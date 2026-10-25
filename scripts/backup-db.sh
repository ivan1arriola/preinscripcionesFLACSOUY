#!/usr/bin/env bash
# Respaldo diario de la base de datos de preinscripciones (PostgreSQL en Docker).
#
# Se instala en el servidor y se programa con cron, por ejemplo:
#   0 3 * * * /opt/flacso/preinscripcionesFLACSOUY/backup-db.sh >> /opt/flacso/backups/preinscripcionesFLACSOUY/backup.log 2>&1
#
# Variables opcionales: BACKUP_DIR, BACKUP_KEEP_DAYS (por defecto 14), COMPOSE_PROJECT.
set -Eeuo pipefail
# Los respaldos contienen datos personales: sólo el usuario que los crea puede leerlos.
umask 077

DEST="${BACKUP_DIR:-/opt/flacso/backups/preinscripcionesFLACSOUY/daily}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PROJECT="${COMPOSE_PROJECT:-preinscripciones-flacsouy}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-db] $*"; }

mkdir -p "$DEST"

# Se busca el contenedor por etiqueta de Compose para no depender de su nombre exacto.
CONTAINER="$(docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=postgres" | head -n1)"
if [[ -z "$CONTAINER" ]]; then
  log "ERROR: no se encontró el contenedor de PostgreSQL del proyecto ${PROJECT}" >&2
  exit 1
fi

TMP="$(mktemp "${DEST}/.tmp-${STAMP}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

# Las credenciales se leen del propio contenedor: no pasan por la línea de comandos ni por el cron.
docker exec "$CONTAINER" sh -c \
  'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  | gzip -9 > "$TMP"

# Un respaldo corrupto o vacío es peor que ninguno: se valida antes de conservarlo.
gzip -t "$TMP"
if [[ "$(stat -c %s "$TMP")" -lt 1024 ]]; then
  log "ERROR: el respaldo es sospechosamente pequeño ($(stat -c %s "$TMP") bytes); se descarta" >&2
  exit 1
fi

FINAL="${DEST}/preinscripciones-${STAMP}.sql.gz"
mv "$TMP" "$FINAL"
trap - EXIT
log "OK ${FINAL} ($(stat -c %s "$FINAL") bytes)"

# Rotación: sólo se borran archivos con el patrón de este script y más antiguos que KEEP_DAYS.
find "$DEST" -maxdepth 1 -type f -name 'preinscripciones-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete \
  | sed "s#^#$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-db] rotado: #"
