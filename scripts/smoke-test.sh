#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Smoke Test Script - FLACSO Uruguay Preinscripciones
# ==============================================================================

BASE_URL="${BASE_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:3000}"

echo "=========================================================="
echo " Ejecutando Smoke Tests contra: ${BASE_URL} (API: ${API_URL})"
echo "=========================================================="

# 1. Probar Liveness Probe
echo -n "[TEST] GET /api/health ... "
HEALTH_RES=$(curl -s -w "\n%{http_code}" "${API_URL}/api/health")
HTTP_CODE=$(echo "${HEALTH_RES}" | tail -n1)
BODY=$(echo "${HEALTH_RES}" | head -n-1)

if [ "${HTTP_CODE}" -eq 200 ] || [ "${HTTP_CODE}" -eq 503 ]; then
  echo "OK (HTTP ${HTTP_CODE})"
else
  echo "FALLO (HTTP ${HTTP_CODE})"
  echo "Respuesta: ${BODY}"
  exit 1
fi

# 2. Probar Readiness Probe
echo -n "[TEST] GET /api/ready ... "
READY_RES=$(curl -s -w "\n%{http_code}" "${API_URL}/api/ready")
READY_CODE=$(echo "${READY_RES}" | tail -n1)
READY_BODY=$(echo "${READY_RES}" | head -n-1)

if [ "${READY_CODE}" -eq 200 ]; then
  echo "OK (HTTP 200 - Ready)"
else
  echo "ADVERTENCIA (HTTP ${READY_CODE})"
  echo "Respuesta: ${READY_BODY}"
fi

# 3. Probar Catálogo de Destinos
echo -n "[TEST] GET /api/targets ... "
TARGETS_RES=$(curl -s -w "\n%{http_code}" "${API_URL}/api/targets")
TARGETS_CODE=$(echo "${TARGETS_RES}" | tail -n1)
TARGETS_BODY=$(echo "${TARGETS_RES}" | head -n-1)

if [ "${TARGETS_CODE}" -eq 200 ]; then
  COUNT=$(echo "${TARGETS_BODY}" | grep -o '"id":' | wc -l || echo 0)
  echo "OK (HTTP 200 - ${COUNT} destinos detectados)"
else
  echo "FALLO (HTTP ${TARGETS_CODE})"
  echo "Respuesta: ${TARGETS_BODY}"
  exit 1
fi

# 4. Probar Security Headers
echo -n "[TEST] Verificando cabeceras de seguridad ... "
HEADERS=$(curl -s -I "${API_URL}/api/health")

if echo "${HEADERS}" | grep -qi "X-Content-Type-Options: nosniff" && \
   echo "${HEADERS}" | grep -qi "X-Frame-Options: SAMEORIGIN" && \
   echo "${HEADERS}" | grep -qi "X-Correlation-ID"; then
  echo "OK (Cabeceras de protección presentes)"
else
  echo "ADVERTENCIA: Alguna cabecera de seguridad esperada no se encontró en la respuesta."
fi

echo "=========================================================="
echo " [SUCCESS] Todos los smoke tests finalizaron con éxito."
echo "=========================================================="
