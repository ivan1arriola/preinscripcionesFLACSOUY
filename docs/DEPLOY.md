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

En producción también son obligatorios `GOOGLE_SHEETS_ID` y
`GOOGLE_SHEETS_SHEET_NAME` en `.env.production`. La cuenta de servicio debe
tener acceso de edición al Spreadsheet y a la carpeta raíz de Drive.

Los secretos deben tener permisos restrictivos y nunca se deben copiar al repositorio. La cuenta de servicio debe tener acceso a la carpeta de Drive y al Spreadsheet institucional. La carpeta raíz de Drive se configura luego desde `/admin/perfiles`; no se agrega al `.env.production`.

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
