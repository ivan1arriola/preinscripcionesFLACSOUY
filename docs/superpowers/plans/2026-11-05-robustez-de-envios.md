# Plan: robustez del flujo de preinscripción (v5)

Fecha: 2026-11-05. Estado: propuesta, sin implementar. Reemplaza la v4 tras la cuarta revisión adversarial de Codex.

## Historia de la revisión

- **v1:** siete arreglos sueltos. Codex: C1, C3 y C5 eran un solo protocolo.
- **v2:** lease, retención, Sheets idempotente. Codex: la retención llegaba tarde, el fencing no frena efectos externos,
  el plazo de 100 s iba en la Release A, la búsqueda de 2 000 filas rompía la idempotencia.
- **v3:** fijar antes de guardar, IDs reservados de Drive, espera de 120 s en Sheets. Codex encontró seis problemas más:

| Hallazgo (v3) | Gravedad | Resolución en la v4 |
|---|---|---|
| Fijar y limpiar no son mutuamente excluyentes: la limpieza puede borrar después de que el fijado "tuvo éxito" | crítico | **P1:** el fijado y la limpieza reclaman el directorio con un `rename` atómico del mismo origen; gana exactamente uno. |
| Los IDs reservados no hacen única una carpeta compartida entre preinscripciones distintas | alto | **P2:** tabla `drive_folders` con clave única por carpeta lógica y ganador atómico. |
| El conteo posterior no detecta una escritura tardía; 120 s no es garantía (Google documenta 180 s) | alto | **P3:** reconciliaciones durables diferidas (+200 s, +15 min, +2 h) y alerta persistente. Se retira la afirmación de detección. |
| El barrido ignora filas sin lease (`NULL`) y la verificación con el barrido apagado no prueba nada | alto | **P4:** lease creado dentro de la transacción de aceptación, `COALESCE` para filas heredadas y un comando de barrido de una sola vez. |
| El plazo de 100 s impide esperar 120 s dentro del reintento | alto | **P3/P4:** la espera es un estado durable (`next_attempt_at`), no un `sleep`. |
| La Release B no contempla operaciones iniciadas por el código viejo | alto | **Despliegue:** migración antes, drenaje verificable, `protocol_version` y conciliación obligatoria de filas heredadas, y rollback documentado. |
- **v4:** reclamo atómico por `rename`, `drive_folders`, esperas durables. Codex encontró cuatro problemas más:

| Hallazgo (v4) | Gravedad | Resolución en la v5 |
|---|---|---|
| Fijar antes de buscar el envío existente rompe los reintentos (respuesta perdida, éxito, fijado parcial, caída) | alto | **P1:** la ruta consulta primero `clientSubmissionId`; el fijado es reanudable y está ligado a la sesión. |
| El borrado público (`DELETE /uploads/:token`) puede borrar archivos ya retenidos | alto | **P1:** `removePending` (público, solo pendientes) separado de `releaseRetained` (interno, solo transiciones terminales). |
| El barrido excluye envíos con caso activo, justo los que tienen una conciliación programada | alto | **P4:** cola durable `submission_tasks`, con reclamo atómico, independiente del caso y del estado del envío. |
| Los archivos heredados quedan expuestos a la limpieza de 30 min | alto | **Despliegue:** adopción reanudable de heredados a `retained/` *antes* de iniciar la limpieza nueva; los ausentes generan caso visible. |

## Qué se verificó en el código

- `main.ts` crea `TemporaryFileStorage` **sin repositorio** (líneas 92-96): en producción los archivos temporales viven en
  disco con `metadata.json`. La retención no puede apoyarse en una transacción de PostgreSQL.
- `TemporaryFileStorage.remove` y `cleanup` borran con `rm(..., {recursive:true})` y la limpieza decide leyendo
  `metadata.json`. No hay exclusión entre limpieza y cualquier otra operación.
- `ensureChildFolder` busca por nombre y crea; no hay unicidad por carpeta lógica.
- La clave de idempotencia es `clientSubmissionId` (`submit-preinscription.ts:176`, `saveOrGet`). Hoy no hay consulta
  previa por esa clave: `saveOrGet` es lo primero que la lee.
- `DELETE /uploads/:token` (`upload-routes.ts:247-271`) llama a `storage.remove(token, sessionId)` desde el navegador.
- Compose recrea el contenedor parando primero el viejo (`Recreate`/`Recreated` en el último deploy), de modo que el drenaje
  del código viejo ocurre antes de que arranque el nuevo, siempre que el apagado le deje tiempo.

