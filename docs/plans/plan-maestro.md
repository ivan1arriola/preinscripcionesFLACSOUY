# Plan maestro: panel admin, configuración en UI, seguridad, calidad y documentación

> Plan vigente del proyecto. Se actualiza junto con [docs/plans/bitacora.md](./bitacora.md) en el mismo commit de cada incremento.

Versión 3, reconciliada. Reemplaza a todas las anteriores. Incorpora las revisiones de Codex y Antigravity, la auditoría de seguridad (haiku buscó, opus verificó), los informes de rendimiento y de librerías, el análisis final de opus y el análisis de ponytail. El usuario aceptó los recortes de ponytail (administradores simples, seguridad sin subsistemas nuevos, UI mínima, documentación y rendimiento acotados) y que las dependencias mayores se actualicen **un mayor por commit, con TypeScript 7 primero**.

## 1. Contexto
- El panel admin (`AdminProfilesPage`, ruta `/admin/perfiles`) mezcla configuración con bandejas operativas; Meta, GA4, WordPress y retención solo existen como variables de entorno (E6 los pasa al panel como única fuente).
- Hay CSS y botones rotos en producción (no hay Tailwind pero el JSX asume sus clases; `main.tsx` importa `App` antes que los CSS; selectores con doble escape inválido; tres botones con texto blanco sobre fondo inexistente).
- Hay restos de funciones retiradas (perfiles dinámicos, SES, un worker duplicado), un correo real versionado en código, migración, compose, docs y tests, 22 dependencias desactualizadas, cobertura sin medir y documentación dispersa.
- Código: unas 27.500 líneas (19.400 de API y 8.100 de web). Producción: un solo contenedor de API (`postgres`, `api`, `web` en `deploy/docker-compose.production.yml`), PostgreSQL 16, Node 24.

## 2. Decisiones cerradas

**Del usuario (no se discuten, solo el cómo):** configuración de Meta, GA4, WordPress y retención editable por UI; administradores por UI con `ADMIN_ALLOWED_EMAILS` solo como bootstrap; `ADMIN_SESSION_TTL_MINUTES` obsoleta; SES fuera; reCAPTCHA y Telegram independientes de WordPress y plugin de WordPress sin tocar; ningún correo real versionado; cobertura real ≥ 90%; tablero de analítica con gráficos; documentación pensada para quien desarrolla; dependencias a la última versión (un mayor por commit, TypeScript 7 primero); wouter como router; TanStack Query en todo el frontend; Radix y lucide-react; metodología de épicas e incrementos; trabajo pasable entre Claude, Codex y Antigravity.

**Mías (cerradas salvo que el usuario diga otra cosa):**

| Tema | Decisión |
|---|---|
| Migraciones | **Se mantiene el runner actual** (`migrate.ts`, lista explícita e idempotente, corre al arrancar). Una migración `031` aditiva con `IF NOT EXISTS`. Sin `Migrator` de Kysely (su `FileMigrationProvider` cargaría `014_smtp_email_settings.test.js` desde `dist/` y fallaría en producción) y sin `pg_advisory_lock` a mano (una sola réplica). Si una migración lanza, la API **sale con error** en lugar de seguir como hoy (`main.ts:196-200`). |
| Comandos en producción | Los scripts usan `tsx` (devDependency, no existe en la imagen de producción). Todo comando de operador corre con `docker compose run --rm api node apps/api/dist/...`. |
| Administradores | `admin_users` **nunca se usó para autorizar** (solo la migración 006 y `schema.ts:343`; la autorización es `getAllowedAdminEmails()`). Tabla nueva `admin_allowed_emails` (`email` en minúsculas como clave, `added_by`, `added_at`). La 006 deja de sembrar `admin_users` (el correo real sale del repo en ese commit). **La tabla `admin_users` no se borra en la misma entrega:** un despliegue posterior, ya pasada la ventana de rollback, agrega una migración que la elimina y retira `schema.ts` (fase de contracción). Autorización = entorno ∪ tabla. Los correos del entorno son fijos e irremovibles. Nadie puede quitarse a sí mismo. Al quitar a alguien se borran su membresía y sus sesiones en una transacción (columna `email` de `admin_sessions`; también en `MemoryAdminSessionStore`) y la autorización se revalida en el middleware y en `/me`. **Sin comando `admin:add`**: la recuperación es editar `ADMIN_ALLOWED_EMAILS` y reiniciar. **El estado del login OAuth queda en memoria** (una sola réplica; un reinicio a mitad de un login solo obliga a repetirlo). |
| Sin `ADMIN_ALLOWED_EMAILS` | El compose de producción la exige (`:?`), así que el deploy aborta con un mensaje claro. Si en ejecución la lista queda vacía, la API arranca, registra el error y rechaza el login admin; el formulario público sigue funcionando. |
| Sesión admin | Constante de 12 h, deslizante como hoy. Antes de retirar la variable, confirmar que producción no la usa con otro valor. |
| Cifrado de ajustes | Solo los **secretos** (token de Meta CAPI, `GA4_API_SECRET` —secreto de Measurement Protocol de GA4—, token del catálogo de WordPress) van cifrados con `EncryptedSettingsService`, con lectura estricta y `PUT` con 503 si falta `APP_SETTINGS_ENCRYPTION_KEY`. Los no secretos (Pixel ID, GA4 ID, URL de WordPress, días de retención) van en claro en `system_settings`. Los secretos son de solo escritura: la API devuelve "configurado sí/no". Validar Pixel ID (dígitos) y GA4 (`^G-[A-Z0-9]+$`). |
| `WORDPRESS_URL` editable | Solo HTTPS en producción, `redirect: 'manual'` sin reenviar `Authorization` a otro origen, reingresar el token al cambiar el origen, y borrar la caché del catálogo al guardar. Sin "revisión compartida con vuelta atrás". |
| Sweeper | Solo lectura en la UI; activarlo sigue el checklist de `docs/operacion-envios.md` (`sweep:once --dry-run`). |
| Retención | Un helper único con el valor de la UI. Aplica a vencimientos nuevos; los existentes conservan el suyo. Hay **dos** retenciones: 7 días fijos para incidentes y archivos (hoy en `submission-routes.ts:437,445,511,519,552,584`, `sweep-abandoned-submissions.ts:65,94`, `sheets-task-executor.ts:109`, `postgres-submission-repository.ts:272,359`, `postgres-submission-recovery-repository.ts:61`, `in-memory-submission-recovery-repository.ts:15`, `in-memory-submission-repository.ts:84` (defaults `retentionDays = 7`), `temporary-file-storage.ts:35,311,356`) y `NOTIFICATION_PAYLOAD_RETENTION_DAYS` (90 días, `purge-notification-personal-data.ts:3-8`). **La UI edita las dos** (decidido por el usuario): dos campos en "Sistema e integraciones". |
| Cuándo entra en vigor un ajuste | Se lee al usarse, con una caché de `system_settings` de TTL corto (15 a 30 s) e invalidación al guardar; una sola implementación, la misma que baja la carga de la base (E6). `/api/config` se pide en cada carga; una pestaña abierta conserva el píxel anterior hasta recargar. **El panel es la única fuente** (decidido por el usuario el 2026-11-26): una importación única desde el entorno al arrancar y después no se lee el entorno (ver E6). Las variables quedan en el `.env` solo durante la ventana de rollback. |
| SES | Se quitan `@aws-sdk/client-sesv2` y `SETTING_SES_*`. Se **conservan** los tests de regresión sobre claves `ses_*` heredadas (con literales). Revisar el host SMTP sembrado por la migración 014, que apunta a AWS. |
| Subidas | Se arregla el PATCH: validar `uploadId`, sesión, rango y tamaño antes de leer el cuerpo, responder 413 en lugar de `req.destroy()`, límite por IP también en PATCH y tope global de bytes reanudables. **Sin ticket firmado con reCAPTCHA** (no se agrega al guard por archivo). |
| `GET /api/targets/:id` | Se mantiene la revalidación contra WordPress, pero con caché de 10 a 15 s y límite de frecuencia; nunca `stale` sin tope. |
| Envío con archivos sin sesión | Validar al inicio del handler: hoy guarda el envío y dispara Meta CAPI antes de rechazar (`submission-routes.ts:218,355-395`). |
| Deploy y rollback | Se diseña antes de endurecer el arranque: comprobar `/api/health`, mostrar los registros del contenedor ante fallo, y rollback manual documentado con el SHA previo de `last-deploy`, volviendo a apuntar `current` y `up -d`. La base **no** se restaura automáticamente. El entrypoint de la API pasa a `exit 1` solo tras verificar los permisos reales de `.secrets/` en el servidor. |
| CSP | `Content-Security-Policy-Report-Only` primero, con verificación real en navegador (reCAPTCHA, Meta, GA4, `blob:`/`data:`, worker de pdf.js, SVG de `form.css:124`). |
| Valores por defecto | Quitar la contraseña y el correo literales de `docker-compose.yml` exige actualizar a la vez `.github/workflows/ci.yml:70` y `playwright.config.ts:20-25` (arranca la API sin `DATABASE_URL`, apoyándose en `kysely.ts:10-13`). |
| PostgreSQL de pruebas | **Versión 16**, la misma que producción (hoy CI usa 17). |
| CI | Agregar `pnpm build`, `pnpm e2e` y `pnpm audit` antes de los saltos de versión mayores: hoy un fallo de compilación con TypeScript 7 o Vite 8 pasaría desapercibido. |
| Login admin en e2e | Playwright siembra una sesión en la base y fija la cookie; sin código de prueba en la aplicación. |
| Guarda de correos | Regex sobre direcciones (`[A-Za-z0-9._%+-]+@flacso\.edu\.uy`), no sobre el dominio, con lista corta de excepciones (correo público de contacto). |
| Diseño del panel | Marca FLACSO (`#073f8c`, `#fdd223`); `#175cd3` se retira. Ajustes como filas etiqueta + control separadas por líneas, tablas para datos, sin sombras salvo en diálogos. Menú lateral en escritorio y cajón en móvil; **sin puntos de estado vivos** en la primera entrega. |
| Estado general | `GET /api/admin/settings/overview` con **solo contadores de la base**; sin comprobaciones externas en la primera entrega. |
| Tablero de analítica | Mínimo: total de preinscripciones en el rango (cuenta de `submissions`), serie temporal, cobertura de seguimiento (`LEFT JOIN campaign_tracking`, porcentajes sobre la población medida) y barras por origen y por oferta (top 10). Sin mapa de calor, país ni modo oscuro. |
| Cobertura | **Primero se mide y el CI exige no bajar** de la línea base (candado). Meta final: API 90% en líneas, ramas, funciones y sentencias; web 90% en líneas, sentencias y funciones y 85% en ramas. Exclusiones legítimas: migraciones (aparte), tests, `test-setup.ts`, `dist/`, puertos que son solo tipos, `schema.ts`, fixtures y `main.tsx`. No se excluyen enteros `main.ts` ni `sweep-once.ts`: se extraen y prueban sus decisiones. |
| Documentación | Mínima y útil: README actualizado, `primeros-pasos`, `variables-de-entorno`, una página del panel y el flujo de una preinscripción. Un solo archivo de plan en el repo (este) y un `AGENTS.md` corto con `CLAUDE.md` de una línea. Sin 14 archivos, sin carpeta de decisiones ni comprobación de enlaces en CI salvo que alguien lo pida. |
| Rendimiento | Solo los quick wins de E11; el resto solo si una medición lo pide. |
| Librerías (de 5c) | Radix `dialog` y `alert-dialog` y `lucide-react` sí; combobox de países: `<select>` nativo con `<optgroup>` primero, Downshift solo si no alcanza; entidades HTML: ampliar el mapa de `html-entities.ts` (hoy 33 entidades, faltan `ordm`, `ordf`, `laquo`, `raquo`, `euro`, `ccedil`, `agrave`, `egrave`, `times`…); regex de correo: centralizar **la regex actual** en `domain/` (no `z.string().email()`, que cambia entre Zod 3 y 4); `parseArgs` de `node:util` para las CLI. **Se introduce una librería por incremento** (wouter, Radix, TanStack Query), con e2e en CI antes. |
| Integración continua | **`main` siempre es desplegable.** Desarrollo basado en tronco: ramas cortas (de horas a dos días) con **un PR por incremento**, no una rama por épica. Se fusiona **solo con CI completa en verde** y con merge *squash*, de modo que cada commit de `main` sea un PR que pasó todas las puertas (con merge normal o *rebase*, los commits intermedios nunca se verificaron). Ninguna rama vive más de unos días: lo grande se parte en incrementos que dejan el sistema funcionando. La protección de `main` (PR obligatorio y checks requeridos) la configura el usuario en GitHub. |
| Producción siempre lista | Cada commit de `main` debe poder desplegarse solo y volver atrás sin perder datos. Reglas: (1) **base de datos compatible hacia atrás**: migraciones solo aditivas (`IF NOT EXISTS`); borrar tablas o columnas va en una migración posterior y en otro despliegue, después de una ventana de rollback, nunca en el mismo commit que retira el código que las usa; (2) **funciones a medio hacer no se muestran**: se agregan por detrás (ruta nueva sin enlace, endpoint sin uso, ajuste con el comportamiento actual como valor por defecto) y se activan en un commit propio; sin librería de *feature flags*; (3) **migrar por sustitución gradual**: lo nuevo convive con lo viejo hasta que cubre todo, y lo viejo se retira en un commit aparte; (4) los ajustes que pasan al panel se importan una vez desde el entorno y desde ese momento solo se leen de la base (ver E6); (5) nada de commits que "rompen y arreglan después". |
| Entrega continua | **Decidido por el usuario: un comando desde la PC, solo SHAs verdes; fusión *squash*, un PR por incremento.** Sin acceso SSH para GitHub y sin despliegue automático. Se mantiene `scripts/deploy-production.sh` (despliega un SHA por SSH a `servidor-flacso`, levanta el stack nuevo en paralelo y el cambio de Apache lo hace el operador). Se le agrega: negarse a desplegar un SHA que no sea de `main` o cuya CI no esté en verde; **`--rollback`** de un comando (vuelve a apuntar `current` a la release anterior y `up -d`, sin tocar la base, lo que es seguro porque las migraciones son aditivas); y una prueba de humo posterior (`/api/health`, `/api/health/catalog`, la web y un `GET /api/targets`). |

