# Amazon SES: notificaciones de preinscripciones - Implementation Plan

> **Para agentes de implementación:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans`. Ejecutar las tareas en orden y mantener cada paso verificable.

**Objetivo:** Enviar notificaciones transaccionales mediante Amazon SES cada vez que una preinscripción se complete correctamente, separando el contenido privado enviado al postulante del contenido operativo enviado a la oferta académica y a los correos maestros.

**Arquitectura:** WordPress será la fuente de verdad del correo opcional de notificación de cada oferta académica y seminario. La aplicación React/TypeScript validará la preinscripción, persistirá los datos, confirmará Drive y Sheets, y generará una bandeja transaccional de notificaciones. Un dispatcher entrega los mensajes pendientes a Amazon SES mediante AWS SDK for JavaScript v3. Las notificaciones se crean con datos y enlaces capturados en el momento de la preinscripción; nunca se construye el correo del postulante leyendo la fila de Google Sheets.

**Stack:** TypeScript, Express, PostgreSQL/Kysely, React, WordPress REST v1, `@aws-sdk/client-sesv2`, Amazon SES API v2, Vitest y Testing Library.

**Dependencia funcional:** Este plan depende de que la reconciliación dinámica Drive–Sheets del plan `docs/superpowers/plans/2026-10-04-fixes-feedback-preinscripciones.md` esté implementada o de que el agente replique sus contratos finales. Para las notificaciones operativas se necesita conocer la URL directa de la fila de Sheets y la carpeta de documentos.

**Documentación oficial de AWS:**
- [AWS SDK for JavaScript v3: envío con SES](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/ses-examples-sending-email.html).
- [API `SendEmail` de SES](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
- [Salir del sandbox de SES](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Alcance exacto

Después de una preinscripción completada:

1. El postulante recibe un correo a `values.email`.
2. La oferta académica o seminario recibe un correo a `target.notificationEmail` si ese campo está declarado y es válido.
3. Uno o varios correos maestros reciben la notificación operativa completa.
4. El correo al postulante contiene los datos que ingresó, con etiquetas humanas, y no contiene enlaces ni datos provenientes de Google Sheets.
5. El correo a la oferta y a los maestros contiene:
   - enlace directo a la fila registrada en el Spreadsheet;
   - enlace directo a la carpeta donde quedaron los archivos;
   - datos completos de la preinscripción al final del mensaje.
6. La notificación no transforma un envío exitoso en fallido si SES está temporalmente indisponible. El sistema conserva el trabajo pendiente y lo reintenta con control de duplicados.

## Estado previo y límites

- El checkout principal es `/home/ivan/repositorios/FLACSO Uruguay/preinscripcionesFLACSOUY`.
- El checkout esperado del plugin es `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin`. Si no existe, localizar el checkout real antes de editar; no crear ni usar el hermano vacío.
- No copiar credenciales AWS, claves privadas, archivos `.env` ni datos personales reales al repositorio.
- No almacenar credenciales AWS en texto plano en PostgreSQL; guardar únicamente ciphertext, nonce/IV, tag de autenticación y versión del algoritmo.
- No enviar correos reales durante las pruebas locales. Usar un fake de SES o el mailbox simulator de AWS en una prueba operativa autorizada.
- No activar producción, solicitar salida del sandbox ni configurar DNS/DKIM automáticamente desde este plan.
- Los cambios locales existentes en el checkout principal deben preservarse y excluirse de los commits de esta feature.

## Decisiones funcionales

### Identidad y destinatarios

- Nuevo campo REST y de dominio: `notificationEmail?: string`.
- Etiqueta administrativa en WordPress: `Correo electrónico para notificaciones de preinscripciones`.
- El campo es opcional para ofertas académicas y seminarios.
- Si está vacío, no se crea la notificación específica del target.
- El plugin debe sanitizar el valor: un correo inválido se guarda como vacío/null y el catálogo no recibe una dirección inválida. Un error de configuración de notificaciones no debe impedir que el postulante reciba su confirmación.
- Los correos maestros se almacenan como una lista normalizada en `system_settings`, clave `notification_master_emails`, no como una lista escrita en el código.
- Cada dirección maestra genera su propia entrega lógica, con el mismo contenido operativo, para poder registrar su estado individualmente.

### Remitente y SES

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y, si corresponde, `AWS_SESSION_TOKEN` se administrarán desde el panel administrativo y se persistirán cifrados en PostgreSQL.
- La clave maestra de cifrado no se guarda en PostgreSQL, Git ni `.env` del repositorio; será un secreto externo del runtime, por ejemplo `APP_SETTINGS_ENCRYPTION_KEY` provisto por Docker Secret, AWS Secrets Manager o el mecanismo seguro del deploy.
- `AWS_REGION`, `SES_FROM_EMAIL`, `SES_CONFIGURATION_SET` y `SES_REPLY_TO_EMAIL` también podrán administrarse desde el panel. Los valores no secretos pueden persistirse sin cifrar, pero se recomienda cifrar toda la configuración SES de forma uniforme.
- `SES_FROM_EMAIL` es obligatorio en producción y debe ser una identidad verificada por SES.
- `AWS_REGION` es obligatorio; la identidad SES y el cliente deben usar la misma región.
- El cliente SES debe recibir las credenciales descifradas solo en memoria al momento de enviar; nunca escribirlas en logs, respuestas HTTP, snapshots ni outbox.
- `SES_CONFIGURATION_SET` es opcional en desarrollo y recomendado en producción para eventos de entrega, rebote y queja.
- `SES_REPLY_TO_EMAIL` es opcional. Para notificaciones operativas se puede usar el correo del postulante como `Reply-To` si la política institucional lo aprueba; nunca se debe usar una dirección no validada como `From`.

### Momento del envío

El correo no se envía antes de que la preinscripción esté persistida y Drive/Sheets hayan terminado correctamente. La secuencia es:

```text
validar formulario
  -> persistir preinscripción
  -> guardar archivos en Drive
  -> registrar fila en Sheets
  -> marcar procesamiento como success
  -> crear/asegurar notificaciones outbox
  -> dispatcher entrega por SES
