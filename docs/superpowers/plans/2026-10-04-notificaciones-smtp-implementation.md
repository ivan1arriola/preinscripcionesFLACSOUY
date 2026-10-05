# Notificaciones SMTP administradas - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir definitivamente el envío por Amazon SES API por SMTP administrado desde Administración, sin exponer secretos, sin variables nuevas de correo y sin perder la cola transaccional existente.

**Architecture:** `system_settings` seguirá siendo la fuente de configuración. La API resuelve una configuración SMTP cifrada mediante la clave de cifrado ya existente, construye un adaptador SMTP con Nodemailer y el dispatcher mantiene la entrega asíncrona desde la outbox. El panel administra, verifica y prueba la configuración, pero nunca devuelve la contraseña. Las claves históricas de AWS se conservan inactivas y no participan en ninguna decisión de envío.

**Tech Stack:** TypeScript, Express, PostgreSQL/Kysely, React/Vite, Nodemailer, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-notificaciones-smtp-design.md`

## Global Constraints

- SMTP es el único proveedor operativo de producción; eliminar SDK, tipos, rutas de ejecución y textos de SES API.
- No agregar variables de entorno de correo. Reutilizar únicamente `APP_SETTINGS_ENCRYPTION_KEY` para valores sensibles.
- Nunca devolver, registrar, serializar en snapshots ni incluir en errores la contraseña SMTP ni valores AWS históricos.
- La migración es aditiva, idempotente y no borra ni transforma las claves SES heredadas.
- Una cola pendiente no se debe reclamar si SMTP está deshabilitado, incompleto o no verificable; los trabajos ya enviados, fallidos y desconocidos se preservan.
- Mantener autenticación administrativa, CSRF, contratos de outbox y reintento manual existentes. No enviar correos reales durante pruebas automatizadas.
- No publicar ni desplegar hasta obtener aprobación explícita para ello; una conexión SMTP real requiere autorización operativa y credenciales fuera del repositorio.

## Review Focus

- Entrada con host que incluye protocolo, puerto fuera de rango, remitente o destinatario inválido: la API debe rechazarla antes de guardar o conectar.
- Contraseña vacía en una edición normal conserva la credencial actual; `replacePassword: true` exige una nueva contraseña no vacía y no permite borrar accidentalmente el secreto.
- Un fallo SMTP antes de aceptar el mensaje puede reintentarse; uno ambiguo después de `DATA` se marca `unknown` y no se reintenta automáticamente.
- Una configuración SES heredada con `email_notifications_enabled=true`, pero sin SMTP completo, deja la outbox pendiente y no crea un proveedor alternativo.
- `GET /email`, errores de validación, logs y UI solo muestran `hasPassword` y datos enmascarados, nunca un secreto.

---

### Task 1: Establecer el contrato SMTP y retirar la dependencia SES del runtime

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Replace: `apps/api/src/infrastructure/email/ses-client.ts`
- Replace tests: `apps/api/src/infrastructure/email/ses-client.test.ts`
- Modify: `apps/api/src/application/email-notification-dispatcher.ts`
- Modify: `apps/api/src/application/email-notification-dispatcher.test.ts`

- [ ] **Step 1: Escribir las pruebas del proveedor neutral antes de cambiarlo.**

  Crear `apps/api/src/infrastructure/email/smtp-email-provider.test.ts` con un transporte inyectado, sin red. Cubrir `verify()`, el mapeo de `from`, `replyTo`, HTML/texto/tags y los tres modos de error (`retryable`, `permanent`, `unknown`). Incluir un caso ambiguo del transporte que nunca autorice reintento automático.

- [ ] **Step 2: Definir los tipos independientes del proveedor.**

  Crear `apps/api/src/infrastructure/email/email-provider.ts` que exporte `EmailMessage`, `EmailProvider` (`verify()` y `send()`), `EmailProviderError` y su clasificación. Mover el fake al mismo módulo o a `fake-email-provider.ts`. Actualizar el dispatcher para depender de esos tipos y no de `SesEmailProviderError`.

- [ ] **Step 3: Implementar `SmtpEmailProvider`.**

  Crear `apps/api/src/infrastructure/email/smtp-email-provider.ts` usando Nodemailer. Construir el transporte desde `SmtpConfig`; mapear `starttls` a `secure: false, requireTLS: true` y `tls` a `secure: true`; implementar `verify()` mediante autenticación SMTP sin envío y `send()` mediante `sendMail()`. Validar destinatarios antes de invocar el transporte y clasificar errores SMTP por códigos y fase, preservando la semántica conservadora para resultados ambiguos.

- [ ] **Step 4: Sustituir el paquete.**

  Quitar `@aws-sdk/client-sesv2`, agregar `nodemailer` y las definiciones TypeScript necesarias, actualizar el lockfile con el gestor ya usado por el repositorio y eliminar `ses-client.ts`/sus pruebas una vez que todas las importaciones apunten al contrato nuevo.

- [ ] **Step 5: Verificar el núcleo aislado.**

  Ejecutar las pruebas nuevas del proveedor y las del dispatcher. Confirmar que el dispatcher marca `retryable`, `permanent` y `unknown` igual que antes, pero a partir de `EmailProviderError`.

### Task 2: Persistir y resolver configuración SMTP de forma aditiva y cifrada

**Files:**
- Create: `apps/api/src/infrastructure/database/migrations/014_smtp_email_settings.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Modify: `apps/api/src/infrastructure/email/email-config.ts`
- Modify: `apps/api/src/infrastructure/email/email-config.test.ts`
- Inspect/retain: `apps/api/src/infrastructure/security/encrypted-settings.ts`
- Inspect/retain: `apps/api/src/infrastructure/database/postgres-system-settings-repository.ts`