## 3. Pendiente de confirmar con el usuario
1. **Nombre completo del postulante hacia Telegram** (`preinscription-telegram-notification.ts:44-45`): por defecto queda como está; se decide al final.
2. **Configuración de GitHub y modo de entrega (solo el usuario):** activar la protección de `main` (PR obligatorio, checks de la CI requeridos, sin pushes directos, merge *squash*), (el modo de entrega ya está decidido: ver la fila "Entrega continua"). Sin protección de rama, "cada commit listo para producción" depende de la disciplina y no de una puerta.
3. **Comprobaciones en el servidor, que solo el usuario puede hacer:** `docker compose ps` (réplicas), permisos de `.secrets/` y `/opt/flacso/backups`, valor de `ADMIN_SESSION_TTL_MINUTES` y de `GOOGLE_SERVICE_ACCOUNT_SUBJECT`, que el worker no se lance a mano, HSTS en Apache, y dos cuentas reales de Google para probar el acceso de administradores.

## 4. Reglas comunes
- **Incremento = un PR = un commit de `main`:** pequeño, con tests, que deja el sistema funcionando y **desplegable tal cual**. El relevo entre proveedores ocurre entre incrementos y basta con `git log` y el mensaje de commit.
- **Definición de "listo para producción" (cada commit de `main`):** pasa toda la CI (ver E1); migraciones aditivas; sin funciones visibles a medio hacer; ajustes que pasan al panel importados desde el entorno sin perder valores; sin correos reales ni secretos versionados; README y documento afectados actualizados en el mismo commit; y se puede deshacer con `--rollback` sin tocar la base.
- **Si algo se rompe en `main`:** se **revierte primero** (un `git revert` en un PR nuevo) y se corrige después; no se arregla hacia adelante sobre un `main` roto.
- **Modelos:** explorar con el tier bajo, implementar con el medio, y el alto para acceso, cifrado, migraciones y revisión de cierre. Se avisa qué modelo corre cada subagente.

### 4b. Metodología de agentes y delegación
Definida en detalle en [`AGENTS.md`](../../AGENTS.md) para trabajar por incrementos entre personas y agentes:
- **Equipo base (política por familia/tier —Carbon/Hydrogen/Neon— o mapeo a tiers disponibles):**
  - `Orchestrator` (`gemini-4-neon-medium`): coordina alcance, asignación, consolidación, PR y CI.
  - `Explorer` (`gemini-4-carbon-low`, tier rápido, solo lectura): hallazgos con `archivo:línea` y evidencia.
  - `Architect` (`gemini-4-neon-high`, tier alto, solo lectura): archivos a tocar, contratos, riesgos, tests y criterios de aceptación.
  - `Implementer` (`gemini-4-carbon-medium`, tier medio, escritura acotada): código y tests del incremento.
  - `Reviewer` (`gemini-4-neon-high`, tier alto, solo lectura): revisión crítica del diff completo por severidad.
  - `QA` (`gemini-4-carbon-high`, tier alto, sin editar): verificación real, casos negativos/límites y aceptación.
- **Especialistas bajo demanda:** Seguridad y Base de datos (`gemini-4-neon-high`), UX/UI, Accesibilidad y Rendimiento (`gemini-4-carbon-high`), en solo lectura; Documentación (`gemini-4-carbon-low`, única que escribe solo documentos). Si la plataforma solo expone tiers genéricos (`flash`/`inherit`/`pro`), se mapean por nivel manteniendo la misma separación de permisos.
- **Independencia y atajo documental:** ningún incremento cierra sin `Reviewer` ni `QA` independientes (si detectan fallos, vuelve a `Implementer`). En cambios triviales de documentación alcanza con `Implementer` + `Reviewer`.
- **Trazabilidad:** todo incremento registra rol y modelo usado en [`docs/plans/bitacora.md`](./bitacora.md) y en el mensaje de commit.