```

Si el proceso se interrumpe entre `success` y la creación del outbox, una reconciliación posterior debe crear las notificaciones faltantes a partir de la preinscripción persistida y de los metadatos de Drive/Sheets registrados.

## Global Constraints

- El correo del postulante nunca incluye enlaces a Sheets, Drive, IDs internos, tokens de archivos ni datos leídos de la planilla.
- El correo operativo nunca expone credenciales, tokens temporales ni errores internos de AWS.
- No enviar el mismo mensaje lógico dos veces por un reintento normal.
- Un fallo de SES no debe borrar archivos temporales ni modificar una preinscripción ya persistida.
- Las direcciones se validan, normalizan y deduplican antes de crear trabajos.
- Todos los correos se construyen desde snapshots de dominio, no desde el estado mutable actual de WordPress o Sheets.
- Los templates deben tener versión explícita para preservar trazabilidad histórica.
- El tamaño total del mensaje debe mantenerse debajo del límite de SES; no adjuntar documentos. Los correos contienen enlaces.
- El API público conserva su contrato `201` para una preinscripción persistida; el estado de notificación se registra aparte.
- No usar emojis en código, comentarios, nombres de variables ni logs técnicos.

## Review Focus

- El postulante debe recibir solo sus datos ingresados, sin enlace a Sheets o Drive.
- Una oferta sin `notificationEmail` debe seguir funcionando y enviar al postulante y maestros.
- Una oferta con correo inválido no debe impedir el envío al postulante ni crear un destinatario SES inválido.
- Un master repetido o igual al correo de la oferta debe recibir como máximo una entrega lógica por dirección.
- Una caída de SES después de persistir la preinscripción debe dejar el trabajo reintentable y no duplicar los mensajes ya aceptados.
- Un cambio posterior del correo de WordPress no debe alterar retroactivamente el destinatario del envío ya creado.

---

### Tarea 1: Auditar contratos existentes y localizar el checkout del plugin

**Archivos:**
- Inspeccionar: `packages/contracts/src/catalog.ts`.
- Inspeccionar: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`.
- Inspeccionar: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`.
- Inspeccionar: `apps/api/src/presentation/http/submission-routes.ts`.
- Inspeccionar: `apps/api/src/application/submit-preinscription.ts`.
- Inspeccionar: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin`.

