# Recuperación de preinscripciones fallidas, alertas Telegram y mejoras UX

## Objetivo

Evitar que un fallo de Drive, Google Sheets o una integración de notificaciones deje al postulante sin trazabilidad ni al equipo sin una forma segura de recuperar la preinscripción. Cuando el envío técnico falla después de validar y guardar los datos, la aplicación conservará temporalmente el caso, avisará al administrador por Telegram y permitirá reintentar o eliminarlo desde Administración.

El mismo cambio mejora la claridad de los errores SMTP y la experiencia de configuración, y corrige la presentación del bloque de documentación del título sin quitar datos ni acciones existentes.

## Decisiones confirmadas

- Toda la configuración de Telegram se administra desde la UI de Administración.
- El token del bot se guarda cifrado usando el servicio de configuración cifrada existente.
- Se podrán configurar uno o varios destinatarios mediante `chat_id`, activar/desactivar alertas y enviar una prueba desde la UI.
- Los mensajes de Telegram no contienen cédula, teléfono, correo completo, valores del formulario ni documentos.
- Los casos fallidos se conservan durante 7 días.
- Administración permite reintentar el procesamiento o descartar definitivamente el caso y sus temporales.
- Los datos y archivos privados se eliminan al vencer la retención o al descartar el caso.
- Se preservan las rutas, datos y acciones actuales; los cambios de UX son aditivos.

## Flujo de envío fallido

1. `submitPreinscription` sigue guardando la preinscripción y sus valores antes de Drive/Sheets.
2. Si falla Drive, Sheets o la creación de la fila, el registro queda `failed` con:
   - `submission_id`;
   - etapa (`drive`, `sheets` o `unknown`);
   - mensaje técnico seguro, sin secretos;
   - fecha de último intento y fecha de vencimiento de retención.
3. Los archivos temporales asociados se mantienen privados hasta la fecha de vencimiento de ese caso. Los temporales de formularios abandonados continúan con su TTL normal.
4. Se encola una alerta operacional duradera. El envío a Telegram ocurre mediante un worker con lease, reintentos y backoff; un fallo de Telegram nunca bloquea ni cambia el resultado de la preinscripción.
5. La respuesta al postulante informa que la preinscripción fue recibida pero está pendiente de procesamiento técnico, devuelve el identificador de seguimiento y no expone el detalle crudo del proveedor.
6. Al reintentar, el sistema reutiliza la preinscripción existente y los archivos ya confirmados, evita duplicar archivos de Drive y vuelve a ejecutar únicamente las etapas pendientes. Si el reintento termina correctamente, se marca `success`, se limpian los temporales y se envían las notificaciones normales.

## Modelo de estados y recuperación

Se agrega una bandeja administrativa de “Preinscripciones pendientes de recuperación” con filtros por estado, etapa, fecha y oferta. Cada fila muestra únicamente metadatos operativos: ID, oferta, fecha, estado, etapa, cantidad de documentos, último error seguro y vencimiento.

Acciones:

- `Reintentar`: reclama el caso de forma idempotente, procesa Drive/Sheets y deja trazabilidad del resultado.
- `Ver detalle`: muestra los datos completos solo dentro de la sesión administrativa autenticada y permite inspección del estado de cada documento.
- `Descartar y eliminar`: elimina los valores, snapshots y archivos temporales asociados después de una confirmación explícita.

El reintento no crea otra fila de `submissions`, no cambia `client_submission_id` y no vuelve a subir un documento cuyo `drive_file_id` ya esté confirmado. Si un archivo temporal ya venció, el caso queda marcado como no recuperable y la UI explica qué documento falta.

## Telegram configurable

La pestaña de notificaciones incorpora un bloque separado “Alertas de recuperación por Telegram”:

- habilitar alertas;
- token del bot, nunca mostrado después de guardarlo;
- uno o varios `chat_id`, uno por línea o separados por coma;
- botón “Guardar configuración”;
- botón “Enviar prueba” habilitado solo cuando la configuración es válida;
- estado de configuración, última prueba, último error y estado de la cola;
- explicación de que el bot debe haber sido iniciado por cada destinatario.

