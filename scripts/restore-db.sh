#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Restauración de Base de Datos PostgreSQL - FLACSO Uruguay
# ==============================================================================

if [ "$#" -lt 1 ]; then
  echo "Uso: $0 <ruta-al-archivo-backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "${BACKUP_FILE}" ]; then
  echo "[ERROR] El archivo de respaldo '${BACKUP_FILE}' no existe."
  exit 1
fi

CONTAINER_NAME="${CONTAINER_NAME:-preinscripciones-postgres}"
DB_USER="${POSTGRES_USER:-flacso}"
DB_NAME="${POSTGRES_DB:-flacso_preinscripciones}"

echo "[WARNING] ¡Atención! Esta operación sobreescribirá la base de datos '${DB_NAME}'."
read -p "¿Desea continuar? (s/N): " -r CONFIRM
if [[ ! "${CONFIRM}" =~ ^[sS]$ ]]; then
  echo "[INFO] Operación cancelada por el usuario."
  exit 0
fi

echo "[INFO] Restaurando base de datos desde '${BACKUP_FILE}'..."

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[INFO] Restaurando a través del contenedor Docker: ${CONTAINER_NAME}"
  gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"
else
  echo "[INFO] Contenedor Docker no detectado; ejecutando psql local..."
  gunzip -c "${BACKUP_FILE}" | PGPORT="${POSTGRES_PORT:-5433}" psql -U "${DB_USER}" -h localhost -d "${DB_NAME}"
fi

echo "[SUCCESS] Base de datos restaurada exitosamente."