- [x] **Paso 1: Confirmar el checkout correcto del plugin**

Ejecutar:

```bash
find "/home/ivan/repositorios/FLACSO Uruguay" -path '*/flacso-uruguay-plugin' -type d -print
git -C "/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin" status --short --branch
```

Si la ruta esperada no existe, detener la tarea de plugin y registrar la ruta correcta antes de modificar archivos.

- [x] **Paso 2: Documentar el contrato actual de target**

Identificar en el plugin el modelo de oferta académica y cohorte, el modelo de seminario y edición, el campo de correo existente por oferta, el endpoint `GET /wp-json/flacso/v1/preinscripciones`, el serializer, `configRevision` y los tests PHP del contrato REST.

Resultado esperado: una tabla que indique dónde se agrega `notificationEmail` para ofertas y seminarios, sin confundirlo con el correo público de contacto.

- [x] **Paso 3: Confirmar el punto de integración del envío**

Verificar que el envío final pasa por `createSubmissionRoutes()` y que `submitPreinscription()` devuelve el `AcademicTarget` revalidado o suficiente información para construir el snapshot de notificación.

---

### Tarea 2: Agregar el correo opcional de notificación al contrato WordPress

**Repositorios:**
- Plugin WordPress: checkout correcto descubierto en la Tarea 1.
- Aplicación: checkout `preinscripcionesFLACSOUY`.

**Archivos esperados en la aplicación:**
- Modificar: `packages/contracts/src/catalog.ts`.
- Modificar: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`.
- Modificar: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`.
- Modificar: `apps/api/src/infrastructure/fixtures/fixture-academic-catalog.ts` y fixtures JSON si corresponde.
- Modificar: `apps/api/src/infrastructure/wordpress/wordpress-contract.test.ts`.

**Contrato:**

```ts
export interface AcademicTarget {
  // ...campos existentes...
  notificationEmail?: string;
}
```

En JSON, el campo debe ser `notificationEmail`, omitido o `null` cuando no está configurado. No usar una cadena vacía como señal ambigua después del mapeo.

- [x] **Paso 1: Escribir pruebas del contrato REST**

Agregar casos para una oferta con `notificationEmail: "coordinacion@flacso.edu.uy"` y un seminario con `notificationEmail: null`. Verificar que ausencia/null sea aceptado y el valor válido se conserve. Agregar un caso de entrada inválida en el administrador y comprobar que el guardado la convierte en vacío/null; el REST nunca debe publicar una dirección inválida.

- [x] **Paso 2: Agregar el campo en WordPress**

En el plugin, agregar el campo a las pantallas de administración de oferta/cohorte y seminario/edición, con capacidades y nonce iguales a los controles existentes, guardado sanitizado, valor vacío permitido, etiqueta `Correo electrónico para notificaciones de preinscripciones` y sin mostrarlo en el formulario público.

- [x] **Paso 3: Exponer el campo en REST v1**

Agregar `notificationEmail` al serializer de ambos tipos. El valor debe salir normalizado o `null`, nunca incluir campos privados adicionales.

- [x] **Paso 4: Mapear el campo en TypeScript**

Actualizar `WordPressTargetSchema`, `AcademicTarget` y `mapTarget()`. Mantenerlo fuera de `FormDefinition` porque es configuración de notificación del target, no un campo que complete el postulante.

