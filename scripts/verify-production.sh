#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Verificación Integral de Producción / Staging - FLACSO Uruguay
# ==============================================================================

TARGET_URL="${1:-http://localhost:3000}"

echo "=========================================================="
echo " Verificación de Entorno: ${TARGET_URL}"
echo " Fecha: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="

# 1. Healthcheck
echo "[1/4] Verificando Liveness Probe (/api/health)..."
HEALTH=$(curl -s "${TARGET_URL}/api/health" || echo "error")
if echo "${HEALTH}" | grep -q '"status":"ok"'; then
  echo "  ✓ API y PostgreSQL reportan estado OK"
else
  echo "  ✗ Error en liveness probe: ${HEALTH}"
  exit 1
fi

# 2. Readiness Probe
echo "[2/4] Verificando Readiness Probe (/api/ready)..."
READY=$(curl -s "${TARGET_URL}/api/ready" || echo "error")
if echo "${READY}" | grep -q '"status":"ready"'; then
  echo "  ✓ Todos los subsistemas (BD, storage, proceso) reportan READY"
else
  echo "  ! Alerta: el sistema no está en estado ready: ${READY}"
fi

# 3. Lectura de Catálogo y Contratos
echo "[3/4] Verificando API de Catálogo (/api/targets)..."
TARGETS=$(curl -s "${TARGET_URL}/api/targets" || echo "error")
if echo "${TARGETS}" | grep -q '"targets":\['; then
  TOTAL=$(echo "${TARGETS}" | grep -o '"id":' | wc -l)
  echo "  ✓ Catálogo accesible: ${TOTAL} destinos académicos detectados"
else
  echo "  ✗ No se pudo obtener el listado de destinos: ${TARGETS}"
  exit 1
fi

# 4. Verificación de Encabezados de Seguridad y Correlation ID
echo "[4/4] Verificando Cabeceras de Seguridad y Observabilidad..."
HEADERS=$(curl -s -I "${TARGET_URL}/api/health")
for HEADER in "x-content-type-options" "x-frame-options" "content-security-policy" "x-correlation-id"; do
  if echo "${HEADERS}" | grep -qi "${HEADER}"; then
    echo "  ✓ Encabezado ${HEADER} presente"
  else
    echo "  ✗ Encabezado ${HEADER} AUSENTE"
  fi
done

echo "=========================================================="
echo " [SUCCESS] Verificación de entorno completada satisfactoriamente."
echo "=========================================================="
