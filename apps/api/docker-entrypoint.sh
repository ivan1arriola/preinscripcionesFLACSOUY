#!/bin/sh
# Arranca como root sólo para preparar el directorio de subidas y baja a un usuario sin privilegios.
# Así un volumen creado antes por root (p. ej. `upload_tmp` del servidor) sigue siendo escribible sin pasos manuales.
set -e

UPLOAD_DIR="${UPLOAD_TMP_DIR:-/tmp/flacso-preinscripciones}"
mkdir -p "$UPLOAD_DIR"
chown -R node:node "$UPLOAD_DIR" 2>/dev/null || true

RUN_AS=node

# Los secretos se montan de sólo lectura desde el servidor: si algún archivo no es legible por `node`
# se prefiere seguir funcionando como root (con aviso) antes que dejar la API sin Google ni correo.
if [ -d /app/.secrets ]; then
  for secret in /app/.secrets/*; do
    [ -e "$secret" ] || continue
    if ! su-exec node test -r "$secret"; then
      echo "[entrypoint] ADVERTENCIA: $secret no es legible por el usuario 'node'; el servicio corre como root." >&2
      echo "[entrypoint] Para quitar el aviso: chmod 644 en esos archivos o chown 1000:1000 en el directorio de secretos." >&2
      RUN_AS=root
    fi
  done
fi

exec su-exec "$RUN_AS" "$@"