- [x] **Paso 5: Verificar**

En el plugin ejecutar `php -l` sobre los archivos modificados y los tests PHP del contrato REST. En la aplicación ejecutar:

```bash
pnpm --filter api test src/infrastructure/wordpress/wordpress-contract.test.ts
pnpm --filter api typecheck
```

---

### Tarea 3: Configurar destinatarios maestros y runtime de Amazon SES

**Archivos:**
- Modificar: `apps/api/package.json`.
- Crear: `apps/api/src/infrastructure/email/ses-client.ts`.
- Crear: `apps/api/src/infrastructure/email/email-config.ts`.
- Crear: `apps/api/src/infrastructure/security/encrypted-settings.ts`.
- Crear: `apps/api/src/infrastructure/security/encrypted-settings.test.ts`.
- Crear: `apps/api/src/infrastructure/email/ses-client.test.ts`.
- Modificar: `apps/api/src/main.ts`.
- Modificar o crear pruebas de `system_settings` y rutas administrativas.

**Dependencia:** usar `@aws-sdk/client-sesv2` y solo imports desde el package root. Crear `SESv2Client` con región y credenciales obtenidas desde la configuración SES descifrada en memoria.

Para esta feature, la configuración SES se leerá desde `system_settings`, no directamente desde variables individuales. `APP_SETTINGS_ENCRYPTION_KEY` solo desbloquea los valores cifrados. Si no está disponible, el proceso debe fallar cerrado cuando las notificaciones estén habilitadas.

**Interfaces:**

```ts
export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string[];
  tags: Record<string, string>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
```

El adapter SES traduce a `SendEmailCommand` usando `Destination.ToAddresses`, `Content.Simple.Subject`, `Content.Simple.Body.Text`, `Content.Simple.Body.Html`, `ReplyToAddresses`, `ConfigurationSetName` y `EmailTags`.

- [x] **Paso 1: Escribir pruebas del cifrado y configuración**

En `encrypted-settings.test.ts`, cubrir cifrado/descifrado correcto, ciphertext diferente para dos nonces, rechazo de ciphertext alterado, rechazo de clave maestra ausente y ausencia de plaintext en el valor persistido. En las pruebas de configuración cubrir producción sin `APP_SETTINGS_ENCRYPTION_KEY`, configuración SES incompleta en `system_settings`, desarrollo con provider fake explícito y normalización/validación/deduplicación de maestros.

- [x] **Paso 2: Agregar configuración segura**

Definir únicamente la variable externa nueva:

```text
APP_SETTINGS_ENCRYPTION_KEY
```

Las siguientes claves de `system_settings` se guardarán mediante el servicio de cifrado:

```text
ses_aws_access_key_id
ses_aws_secret_access_key
ses_aws_session_token opcional
ses_region
ses_from_email
ses_reply_to_email opcional
ses_configuration_set opcional
notification_master_emails
email_notifications_enabled
```

No guardar `APP_SETTINGS_ENCRYPTION_KEY` en la misma base de datos. No introducir credenciales AWS en archivos del repositorio.

- [x] **Paso 3: Agregar almacenamiento administrativo cifrado**

Extender las rutas protegidas de administración para guardar cada valor mediante `EncryptedSettingsService`. La API nunca debe devolver secretos; al leer, devolver solo `configured: true|false`, región, remitente enmascarado y configuración set enmascarada. Para reemplazar una credencial, el administrador debe enviar un nuevo valor explícito; no mostrar el valor anterior.

Agregar auditoría mínima de cambios (`key`, actor, fecha, resultado), sin guardar el valor ni el ciphertext completo en logs.

- [x] **Paso 4: Implementar el adapter SES**

`SesEmailProvider.send()` debe rechazar destinatarios vacíos o inválidos antes de llamar a AWS, no mezclar destinatarios privados, capturar nombre/status/messageId sin registrar cuerpos con PII, convertir errores de SES a un error de dominio estable y aplicar configuration set/tags cuando estén configurados.

