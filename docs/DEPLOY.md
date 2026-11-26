# Deploy productivo

El deploy de `preinscripcionesFLACSOUY` se ejecuta desde esta PC hacia `servidor-flacso`. El script no modifica Apache ni cambia el dominio público: levanta la nueva aplicación en un puerto local para que el operador haga el cambio de `ProxyPass` de forma separada.

## Instalación inicial del servidor

Crear una única vez, como usuario con permisos para Docker:

```bash
sudo mkdir -p /opt/flacso/preinscripcionesFLACSOUY/.secrets
sudo mkdir -p /opt/flacso/backups/preinscripcionesFLACSOUY
sudo chown -R ubuntu:ubuntu /opt/flacso/preinscripcionesFLACSOUY /opt/flacso/backups/preinscripcionesFLACSOUY
```

Copiar en el servidor:

- `.env.production` a `/opt/flacso/preinscripcionesFLACSOUY/.env.production` usando [`.env.production.example`](../.env.production.example) como referencia.
- `google-service-account.json` a `/opt/flacso/preinscripcionesFLACSOUY/.secrets/google-service-account.json`.
- `google-oauth-web-client.json` a `/opt/flacso/preinscripcionesFLACSOUY/.secrets/google-oauth-web-client.json`.

`APP_SETTINGS_ENCRYPTION_KEY` debe existir en `.env.production` antes de
activar las notificaciones por correo (SMTP) o las alertas de incidentes por Telegram.
Es la misma variable de entorno que se usa en local, pero el valor de producción debe
ser diferente y no debe copiarse desde la PC. Generar y guardar la clave directamente
en el servidor con permisos restrictivos (cadena hexadecimal de 64 caracteres para AES-256-GCM):
```bash
openssl rand -hex 32
```

### Configuración y Operación SMTP (Amazon SES u otro proveedor)

1. **Credenciales SMTP:**
   El envío transaccional utiliza SMTP estándar (por ejemplo, Amazon SES SMTP en el puerto 587 con STARTTLS o puerto 465 con TLS directo).
   Los parámetros (`smtp_host`, `smtp_port`, `smtp_security`, `smtp_username`, `smtp_password`, `email_from`, `email_reply_to` y `notification_master_emails`) se configuran cifrados desde el panel administrativo (`/admin/perfiles` pestaña `✉️ Notificaciones SMTP`). Nunca se almacenan en texto plano en la base de datos ni en variables de entorno.

2. **Verificación de dominios e identidades:**
   - Si se utiliza Amazon SES, verificar el dominio del remitente (`flacso.edu.uy`) mediante registros DNS (DKIM, SPF y DMARC).
   - Asegurarse de que la cuenta haya salido del modo Sandbox de SES si se requiere enviar a cualquier postulante.

3. **Reintentos y Observabilidad de Notificaciones:**
   - La cola Outbox procesa envíos en segundo plano con leases distribuidos.
   - Los fallos transitorios se reintentan automáticamente con backoff exponencial.
   - Los registros en estado `failed` pueden ser reintentados manualmente desde la interfaz.
   - Los registros en estado `unknown` (timeout o desconexión durante el envío) requieren confirmación explícita (`force: true`) para prevenir duplicados.

### Alertas de Incidentes por Telegram

1. **Creación del Bot:**
   - Crear un bot en Telegram a través de `@BotFather` (`/newbot`) y copiar el token generado.
   - Guardar el token en el panel administrativo (`/admin/perfiles` pestaña `🛡️ Recuperación y Alertas`). El token se almacena cifrado y nunca se vuelve a exponer en claro.

2. **Configuración de Destinatarios (Chat IDs):**
   - **Requisito obligatorio:** Cada persona o grupo destinatario debe haber iniciado una conversación con el bot (enviándole `/start`) antes de que el bot pueda entregar mensajes.
   - Obtener el ID de usuario o grupo (usando un bot como `@userinfobot` o consultando `https://api.telegram.org/bot<TOKEN>/getUpdates`).
   - Ingresar uno o varios Chat IDs (uno por línea o separados por coma) en el panel administrativo.

3. **Prueba y Contenido de Alertas:**
   - Probar el envío inmediato con el botón "Enviar mensaje de prueba" en el panel.
   - Las alertas operacionales contienen únicamente metadatos seguros de diagnóstico (ID de seguimiento, oferta académica truncada, etapa fallida, error truncado sin secretos y enlace de administración). No contienen datos personales del postulante (PII), cédulas, teléfonos ni documentos.

### Recuperación de Preinscripciones Fallidas (Runbook)