- [ ] **Step 1: Escribir casos de configuración primero.**

  Extender `email-config.test.ts` para resolver: SMTP completo y habilitado; SMTP incompleto/deshabilitado; contraseña cifrada; valores AWS heredados ignorados; fake exclusivo de pruebas; y rechazo seguro cuando falta la clave de cifrado para leer un secreto configurado.

- [ ] **Step 2: Agregar la migración `014_smtp_email_settings`.**

  Registrar de forma idempotente las claves no secretas ausentes: `email_provider=smtp`, `smtp_host`, `smtp_port=587`, `smtp_security=starttls`, `smtp_username`, `email_from`, `email_reply_to` y metadatos de estado de verificación definidos por el spec. No sembrar contraseña, no borrar claves `ses_*`, y no asumir disponibilidad de la clave de cifrado durante la migración.

- [ ] **Step 3: Resolver `SmtpConfig` desde ajustes.**

  Cambiar `loadEmailConfig()` para devolver `provider: 'smtp' | 'fake' | 'disabled'`, `enabled`, destinatarios maestros y, sólo si la configuración está completa, `smtp: SmtpConfig`. Desencriptar `smtp_password` únicamente en memoria. Centralizar normalización: host sin esquema, puerto 1–65535, seguridad permitida, correos válidos/deduplicados.

- [ ] **Step 4: Definir el estado de verificación sin secretos.**

  Guardar el resultado mínimo que permita mostrar “sin verificar”, “verificada” o “falló”, su fecha y un mensaje seguro/truncado. El estado debe invalidarse al cambiar cualquier campo de conexión o la contraseña.

- [ ] **Step 5: Verificar migración y configuración.**

  Ejecutar la migración contra la base local de prueba dos veces, comprobar que no cambia claves SES existentes y ejecutar las pruebas de configuración/cifrado. Revisar que ninguna expectativa conserve texto `ses_` como configuración activa.