- [x] **Paso 5: Agregar destinatarios maestros en administración**

Reutilizar las rutas protegidas y `system_settings`. Agregar un endpoint administrativo para leer/guardar configuración SES y maestros con sesión y CSRF iguales a `/api/admin/settings/google-drive`. El frontend debe permitir agregar, quitar y guardar correos, mostrando errores de formato y nunca mostrando las claves AWS.

- [x] **Paso 6: Verificar**

```bash
pnpm --filter api test src/infrastructure/email/ses-client.test.ts src/presentation/http/admin-settings-routes.test.ts
pnpm --filter api typecheck
```

---

### Tarea 4: Crear snapshot y templates separados por audiencia

**Archivos:**
- Crear: `apps/api/src/application/notification-snapshot.ts`.
- Crear: `apps/api/src/application/notification-snapshot.test.ts`.
- Crear: `apps/api/src/infrastructure/email/notification-templates.ts`.
- Crear: `apps/api/src/infrastructure/email/notification-templates.test.ts`.

**Interfaces:**

```ts
export type NotificationAudience = 'applicant' | 'target' | 'master';

export interface SubmissionNotificationSnapshot {
  submissionId: string;
  targetId: string;
  targetTitle: string;
  targetKind: 'academic_offer' | 'seminar';
  applicantEmail: string;
  notificationEmail?: string;
  values: Record<string, { key: string; label: string; value: string }>;
  spreadsheetRowUrl: string;
  documentsFolderUrl: string;
  templateVersion: 'preinscription-notification-v1';
}

export interface RenderedNotification {
  audience: NotificationAudience;
  to: string;
  subject: string;
  text: string;
  html: string;
  tags: Record<string, string>;
}
```

- [x] **Paso 1: Escribir pruebas del snapshot**

Construir un snapshot con nombre, documento, email, país y ciudad. Verificar etiquetas de `FormDefinition`, valores normalizados, target y destinatarios congelados, y ausencia de tokens de archivos o secretos.

- [x] **Paso 2: Escribir pruebas del correo al postulante**

Verificar que contiene los datos ingresados, el título de la oferta y una referencia pública opcional, pero no contiene `docs.google.com/spreadsheets`, `drive.google.com`, `spreadsheetId`, `driveFileId` ni `token`.

- [x] **Paso 3: Escribir pruebas del correo operativo**

Verificar que target y maestros reciben el enlace directo al Spreadsheet, la URL de la carpeta de documentos y los datos completos después de una sección de enlaces/resumen. Verificar que no se usa el correo del target cuando está vacío.

- [x] **Paso 4: Implementar templates texto y HTML**

Mantener contenido equivalente en texto plano y HTML. Escapar valores de usuario antes de interpolarlos en HTML. No adjuntar archivos. No incluir la fila cruda de Sheets; construir la sección de datos desde el snapshot.

- [x] **Paso 5: Verificar**

```bash
pnpm --filter api test src/application/notification-snapshot.test.ts src/infrastructure/email/notification-templates.test.ts
pnpm --filter api typecheck
```

---

### Tarea 5: Capturar enlaces directos a Sheets y Drive

**Archivos:**
- Modificar: `apps/api/src/ports/spreadsheet-repository.ts`.
- Modificar: `apps/api/src/infrastructure/google/sheets-client.ts`.
- Modificar: `apps/api/src/infrastructure/google/google-sheets-repository.ts`.
- Modificar: `apps/api/src/ports/google-drive-repository.ts`.
- Modificar: `apps/api/src/infrastructure/google/google-drive-repository.ts`.
- Modificar: `apps/api/src/application/target-spreadsheet-service.ts`.
- Modificar pruebas de Drive/Sheets existentes.

**Contratos:**

```ts
export interface AppendResult {
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  updatedRange: string;
  rowUrl: string;
  updatedRows: number;
}

export interface StoredDriveFiles {
  files: StoredDriveFile[];
  documentsFolderId: string;
  documentsFolderUrl: string;
}
```