## 5. Orden de entregas (mínimo viable)
1. **E0** hotfixes.
1b. **Fusionar E0 por PR** (hoy son 6 commits en la rama `epica/e0-hotfixes`, sin CI corrida) como primer incremento que pasa por la puerta de CI.
2. **E1 = la tubería de integración continua** (ver E1): ninguna otra épica arranca antes de que `main` tenga todas las puertas y la protección de rama. Además cobertura medida y candado, `AGENTS.md` y borrar el worker.
3. **E2a:** lote 1 de dependencias y quitar SES.
4. **E2b:** mayores de herramientas y de API, **uno por commit**: `@types/node` (`22 → 24`, coincidente con Node 24) → TypeScript 7 → Vitest 5 junto con Vite 8, `@vitejs/plugin-react` 6 y `@vitest/coverage-v8` (un solo paso forzado por compatibilidad) → `jsdom` y `@testing-library/jest-dom` → Zod 4 → Express 5 → Kysely 0.29.
5. **E3 reducida:** seguridad.
6. **E2c:** React 19 con sus tipos y `pdfjs-dist` 6 (justo antes de tocar la UI).
7. **E5:** administradores por UI.
8. **E4 reducida y E6:** panel y configuración en UI (con la caché de ajustes).
9. **E8** analítica mínima (depende solo de E4).
10. **E7** portal y wizard, **E11** quick wins del frontend, **E9** documentación mínima.
11. **E10** cierre: umbral de cobertura final y revisión.
Si un mayor de E2 no pasa en un intento razonable, se deja fuera y se anota como deuda en lugar de bloquear el resto. Ponytail señala que, salvo Express 5 (permite borrar `async-router.ts`), ninguno entrega algo visible: el valor es seguridad y mantenimiento.

## 6. Épicas

### E0 Hotfixes inmediatos
- `main.tsx`: importar `app.css` y `form.css` antes que `App`. Corregir los selectores con doble escape (`app.css:133,155,158,342,343`), incluir `textarea` en las reglas de campos, `overflow-x: hidden` → `clip` (`app.css:297`), excluir `checkbox`, `radio` y `file` de `min-height` (`app.css:332`), mover `.phone-input` a `form.css`.
- Botones ilegibles (`AdminFailedSubmissionsCard.tsx:518`, `AdminNotificationsSettingsCard.tsx:558,782`); modal de reintento inline (`AdminNotificationsSettingsCard.tsx:760`); `.target-card-primary-action` sin estilos (`TargetList.tsx:74`); `btn--secondary` → `btn-secondary` (`UploadingFileRow.tsx:65-66`); `space-x-3` duplicado (`App.tsx:145`); `prefers-reduced-motion`.
- Errores del panel que desaparecen (`AdminDriveSettingsCard.tsx:65-73`, `AdminRecoverySettingsCard.tsx:94-96` llaman a `loadSettings()` justo después de `setError`); la provisión de planillas al abrir la pestaña pasa a ser una acción explícita (`AdminSpreadsheetSettingsCard.tsx:31-54`).
- Envío con archivos sin sesión: validar al inicio (`submission-routes.ts:218,355-395`). `umask 077` en el volcado (`deploy-production.sh:116`). Borrar el parseo manual de cookies que nunca corre (`admin-session.ts:100-107`, `admin-auth-routes.ts:169-175,199-205`).
- **Hecho cuando:** capturas a 1280 y 360 px sin elementos rotos y un test por comportamiento corregido.

### E1 Base de calidad (reducida)
- `@vitest/coverage-v8` (misma versión que `vitest`), `apps/api/vitest.config.ts`, script `test:coverage`, línea base real por app y por capa (estimación actual: API 71%, web 65%) y un candado en CI para no bajar. PostgreSQL 16 desechable y `PREINSCRIPTIONS_TEST_DATABASE_URL` (13 suites se saltan sin ella).
- **Tubería de CI (`.github/workflows/ci.yml`)**, lo que hoy hace solo `typecheck`, `test` y `docker compose config` (con PostgreSQL 17 y pnpm 12.8.1 contra el 12.14 local). Puertas obligatorias en cada PR, en trabajos en paralelo para que dure menos de unos 10 minutos:
  1. **Verificar:** instalar con `--frozen-lockfile`, compilar contratos, `typecheck`, tests unitarios y de integración con **PostgreSQL 16** (la versión de producción), con el candado de cobertura.
  2. **Compilar:** `pnpm build` de API y web y **`docker build` de las imágenes de api y web** (detecta fallos de `--frozen-lockfile`, de dependencias solo de desarrollo como `tsx`, y de archivos de prueba compilados dentro de `dist/`).
  3. **Migraciones:** aplicarlas sobre una base vacía, volver a aplicarlas (idempotencia) y un chequeo que rechace `DROP`, `RENAME` y borrado de columnas en migraciones nuevas, salvo las marcadas como contracción.
  4. **e2e:** Playwright contra el stack levantado con las imágenes construidas y la base de CI (con la sesión de administrador sembrada en la base, ver decisiones); es la prueba de humo de "arranca y sirve".
  5. **Compose:** `docker compose config` de desarrollo (sin `--env-file`) y de producción (con `.env.production.example`).
  6. **Seguridad e higiene:** `pnpm audit` (como aviso hasta cerrar E2, cuando las actualizaciones mayores permiten hacerlo bloqueante), la guarda de correos reales (en E1 valida las líneas nuevas del diff del PR con excepción explícita de `inscripciones@flacso.edu.uy`; en E3 pasa al modo completo sobre todo el repo) y búsqueda de secretos.
- Un e2e inestable no se tolera como puerta: se corrige o se aísla con un ticket, pero no se deja pasar a ciegas.
- **Despliegue (scripts/deploy-production.sh):** exigir un SHA de `main` con CI verde, agregar `--rollback` y la prueba de humo posterior (ver decisiones). El Incremento 5 actualiza `current` después de la prueba de humo y conserva en `last-deploy` el SHA anterior para la reversión manual.
- Antes de cerrar E1, el usuario activa en GitHub la protección de `main` (PR obligatorio, checks requeridos, sin pushes directos) y se prueba que un PR con un test roto no se puede fusionar.
- Borrar `worker-notifications.ts`, el servicio `notification-worker` de `docker-compose.yml`, el script `worker:notifications` y las menciones en docs. Es un duplicado: producción solo despliega `postgres`, `api` y `web` y `main.ts:207-272` ya instancia los mismos cuatro dispatchers.
- Auditar los tests de API y los obsoletos que no dependen de la navegación: `admin-profile-routes.test.ts` (solo 404 de rutas retiradas; consolidar), fixtures de perfiles antiguos (`ver_maestria_v1`, `ver_diploma_v1`, `diploma-v1`, `profile-1` en `spreadsheet-schema.test.ts:20`), el e2e de `preinscriptions.spec.ts:329` ("este seminario" vs "esta propuesta") y el comentario "401" vs 404 (`:264-265`). Los tests de UI se auditan en E4.
- Ampliar el mapa de `html-entities.ts` (ver decisiones).
- **Hecho cuando:** `pnpm test:coverage` corre en verde y queda registrada la línea base.
- **Línea base real medida (2026-11-21, PostgreSQL 16 y Node 24):**
  - **Cobertura `apps/api` (99 archivos, exclusiones de la sección 2):** líneas `78,48 %`, sentencias `78,48 %`, funciones `87,26 %`, ramas `79,56 %` (candado fijado en `78 / 78 / 87 / 79` en `apps/api/vitest.config.ts` cuando `CI` o `PREINSCRIPTIONS_TEST_DATABASE_URL` están presentes). Por capa: `domain` `93,53 %` líneas (`86,59 %` ramas, `98,04 %` funcs), `application` `78,19 %` (`79,04 %`, `75,51 %`), `infrastructure` `84,28 %` (`81,10 %`, `89,41 %`), `presentation` `78,47 %` (`72,19 %`, `89,58 %`), raíz (`main.ts`, `sweep-once.ts`, `migrate-spreadsheets.ts`, `graceful-shutdown.ts`) `7,89 %` (`65,00 %`, `20,00 %`).
  - **Cobertura `apps/web` (51 archivos, exclusiones de la sección 2):** líneas `80,40 %`, sentencias `80,40 %`, funciones `63,79 %`, ramas `79,96 %` (candado fijado en `80 / 80 / 63 / 79` en `apps/web/vite.config.ts`). Por carpeta: `components` `86,47 %`, `pages` `82,92 %`, `domain` `84,21 %`, `api` `37,71 %`, `content` `100 %`, raíz `82,29 %`.
  - **Rendimiento (línea base de E11):**
    - Bundle web inicial (`apps/web/dist/assets/`): `index-*.js` `684.636 B` crudos / `175.175 B` gzip-9 (`171,07 KiB`); `index-*.css` `58.640 B` crudos / `12.207 B` gzip-9 (`11,92 KiB`). Diferidos PDF: `pdf-*.js` `517.856 B` (`156.362 B` gzip-9) y `pdf.worker.min-*.mjs` `1.286.284 B` (`380.958 B` gzip-9).
    - Consultas en reposo (API contra PostgreSQL 16 sin tráfico HTTP, ventana 60 s): `140` consultas `SELECT` (`148` sentencias SQL logueadas con `BEGIN`/`COMMIT`; `xact_delta = 208` en `pg_stat_database`), de las cuales `136` son lecturas repetidas de `system_settings` hechas antes de comprobar la cola por los despachadores de Mautic (cada 10 s) y correo (cada 30 s), y `4` son consultas de Telegram (cada 15 s).
    - Latencia `POST /api/uploads` (PDF pequeño, 10 muestras tras 2 de calentamiento en `UPLOAD_TMP_DIR` local): `0` retenidos → mediana `17,18 ms` (p95 `23,01 ms`); `500` retenidos → mediana `677,73 ms` (p95 `839,18 ms`); `2.000` retenidos → mediana `2.163,05 ms` (p95 `2.415,16 ms`).

