#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Limpieza de Archivos Temporales Expirados - FLACSO Uruguay
# ==============================================================================

CONTAINER_NAME="${CONTAINER_NAME:-preinscripciones-api}"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[INFO] Ejecutando worker de limpieza en contenedor ${CONTAINER_NAME}..."
  docker exec -i "${CONTAINER_NAME}" node -e "
    import('./dist/infrastructure/uploads/cleanup-worker.js').catch(err => {
      console.error(err);
      process.exit(1);
    });
  " || true
else
  echo "[INFO] Ejecutando worker de limpieza localmente..."
  pnpm --filter api exec tsx src/infrastructure/uploads/cleanup-worker.ts || true
fi