- [x] **Paso 1: Resolver el `sheetId` real**

Agregar al cliente Sheets una operación de metadata equivalente a `GET /v4/spreadsheets/{id}?fields=sheets.properties`. No asumir `gid=0`. Guardar `sheetId` junto a `sheetName` en la configuración operativa.

- [x] **Paso 2: Construir la URL de la fila**

Crear una función pura `buildSpreadsheetRowUrl(spreadsheetId: string, sheetId: number, updatedRange: string): string`. Extraer la fila del rango devuelto por Google y producir `https://docs.google.com/spreadsheets/d/<id>/edit#gid=<sheetId>&range=<A2:Z2>`. Si el rango es inesperado, devolver enlace al Spreadsheet completo y registrar warning técnico sin PII.

- [x] **Paso 3: Devolver la carpeta de documentos**

Modificar `storeSubmissionFiles()` para devolver la carpeta final donde quedaron los archivos, incluso si hay un solo documento. Si no hay archivos, resolver igualmente la carpeta `Documentación` del target para que el correo operativo tenga un enlace estable.

- [x] **Paso 4: Verificar enlaces**

Agregar pruebas para nombres de hojas con espacios, rangos `A2:Z2`, distintos `sheetId`, carpetas ya existentes y ausencia de documentos.

```bash
pnpm --filter api test src/infrastructure/google/google-sheets-repository.test.ts src/infrastructure/google/google-drive-repository.test.ts
pnpm --filter api typecheck
```

---

### Tarea 6: Persistir el outbox de notificaciones

**Archivos:**
- Crear: `apps/api/src/infrastructure/database/migrations/012_email_notifications.ts`.
- Modificar: `apps/api/src/infrastructure/database/migrate.ts`.
- Crear: `apps/api/src/ports/email-notification-repository.ts`.
- Crear: `apps/api/src/infrastructure/database/postgres-email-notification-repository.ts`.
- Crear: `apps/api/src/infrastructure/database/in-memory-email-notification-repository.ts`.
- Crear pruebas para ambos repositorios.

**Tabla propuesta:** `email_notifications` con `id`, `submission_id`, `audience`, `recipient_email`, `target_id`, `template_version`, `payload_json`, `status`, `attempt_count`, `provider_message_id`, `last_error`, `available_at`, `locked_until`, `sent_at`, `created_at` y `updated_at`. Usar FK a `submissions`, índice por `status/available_at` y restricción única sobre `(submission_id, audience, recipient_email, template_version)`.

**Interfaz:**

```ts
export interface EnsureEmailNotificationsInput {
  submissionId: string;
  snapshot: SubmissionNotificationSnapshot;
  recipients: Array<{ audience: NotificationAudience; email: string }>;
}

export interface EmailNotificationRepository {
  ensureForSubmission(input: EnsureEmailNotificationsInput): Promise<EmailNotificationRecord[]>;
  claimPending(limit: number, now: Date): Promise<EmailNotificationRecord[]>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<void>;
  markRetryableFailure(id: string, error: string, availableAt: Date): Promise<void>;
  markUnknown(id: string, error: string): Promise<void>;
  listMissingForSuccessfulSubmissions(limit: number): Promise<string[]>;
}
```

- [x] **Paso 1: Escribir pruebas de idempotencia**

Llamar dos veces `ensureForSubmission()` con el mismo snapshot y comprobar que no duplica jobs. Cambiar el correo de WordPress después de crear el snapshot y comprobar que no modifica el job histórico.

- [x] **Paso 2: Escribir pruebas de claim y lease**

Comprobar que dos workers no reclaman el mismo job al mismo tiempo y que un lease vencido vuelve a estar disponible.

- [x] **Paso 3: Crear migración y repositorios**

Persistir solo el payload de notificación necesario. No guardar claves AWS ni documentos binarios. En la migración descendente, borrar solo la tabla nueva.