### E2 Dependencias (`pnpm outdated -r`; pnpm 12.14; Node 24)
| Lote | Paquetes (actual → última) |
|---|---|
| a. menores y parches | `@types/busboy` 1.5.4→1.5.5; `libphonenumber-js` 1.13.14→1.13.17; `google-auth-library` 11.1.0→11.3.4; `nodemailer` 10.0.14→10.6.1; `@playwright/test` 1.63.0→1.65.1 |
| b. mayores (orden de la sección 5) | `@types/node` 22→**24** (no 26: debe coincidir con Node 24); `typescript` 5.9.3→7.0.2; `vitest` 3.2.7→5.1.1 con `vite` 6.4.3→8.3.8 y `@vitejs/plugin-react` 4.7.0→6.3.0; `jsdom` 26.1.0→31.0.1; `@testing-library/jest-dom` 6.9.1→8.0.0; `zod` 3.25.76→4.6.7; `express` 4.22.3→5.3.0; `kysely` 0.27.6→0.29.9 |
| c. mayores de la UI | `react`, `react-dom` y `@types/react*` 18.3→19.3; `pdfjs-dist` 5.7.284→6.5.438 |
| Se elimina | `@aws-sdk/client-sesv2` (se retira) |
- **Cada mayor es un PR propio con toda la CI en verde (incluido `docker build`) y se despliega antes de empezar el siguiente.** Así, si algo se rompe en producción, el sospechoso es uno solo y `--rollback` lo deshace. No hay actualizaciones "en lote" de mayores.
- Cada mayor lleva su guía oficial leída y sus usos buscados en el repo antes de tocar nada; los cambios de código van en el mismo commit. TypeScript 7 primero (tras `@types/node` 24) también porque `packages/contracts` emite los `.d.ts` que consumen la API y la web desde `dist/`: se valida ese build antes de seguir; al subir TypeScript 7, alinear también `"typescript"` en `package.json` raíz (`^5.7.3` → `7.0.2`).
- Zod 4 cambia la forma de `error.issues`, que el login devuelve al cliente (`admin-auth-routes.ts:72`). Express 5 permite retirar `async-router.ts` (4 archivos lo usan), con tests de errores asíncronos por ruta; al subir `express` a `5.3.0`, alinear también el par `@types/express` v5 (en `apps/api/package.json` ya está en `^5.0.0`). Tras Express 5 y Zod 4 se prueba a mano login admin, envío con subida reanudable y cada tarjeta de configuración.
- Regenerar `pnpm-lock.yaml` y comprobar que los Docker de API y web pasan con `--frozen-lockfile`. Dependabot o Renovate agrupado por lote, si se quiere.
- **Hecho cuando:** cada mayor tiene su commit con `typecheck`, `test`, `build` y `e2e` en verde, o queda anotado como deuda.

### E3 Seguridad (reducida)
La auditoría no confirmó ningún hallazgo de severidad alta en producción (API solo con `expose`, Postgres sin puertos, web en `127.0.0.1`). Se corrige, por orden:
1. **Subidas (media):** ver decisión. Además `countResumable` lee todos los `metadata.json` en cada inicio (`temporary-file-storage.ts:114-125`) y Busboy no limita campos (`upload-routes.ts:204-207`).
2. **Consulta a WordPress en cada visita (media/baja):** `get-target-form.ts:35` y `upload-routes.ts:65,278`; caché corta y límite de frecuencia.
3. **Entrypoint de la API** (`docker-entrypoint.sh:14-25`, vuelve a root si un secreto no es legible) y deploy: ver decisión de rollback.
4. **Cuenta de servicio de Google:** el scope de Drive completo está justificado (`google-credentials.ts:18-20`); la delegación solo se activa con `GOOGLE_SERVICE_ACCOUNT_SUBJECT`. Verificar si producción la usa; si no, dejarla vacía.
5. **Bajas, cuando se pase por el archivo:** `urls.edit` en `GET /api/targets` (`diagnostics.ts:95`); logout sin CSRF y mensajes de error crudos en el login (`admin-auth-routes.ts:167,153-163`); `new RegExp(token)` sin escapar (`telegram-provider.ts:87`); CSP en modo informe; `compose.override.yml` que el deploy respalda y nunca se aplica (`deploy-production.sh:108,124`); desde ponytail: acciones de CI fijadas por SHA, solo si es de 10 minutos.
6. **Compose de desarrollo y valores por defecto:** `docker-compose.yml` versiona una contraseña de Postgres y publica base y API en todas las interfaces; `kysely.ts:10-13` tiene una URL por defecto con esa contraseña. Pasar a `${POSTGRES_PASSWORD:?}`, publicar solo en `127.0.0.1`, quitar el valor por defecto y actualizar `ci.yml` y `playwright.config.ts` a la vez.
7. **Sin correos reales en el repo:** quitar el correo por defecto y `ALLOWED_ADMIN_EMAIL` (`admin-session.ts:10,26`); el actor de auditoría por defecto (`admin-settings-routes.ts:1161,1262`: sin `adminUser` la petición falla); el texto de `AdminLoginPage.tsx:102`; ejemplos con `admin@example.com` en `.env.example`, `.env.production.example`, `docker-compose.yml:36` y `playwright.config.ts:22`; README, `docs/ARQUITECTURA.md`, `docs/AUDITORIA-…`, planes y specs viejos; los tests (unos 15 archivos) con un fixture `TEST_ADMIN_EMAIL = 'admin@example.test'`; la guarda de CI. El historial de git conserva la dirección: reescribirlo es destructivo y no se propone.
- **Centralizar la regex de correo** (hoy copiada en `form-validation.ts:4`, `email-config.ts:36`, `smtp-email-provider.ts:22`, `mautic-client.ts:47`, `wordpress-academic-catalog.ts:15`), unificar la redacción de secretos (hoy en 4 sitios; `safe-error.ts` no redacta nada) y `parseArgs` en `migrate-spreadsheets.ts` y `sweep-once.ts`.
- **Desmentidos (sin acción):** mock de Drive en producción, callback de OAuth sin lista de permitidos, cookie `Secure`, `UPLOAD_TMP_DIR`, id de sesión con `randomUUID` bajo HTTPS, cifrado con texto plano (explotarlo exige escribir en la base).
- **Hecho cuando:** cada corrección tiene su test, `docker compose config`, `pnpm e2e` y CI pasan, y se verificaron en el servidor los permisos de `.secrets/` y `/opt/flacso/backups` antes de endurecer el entrypoint.

### E4 Panel: navegación y base de UI (reducida)
- **8 secciones, rutas `/admin/<seccion>`** (con redirección desde `/admin/perfiles`; ojo con `normalizePath()` de `App.tsx:25` y `legacy-permalink-resolution.ts:5-15`, que fuerza `/` final; `AdminProfilesPage` repite `getAdminMe()` y ante un error distinto de 401 queda en "Verificando sesión…"):
  1. **Estado general** (solo contadores de la base).
  2. **Operación:** envíos fallidos y cola de notificaciones (hoy la cola comparte componente y carga inicial con la configuración de correo en `AdminNotificationsSettingsCard.tsx`; hay que separarlas).
  3. **Almacenamiento y planillas.**
  4. **Comunicaciones:** SMTP o Mautic, remitente, destinatarios maestros, prueba, Mautic y Telegram. Botón "Verificar conexión SMTP" (`POST /email/verify` y `apiClient.verifyAdminEmail` existen sin uso). Los campos SMTP no son `required` si se elige Mautic. Nota de que WordPress tiene su propia configuración de Telegram y reCAPTCHA.
  5. **Seguridad y acceso:** reCAPTCHA y administradores (E5).
  6. **Marketing y analítica:** Meta y GA4 (E6), exportación CSV y tablero (E8).
  7. **Sistema e integraciones:** WordPress y retención (E6), y estado de solo lectura de credenciales de Google, clave de cifrado y sweeper.
  8. **Estructura de los formularios** (decidido por el usuario el 2026-11-26; reemplaza a "Formularios Canónicos" en lugar de solo retirarla): vista de auditoría de solo lectura, sin backend nuevo. Tiene dos vistas:
     - **Por tipo de oferta:** matriz paso/campo × `SUPPORTED_CANONICAL_OFFER_TYPES`. Cada campo se marca como obligatorio, opcional, condicional (con su condición) o "no se pide", y muestra la columna de la planilla. Los documentos muestran máximo de archivos, tamaño, formatos y alternativa. Incluye filtro "solo diferencias", totales por tipo, aviso de doctorado no soportado y "Copiar como texto". Se calcula en el navegador con `getCanonicalFormDefinition()` (`packages/contracts/src/canonical-forms.ts:160`) sobre un target sintético por tipo.
     - **Por oferta publicada:** el formulario real que devuelve `GET /api/targets/:id`, con menciones, convenios y revisión efectiva de WordPress. Si la API responde 409, se muestran los `issues`. Incluye enlaces al formulario público y a la planilla.
     - Test: los totales de la matriz coinciden con `getCanonicalFormDefinition()`.