## Principios de diseño

1. **La exclusión la da un recurso atómico del propio sistema** (un `rename`, una restricción única, un `UPDATE` condicional),
   nunca una comprobación seguida de una acción.
2. **Ningún tiempo de espera se presenta como garantía.** Las esperas son estados durables con reconciliaciones
   posteriores, y lo que no se pueda cerrar se declara como riesgo residual.
3. **Un reintento nunca espera dentro de la petición.** Si debe esperar, responde cuándo volver y deja una continuación
   programada.
4. **Todo estado nuevo debe tener un camino de salida** para los registros anteriores al cambio.

## Alcance y supuestos

- Solo `apps/api`, migraciones y compose. No cambia el contrato HTTP; se usa el `202` que ya existe.
- Una sola réplica de la API. El lease y las restricciones únicas protegen aunque algún día haya más; el `rename` también
  (mismo volumen).
- Drive y Sheets no son transaccionales. Drive permite crear con ID reservado; Sheets no tiene inserción condicional.

## Protocolo (P1 a P4)

### P1. Archivos: reclamo atómico entre fijado y limpieza

**Estructura de directorios** bajo `UPLOAD_TMP_DIR`:

```
<root>/<token>/              subida reciente, vence a los 30 min (estado actual, "pendiente")
<root>/retained/<token>/     fijado por una preinscripción aceptada (7 días)
<root>/deleting/<token>/     reclamado por la limpieza o por un borrado explícito
```

**Reclamo con `rename` del mismo origen.** Un `rename` de un directorio dentro del mismo volumen es atómico: si dos
procesos intentan mover `<root>/<token>` a destinos distintos, uno lo logra y el otro recibe `ENOENT`.

- **Fijar** (`pinFiles`) es **reanudable e idempotente por token**. Para cada token:
  1. `rename(<root>/<token>, <root>/retained/<token>)` y, si lo logra, escribe en el `metadata.json` retenido el
     `sessionId` y el `clientSubmissionId` del intento (`pinnedFor`).
  2. Si recibe `ENOENT`, mira `retained/<token>`: si existe y su `sessionId` coincide, **ya estaba fijado** (intento
     anterior, fijado parcial o caída) y cuenta como éxito. Si pertenece a otra sesión, `403`.
  3. Si no existe en ninguno de los dos, la limpieza ganó o venció: `400 FILE_EXPIRED` ("volvé a cargar el archivo")
     **antes** de guardar nada.
- **Limpieza y borrado de pendientes:** hacen primero `rename(<root>/<token>, <root>/deleting/<token>)` y solo si lo
  logran borran `deleting/<token>`. La limpieza **nunca** toca `retained/`.
- Como fijado y limpieza compiten por el mismo origen, es imposible que el fijado "tenga éxito" y la limpieza borre el
  mismo directorio.

**Dos operaciones de borrado distintas:**

- `removePending(token, sessionId)`: es la que usa `DELETE /uploads/:token`. **Solo** actúa sobre `<root>/<token>`. Si el
  token ya está en `retained/`, responde `409 FILE_ALREADY_SUBMITTED` y no toca nada, aunque la petición sea tardía o
  concurrente con el fijado. Si el `rename` a `deleting/` pierde contra el fijado, el resultado es el mismo `409`.
- `releaseRetained(token)`: interna, no expuesta por HTTP. Solo la invocan las transiciones terminales controladas
  (éxito, descarte, caso vencido, huérfanos). Mueve `retained/<token>` a `deleting/<token>` y borra.

**Orden en la ruta de envío:**

1. Validar cuerpo y sesión.
2. **Consultar por `clientSubmissionId`** (`findByClientSubmissionId`, lectura sin efectos). Si el envío existe →
   responder su estado (`200` si `success`, `202` en otro caso) **sin fijar ni tocar archivos**. Cubre respuesta perdida,
   éxito con archivos ya borrados y reintentos tras fallos.
3. Si no existe: `pinFiles` (reanudable) → `saveOrGet` (con el lease, ver P4). Un fallo al fijar no deja registro; el
   reintento retoma los tokens ya fijados y fija los que faltan.
