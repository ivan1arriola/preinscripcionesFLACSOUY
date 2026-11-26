#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE_HOST="servidor-flacso"
REMOTE_ROOT="/opt/flacso/preinscripcionesFLACSOUY"
REMOTE_BACKUPS="/opt/flacso/backups/preinscripcionesFLACSOUY"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref=HEAD
mode=deploy
dry_run=false

usage() {
  cat <<'EOF'
Uso:
  scripts/deploy-production.sh [--sha SHA] [--dry-run]
  scripts/deploy-production.sh --check
  scripts/deploy-production.sh --rollback
EOF
}

fail() { echo "$*" >&2; exit 1; }

while (($# > 0)); do
  case "$1" in
    --sha) [[ $# -ge 2 ]] || fail "Falta el valor de --sha"; ref="$2"; shift ;;
    --dry-run) dry_run=true ;;
    --check|--rollback) [[ "$mode" == deploy ]] || fail "Elegí una sola operación"; mode="${1#--}" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "Argumento desconocido: $1" ;;
  esac
  shift
done

cd "$REPO_ROOT"
sha=
if [[ "$mode" != rollback ]]; then
  [[ -z "$(git status --short)" ]] || fail "El árbol de trabajo debe estar limpio."
fi

if [[ "$mode" == check ]]; then
  pnpm test
  pnpm typecheck
  pnpm build
  git diff --check
  echo "Validaciones locales completas."
  exit 0
fi

if [[ "$mode" == deploy ]]; then
  command -v gh >/dev/null || fail "Instalá GitHub CLI y ejecutá gh auth login."
  sha="$(git rev-parse --verify --end-of-options "$ref^{commit}")"
  origin="$(git remote get-url origin)"
  [[ "$origin" =~ ^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$ ]] ||
    fail "origin debe apuntar al repositorio de GitHub."
  repo="${BASH_REMATCH[2]%.git}"
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  git merge-base --is-ancestor "$sha" refs/remotes/origin/main ||
    fail "El SHA $sha no pertenece a origin/main."

  run_id="$(gh run list --repo "$repo" --workflow ci.yml --branch main --event push \
    --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  [[ "$run_id" =~ ^[0-9]+$ ]] || fail "Falta la ejecución de CI del push a main para $sha."
  verified="$(gh run view "$run_id" --repo "$repo" --json headSha,headBranch,event,status,conclusion,jobs --jq "
    .headSha == \"$sha\" and .headBranch == \"main\" and .event == \"push\" and
    .status == \"completed\" and .conclusion == \"success\" and
    ([.jobs[] | select(.status == \"completed\" and .conclusion == \"success\") | .name] as \$passed |
      [\"Verificar y cobertura\", \"Compilar e imágenes Docker\", \"Migraciones (aditivas e idempotentes)\",
       \"Docker Compose config\", \"Playwright E2E sobre imágenes Docker\", \"Seguridad e higiene\"] - \$passed == [])
  ")"
  [[ "$verified" == true ]] || fail "La CI $run_id de $sha debe tener las seis puertas de E1 en verde."
  echo "SHA validado: $sha (CI $run_id)."
elif [[ "$ref" != HEAD ]]; then
  fail "--rollback usa la release registrada en last-deploy."
fi

if [[ "$dry_run" == true ]]; then
  echo "Modo dry-run. Operación prevista en $REMOTE_HOST: $mode."
  exit 0
fi

remote_script="$(<"$REPO_ROOT/scripts/deploy-production-remote.sh")"
# SSH entrega este argumento a la shell del servidor antes de invocar Bash.
remote_script=${remote_script//\'/\'\\\'\'}
remote_command="bash -c '$remote_script' -- '$REMOTE_ROOT' '$REMOTE_BACKUPS' '$mode' '$sha'"
if [[ "$mode" == deploy ]]; then
  git archive "$sha" -- . ':(exclude,glob)**/.env' ':(exclude,glob)**/.env.*' \
    ':(exclude,glob)**/.secrets' ':(exclude,glob)**/.secrets/**' | ssh "$REMOTE_HOST" "$remote_command"
else
  ssh "$REMOTE_HOST" "$remote_command" < /dev/null
fi