- **Especificación de pantallas (acordada con el usuario el 2026-11-26):**
  - **Shell:**
    - Rutas `/admin/estado/`, `/admin/operacion/`, `/admin/almacenamiento/`, `/admin/comunicaciones/`, `/admin/seguridad/`, `/admin/marketing/`, `/admin/formularios/` y `/admin/sistema/`. `/admin`, `/admin/perfiles/` y cualquier ruta desconocida redirigen a `/admin/estado/`.
    - Los filtros de las listas van en el query string (`?estado=failed&pagina=2`), así el Estado general enlaza a una lista ya filtrada.
    - Solo "Operación" lleva contador (fallidas pendientes + correos `failed`/`unknown`, tomado de `overview`).
    - Las secciones con varios bloques (Operación, Almacenamiento, Comunicaciones, Marketing) usan sub-navegación con anclas, sin pestañas.
    - Un 401 lleva al login y después vuelve a la misma URL.
    - Una sección sin contenido todavía (Sistema antes de E6) no aparece en el menú.
  - **Estado general:**
    - Tres tarjetas (fallidas, correos, planillas) en verde, ámbar o rojo según el número, con enlace a la lista filtrada.
    - Lista "Requiere atención" ordenada por gravedad, incluidas las fallidas que vencen en menos de 24 h.
    - Si no hay nada pendiente, el mensaje "Todo en orden".
  - **Operación › Fallidas:**
    - Chips de estado con contador ("Pendientes" por defecto) y búsqueda que se aplica 400 ms después de dejar de escribir.
    - Columna "Vence" en rojo si faltan menos de 24 h.
    - "Reintentar" visible; "Ver detalle" y "Descartar…" en el menú `⋯`.
    - Paginación con `limit`/`offset` (ya existen).
  - **Operación › Cola de correos:**
    - Contadores como `<button aria-pressed>`.
    - Estados y audiencias en español; título de la oferta en lugar de `targetId`; error en una línea debajo de la fila.
    - "Forzar reintento…" con aviso de duplicado; paginación.
    - Búsqueda por destinatario y filtro por fecha: `search`, `from` y `to` en `GET /notifications`, un cambio aditivo validado con Zod.
    - El error de carga se muestra en pantalla.
  - **Almacenamiento:**
    - Planillas: chip "Desvinculadas" (`summary.detached`); un solo badge por fila; "Desvincular…" pasa al menú `⋯`.
    - El texto "Reintentar preparación" se corrige a "Sincronizar formato".
    - Drive: "Cambiar carpeta" sigue el patrón de `SecretField`; la reconciliación se muestra con el título de cada oferta.
  - **Comunicaciones:**
    - Se muestra solo el bloque del proveedor elegido (SMTP o Mautic).
    - Botón "Verificar conexión SMTP".
    - Telegram: chat IDs como chips enmascarados, con "Quitar todos…" que envía `[]`.
    - Una barra "Guardar" por bloque, que aparece solo si hay cambios, y aviso al salir con cambios sin guardar.
  - **Marketing:**
    - "Exportar" (CSV con accesos rápidos de rango y aviso de datos personales) entra en E4.
    - "Seguimiento" (Meta Pixel ID, token CAPI, código de prueba, `GA4_MEASUREMENT_ID` y `GA4_API_SECRET` —editable con `SecretField`—, editables solo en el panel; sin indicador de origen) entra en E6.
    - "Tablero" entra en E8.
  - **`SecretField`:**
    - Con valor guardado: fila de solo lectura con el badge "Configurado", el valor enmascarado y el botón "Reemplazar".
    - Al tocar "Reemplazar": input con el aviso "Vas a sobrescribir el valor actual. Al guardar, el anterior se pierde." y un botón "Cancelar". El botón Guardar dice "(reemplaza <campo>)".
    - Nunca se muestra un input vacío con placeholder cuando ya hay un valor guardado.
    - Test: sin pasar por "Reemplazar", no se envía nada.
  - **Convenciones:**
    - Éxito: Alert que se cierra a los 6 s. Error: Alert fijo.
    - Las acciones destructivas van en rojo, con "…" en la etiqueta y AlertDialog.
    - Fechas `dd/mm HH:MM` en hora de Montevideo.
    - Ningún estado crudo de la API llega a la pantalla.
- **Revisión UX complementaria (2026-11-26, sin cambiar decisiones técnicas ni adelantar E6/E8):**
  - **Shell:** menú lateral de 256 px en escritorio; ítem activo con fondo azul muy claro y barra amarilla. Migas en el encabezado (`Administración / Operación / Cola de correos`) en lugar de repetir el nombre de la institución. Contenido con ancho máximo de 1440 px y padding horizontal de 32/24/16 px (escritorio/tablet/móvil).
  - **Encabezado de sección (`PageHeader`):** título, una línea de descripción, acción principal a la derecha y "Actualizado hace N min" en las vistas de datos (hora de la última carga de la query).
  - **Tarjetas solo para indicadores y grupos independientes;** la configuración va en filas etiqueta + control con divisores (ya decidido).
  - **Estado general:** cada indicador es un enlace a la sección filtrada; las alertas de "Requiere atención" se ordenan por urgencia real (primero archivos que vencen en < 24 h, después fallos, después bloqueos), no por categoría; sin gráficos; el estado "Todo en orden" es discreto (una línea con ícono, sin ilustración); si una consulta falla, el indicador conserva su espacio y muestra el error ahí mismo.
  - **Operación › Fallidas:** columnas en este orden: oferta + ID de seguimiento, etapa, error breve, vencimiento y acciones. Al elegir una fila se abre un **panel lateral de detalle** en escritorio (Radix Dialog con estilo de cajón a la derecha; a pantalla completa en móvil) con datos del incidente, estado de cada documento, etapa del error, cantidad de intentos, fecha del primer fallo y del último intento, y el último error (`GET /recoveries/:id` no guarda historial por intento: no se muestra línea temporal), tiempo restante de retención y acciones.
  - **Operación › Cola de correos:** distinguir el **estado del correo** (badge: Enviado, Fallido…) de la cantidad de intentos: un correo enviado con reintentos muestra "Enviado · 3 intentos" y ningún error (al enviarse se borra el último error y no hay historial por intento). Columnas: fecha y hora local, destinatario enmascarado, oferta, audiencia, intentos y estado; solo los correos no enviados muestran su último error, completo en el detalle expandible. "Procesar cola ahora" va en el encabezado, separado visualmente de las acciones por fila, porque afecta a toda la cola.
  - **Comunicaciones y Almacenamiento (`ConnectionStatus`):** cada integración (SMTP, Mautic, Telegram, Drive) tiene la misma estructura: estado de **configuración** ("Configurado"/"Sin configurar") separado del de **verificación**, con el mensaje explicativo de la API cuando falla. SMTP, Mautic y Telegram guardan fecha y resultado de la última prueba ("Última verificación registrada: 20/11 10:31 · Conexión exitosa"); Drive no los guarda (nombre de carpeta y permiso de escritura se calculan al consultar), así que muestra "Estado al cargar la página", no "Última verificación". La verificación de conexión aclara que no garantiza la entrega de correos. `SaveBar`: barra inferior fija con "Guardar" y "Descartar" mientras haya cambios.
  - **Estructura de los formularios:** encabezado de columna por tipo de oferta claramente diferenciado; primera columna (paso/campo) fija al desplazar en horizontal; con "Mostrar solo diferencias" se mantiene el encabezado del paso para dar contexto; al elegir un campo se abre el panel lateral con tipo, obligatoriedad, condición, documentos relacionados y columna de destino. **En móvil no hay matriz:** se elige un tipo de oferta y se ven sus campos, con la opción de compararlo contra un segundo tipo (diferencias marcadas).
  - **Componentes compartidos** (solo los que se usan en más de un sitio, según la decisión de primitivos): `PageHeader`, `StatusBadge`, `FilterChips`, `InlineAlert`, `EmptyState`, `ConfirmDialog`, `DetailDrawer` (variante de `Dialog`), `SecretField`, `ConnectionStatus` y `SaveBar`. Los indicadores del Estado general y las tablas no son componentes genéricos: se escriben en su sección con las clases `.admin-table` y `.admin-metric` de `admin.css`.
  - **Criterios de aceptación adicionales:** WCAG 2.2 AA con navegación completa por teclado; zoom al 200 % sin pérdida de funcionalidad; errores asociados a su campo (`aria-describedby`); tablas con `<th scope>` y `<caption>` utilizables con lector de pantalla; ningún estado comunicado solo con color (badge con texto o ícono); `prefers-reduced-motion`; sin saltos de layout durante las cargas (placeholders del mismo tamaño); todo botón de acción con estado de carga y bloqueo de doble envío; confirmación al salir de una configuración con cambios.