- [x] **Paso 4: Verificar**

```bash
pnpm --filter api test src/infrastructure/database/*email-notification*.test.ts
pnpm --filter api typecheck
```

---

### Tarea 7: Encolar notificaciones al completar una preinscripción

**Archivos:**
- Crear: `apps/api/src/application/create-preinscription-notifications.ts`.
- Modificar: `apps/api/src/presentation/http/submission-routes.ts`.
- Modificar: `apps/api/src/application/submit-preinscription.ts` si hace falta devolver el snapshot del target.
- Modificar pruebas de `submission-routes` y `submit-preinscription`.

**Interfaz:**

```ts
export interface CreateNotificationsInput {
  submissionId: string;
  target: AcademicTarget;
  form: FormDefinition;
  values: Record<string, string>;
  spreadsheetRowUrl: string;
  documentsFolderUrl: string;
  masterRecipients: string[];
}
```

- [x] **Paso 1: Escribir prueba de orden de operaciones**

Simular una preinscripción completa y verificar este orden observable: `saveOrGet`, Drive, Sheets, `markProcessing(success)` y `ensureForSubmission`. Un fallo de Drive o Sheets no debe crear notificaciones enviables.

- [x] **Paso 2: Implementar destinatarios**

Crear como máximo un job `applicant` para `values.email`, uno `target` si `target.notificationEmail` es válido y uno `master` por cada correo maestro válido y único. Si target y master comparten dirección, deduplicar por dirección para evitar dos entregas visibles.

- [x] **Paso 3: Conectar el route sin envío síncrono**

Encolar después de que Drive y Sheets devuelvan enlaces y después de marcar éxito. La respuesta `201` no debe esperar SES. Si falla el outbox, marcar estado de notificación degradado y registrar error técnico; no revertir la preinscripción persistida.

- [x] **Paso 4: Agregar reconciliación**

Usar `listMissingForSuccessfulSubmissions()` para crear jobs de preinscripciones exitosas que no tengan notificaciones. No inventar enlaces: si faltan enlaces operativos, dejar el job en `failed` con causa explícita.

- [x] **Paso 5: Verificar**

```bash
pnpm --filter api test src/presentation/http/submission-routes.test.ts src/application/submit-preinscription.test.ts
pnpm --filter api typecheck
```

---

### Tarea 8: Implementar dispatcher y reintentos Amazon SES

**Archivos:**
- Crear: `apps/api/src/application/email-notification-dispatcher.ts`.
- Crear: `apps/api/src/application/email-notification-dispatcher.test.ts`.
- Modificar: `apps/api/src/main.ts`.
- Modificar: `apps/api/package.json` para script operativo si se necesita.

**Reglas de estado:** `pending`, `sending`, `sent`, `failed` y `unknown`. Un job `unknown` no se reintenta automáticamente sin verificación operativa para evitar duplicados.

- [x] **Paso 1: Escribir pruebas del dispatcher**

Cubrir envío exitoso, error transitorio con backoff, error permanente por dirección inválida, excepción sin `providerMessageId`, lease vencido y no reenvío de jobs `sent`.

- [x] **Paso 2: Implementar backoff y clasificación**

Usar backoff de 1 minuto, 5 minutos, 30 minutos y 2 horas, con máximo configurable. Clasificar errores SES por nombre/status sin almacenar el cuerpo completo de la excepción.

- [x] **Paso 3: Renderizar por audiencia y llamar al provider**

Leer el snapshot, usar el template correcto, enviar una sola dirección por job y guardar el `MessageId` retornado por SES. Agregar tags `submissionId`, `targetId` y `audience`.

- [x] **Paso 4: Integrar el loop de ejecución**

Inicializar el cliente SES una vez, fuera del ciclo. Preferir un proceso `notifications:worker` separado o un cron supervisado con lease; no usar un `setInterval` sin protección contra múltiples instancias.