El token y los chat IDs se validan y persisten cifrados. La API devuelve solo `hasToken`, cantidad de destinatarios, destinatarios enmascarados y metadatos de estado. El proveedor Telegram usa HTTPS, timeout corto y clasificación segura de errores; nunca registra el token ni el cuerpo completo de la respuesta.

El mensaje operacional contiene, como máximo:

```text
⚠️ Preinscripción pendiente de recuperación
ID: sub_...
Oferta: <título truncado>
Etapa: Google Sheets
Fecha: <fecha local>
Error: <mensaje seguro truncado>
Administración: <enlace autenticado o enlace de acceso al panel>
```

## Retención y limpieza

- Los casos fallidos tienen `retention_expires_at` calculado a 7 días desde el primer fallo.
- Cada nuevo reintento actualiza `last_attempt_at`, pero no extiende indefinidamente la retención; la extensión solo ocurre mediante una acción administrativa explícita.
- Un proceso periódico elimina casos vencidos, sus `submission_values`, snapshots, referencias temporales y archivos del volumen privado.
- La eliminación es idempotente y deja un evento operacional sin datos personales para auditoría.

## Mejoras de interfaz aprobadas

### SMTP

- Separar visualmente “Conexión”, “Credenciales”, “Remitente y respuesta” y “Destinatarios maestros”.
- Los valores enmascarados no se usan como valores editables: se muestran como estado de solo lectura y los campos vacíos significan conservar el secreto actual.
- Los errores muestran mensaje general, motivo exacto y acción sugerida, por ejemplo: “El remitente debe ser una dirección válida”.
- Mejorar jerarquía, espaciado, estados de guardado, estados de prueba y botones; mantener todos los campos, prueba SMTP, cola y acciones actuales.
- Mostrar una confirmación clara cuando la configuración se guarda sin activar el envío.

### Documentación requerida

- Rediseñar el bloque de título con una tarjeta de decisión accesible para “Poseo título” / “No poseo actualmente título”.
- Alinear checkbox, texto y ayuda; hacer que toda la etiqueta sea clickeable.
- Al seleccionar que no posee título, ocultar o deshabilitar coherentemente denominación y archivo, limpiar errores asociados y conservar la validación condicional.
- Mantener carga, eliminación, nombres, tamaños, límites y contratos actuales.

## Privacidad y seguridad

- No enviar PII ni enlaces públicos a Telegram.
- No incluir secretos en mensajes, errores HTTP, logs o snapshots de configuración.
- Mantener acceso administrativo autenticado y protección CSRF para configuración, prueba, reintento y eliminación.
- El detalle completo de una preinscripción solo se entrega a una sesión administrativa autorizada.
- Los mensajes de proveedor se normalizan y truncan antes de persistirse o mostrarse.

## Criterios de aceptación

1. Un fallo simulado de Sheets deja una preinscripción recuperable, con valores persistidos, archivos temporales privados y alerta Telegram en cola.
2. Telegram puede configurarse, validarse, probarse y desactivarse sin editar variables de entorno.
3. Un fallo de Telegram no impide completar la respuesta de error ni elimina el caso recuperable.
4. El reintento exitoso no duplica la preinscripción ni los archivos confirmados.
5. Un caso vencido se elimina automáticamente y deja de aparecer como recuperable.
6. La UI muestra el motivo real de errores SMTP y nunca vuelve a validar una dirección enmascarada como si fuera completa.
7. El bloque “Documentación requerida” queda alineado y su validación condicional funciona en teclado y mouse.
8. Las pruebas cubren API, repositorios, worker, configuración cifrada, reintentos, retención y componentes web.

## Fuera de alcance

- Enviar datos personales o documentos por Telegram.
- Crear un portal de recuperación para postulantes.
- Cambiar el proveedor de correo o Google Drive/Sheets.
- Cambiar rutas públicas, permisos administrativos o el modelo académico.
