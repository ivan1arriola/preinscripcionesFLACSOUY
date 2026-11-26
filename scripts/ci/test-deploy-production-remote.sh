#!/usr/bin/env bash
set -euo pipefail

remote="$(cd "$(dirname "$0")/.." && pwd)/deploy-production-remote.sh"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
root="$tmp/production"
backups="$tmp/backups"
mkdir -p "$root/.secrets" "$tmp/bin" "$tmp/source/deploy"
printf 'WEB_PORT=54321\nPOSTGRES_USER=fixture\nPOSTGRES_DB=fixture\n' > "$root/.env.production"
printf '{}\n' > "$root/.secrets/google-service-account.json"
printf 'services: {}\n' > "$tmp/source/deploy/docker-compose.production.yml"
export PATH="$tmp/bin:$PATH" CALLS="$tmp/calls"

cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CALLS"
[[ "$1" == compose ]]
shift
while (($#)); do
  case "$1" in
    --env-file|-f|--project-directory|-p) shift 2; continue ;;
    port) [[ "$2 $3" == 'web 80' ]]; echo '127.0.0.1:54321'; exit ;;
    config|build|up|logs) exit 0 ;;
    ps) [[ "${POSTGRES_PS_FAILURE:-}" != true ]] || exit 1
        [[ " $* " != *' -q postgres '* ]] || echo fixture-postgres; exit 0 ;;
    exec)
      shift
      [[ "$1" != -T ]] || shift
      case "$1 $2" in
        'api node') shift; exec "$@" ;;
        'postgres sh') echo 'fixture database backup'; exit ;;
      esac ;;
  esac
  echo "Docker no contemplado en la prueba: $*" >&2
  exit 1
done
STUB

cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -eu
for url in "$@"; do
  case "$url" in
    http://127.0.0.1:54321/) [[ " $* " == *' -w %{http_code} '* ]]; printf 200; exit ;;
    http://127.0.0.1:54321/api/health) echo '{"status":"ok","database":"up"}'; exit ;;
    http://127.0.0.1:54321/api/health/catalog) echo '{"status":"ok","code":"ok","rejectedTargets":0}'; exit ;;
    http://127.0.0.1:54321/api/targets) echo "$TARGETS"; exit ;;
  esac
done
echo "URL no contemplada en la prueba: $*" >&2
exit 1
STUB
chmod +x "$tmp/bin/"*
export TARGETS='{"targets":[]}'

deploy() {
  tar -C "$tmp/source" -cf - . | bash "$remote" "$root" "$backups" deploy "$1"
}
rollback() {
  bash "$remote" "$root" "$backups" rollback </dev/null
}
expect_failure() {
  if "$@"; then
    echo "Se esperaba un error en $*" >&2
    exit 1
  fi
}
current_is() {
  [[ "$(cd "$root/current" && pwd -P)" == "$(cd "$root/releases/$1" && pwd -P)" ]]
  grep -Fxq "SHA=$1" "$root/last-deploy"
}

a="$(printf 'a%.0s' {1..40})"
b="$(printf 'b%.0s' {1..40})"
c="$(printf 'c%.0s' {1..40})"
deploy "$a"
current_is "$a"
# El registro que dejó el script anterior no tenía PREVIOUS_SHA.
sed -i '/^PREVIOUS_SHA=/d' "$root/last-deploy"
expect_failure rollback
> "$CALLS"
POSTGRES_PS_FAILURE=true expect_failure deploy "$b"
current_is "$a"
if grep -Eq ' (build|up) ' "$CALLS"; then
  echo 'El script continuó después de un error al consultar PostgreSQL.' >&2
  exit 1
fi
deploy "$b"
current_is "$b"
grep -Fxq "PREVIOUS_SHA=$a" "$root/last-deploy"
> "$CALLS"
rollback
current_is "$a"
up="$(grep ' up -d ' "$CALLS")"
[[ "$up" == *'--no-deps'* && "$up" == *' api'* && "$up" == *' web'* && "$up" != *' postgres'* ]]
grep -Fq "/$a/deploy/docker-compose.production.yml build api web" "$CALLS"

export TARGETS='{"targets":null}'
expect_failure deploy "$c"
export TARGETS='{"targets":[]}'
current_is "$a"
grep -q ' logs .*api web' "$CALLS"
[[ -f "$root/deploy-pending" ]]
rollback
current_is "$a"
[[ ! -e "$root/deploy-pending" ]]

expect_failure bash "$remote" "$root" "$backups" deploy "$(printf 'd%.0s' {1..40})" < /dev/null
current_is "$a"
echo 'Prueba de despliegue y rollback en directorio temporal completada.'