- **Mejoras opcionales incluidas en E4 (decididas por el usuario el 2026-11-26), cada una en su propio PR después de las secciones:**
  - **Menú contraíble:** botón para pasar el menú lateral de 256 a 72 px, mostrando solo íconos de lucide. Cada enlace conserva su `aria-label` con el nombre de la sección, y el tooltip aparece con `:hover` y con `:focus-visible` (CSS propio, sin dependencias nuevas). La preferencia se guarda en `localStorage`. En móvil no aplica, porque el menú es un cajón.
  - **Ordenar por columnas en Fallidas y Cola:** el orden se hace en el servidor para que sea correcto con paginación. Parámetros aditivos `sort` y `dir` en `GET /recoveries` y `GET /notifications`, validados con un `z.enum` de columnas permitidas. Fallidas: `createdAt`, `expiresAt` y `stage`. Cola: `createdAt`, `attemptCount` y `status`. Sin parámetros, el orden por defecto es el de hoy. El orden se refleja en la URL (`?orden=vence&dir=asc`). Los encabezados son `<button>` dentro de `<th aria-sort>`. Lleva tests de API: columna permitida, columna rechazada con 400 y combinación con paginación.
  - **Atajos de teclado:**
    - `g` seguido de una letra navega a una sección (`g e` Estado, `g o` Operación, `g a` Almacenamiento, `g c` Comunicaciones, `g s` Seguridad, `g m` Marketing, `g f` Formularios).
    - `/` lleva el foco a la búsqueda de la vista.
    - `?` abre un diálogo con la lista de atajos.
    - Se ignoran mientras el foco está en un `input`, `textarea`, `select` o `[contenteditable]`.
    - WCAG 2.2, criterio 2.1.4: como son atajos de un solo carácter, hay un interruptor "Atajos de teclado" (activados por defecto, guardado en `localStorage`) dentro del diálogo de ayuda y del menú de usuario.
    - Lleva un test que comprueba que no se disparan al escribir en un campo ni cuando están desactivados.
  - **Densidad de tablas:** selector "Cómoda / Compacta" en las tablas de Operación, guardado en `localStorage`, que cambia una variable CSS de padding de fila. Solo aplica desde 768 px; en móvil se mantiene el alto táctil de 44 px.
- **Revisión UX complementaria II — calidad de interacción y comportamiento responsive (2026-11-26, sin dependencias nuevas):**
  - **Tablas en móvil (<768 px):** sin scroll horizontal. Cada registro es un bloque: primera línea oferta y estado; segunda identificador y vencimiento (en la cola, destinatario y fecha); el resto va en el detalle; acciones en el menú `⋯`; filtros en un panel desplegable.
  - **Estados de datos:** primera carga → placeholders; carga correcta → datos y "Actualizado hace N min"; actualizando → indicador discreto sin borrar los datos; falla la actualización → advertencia y la última información disponible, conservando la hora de la última carga correcta (nunca se presenta información vieja como recién actualizada); sin datos → estado vacío; sin coincidencias → mensaje propio y "Limpiar filtros".
  - **Filtros:** contador de resultados (la cola y fallidas necesitan el total filtrado; si el endpoint no lo devuelve, se agrega como campo aditivo con su test), filtros activos identificados, "Limpiar filtros", cambiar un filtro vuelve a la página 1, y cerrar un detalle o volver atrás conserva filtros y paginación.
  - **Tipografía:** escala de 12 (auxiliar), 14 (secundario), 16 (base), 20 (subtítulo), 24 (título de sección) y 32 px (título principal), pesos 400 y 600, interlineado menor en los tamaños grandes.
  - **Contraste (verificado):** blanco sobre `#073f8c` 10,01:1; `#12233f` sobre `#fdd223` 10,78:1; los colores secundario y de estado sobre `#f3f6fb` dan entre 5,25:1 y 6,07:1. Los botones amarillos usan texto `#12233f`, **nunca blanco** (1,46:1), y el amarillo no se usa como color de texto sobre fondo claro.
  - **Estado general:** cada indicador lleva una explicación breve de qué cuenta; las alertas distinguen problemas operativos de avisos informativos, dicen qué acción los resuelve y un mismo incidente no se repite en dos bloques (la fallida que vence en < 24 h aparece una sola vez, como urgente).
  - **Acciones:** las irreversibles (descartar, desvincular, quitar chat IDs, forzar reintento de un correo `unknown`) se distinguen visualmente de las reversibles (reintentar), explican la consecuencia y piden confirmación. Las acciones ofrecidas dependen del estado real del registro.
  - **Planillas:** cada oferta es una ficha compacta con estado, vínculo, ID de carpeta raíz (`rootFolderId`), enlace a la planilla (se arma desde `spreadsheetId`) y fecha del último descubrimiento (`lastDiscoveredAt`). El backend no da URL de carpeta, "necesita sincronización" ni resultado de sync por oferta: no se muestran ni se simulan.
  - **Pruebas de conexión:** el resultado dice qué se comprobó, qué dio y qué significa (y qué no garantiza).
  - **Formularios:** pasos y campos diferenciados; obligatorio/opcional/condicional con texto además del símbolo; la condición visible sin abrir el campo; encabezados fijos; acceso rápido a las diferencias; "Copiar como texto" confirma con "Copiado".
  - **Foco y anuncios:** al abrir un detalle el foco pasa al panel y al cerrarlo vuelve a la fila de origen; un error al guardar conserva lo escrito; resultados y errores importantes se anuncian con `aria-live`.
  - **Criterios de aceptación adicionales:** todo lo anterior, más pruebas responsive de tablas y formularios a 360 y 390 px y contraste verificado en cada combinación de texto y fondo.
  - **Pantallas de referencia:** primero se construyen y las valida Iván en la aplicación Estado general, Operación y Comunicaciones; sus patrones se trasladan al resto recién después de esa aprobación.
- **Sustitución gradual, no reescritura:** primero un incremento que agrega el menú lateral y las rutas `/admin/<seccion>` mostrando las tarjetas actuales, con `/admin/perfiles` funcionando igual; después **una sección por PR** (cada una mueve sus tarjetas, mantiene la ruta vieja como redirección y deja el panel completo y usable); recién al final se retira la vista de pestañas antigua. Cada PR es desplegable solo y nada queda a medio migrar. Las librerías (wouter, Radix, lucide, TanStack Query) entran de a una, en PR propios, antes de usarlas en las secciones.
- Se retiran la pestaña "Formularios Canónicos" (reemplazada por la sección 8), el nombre `AdminProfilesPage`, el texto "gestión de perfiles" del login y los `window.confirm`/`alert`.
- **Base de UI:** `apps/web/src/styles/` (`tokens.css` → `base.css` → `ui.css` → `public.css` → `form.css` → `admin.css`, importados en ese orden desde `main.tsx`), sin Tailwind, y se borra el subconjunto falso de `app.css`. Tokens: Tinta `#12233f`, Azul `#073f8c` (hover `#052f6a`), Amarillo `#fdd223` (solo el CTA principal), Papel `#f3f6fb`, Línea `#dbe4f0`, texto secundario `#56667f`; estados Al día `#067647`, Atención `#8a5a00`, Error `#b42318`; pila de fuentes del sistema (no se carga `Inter`); escala de 6 tamaños, sin 10 ni 11 px; radios 8/11/16/20 px; capas de `z-index` nombradas; breakpoints 640/768/1024.
- **Primitivos, solo los que se usan en más de un sitio:** `Dialog` y `ConfirmDialog` (sobre `@radix-ui/react-dialog` y `alert-dialog`), `Button` (alto táctil 44 px en móvil), `Field` y `SecretField` ("Configurada · Cambiar"). Iconos con `lucide-react`. El resto se escribe donde se necesita.
- **Librerías, una por incremento:** wouter (rutas), Radix, lucide-react y TanStack Query para el panel y su `overview`; el portal se pasa a TanStack Query en E7.
- `React.lazy` para las páginas admin (se hace con el ruteo nuevo) y las banderas por código.
- Copy: voseo rioplatense en lo que se toca; "propuesta" en lugar de "destino"; el botón "Administración" sale de la cabecera pública hacia el pie. Accesibilidad AA en lo que se toca: un `<h1>` por vista, controles reales en lugar de `<div onClick>` (logo, filtros de la cola), `:focus-visible` global, contraste ≥ 4,5:1.
- Se auditan los tests de UI restantes (`App.test.tsx`, `AdminProfilesPage.test.tsx`, `TargetPage.test.tsx`, `DynamicForm.test.tsx`, `preinscription-form-view-model.test.ts`, e2e) y se retiran los fixtures de perfiles antiguos.
- **Hecho cuando:** las 8 secciones cargan, guardan y respetan sesión y CSRF; capturas a 1280 y 360 px; recorrido con teclado; tests de `aria-current`, textos de estado y diálogos; se cumplen los criterios de aceptación de la revisión UX complementaria.

