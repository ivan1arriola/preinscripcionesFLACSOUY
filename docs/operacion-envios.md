# Manual de operación y contingencia: robustez de envíos

Este documento detalla el procedimiento operativo, de verificación y de rollback asociado al protocolo de robustez de envíos (Release A y B), así como la gestión de casos y riesgos residuales en producción.

---

## 1. Procedimiento de Rollback

El diseño del protocolo es aditivo y hacia atrás compatible:
- **Base de datos:** Todas las nuevas columnas (`lease_owner`, `lease_expires_at`, `next_attempt_at`, `protocol_version`, `sheet_attempt_started_at`, `sheet_written_at`, `drive_reserved_id`) son nulas o tienen valores por defecto, y las nuevas tablas (`drive_folders`, `submission_tasks`) no interfieren con el código previo.
- **Archivos en disco:** El subdirectorio `<root>/retained/` almacena los archivos fijados. El código viejo solo interactúa con `<root>/<token>`, por lo que no colisiona con el almacenamiento retained.
- **Drive:** Los archivos creados con `drive_reserved_id` mantienen los metadatos `appProperties` que el código anterior utiliza para su indexación.

### Pasos para revertir (Rollback de Release B a Release A o versión anterior)

1. **Drenar casos pendientes antes de revertir:**
   Ejecutar el comando de barrido puntual para asegurar que no queden preinscripciones en estados transitorios dependientes del nuevo protocolo:
   ```bash
   pnpm --filter api sweep:once
   ```
2. **Consecuencia sobre archivos retenidos:**
   Las preinscripciones aceptadas bajo la Release B tienen sus archivos temporales en `<root>/retained/<token>`. El código viejo no lee este subdirectorio. Por lo tanto, si un reintento manual posterior requiriese esos archivos, dicho reintento deberá esperar al redespliegue de la Release B o el archivo deberá ser cargado nuevamente si se generó un caso `files_missing`.
3. **Revertir la imagen o commit:**
   Apagar el servicio actual y desplegar la versión previa mediante Docker Compose:
   ```bash
   docker compose down
   # Cambiar a la imagen/tag anterior o git checkout a la versión previa
   docker compose up -d
   ```
4. **Verificación post-rollback:**
   Consultar la salud del servicio:
   ```bash
   curl -s http://localhost:3000/api/health
   ```
   Comprobar los logs de `preinscripciones-api` para asegurar el arranque normal.

---

## 2. Manual de `sweep:once`

El comando `sweep:once` permite ejecutar manualmente el barrido de envíos abandonados y el procesamiento de tareas diferidas de la cola `submission_tasks` de forma puntual, controlada y sin necesidad de activar el demonio continuo.

### Modos de ejecución

1. **Modo vista previa (Dry-Run):**
   Inspecciona la base de datos e informa qué envíos se consideran abandonados y cuántas tareas diferidas están listas para ejecución, **sin reclamar leases ni alterar registros**:
   ```bash
   pnpm --filter api sweep:once --dry-run
   ```
2. **Modo ejecución real:**
   Reclama atómicamente los envíos abandonados con lease vencido, crea los casos visibles correspondientes en `submission_recoveries` y despacha las tareas vencidas de `submission_tasks` (por ejemplo, reconciliaciones de Sheets):
   ```bash
   pnpm --filter api sweep:once
   ```

### Cuándo utilizarlo
- **Verificación durante despliegues:** Para constatar en producción que el procesador y la base de datos responden correctamente antes de habilitar el barrido continuo.
- **Mantenimiento o caídas imprevistas:** Tras un reinicio abrupto o mantenimiento en servidores para destrabar envíos que hayan quedado pendientes sin dueño.
- **Previo a un rollback:** Para drenar las tareas diferidas acumuladas.

---

## 3. Bandera `SUBMISSION_SWEEPER_ENABLED`

- **Variable de entorno:** `SUBMISSION_SWEEPER_ENABLED`
- **Valores posibles:** `true` | `false` (predeterminado: `false`)

### Comportamiento
- Cuando está en `false` (o no definida), el servicio de la API no ejecuta el intervalo periódico de barrido cada 60 s. Las tareas en cola permanecen seguras en PostgreSQL y pueden ejecutarse con `sweep:once`.
- Cuando está en `true`, se activa un temporizador en segundo plano que cada 60 s invoca la rutina de barrido para reclamar envíos abandonados y ejecutar tareas diferidas pendientes.

### Recomendación operativa
Durante la fase inicial de Release B, mantener `SUBMISSION_SWEEPER_ENABLED=false`. Una vez verificado el comportamiento del sistema y tras realizar pruebas controladas con `sweep:once`, activar la variable configurando `SUBMISSION_SWEEPER_ENABLED=true` en el entorno de producción.

---

## 4. Riesgo residual de Google Sheets

Google Sheets API **no provee transacciones ACID ni inserciones condicionales**. Además, Google documenta que una solicitud puede tardar hasta **180 segundos** en procesarse internamente. Por ello:

1. **Ventana de incertidumbre y espera durable:**
   Si una petición de escritura a Sheets finaliza con error de red, timeout o respuesta ambigua, el sistema no reintenta de inmediato: establece `next_attempt_at = now() + 200 s` (superando los 180 s documentados) y encola una tarea diferida `sheets_reconcile`.
2. **Reconciliación y recuentos posteriores:**
   Al cumplirse el plazo, se lee la columna completa de "ID de seguimiento". Si el ID ya fue escrito por Google, no se duplica. Tras la inserción, se programan recuentos durables a los **+15 minutos** y a las **+2 horas**.
3. **Límite honesto y residuo no cerrado:**
   Si Google aplicara una escritura retrasada **después de 2 horas**, el recuento diferido habrá concluido y el duplicado no se detectará automáticamente. Este es un riesgo residual propio del proveedor que no puede cerrarse por software.

---

## 5. Procedimiento para resolver un caso `sheets_duplicate`

Cuando uno de los recuentos difer (+15 min o +2 h) detecta que un mismo ID de seguimiento aparece más de una vez en la planilla Google Sheets:
- Se genera un caso visible en el panel administrativo con `stage: 'sheets_duplicate'`.
- Se despacha una alerta por Telegram indicando el ID de seguimiento y las filas duplicadas.
- **Nunca se borran filas de Sheets automáticamente**, para evitar pérdidas accidentales de datos si la planilla fue reordenada o modificada.

### Pasos de resolución manual

1. **Abrir la planilla de cálculo de la oferta:**
   Acceder a Google Sheets mediante el enlace provisto en el panel administrativo para la oferta correspondiente.
2. **Localizar el duplicado:**
   Presionar `Ctrl+F` (o buscar) y escribir el ID de seguimiento reportado en la alerta o en el panel.
3. **Revisar y eliminar la fila sobrante:**
   Identificar cuál de las dos (o más) filas es la sobrante (generalmente la insertada en segundo lugar con los mismos datos). Hacer clic derecho sobre el número de fila sobrante y seleccionar **Eliminar fila**.
4. **Marcar el caso como resuelto:**
   En el panel administrativo de FLACSO Uruguay, ingresar a la sección de **Recuperación de envíos**, ubicar el caso con etapa `sheets_duplicate` correspondiente al ID de seguimiento y presionar la acción **Marcar como resuelto**.