4. Si dos intentos concurrentes con el mismo `clientSubmissionId` llegan al paso 3, ambos fijan (idempotente) y
   `saveOrGet` decide con su restricción única; el perdedor recibe `existing: true`.

**Ciclo de vida de `retained/`:**

- Éxito: `releaseRetained(token)` (vía `deleting/`), una vez confirmada la etapa que ya no necesita el archivo.
- Preinscripción descartada o caso vencido a los 7 días: la limpieza de recuperaciones ya existente lo borra.
- **Huérfanos** (caída entre fijar y guardar): una limpieza nueva borra `retained/<token>` cuando tiene más de 7 días y
  ningún `submission_files.token` lo referencia. Fuga acotada, sin pérdida de datos.
- `open` y `listBySession` consultan `<root>/<token>` y `<root>/retained/<token>`; `removePending` solo el primero.
- **Directorios heredados:** los que existían al desplegar quedan en `<root>/<token>`. Los que pertenecen a envíos
  recuperables **no se dejan como pendientes**: se adoptan a `retained/` antes de que arranque la limpieza nueva (ver
  Orden de despliegue, paso 3).

**Pruebas:** limpieza suspendida justo después de leer el vencimiento y reanudada tras el fijado y el guardado
(el fijado debe fallar o la limpieza fallar, nunca ambos "tener éxito"); doble fijado concurrente del mismo token;
caída entre fijar y guardar; huérfano de más de 7 días; token ya vencido; sesión ajena; **reintento tras respuesta
perdida, tras éxito (archivos borrados) y tras fijado parcial de N archivos; reintento tras caída antes del commit;
`DELETE` tardío, concurrente con el fijado y posterior a la aceptación (siempre `409`, archivo intacto);
`releaseRetained` inaccesible por HTTP.**

### P2. Drive: creación condicional por ID y carpetas lógicas únicas

**Archivos.** Antes de la primera subida se piden IDs con `files.generateIds` y se guardan en
`submission_files.drive_reserved_id`. La subida usa ese `id`; un segundo intento recibe `409` y se trata como "ya
existe, recuperarlo". Se sigue escribiendo `appProperties` en cada archivo para compatibilidad con la búsqueda actual.

**Carpetas compartidas** (oferta, `Preinscripciones`, `Documentación`, y la carpeta de cada preinscripción). El `409` por
ID no basta, porque dos preinscripciones distintas reservarían IDs distintos para el mismo padre y nombre. Por eso:

1. Tabla nueva `drive_folders(folder_key text primary key, drive_folder_id text not null, created_at, confirmed_at)`.
   `folder_key` es la ruta lógica completa desde la carpeta raíz (`<rootId>/<oferta>/<Preinscripciones>/...`).
2. Para resolver una carpeta: (a) buscar una fila existente; (b) si no hay, **adoptar** una carpeta ya existente en Drive
   buscándola por nombre y padre, o generar un ID nuevo con `generateIds`; (c) `INSERT ... ON CONFLICT (folder_key) DO
   NOTHING` con ese candidato y releer: **el ganador es el ID de la fila persistida**, no el candidato propio; (d) crear
   en Drive solo con el ID ganador, tolerando `409`; (e) marcar `confirmed_at`.
3. Dos envíos simultáneos con candidatos distintos terminan usando el mismo ID ganador; el candidato perdedor nunca se crea.
4. Carpetas duplicadas que ya existan por carreras anteriores: se adopta la primera que devuelva Drive (comportamiento
   actual) y queda registrada; no se fusionan, se documenta.
5. Se reemplaza la cola en memoria de P5 (carpetas): ya no depende de una sola réplica.

**Pruebas:** dos preinscripciones distintas a una oferta nueva en paralelo (una sola jerarquía); subida con `409`; adopción
de una carpeta preexistente; candidato perdedor que no se crea; fila persistida sin `confirmed_at` tras una caída (el
siguiente la completa).

### P3. Sheets: intento incierto como estado durable

**Atomicidad.** `insertDimension` + `updateCells` + `repeatCell` (color) en un único `batchUpdate`; `stringValue` y
`formulaValue` para los `=HYPERLINK`. Se mantiene la evaluación de `pasteData` como alternativa en una hoja de prueba.

**Resultado incierto.** Google documenta un límite de procesamiento de 180 s por solicitud, así que **no existe una
ventana tras la cual una escritura enviada sea segura de descartar.** Por eso:

1. Antes de enviar se guarda `sheet_attempt_started_at`. Si el intento termina sin confirmación, el estado pasa a
   `sheet_uncertain` con `next_attempt_at = started_at + 200 s` (por encima de los 180 s documentados).
2. Un reintento antes de `next_attempt_at` **no espera**: responde "volvé a ejecutarlo a partir de HH:MM" (en el panel) o
   se ignora hasta que corresponda (en el barrido), sin consumir el plazo de 100 s.
3. Al llegar `next_attempt_at`, reconcilia: lee la columna "ID de seguimiento" **completa** (una llamada,
   `majorDimension=COLUMNS`) y solo inserta si el ID no está.
4. **Reconciliaciones posteriores durables.** Tras cualquier inserción en estado incierto se encolan en `submission_tasks`
   (ver P4) recuentos del ID en `+15 min` y `+2 h`, que se ejecutan aunque el envío ya esté en `success`. Si en alguno aparece más de una vez, se crea un caso persistente `stage:'sheets_duplicate'` visible
   en el panel y se alerta por Telegram con el ID y las filas, con el procedimiento: *eliminar la fila sobrante en la
   planilla y marcar el caso como resuelto*. No se borra nada automáticamente.
5. El camino normal (sin incertidumbre) no lee la hoja y no programa recuentos: costo cero.
6. `sheet_written_at` se guarda al confirmarse, y las etapas siguientes nunca vuelven a tocar la hoja.

**Residuo declarado:** si Google aplica una escritura pasadas las 2 h, el duplicado no se detecta. Es un riesgo que el
proveedor no permite cerrar; se documenta en el manual operativo y en el código.

**Pruebas:** primer batch que se aplica **después** del conteo y la inserción del segundo (el recuento a +15 min debe
alertar); respuesta perdida con batch aplicado; fallo antes de aplicarse; ID en la fila 25 000; hoja reordenada; reintento
inmediato desde el panel (responde cuándo volver, no queda colgado); un reintento a tiempo progresa sin intervención.

### P4. Lease, aceptación y barrido

**Lease.** Columnas en `submission_processing`: `lease_owner`, `lease_expires_at`, `next_attempt_at`,
`protocol_version`. Adquirir, renovar cada 20 s (duración 60 s) y escribir estados finales con
`WHERE lease_owner = $token`, como en la v2.

**Sin ventana sin lease.** El lease inicial **se crea dentro de la misma transacción de `saveOrGet`**: la fila de
`submission_processing` nace con `lease_owner` y `lease_expires_at` ya fijados y `protocol_version = 1`. No existe un
instante en que la preinscripción esté guardada y sin dueño.

**Dos selectores independientes.** El barrido no mezcla "envíos abandonados" con "trabajo programado":

1. **Envíos abandonados** (rescate; crea el caso si no existe), con el predicado de abajo.
2. **Tareas vencidas** de la cola durable `submission_tasks`, que **no depende de que exista un caso ni del estado del
   envío**.

**Cola durable:**

```sql
submission_tasks(
  id bigserial primary key, submission_id uuid not null, kind text not null, -- sheets_reconcile | sheets_recount
  run_at timestamptz not null, claimed_by text, claimed_until timestamptz,
  attempts int not null default 0, done_at timestamptz, last_error text,
  unique (submission_id, kind, run_at))
```

Reclamo atómico:

```sql
UPDATE submission_tasks SET claimed_by=$w, claimed_until=now()+interval '2 minutes', attempts=attempts+1
WHERE id IN (SELECT id FROM submission_tasks
             WHERE done_at IS NULL AND run_at <= now() AND (claimed_until IS NULL OR claimed_until < now())
             ORDER BY run_at LIMIT 5 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

La tarea se encola **en la misma transacción** que escribe `sheet_uncertain` o el caso, así que no puede haber estado
incierto sin tarea. Una tarea reclamada cuyo proceso cae se reabre sola al vencer `claimed_until`. Si una tarea falla,
se reprograma con retroceso exponencial y, tras 5 intentos, crea un caso visible `stage:'task_failed'` más alerta, sin
perderse.

**Predicado de envíos abandonados, explícito con `NULL`:**

```sql
status = 'pending'
AND COALESCE(lease_expires_at, updated_at + interval '3 minutes') < now()
AND (next_attempt_at IS NULL OR next_attempt_at <= now())
AND NOT EXISTS (caso de recuperación activo)
```

Este predicado sigue excluyendo envíos con caso activo **a propósito**: ahí el caso ya existe. Lo que antes dependía de él
(reconciliar Sheets al llegar `next_attempt_at`, recuentos) lo ejecuta ahora la cola.

`COALESCE` cubre las filas heredadas (sin lease) usando su `updated_at` más 3 minutos de gracia, para no marcar como
abandonado un envío que todavía arranca.

**Respuestas cuando la preinscripción ya existe** (ambos caminos `existing`): `success` → `200`; cualquier otro estado →
`202 pending_processing`. Si el lease venció y no hay caso, se crea (`stage:'unknown'`).

**Plazo de 100 s.** Aplica al **trabajo activo** de un procesador. Las esperas no son trabajo: son `next_attempt_at`. Al
vencer el plazo, el procesador libera el lease y deja el caso; encola `sheets_reconcile` con `run_at = next_attempt_at`; el
barrido la reclama desde la cola (aunque haya caso activo) y ejecuta **solo la reconciliación de Sheets** (cabe
holgadamente en 100 s). Los reintentos de Drive siguen
siendo manuales desde el panel.

**Barrido.** Cada 60 s. Bandera `SUBMISSION_SWEEPER_ENABLED`, apagada por defecto. Además un **comando de una sola vez**,
`pnpm --filter api sweep:once [--dry-run]`, que ejecuta el mismo barrido manualmente y con vista previa. Es lo que permite
verificar en producción sin dejar el barrido encendido.

**`unknown` en `retryFailedSubmission`:** rehacer desde Drive (seguro por IDs reservados) y reconciliar Sheets antes de
insertar. Se agrega al `switch` y se prueba.

**Pruebas:** escritura incierta **con caso activo** que progresa por la cola; recuentos que corren con el envío ya en
`success` y tras reiniciar el proceso; dos workers reclamando la misma tarea (solo uno ejecuta); tarea de un proceso
caído que se reabre; tarea que falla 5 veces y genera `task_failed`; caída entre el commit y el primer lease (imposible por construcción: prueba que la fila nace con lease);
fila heredada con lease nulo (el `COALESCE` la selecciona tras 3 min y no antes); dos barridos simultáneos (un solo caso);
procesador que sigue renovando no se toca; reintento anticipado que no consume el plazo; plazo que vence y deja
`next_attempt_at`.

## Orden de despliegue

La clave es que **la migración y la compatibilidad hacia atrás se desplegan antes que el cambio de comportamiento**, y que el
código viejo se drena de forma verificable antes de activar el nuevo.

1. **Release A (no corta ni cambia ningún efecto externo):**
   - migración aditiva: columnas nulas (`lease_owner`, `lease_expires_at`, `next_attempt_at`, `protocol_version`,
     `sheet_attempt_started_at`, `sheet_written_at`, `drive_reserved_id`) y tablas nuevas (`drive_folders`), todas ignoradas
     por el código actual;
   - `stop_grace_period: 120s` en `api` y espera interna de 110 s en `main.ts`;
   - timeout de subida a Drive de 15 s a 60 s (alarga, no corta);
   - `StorageLayout` v2 que **lee** `retained/` y `deleting/` pero **escribe** igual que hoy.
   Con A en producción, la base ya está migrada y el código viejo, drenado con 120 s de margen, puede convivir.
2. **Corte de admisión y drenaje verificable antes de B.** Se despliega B con `docker compose up`, que para primero el
   contenedor viejo y le da hasta 120 s para terminar las peticiones en curso. Verificación previa al corte: consultar
   `submission_processing` y confirmar que no hay filas `pending` con `updated_at` de los últimos 5 minutos (el drenaje
   terminó) o esperar a que las haya. Si el drenaje se agota por SIGKILL, ver el siguiente paso.
3. **Conciliación obligatoria de lo iniciado por el código viejo, en el arranque de B y antes de la limpieza nueva.**
   La limpieza de pendientes y el barrido **no arrancan** hasta que este paso termine.
   - **Adopción de archivos heredados.** Para cada `submission_files.token` de una fila `pending`/`failed` con
     `protocol_version IS NULL`, o con caso de recuperación activo, se ejecuta el mismo `pinFiles` reanudable (`rename` a
     `retained/`, compitiendo atómicamente con cualquier limpieza). Si el token ya no existe en ninguno de los dos
     sitios, se crea un caso visible `stage:'files_missing'` con la lista de archivos; no se continúa en silencio. El
     paso es idempotente: si el proceso cae, se repite entero.
   - Su reintento **siempre** reconcilia Sheets (columna completa) y Drive (búsqueda por `appProperties`) antes de crear.
   - Se les asigna `next_attempt_at = now() + 200 s` (mayor que los 180 s de Google) y se encola su `sheets_reconcile`.
   - El comando `sweep:once` las lista con su estado y el resultado de la adopción.
   - **Límite honesto:** si la limpieza del código viejo (activa hasta el corte) ya borró un archivo de un envío
     recuperable, no se puede deshacer; el paso lo detecta y lo muestra como `files_missing`.
4. **Release B (protocolo completo en un solo despliegue):** P1, P2, P3, P4 y el plazo de 100 s. Barrido apagado.
5. **Verificación en producción con el barrido apagado:** (a) matar el contenedor `api` a mitad de un envío con archivos;
   (b) ejecutar `pnpm --filter api sweep:once --dry-run` y comprobar que lista la preinscripción; (c) ejecutarlo sin
   `--dry-run` y comprobar el caso de recuperación y los archivos en `retained/`; (d) reintentar desde el panel y
   comprobar que completa Drive y Sheets sin duplicar; (e) forzar un intento incierto de Sheets en una planilla de
   prueba y comprobar `next_attempt_at` y los recuentos diferidos.
6. **Encender el barrido** (`SUBMISSION_SWEEPER_ENABLED=true`).

**Rollback.** B no elimina ni reescribe nada: las columnas y tablas nuevas son aditivas, `retained/` es una carpeta más y
el código viejo las ignora. Volver a la imagen anterior es seguro. Quedan las siguientes consecuencias, que se documentan:
los archivos de las preinscripciones aceptadas por B viven en `retained/` y el código viejo no los ve, por lo que antes de
revertir hay que ejecutar `sweep:once` para vaciar los casos pendientes o aceptar que esos reintentos esperen a B. Los
archivos con `drive_reserved_id` conservan `appProperties`, así que el código viejo los reconoce.

## Verificación

- `pnpm -r run typecheck` y `pnpm -r run test` con los tests de integración de PostgreSQL del CI.
- Pruebas de concurrencia reales (no secuenciales) en P1, P2, P3 y P4, listadas arriba.
- Prueba de migración: base con envíos `protocol_version IS NULL` en `pending`/`failed`, con archivos presentes, vencidos
  por TTL y ausentes; tras el arranque de B los presentes están en `retained/`, los ausentes tienen `files_missing` y
  la limpieza no corrió antes de terminar la adopción.
- Prueba de transición: un efecto del código viejo que termina después de iniciarse el código nuevo, con una fila de
  `protocol_version IS NULL` (debe reconciliar y no duplicar).
- Despliegue durante una subida de más de 28 s para validar el apagado ordenado.

## Riesgos que quedan

- **Sheets** puede duplicar una fila si Google aplica una escritura pasadas 2 h. Se detecta hasta ese punto, se alerta y se
  resuelve a mano; no se borra sola. No hay forma de cerrarlo con la API de Sheets.
- Un `SIGKILL` o una caída sigue produciendo un caso de recuperación; se mitiga, no se elimina.
- El `rename` atómico supone que `UPLOAD_TMP_DIR`, `retained/` y `deleting/` están en el mismo volumen. Se valida al
  arrancar (falla cerrada con un error claro si no lo están).
- Carpetas duplicadas ya existentes en Drive por carreras anteriores no se fusionan.
- Si una asistente borra la columna "ID de seguimiento", la reconciliación falla cerrada (vuelve a insertar) y se alerta.
  Se documenta en el manual de las asistentes.
- Archivos fijados sin preinscripción: fuga de hasta 7 días, sin pérdida de datos.
- Archivos de envíos heredados que el código viejo ya limpió antes del corte: se detectan (`files_missing`), no se recuperan.
- La cola `submission_tasks` suma una tabla y un ejecutor; si el barrido se detiene, las tareas esperan (no se pierden)
  y `sweep:once` puede ejecutarlas a mano.

## Fuera de alcance

Revisión del frontend (salvo la verificación del `202`), de `admin-settings-routes.ts`, de los despachadores de correo,
Telegram y Mautic, y de las migraciones anteriores.