### E5 Administradores por UI (riesgo alto)
- **En cuatro entregas, cada una desplegable sola:** (1) migración `031` aditiva con la tabla `admin_allowed_emails` y el seed fuera de la 006, sin cambiar la autorización; (2) la autorización pasa a entorno ∪ tabla, con la tabla vacía (mismo comportamiento que hoy); (3) los endpoints y la sección de la UI; (4) una migración posterior elimina `admin_users` y la retira de `schema.ts`, después de la ventana de rollback.
- Endpoints `GET/POST/DELETE /api/admin/settings/admins` tras `createRequireAdminSession` y CSRF; sección en "Seguridad y acceso". Mover la renovación de sesión después de validar el token CSRF (`admin-session.ts:131-142`).
- Pruebas: base nueva, base ya migrada y fallo de migración; carrera de login concurrente con una baja; 403 sin token CSRF sin escribir nada; revocación de sesiones; correo fijo no removible; auto-eliminación rechazada.
- Antes del corte: ensayar la migración y volver al binario anterior sobre una copia de la base con escrituras posteriores; probar con dos cuentas reales en el dominio público.
  - Revisión UX II (2026-11-26): la lista de administradores distingue los protegidos por el servidor (entorno), los agregados desde el panel y el usuario actual; cuando no se puede quitar a alguien, el motivo es texto visible (no solo un botón deshabilitado o un tooltip); la baja avisa que revoca sus sesiones.
- **Hecho cuando:** un administrador agregado por UI entra, uno quitado pierde la sesión de inmediato, y la API sigue funcionando con la lista del entorno si la tabla está vacía.

