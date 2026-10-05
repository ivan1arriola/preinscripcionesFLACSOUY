# Notificaciones Telegram por preinscripción y bandeja operativa de planillas

## Objetivo

Ampliar Telegram para que pueda notificar cada preinscripción confirmada, sin convertirlo en una dependencia del flujo público, y rediseñar la pantalla administrativa de planillas para que sea una bandeja operativa legible aun cuando existan decenas o cientos de destinos.

El alcance conserva los contratos académicos, las rutas públicas, los datos existentes y las acciones actuales de Google Sheets. No incluye migrar el proveedor de correo, cambiar la arquitectura de WordPress ni rediseñar el resto de Administración.

## Estado actual relevante

- `AdminSpreadsheetSettingsCard` presenta todos los destinos en una lista vertical de igual jerarquía.
- La pantalla no ofrece búsqueda, filtros, métricas ni separación visual entre pendientes y planillas activas.
- Telegram ya tiene configuración cifrada, múltiples `chat_id`, proveedor HTTP, cola durable y alertas de recuperación.
- Las alertas actuales se encolan cuando Drive o Sheets fallan; no existe todavía un evento de Telegram para cada preinscripción exitosa.
- El repositorio de alertas actual se llama `telegram_recovery_alerts`; se conserva el nombre físico para evitar una migración destructiva y se amplía su contrato mediante una migración aditiva.

## Decisiones funcionales

### Telegram

1. La configuración tendrá dos interruptores independientes:
   - `telegram_recovery_enabled`: alertas de fallos recuperables existentes.
   - `telegram_preinscription_enabled`: notificación de cada preinscripción confirmada.
2. Se reutilizarán el token, los `chat_id`, el proveedor y el worker existentes.
3. Cada combinación `submission_id + chat_id + event_type` será idempotente. Reintentos HTTP o reintentos administrativos no crearán mensajes duplicados.
4. La notificación de una preinscripción se encolará después de que la preinscripción haya sido persistida y marcada como `success`. Un error de configuración, base de datos de la cola o Telegram se registrará de forma segura y no cambiará la respuesta 201/202 del flujo público.
5. El mensaje será operacional y mínimo:

   ```text
   ✅ Nueva preinscripción recibida
   ID: sub_...
   Destino: <título académico>
   Tipo: Oferta académica | Seminario
   Fecha: <fecha ISO o local>
   Estado: Registrada
   ```

   No incluirá cédula, teléfono, correo, valores del formulario, nombres, documentos, tokens ni enlaces privados.
6. La UI mostrará el estado de ambos tipos de alerta por separado. No expondrá token ni valores completos de `chat_id`.

### Bandeja de planillas

1. Se conserva `AdminSpreadsheetSettingsCard` y todos sus endpoints:
   - consultar destinos;
   - preparar/reintentar planillas;
   - abrir planilla;
   - desvincular planilla.
2. Se agregan controles puramente de presentación y estado local:
   - búsqueda por título;
   - filtro por tipo: todos, ofertas académicas, seminarios;
   - filtro por estado: todos, requieren atención, activas/listas, desvinculadas;
   - orden estable por atención primero y luego título.
3. El encabezado muestra métricas derivadas de la respuesta existente: total, activas/listas, pendientes y bloqueadas.
4. Las filas se agrupan en “Requieren atención” y “Planillas disponibles”. Cada fila muestra título, tipo, estado y una acción principal; las acciones secundarias permanecen visibles en una fila expandible o menú accesible.
5. Cuando no hay resultados filtrados se muestra un estado vacío específico, con opción de limpiar filtros.
6. En móvil las filas pasan a tarjetas compactas sin ocultar estado ni acciones.

## Privacidad y tolerancia a fallos

- Telegram nunca será una dependencia síncrona de la respuesta pública.
- No se harán reintentos bloqueantes dentro del request de preinscripción.
- Los errores de Telegram se sanitizan y truncan antes de persistirse o mostrarse.
- La cola seguirá usando leases, backoff y máximo de intentos existentes.
- Una falla de encolado se registra con `console.error` operacional seguro, sin cuerpo completo ni secretos.
- La UI no debe revelar credenciales ni datos de postulantes.

## Criterios de aceptación

1. Con Telegram de preinscripciones habilitado y dos destinatarios configurados, una preinscripción exitosa crea exactamente dos trabajos, uno por destinatario.
2. Repetir el mismo request con el mismo `clientSubmissionId` no duplica esos trabajos.
3. Si el proveedor Telegram falla, el flujo público conserva su respuesta y el estado de la preinscripción.
4. Si Telegram está deshabilitado, no se generan trabajos de preinscripción, pero las alertas de recuperación conservan su comportamiento.
5. Los trabajos de recuperación y de preinscripción pueden distinguirse en estadísticas y filtros administrativos.
6. La pantalla de planillas permite encontrar un destino por texto y reducir la lista por tipo/estado.
7. Los destinos bloqueados o pendientes aparecen antes que los destinos activos, sin perder ninguna acción existente.
8. La pantalla conserva navegación por teclado, nombres accesibles, estados de carga/error y comportamiento responsive.

## Fuera de alcance

- Enviar información personal por Telegram.
- Cambiar el proveedor Telegram o agregar otra plataforma de mensajería.
- Cambiar el modelo de Google Drive/Sheets.
- Agregar paginación de servidor para la lista de planillas.
- Modificar la pantalla pública de preinscripción.
