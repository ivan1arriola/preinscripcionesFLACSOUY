# Notificaciones por Telegram y Bandeja Operativa de Planillas

Este documento describe la arquitectura, configuración y operativa de las notificaciones por Telegram y la bandeja operativa de planillas en la plataforma de preinscripciones de FLACSO Uruguay.

---

## 1. Notificaciones por Telegram

La plataforma soporta dos tipos independientes de alertas vía Telegram:

1. **Alertas operativas de incidentes técnicos (`incident`):**
   - Se activan con el switch **"Alertas técnicas por Telegram"** en el panel de administración (`/admin`).
   - Se encolan automáticamente cuando falla el procesamiento de una preinscripción en Google Drive o Google Sheets.
   - Incluyen ID de seguimiento (`submission_id`), destino académico, etapa que falló y detalle técnico sanitizado.
   - **No contienen PII** (datos personales del postulante).

2. **Notificaciones de preinscripciones recibidas (`preinscription`):**
   - Se activan con el switch independiente **"Notificar cada preinscripción por Telegram"** en el panel de administración.
   - Se encolan tras cada registro exitoso de una preinscripción (ya sea en el flujo público `201 Created` o en la recuperación administrativa manual `200 OK`).
   - El mensaje incluye:
     - Título del evento: `✅ Nueva preinscripción recibida`
     - Identificador del envío: `ID: sub_...`
     - Título de la oferta o seminario (truncado a 100 caracteres si excede).
     - Tipo de destino: `Oferta académica` o `Seminario`.
     - Timestamp UTC: `Fecha: 2026-10-05T...Z`
     - Estado: `Registrada`
   - **Garantía estricta de privacidad (Zero PII):** No se envían nombres, correos, documentos de identidad, teléfonos, enlaces directos ni respuestas a campos del formulario.

### Semántica de encolado y entrega

- **No bloqueante:** La generación de la alerta por Telegram ocurre en un bloque aislado con captura de errores. Cualquier problema con Telegram (token inválido, rate limits de la API de Telegram, fallas de red) **nunca** bloquea ni altera la respuesta HTTP al postulante ni la persistencia de la preinscripción.
- **Idempotencia:** Cada alerta se almacena en la tabla `telegram_alerts` con un `dedupe_key` único: `${submissionId}:${chatId}:${eventType}`. Si la preinscripción se procesa o reintenta, no se duplicarán mensajes en el mismo chat para el mismo evento.
- **Despachador en segundo plano:** Dentro del proceso de la API se despachan los mensajes pendientes con reintentos exponenciales y backoff ante rate limits (`429 Too Many Requests`).

### Configuración de Chats y Bot

1. Crear un bot en Telegram con `@BotFather` y obtener el `TELEGRAM_BOT_TOKEN`.
2. Para cada canal o grupo destinatario:
   - Añadir el bot al grupo.
   - Enviar `/start` o cualquier mensaje para inicializar el chat.
   - Configurar el `chat_id` correspondiente en la configuración administrativa o variable de entorno (`TELEGRAM_CHAT_ID`, `TELEGRAM_PREINSCRIPTION_CHAT_ID` o lista separada por comas).

---

## 2. Bandeja Operativa de Planillas de Google Sheets

Cada oferta académica y seminario cuenta con una planilla dedicada en Google Drive donde se sincronizan las preinscripciones.

La sección **"Planillas automáticas por oferta"** en el panel de administración ofrece una bandeja operativa con:

### Métricas de cabecera
- **Total:** Cantidad de ofertas y seminarios en el catálogo.
- **Disponibles:** Planillas sincronizadas, reconciliadas y listas para recibir filas.
- **Requieren atención:** Planillas bloqueadas (ej. fallas de permisos de cuenta de servicio) o con creación pendiente.
- **Bloqueadas:** Planillas que han reportado errores HTTP o de acceso con la API de Google Sheets.

### Filtros en tiempo real
- **Buscador:** Filtrado instantáneo tolerante a mayúsculas y acentos por título del curso o identificador (`targetId`).
- **Tipo:** Todos, Ofertas académicas, Seminarios.
- **Estado:** Todas, Requieren atención, Listas / Activas, Desvinculadas.
- **Botón "Limpiar filtros":** Restaura rápidamente la vista completa si no hay coincidencias o si se desea reiniciar.

### Agrupación y gestión
- Las ofertas que **requieren atención** se presentan al inicio con llamada visual de advertencia (`⚠️`).
- Cada fila compacta muestra:
  - Título y etiqueta de tipo (`Oferta académica` / `Seminario`).
  - Badge de estado (`Activa`, `Lista`, `Reconciliada`, `Bloqueada`, `Desvinculada`, `Pendiente`).
  - Enlace directo **"Abrir planilla ↗"** que redirige a Google Sheets si la planilla existe.
  - Botón **"Detalles"** expandible para inspeccionar el `ID del destino` y el `ID de Google Sheet`.
  - Acción segura de **"Desvincular planilla"** (con confirmación de usuario) para desasociar una planilla dañada y permitir su regeneración con el botón general **"Reintentar preparación"**.