### E6 Configuración en UI
- Claves y validaciones según las decisiones: Meta Pixel ID, token de Meta CAPI, `META_CAPI_TEST_EVENT_CODE` (hoy no está documentada en ningún `.example` ni compose), GA4 (`GA4_MEASUREMENT_ID` y `GA4_API_SECRET`, este último cifrado con `EncryptedSettingsService`), WordPress (URL y token) y días de retención.
- La caché de `system_settings` (TTL corto, invalidada al guardar, clave de descifrado calculada una vez) es el mismo mecanismo que baja la carga de la base; se construye aquí y la usan también los dispatchers y la CLI `migrate:spreadsheets`.
- **El panel es la única fuente de estos ajustes** (decidido por el usuario el 2026-11-26; reemplaza a "UI primero, entorno después"):
  - Las variables `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `WORDPRESS_URL`, `WORDPRESS_CATALOG_TOKEN`, `NOTIFICATION_PAYLOAD_RETENTION_DAYS` y la retención de incidentes **no se leen en tiempo de ejecución** (se importan una sola vez desde el entorno al arrancar, cifrando todos los secretos —`META_CAPI_ACCESS_TOKEN`, `GA4_API_SECRET` y `WORDPRESS_CATALOG_TOKEN`— con `EncryptedSettingsService`). La UI no muestra un "origen": cada valor está en el panel o no está configurado.
  - **Importación única** desde el entorno a la base, para no perder los valores actuales:
    - Corre al arrancar la API, después de las migraciones (no puede ser una migración SQL, porque los secretos se cifran con `EncryptedSettingsService`).
    - Por cada clave: si no hay fila en `system_settings` y el entorno trae un valor, lo guarda, validado y cifrado si es secreto, con el actor `importación desde entorno`.
    - Al terminar, marca `settings_env_import_done_at`. Con la marca presente, la importación no vuelve a correr y el entorno ya no se lee para nada.
    - Si un valor del entorno no pasa la validación o falta `APP_SETTINGS_ENCRYPTION_KEY` para cifrar un secreto, la API **sale con error** y no arranca sin configuración, igual que con una migración fallida.
    - Lleva tests de base vacía, base ya importada, valor inválido y clave de cifrado ausente.
  - **Sin valor en el panel**, cada integración queda desactivada de forma explícita:
    - Meta: sin píxel y sin CAPI. GA4: sin `GA4_MEASUREMENT_ID` no hay `gtag` ni envío por servidor; con `GA4_MEASUREMENT_ID` pero sin `GA4_API_SECRET`, opera `gtag` en navegador y `ga4.serverEvents` es `false` (sin envío por Measurement Protocol).
    - WordPress sin configurar: `/api/health/catalog` falla y la prueba de humo del deploy lo detecta. El panel lo muestra como "Sin configurar" en "Sistema e integraciones".
  - **Catálogo de prueba solo fuera de producción:** hoy, sin `WORDPRESS_URL`, `main.ts:63-65` usa `FixtureAcademicCatalog` en silencio. Con el panel como única fuente, en `NODE_ENV=production` una URL sin configurar **no** cae al catálogo de prueba: el catálogo queda no disponible y `/api/health/catalog` falla. Desarrollo, CI (cuando E1 incorpore el job `e2e` en `.github/workflows/ci.yml`) y Playwright (`playwright.config.ts:24`) siguen usando el catálogo de prueba.
  - **Todos los lectores pasan a la base:** `meta-capi.ts:132-137` (`createMetaCapiTrackerFromEnv`, invocado en `app.ts:180`, expuesto en `app.ts:195` e inyectado en `app.ts:317`), `apps/api/src/infrastructure/ga4/ga4-measurement-protocol.ts:83-88` (`createGa4TrackerFromEnv`, invocado en `app.ts:181`, leído/expuesto en `app.ts:196` en `/api/config` e inyectado en `app.ts:318`, consumiendo `ga4Tracker.sendSubmitApplication` en `submission-routes.ts:381-389`), `main.ts:63-96` (WordPress y su health), la CLI `migrate-spreadsheets.ts:55-57` y `purge-notification-personal-data.ts:6-9` (`getNotificationRetentionDays`). Los tests que hoy tocan `process.env` (`meta-capi.test.ts:44-45`, `ga4-measurement-protocol.test.ts`, `purge-notification-personal-data.test.ts:100-115`) pasan a probar el lector de ajustes y la importación.
  - **Orden en el arranque:** la importación corre después de `runMigrations` (`main.ts:196-201`) y antes de `createApp` (`main.ts:310`). `EncryptedSettingsService` (`encrypted-settings.ts`) solo necesita el repositorio de `system_settings` (migración 007) y la clave, así que funciona antes del servidor HTTP. Si `system_settings` no existe, la importación sale con error.
- **Orden de entrega, para que cada paso sea desplegable y reversible:**
  1. El lector de ajustes desde la base, con su caché.
  2. Endpoints de guardado y tarjetas de UI, sin que nada dependa todavía de ellos (una función que aún no se muestra).
  3. Por cada grupo (Meta y GA4, luego retención, WordPress al final por ser el de mayor riesgo), un PR que agrega su importación y cambia la lectura a "solo base" en el mismo commit.
- **Rollback:** durante la ventana de rollback, las variables siguen en el `.env` del servidor (el binario nuevo no las lee), así que `--rollback` vuelve a un binario que todavía las usa. Pasada la ventana, se quitan del compose (`deploy/docker-compose.production.yml:30-37` —incluido `GA4_API_SECRET` en `:37`— y `docker-compose.yml:31-35`), de `.env.example` y de `.env.production.example` (incluido `GA4_API_SECRET` en `:38`); `deploy-production.sh` sigue comprobando `/api/health/catalog`. Se retira `ADMIN_SESSION_TTL_MINUTES` (`admin-session.ts:13-25`).
- **Cuidado al hacer rollback:** si algo se cambió en el panel durante la ventana, el binario anterior va a usar el valor viejo del entorno hasta que se vuelva a desplegar. Se documenta en `docs/DEPLOY.md`.
- Variables que se quedan solo en entorno, con su estado visible: `APP_SETTINGS_ENCRYPTION_KEY`, credenciales y cuenta de servicio de Google, `DATABASE_URL`, `TRUST_PROXY_HOPS`, `UPLOAD_TMP_DIR`, `GOOGLE_DRIVE_MOCK`, `PORT`, `NODE_ENV`.
- **Hecho cuando:** guardar un ajuste lo aplica sin reiniciar (salvo los que se declaren), un secreto no vuelve nunca al navegador y se probó el cambio de origen de WordPress con la caché caliente y WordPress caído.

### E7 Portal y wizard (con test por corrección)
- **Hecho cuando:** cada punto de la lista tiene su test y `pnpm e2e` cubre el flujo completo de una preinscripción.
- Flash de `HomePage` y doble fetch en enlaces directos (`App.tsx:68-130`, falta `isResolvingRoute` y `key={selectedTargetId}`; tampoco se reinicia scroll ni `document.title`).
- Catálogo: el buscador cierra los grupos en cada tecla y no ignora tildes (`HomePage.tsx:84-255`); oferta cerrada sin mensaje en el wizard (`PreinscriptionWizard.tsx:355-371`).
- Wizard: resumen de errores del servidor oculto (`:70-84`, falta `setSummaryVisible(true)`); `serverErrors` sin limpiar; enlaces de `FormErrorSummary` que no encuentran el campo; "Mención" duplicada y marcada obligatoria (`PreinscriptionSummary.tsx:191-207`, `FormStep.tsx:147`); progreso de documentos que ignora `sinTituloActual` (`preinscription-form-view-model.ts:109-116`); "Siguiente" activo con una subida en curso; celular sin normalizar con Enter; superposición de envío que no bloquea.
- Selector de países: `<select>` nativo con `<optgroup>`; Downshift solo si no alcanza.
- Fugas de jerga ("destinos", errores de `target.issues`, la promesa de "consultar el estado" en `TargetPage.tsx:116`). Código muerto a confirmar y borrar: rama de una sola página de `DynamicForm.tsx`, rama `confirmacion` de `FormStep.tsx`.

### E8 Analítica (mínima)
- Sección "Marketing y analítica" con el tablero mínimo de las decisiones. Endpoint `GET /api/admin/settings/campaign-tracking/summary?from&to&type&targetId` con solo agregados desde SQL (no usar `listCampaignTracking()`, que trae hasta 100.000 filas con datos personales); contrato en `packages/contracts`; `Cache-Control: no-store`.
- `oferta_tipo` guarda `academic_offer` o `seminar`, no el tipo de oferta (`maestria`, `diploma`…); filtrar por oferta exige `JOIN submissions`. La fila de seguimiento es condicional y la migración 029 no rellena el histórico: por eso se muestra la cobertura de seguimiento.
- Privacidad: los `utm_*` son texto libre del cliente y pueden contener un correo; sanear etiquetas, excluir `utm_term` y `utm_content`, suprimir grupos pequeños y agrupar por semana en rangos amplios.
- Gráficos con SVG y CSS propios, accesibles (texto alternativo y tabla equivalente), sin librería nueva.
  - Revisión UX II (2026-11-26): total como indicador principal, serie temporal como gráfico de líneas, cobertura de seguimiento como porcentaje con denominador visible y ayuda sobre cómo se calcula, origen y oferta como barras horizontales, tabla de datos accesible debajo de cada gráfico y filtros de fecha y oferta agrupados en el encabezado; solo SVG y CSS.
- **Hecho cuando:** los números del tablero coinciden con una consulta manual sobre una copia, y los tests cubren rangos vacíos, filtros y supresión de grupos pequeños.

### E9 Documentación (mínima)
- README al día (secciones de administración, tabla de variables con `ADMIN_ALLOWED_EMAILS` como bootstrap, gestión de admins, comandos de prueba y cobertura, `/admin/perfiles`; `README.md:63` aún describe perfiles editables en PostgreSQL) y revisado completo en E10; `docs/primeros-pasos.md`; `docs/variables-de-entorno.md` (qué hace, obligatoria, entorno o UI (los ajustes de E6 figuran como «solo panel; importados una vez desde el entorno»), ejemplo ficticio); el flujo de una preinscripción (formulario → Drive → Sheets → notificaciones → recuperación); una página del panel con capturas, al final.
- Borrar `docs/SES-NOTIFICACIONES.md`; sanear correos; mover `docs/superpowers/` a un `docs/archivo/`.
- Cada comando y ruta citados se prueba tal como está escrito.
- **Hecho cuando:** alguien nuevo levanta el entorno y corre los tests solo con `primeros-pasos.md`.

### E10 Cierre de calidad
- Umbral final de cobertura en CI (ver decisiones) y `coverage/` como artefacto. Flujos a cubrir con tiempo: envío completo de cada tipo de oferta (con reCAPTCHA activo y caído, con y sin UTM/fbclid), carga reanudable (límites, firma, recuperación), fallo en cada etapa (Drive, Sheets, notificaciones), reintento, descarte y sweeper, login admin (entorno, agregado, quitado, no autorizado, `state` reutilizado, CSRF inválido, sesión vencida), cada tarjeta de configuración, cola con SMTP y Mautic, ofertas cerradas y enlaces legacy, catálogo caído.
- Revisión final de seguridad, README completo y despliegue de ensayo sobre una copia.

### E11 Rendimiento: solo los quick wins, repartidos en las épicas
**Regla:** no se optimiza sin medir. En E1 se toma una línea base con números (bundle inicial con gzip, consultas por minuto con la API en reposo, latencia de `POST /api/uploads` con 0, 500 y 2.000 archivos retenidos) y cada mejora se acepta con su medición antes y después. Ninguna mejora de índices sin `EXPLAIN ANALYZE` en una copia con volumen real.

| Quick win | Épica | Detalle |
|---|---|---|
| nginx | E3 | `gzip` para JS, CSS, JSON y SVG; `Cache-Control: public, max-age=31536000, immutable` en `/assets/*` y `no-cache` en `index.html`; `upstream` con `keepalive`. Confirmar con `nginx -T` que la imagen no trae compresión por defecto. Sin Brotli. |
| Dispatchers miran la cola primero | E3 | `email-notification-dispatcher.ts:103` resuelve el proveedor (lee y descifra la configuración) antes de reclamar filas, igual que los de Mautic; el de Telegram ya lo hace bien. |
| Subidas: índice en memoria por sesión | E3 | **No se pasa `PostgresTemporaryUploadRepository`:** el análisis de opus mostró que no cubre `countResumable` y que, al activarlo, `open`, `remove` y `removePending` exigen una fila en la base (`temporary-file-storage.ts:228-231,382-385,420-423`), con lo que los archivos ya guardados fallarían y `cleanup` dejaría huérfanos. En su lugar, un `Map<sessionId, tokens>` en el proceso, reconstruido con un solo escaneo al arrancar y actualizado al crear, quitar y limpiar. Más `rename` en `finishResumable` (`:133-148`) y leer solo 1024 bytes para `matchesDeclaredType` (`upload-routes.ts:168-173`). |
| Caché de ajustes | E6 | El mismo mecanismo de E6; baja las 45 a 56 lecturas y descifrados por envío que estima Antigravity (sin medir) y las de los ticks. |
| Panel y banderas fuera del bundle | E4 | `React.lazy` para las páginas admin; importar las banderas por código. El bundle inicial sin comprimir es de 684 KB. `pdfjs-dist` ya está en `import()` dinámico: no hay que tocarlo. |
| `INSERT` multi-fila | E7 (o aparte) | `postgres-submission-repository.ts:107-120,212-242`: unos 40 a 65 `INSERT` secuenciales por envío en tres bucles. |
| Teclado en el paso de contacto | E7 | `UniversalFields.tsx:176-180` recalcula ~250 países en cada tecla; calcular una vez a nivel de módulo; `useMemo` en `HomePage`. |
**No se hace, salvo que una medición lo pida:** índices nuevos, fixes de Big-O con N de decenas, concurrencia en Drive, caché de Sheets y de miniaturas PDF, ajustes del pool de `pg`, subir el tamaño de bloque de subida de 1 MiB, exportación CSV en streaming, `statement_timeout` global, `libphonenumber-js/min` (solo si los tests de teléfono lo cubren), Brotli.
**Corrección que apareció de paso:** `migrate-target-spreadsheets.ts:262` usa `Math.max(0, ...existingRows.map(...))`, que puede lanzar `RangeError` con planillas grandes; cambiar por un `reduce`.
**Hecho cuando:** la medición posterior muestra menos consultas por minuto en reposo, una latencia de subida que no crece con los archivos retenidos y un bundle inicial más chico, con todos los tests en verde.

## 7. Qué no se hace (decidido con ponytail)
Estado del login OAuth en PostgreSQL, comando `pnpm admin:add`, `Migrator` de Kysely, ticket firmado de reCAPTCHA para subidas, revisión compartida con vuelta atrás para WordPress, librería de 9 primitivos, comprobaciones externas en `overview`, 11 archivos de épicas y notas de traspaso por incremento, 14 documentos y una carpeta de decisiones, `tus`, `express-session`, `pg-boss`, `googleapis`, `rate-limiter-flexible`, `multer`, `file-type`, `react-hook-form`, `pino`, React Router, y los índices, la concurrencia de Drive y los fixes de Big-O sin medición.

## 8. Verificación general
- Por incremento: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` cuando se toca la navegación o el envío, `docker compose config` (sin `--env-file` y con el de producción), capturas a 1280 y 360 px para cambios visuales.
- Seguridad: pruebas de 401/403/CSRF por endpoint nuevo, ninguna respuesta devuelve secretos, guarda de correos en CI.
- Migraciones: base nueva, base ya migrada, fallo de migración y volver al binario anterior sobre la base ya migrada.

## 9. Límites de las revisiones
Todas fueron estáticas. No se vio el servidor de producción, no se midió la cobertura real, no se abrió el navegador, no se ejecutó `pnpm audit` y no se revisó el repo de WordPress. Varias cifras vienen de informes de agentes y se confirman al implementar cada punto. Al agente de base de datos de la auditoría de rendimiento lo cortó el límite de uso de la cuenta; sus candidatos de índices vienen del informe de Antigravity y están sin verificar.