- [x] **Paso 5: Verificar**

```bash
pnpm --filter api test src/application/email-notification-dispatcher.test.ts
pnpm --filter api build
```

---

### Tarea 9: Administración, observabilidad y operación SES

**Archivos:**
- Modificar: `apps/api/src/presentation/http/admin-settings-routes.ts`.
- Modificar: `apps/web/src/components/AdminDriveSettingsCard.tsx` o crear componente administrativo dedicado.
- Crear o modificar pruebas de rutas/UI.
- Actualizar: `docs/DEPLOY.md` y documentación operativa.

- [x] **Paso 1: Mostrar estado de notificaciones**

Agregar una vista administrativa protegida con conteos `pending`, `failed`, `unknown` y `sent`, sin mostrar el contenido completo de datos personales a usuarios no autorizados.

- [x] **Paso 2: Agregar reintento manual seguro**

Permitir reintentar solo `failed` después de confirmar la dirección. No permitir reintentar `unknown` sin verificar `MessageId` o evento SES.

- [x] **Paso 3: Documentar infraestructura AWS**

Documentar región SES, identidad o dominio verificado, DKIM/SPF/DMARC, salida del sandbox, IAM mínimo `ses:SendEmail`, configuration set, destino de eventos y límites de envío. SES exige una identidad remitente verificada; en sandbox también limita destinatarios a identidades verificadas.

- [x] **Paso 4: Verificar con mailbox simulator o entorno autorizado**

Probar postulante, target configurado, target sin correo, dos maestros, rebote simulado, caída de SES y reintento. No usar datos reales.

---

### Tarea 10: Verificación integral y criterios de aceptación

- [x] **Paso 1: Ejecutar validaciones locales**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

- [x] **Paso 2: Auditar referencias y secretos**

```bash
rg -n "AWS_SECRET|AWS_ACCESS_KEY|SES_FROM_EMAIL|notificationEmail|notification_master_emails|SendEmailCommand" apps packages docs
git diff -- . ':!*.lock' | rg -n "AKIA|BEGIN .*PRIVATE KEY|secret|token" || true
```

No debe haber credenciales ni tokens reales.

- [x] **Paso 3: Verificar contratos**

Comprobar que plugin REST, schema Zod, `AcademicTarget`, caché WordPress y snapshot usan `notificationEmail` con la misma semántica opcional.

- [x] **Paso 4: Verificar privacidad**

Inspeccionar cuerpos text/html: postulante con datos ingresados y sin Sheets/Drive; target/masters con enlaces directos y datos al final; ningún correo con tokens, secretos, errores AWS, credenciales o datos de otra preinscripción.

- [x] **Paso 5: Separar publicación y producción**

Reportar por separado tests locales, commit, push, CI, deploy, configuración SES, salida del sandbox, entrega real y revisión de rebotes. Un build verde no demuestra que SES esté habilitado ni que el correo haya llegado.

## Criterios de aceptación finales

1. WordPress guarda y expone un correo opcional por oferta académica y seminario.
2. Una preinscripción exitosa genera notificación al postulante, al target cuando corresponde y a todos los maestros válidos.
3. El correo del postulante no contiene datos obtenidos de Sheets ni enlaces privados.
4. Los correos operativos contienen el enlace a la fila y a la carpeta de documentos, además de los datos al final.
5. Los datos usados por cada correo provienen de un snapshot versionado.
6. La notificación es idempotente y reintentable sin duplicar entregas normales.
7. Un fallo de SES no borra ni invalida una preinscripción persistida.
8. La configuración maestra está protegida por autenticación y no se guarda en el código.
9. Las credenciales SES quedan cifradas en PostgreSQL, la clave maestra queda fuera de PostgreSQL y ningún secreto aparece en respuestas o logs.
10. Producción usa identidad SES verificada, credenciales IAM mínimas, región explícita y estado de sandbox conocido.
11. Todas las pruebas, typecheck, build y auditorías de secretos pasan.
