#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Respaldo de Base de Datos PostgreSQL - FLACSO Uruguay
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/flacso_preinscriptions_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="${CONTAINER_NAME:-preinscripciones-postgres}"
DB_USER="${POSTGRES_USER:-flacso}"
DB_NAME="${POSTGRES_DB:-flacso_preinscripciones}"

mkdir -p "${BACKUP_DIR}"

echo "[INFO] Iniciando respaldo de PostgreSQL (${DB_NAME})..."

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[INFO] Ejecutando pg_dump a través del contenedor Docker: ${CONTAINER_NAME}"
  docker exec -i "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${BACKUP_FILE}"
else
  echo "[INFO] Contenedor Docker no detectado; intentando pg_dump local..."
  PGPORT="${POSTGRES_PORT:-5433}" pg_dump -U "${DB_USER}" -h localhost -d "${DB_NAME}" --clean --if-exists | gzip > "${BACKUP_FILE}"
fi

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[SUCCESS] Respaldo completado exitosamente: ${BACKUP_FILE} (${FILE_SIZE})"