1. **Captura y Retención:**
   - Si un envío falla técnicamente al subir archivos a Google Drive o al insertar la fila en Google Sheets, la preinscripción no se pierde: los datos del postulante y los archivos temporales quedan retenidos en estado `failed` por un período de **7 días**.
   - El postulante recibe un identificador de seguimiento seguro informando que la postulación fue recibida y se encuentra pendiente de procesamiento técnico.
   - Si Telegram está configurado, se encola y despacha automáticamente una alerta al equipo.

2. **Bandeja de Recuperación:**
   - Acceder a `/admin/perfiles` pestaña `🛡️ Recuperación y Alertas`.
   - Filtrar los incidentes por estado (`failed`, `processing`, `success`, `discarded`) y etapa (`drive`, `sheets`).
   - **Ver detalle:** Inspecciona el estado de cada documento (si ya fue subido a Drive o sigue como archivo temporal) y el error operacional registrado.
   - **Reintentar:** Acción idempotente que reclama el incidente mediante lease. Si los archivos de Drive ya habían sido confirmados, no los duplica y completa únicamente las etapas pendientes (ej. inserción en Sheets). Al completarse exitosamente, limpia los archivos temporales y despacha las notificaciones de bienvenida.
   - **Descartar y eliminar:** Acción destructiva con confirmación explícita que purga definitivamente los datos del postulante, snapshots y archivos temporales asociados.

3. **Limpieza Automática:**
   - El proceso de la API en segundo plano ejecuta una limpieza periódica que elimina de forma segura e idempotente cualquier caso fallido que haya superado los 7 días de retención.

No se configura ningún `GOOGLE_SHEETS_ID` en `.env.production`: la aplicación
crea una planilla independiente por oferta o seminario y la guarda dentro de la
carpeta raíz configurada en el panel administrativo. La cuenta de servicio debe
tener permisos de edición en esa carpeta.

Los secretos deben tener permisos restrictivos y nunca se deben copiar al repositorio. La cuenta de servicio debe tener acceso a la carpeta de Drive; las planillas individuales se crean dentro de ella. La carpeta raíz de Drive se configura luego desde `/admin/perfiles`; no se agrega al `.env.production`.

### Seguimiento de campañas (UTM)

Cada preinscripción enviada deja una fila en la tabla `campaign_tracking` (se crea con la migración 029; la 030 suma país, `utm_id` y `fbclid`), en la misma transacción
que la preinscripción. Guarda sólo: nombre, apellido, correo, oferta (o seminario), edición (o cohorte), `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id` y `fbclid`, más `pais`, y la fecha y hora. También se registran los envíos sin UTM, para poder comparar con el tráfico orgánico.

**Contiene datos personales.** Se descarga desde el panel de administración, pestaña Seguridad, tarjeta "Seguimiento de campañas"
(rango de fechas opcional), o con `GET /api/admin/settings/campaign-tracking.csv?from=AAAA-MM-DD&to=AAAA-MM-DD`, que exige sesión
de administrador. El CSV usa UTF-8 con BOM (Excel) y hora de Montevideo; manéjelo con el cuidado correspondiente.

## Validación sin tocar el servidor

```bash
scripts/deploy-production.sh --check
```

Esto ejecuta pruebas, typecheck, build y verificación del diff. No realiza SSH ni cambios remotos.

## Deploy de un SHA

```bash
scripts/deploy-production.sh --sha "$(git rev-parse HEAD)"
```

El script:

1. exige el working tree limpio;
2. valida tests, tipos y build;
3. copia el SHA a `/opt/flacso/preinscripcionesFLACSOUY/releases/<sha>`;
4. respalda `.env.production` y la base nueva si ya existe;
5. actualiza el enlace `current` de forma atómica;
6. construye y levanta el Compose productivo;
7. espera la salud de API y web;
8. informa el puerto que Apache debe usar.

La plataforma legacy no se detiene: permanece en `127.0.0.1:3200` como `inscripciones-flacso.service`.

## Cambio de Apache

Lo realiza el operador, fuera de este script:

- respaldar el vhost actual;
- cambiar `ProxyPass` y `ProxyPassReverse` del dominio principal al `WEB_PORT` indicado;
- ejecutar `apachectl configtest`;
- recargar Apache;
- verificar `https://preinscripciones.flacso.edu.uy/`.

El script nunca edita directivas Apache.

## Rollback

Si la nueva app falla antes del cambio de Apache, volver a desplegar el vhost legacy no requiere tocar la aplicación vieja.

Si hay que volver atrás después del cambio de dominio:

1. restaurar el vhost respaldado y recargar Apache;
2. confirmar que `inscripciones-flacso.service` siga activo;
3. conservar los logs y el backup informado en `last-deploy`;
4. no borrar la release fallida hasta terminar el diagnóstico.

La restauración de datos de PostgreSQL se hace únicamente después de identificar el backup correcto y aprobar la operación; no se ejecuta automáticamente.