### Task 3: Conectar SMTP al proceso de despacho sin alterar la outbox

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/worker-notifications.ts`
- Modify: `apps/api/src/application/email-notification-dispatcher.ts`
- Modify: `apps/api/src/application/email-notification-dispatcher.test.ts`
- Inspect/retain: `apps/api/src/ports/email-notification-repository.ts`
- Inspect/retain: `apps/api/src/infrastructure/database/postgres-email-notification-repository.ts`

- [ ] **Step 1: Escribir el caso de configuración no utilizable.**

  Agregar una prueba del dispatcher que recibe `null` de `getProvider()` por SMTP no configurado y confirma que no reclama ni modifica trabajos pendientes. Agregar el caso equivalente para una configuración heredada SES, para impedir cualquier fallback implícito.

- [ ] **Step 2: Instanciar sólo el proveedor SMTP.**

  Reemplazar en `main.ts` y `worker-notifications.ts` la construcción de `SesEmailProvider` por `SmtpEmailProvider`, conservando el fake sólo para pruebas/desarrollo controlado. Actualizar los mensajes operativos para mencionar “correo” o “SMTP”, sin imprimir host, usuario ni secretos.

- [ ] **Step 3: Preservar la semántica de la cola.**

  Mantener `claimPending`, bloqueos, número máximo de intentos, reintento manual y estados. Ajustar sólo la traducción de errores al nuevo `EmailProviderError`; no introducir reintentos automáticos de resultados `unknown`.

- [ ] **Step 4: Verificar integración de proceso.**

  Ejecutar las pruebas del dispatcher y una prueba de arranque con proveedor fake/incompleto. Confirmar por aserciones de repositorio que una cola pendiente sigue pendiente cuando no hay SMTP completo.

### Task 4: Exponer una API administrativa segura de SMTP y pruebas de conexión

**Files:**
- Modify: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/api/src/presentation/http/admin-settings-routes.test.ts`
- Modify if required: `apps/api/src/infrastructure/email/email-config.ts`

- [ ] **Step 1: Reescribir primero las pruebas HTTP de correo.**

  Reemplazar los escenarios SES por: `GET /email` inicial sin secreto; `PUT /email` con SMTP válido y campos guardados cifrados; host/protocolo/puerto/correo inválido; contraseña omitida que preserva el valor; `replacePassword` inválido; acceso sin sesión/CSRF; y ausencia de secreto en cuerpo o error.

- [ ] **Step 2: Cambiar el DTO y `GET /email`.**

  Publicar únicamente `provider: 'smtp'`, `enabled`, host, puerto, seguridad, usuario enmascarado cuando corresponda, `hasPassword`, remitente, reply-to, maestros y estado de verificación. Eliminar región, configuration set, access key, session token y cualquier indicio de credenciales AWS.

- [ ] **Step 3: Implementar `PUT /email` transaccional.**

  Validar y normalizar el payload antes de persistir. Cifrar `smtp_password` mediante `EncryptedSettingsService`; una contraseña vacía sin reemplazo conserva el ciphertext existente. Invalidar el estado de verificación al cambiar conexión/credencial. Mantener los valores AWS existentes sin leerlos, modificarlos ni devolverlos.

- [ ] **Step 4: Separar verificación de envío.**

  Añadir `POST /email/verify`, protegido igual que el resto, que carga la configuración recién guardada, ejecuta `provider.verify()` y actualiza el estado sin enviar. Mantener `POST /email/test` para un destinatario válido y hacer que envíe sólo con configuración SMTP completa y verificada o bajo la política exacta definida en el spec; no mezclar ambos efectos.

- [ ] **Step 5: Verificar rutas y ausencia de fuga.**

  Ejecutar la suite de `admin-settings-routes`. Añadir aserciones explícitas de que ciphertext, contraseña original, nombres de variables AWS y valores de fábrica no aparecen en respuestas, logs de prueba ni snapshots.

