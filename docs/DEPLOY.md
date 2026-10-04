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
activar las notificaciones SES. Es la misma variable de entorno que se usa en
local, pero el valor de producción debe ser diferente y no debe copiarse desde
la PC. Generar y guardar la clave directamente en el servidor con permisos
restrictivos (cadena hexadecimal de 64 caracteres para AES-256-GCM):
```bash
openssl rand -hex 32
```

### Configuración y Operación de Amazon SES

1. **Credenciales y Política IAM recomendada:**
   Crear un usuario IAM o rol con permisos mínimos para envío de correo:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ses:SendEmail"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
   Las credenciales (`AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`) se configuran cifradas desde el panel administrativo (`/admin/perfiles` pestaña `✉️ Notificaciones SES`), nunca en texto plano en la base ni en `.env`.

2. **Modo Sandbox e Identidades Verificadas:**
   - En cuentas nuevas de AWS SES (modo Sandbox), solo se puede enviar correos **desde** y **hacia** identidades verificadas (dominios o correos individuales).
   - Para producción, solicitar la salida de Sandbox en la consola de AWS SES para permitir envíos a cualquier postulante.
   - Verificar el dominio remitente (ej. `flacso.edu.uy`) mediante registros DNS (DKIM / SPF / DMARC).

3. **Reintentos y Observabilidad:**
   - Los fallos transitorios se reintentan automáticamente con backoff exponencial (1m, 5m, 30m, 2h).
   - Los registros en estado `failed` pueden ser reintentados manualmente desde la interfaz de administración.
   - Los registros en estado `unknown` (desconexión o timeout antes de confirmar entrega) requieren confirmación explícita (`force: true`) debido al riesgo de entrega duplicada al postulante si SES ya despachó el mensaje.

No se configura ningún `GOOGLE_SHEETS_ID` en `.env.production`: la aplicación
crea una planilla independiente por oferta o seminario y la guarda dentro de la
carpeta raíz configurada en el panel administrativo. La cuenta de servicio debe
tener permisos de edición en esa carpeta.

Los secretos deben tener permisos restrictivos y nunca se deben copiar al repositorio. La cuenta de servicio debe tener acceso a la carpeta de Drive; las planillas individuales se crean dentro de ella. La carpeta raíz de Drive se configura luego desde `/admin/perfiles`; no se agrega al `.env.production`.

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
