#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE_HOST="servidor-flacso"
REMOTE_ROOT="/opt/flacso/preinscripcionesFLACSOUY"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_RELEASES="$REMOTE_ROOT/releases"
REMOTE_BACKUPS="/opt/flacso/backups/preinscripcionesFLACSOUY"
ENV_FILE="$REMOTE_ROOT/.env.production"
SECRETS_DIR="$REMOTE_ROOT/.secrets"
COMPOSE_FILE="deploy/docker-compose.production.yml"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
DRY_RUN=false
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Uso:
  scripts/deploy-production.sh [--sha SHA] [--dry-run]
  scripts/deploy-production.sh --check

El script despliega la nueva aplicación en un stack independiente.
No modifica Apache ni cambia el dominio público.
EOF
}

while (($# > 0)); do
  case "$1" in
    --sha)
      [[ $# -ge 2 ]] || { echo "Falta el valor de --sha" >&2; exit 2; }
      SHA="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --check)
      CHECK_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$REPO_ROOT"

if [[ -n "$(git status --short)" ]]; then
  echo "El working tree no está limpio. Commití o apartá los cambios antes de desplegar." >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse --verify "$SHA^{commit}")"
echo "SHA a desplegar: $SHA"
echo "Servidor: $REMOTE_HOST"
echo "Destino: $REMOTE_ROOT"
echo "Apache: no se modifica; el cambio de dominio queda a cargo del operador."

run_local_checks() {
  pnpm test
  pnpm typecheck
  pnpm build
  git diff --check
}

if [[ "$CHECK_ONLY" == true || "$DRY_RUN" == false ]]; then
  run_local_checks
fi

if [[ "$CHECK_ONLY" == true ]]; then
  echo "Validaciones locales completas. No se modificó el servidor."
  exit 0
fi

REMOTE_SCRIPT=$(cat <<EOF
set -Eeuo pipefail
ROOT='$REMOTE_ROOT'
RELEASES='$REMOTE_RELEASES'
BACKUPS='$REMOTE_BACKUPS'
ENV_FILE='$ENV_FILE'
SECRETS_DIR='$SECRETS_DIR'
COMPOSE_FILE='$COMPOSE_FILE'
SHA='$SHA'
RELEASE="\$RELEASES/\$SHA"
CURRENT="\$ROOT/current"
mkdir -p "\$RELEASES" "\$BACKUPS"
test -f "\$ENV_FILE" || { echo "Falta \$ENV_FILE en el servidor" >&2; exit 1; }
test -d "\$SECRETS_DIR" || { echo "Falta \$SECRETS_DIR en el servidor" >&2; exit 1; }
test -r "\$SECRETS_DIR/google-service-account.json" || { echo "Falta la cuenta de servicio de Google en \$SECRETS_DIR" >&2; exit 1; }
test -f "\$RELEASE/\$COMPOSE_FILE" || { echo "Falta el Compose en \$RELEASE" >&2; exit 1; }

STAMP="\$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="\$BACKUPS/\$STAMP-\$SHA"
mkdir -p "\$BACKUP_DIR"
if [[ -e "\$ENV_FILE" ]]; then
  install -m 600 "\$ENV_FILE" "\$BACKUP_DIR/.env.production"
fi
if [[ -e "\$ROOT/compose.override.yml" ]]; then
  install -m 600 "\$ROOT/compose.override.yml" "\$BACKUP_DIR/compose.override.yml"
fi
if [[ -L "\$CURRENT" || -d "\$CURRENT" ]]; then
  docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" ps >/dev/null 2>&1 || true
  if docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" ps -q postgres | grep -q .; then
    DB_USER="\$(grep '^POSTGRES_USER=' "\$ENV_FILE" | cut -d= -f2-)"
    DB_NAME="\$(grep '^POSTGRES_DB=' "\$ENV_FILE" | cut -d= -f2-)"
    test -n "\$DB_USER" && test -n "\$DB_NAME" || { echo "Faltan POSTGRES_USER o POSTGRES_DB en \$ENV_FILE" >&2; exit 1; }
    docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" exec -T postgres pg_dump --username "\$DB_USER" --dbname "\$DB_NAME" --clean --if-exists --no-owner --no-privileges < /dev/null > "\$BACKUP_DIR/database.sql"
  fi
fi

ln -sfn "\$RELEASE" "\$ROOT/.current-new"
mv -Tf "\$ROOT/.current-new" "\$CURRENT"
docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" config >/dev/null
docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" build --pull
docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" up -d --remove-orphans
docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" ps

for attempt in \$(seq 1 30); do
  if docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" exec -T api wget -qO- http://localhost:3000/api/health < /dev/null | grep -q '"status":"ok"'; then
    break
  fi
  if [[ "\$attempt" == 30 ]]; then
    docker compose --env-file "\$ENV_FILE" -f "\$CURRENT/\$COMPOSE_FILE" logs --tail=120 api web >&2 || true
    exit 1
  fi
  sleep 2
done

curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:\$(grep '^WEB_PORT=' "\$ENV_FILE" | cut -d= -f2-)/" >/dev/null
printf 'SHA=%s\\nBACKUP=%s\\nWEB_PORT=%s\\n' "\$SHA" "\$BACKUP_DIR" "\$(grep '^WEB_PORT=' "\$ENV_FILE" | cut -d= -f2-)" > "\$ROOT/last-deploy"
chmod 600 "\$ROOT/last-deploy"
echo "Nueva aplicación levantada. Apache todavía no fue modificado."
echo "Backup: \$BACKUP_DIR"
EOF
)

if [[ "$DRY_RUN" == true ]]; then
  echo "Modo dry-run: se validó el repositorio, pero no se ejecuta SSH ni se modifica el servidor."
  exit 0
fi

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_RELEASES/$SHA' '$REMOTE_ROOT'"
rsync -az --delete \
  --exclude='.git/' \
  --exclude='.secrets/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='coverage/' \
  --exclude='test-results/' \
  --exclude='playwright-report/' \
  --exclude='backups/' \
  "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_RELEASES/$SHA/"

ssh "$REMOTE_HOST" "bash -s" <<<"$REMOTE_SCRIPT"

echo "Deploy terminado para $SHA."
echo "Ahora podés apuntar Apache al puerto WEB_PORT indicado por el script y verificar el dominio público."