### Task 5: Actualizar el panel de Administración y su contrato web

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/AdminNotificationsSettingsCard.tsx`
- Create or modify: `apps/web/src/components/AdminNotificationsSettingsCard.test.tsx`
- Modify: `apps/web/src/pages/AdminProfilesPage.tsx`
- Modify: `apps/web/src/pages/AdminProfilesPage.test.tsx`

- [ ] **Step 1: Ajustar los tipos y mocks del cliente antes de la pantalla.**

  Sustituir tipos `SesEmailSettings`/payloads SES por DTOs SMTP equivalentes. Agregar funciones explícitas para guardar, verificar conexión y enviar prueba; actualizar mocks para no contener secretos ni campos AWS.

- [ ] **Step 2: Rediseñar `AdminNotificationsSettingsCard`.**

  Cambiar la pestaña a `Notificaciones por correo`. Mostrar proveedor fijo “Amazon SES por SMTP”, servidor, puerto, seguridad, usuario, contraseña con estado “configurada” y acción “Cambiar contraseña”, remitente, reply-to y destinatarios maestros. Quitar región, configuration set, Access Key, Secret Key y Session Token.

- [ ] **Step 3: Presentar estado y acciones separadas.**

  Mostrar estado de configuración, última verificación y error seguro. Proveer `Probar conexión` (sin envío) y `Enviar correo de prueba` (con destinatario); deshabilitar acciones cuando faltan datos y comunicar el motivo sin revelar secretos. Conservar la bandeja/outbox, filtros y reintento manual existentes.

- [ ] **Step 4: Probar flujos de UI.**

  Cubrir: carga inicial sin contraseña; guardar sin reemplazarla; activación explícita del reemplazo; validaciones visibles; llamadas separadas de verificación/prueba; estados de error; y presencia del listado de outbox. Actualizar la prueba de pestañas en `AdminProfilesPage`.

### Task 6: Eliminar residuos SES y validar el cambio completo

**Files:**
- Modify as needed: `apps/api/README.md`, `README.md`, `.env.production.example`, runbooks de correo relevantes
- Inspect: `apps/api/src/**`, `apps/web/src/**`, `apps/api/package.json`, `pnpm-lock.yaml`, `docs/**`

- [ ] **Step 1: Auditoría de residuos.**

  Buscar `@aws-sdk/client-sesv2`, `SESv2Client`, `SendEmailCommand`, `SesEmailProvider`, `ses_aws_`, `ses_region`, `ses_configuration_set`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y “Notificaciones SES”. Deben permanecer, si acaso, sólo como referencia explícita de migración histórica; nunca en runtime, UI ni configuración operativa.

- [ ] **Step 2: Actualizar documentación operativa.**

  Documentar que las credenciales SMTP se cargan desde Administración, que la contraseña no se muestra, cómo realizar una verificación sin envío, cómo hacer una prueba autorizada y cómo interpretar `pending`, `failed` y `unknown`. Mantener el aviso de que las claves AWS históricas son inactivas.

- [ ] **Step 3: Ejecutar validación completa local.**

  Ejecutar las suites enfocadas API/web, luego `pnpm --filter api typecheck`, `pnpm --filter web typecheck` (o el script equivalente), builds de ambos paquetes y `git diff --check`. Si hay entorno de navegador local disponible, verificar la pestaña de Administración con mocks/local sin enviar correo real.

- [ ] **Step 4: Revisar el diff de seguridad antes de publicar.**

  Confirmar que no se añadió `.env`, ciphertext real, usuario/contraseña SMTP, logs sensibles ni cambios no relacionados. Revisar que migración, API, worker y web cambian de manera coherente y que la outbox no fue reescrita.

## Completion Criteria

- Producción puede configurarse exclusivamente con SMTP desde Administración y el backend no carga AWS SDK ni intenta SES API.
- La contraseña SMTP está cifrada al guardar, no se devuelve por HTTP y se conserva cuando la edición no la reemplaza.
- Verificar conexión no envía; el envío de prueba es una acción distinta y auditada por la outbox/log disponible.
- La cola existente conserva sus registros y no genera duplicados ni reintenta automáticamente resultados ambiguos.
- Pruebas, typechecks y builds relevantes pasan localmente; cualquier verificación SMTP real, publicación, CI, despliegue y validación en producción se informa por separado.
