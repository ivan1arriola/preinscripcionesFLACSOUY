#!/usr/bin/env bash
set -Eeuo pipefail

root="$1"
backups="$2"
mode="$3"
sha="${4:-}"
releases="$root/releases"
current="$root/current"
record="$root/last-deploy"
pending="$root/deploy-pending"
env_file="$root/.env.production"
compose_file=deploy/docker-compose.production.yml

fail() { echo "$*" >&2; exit 1; }
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
field() { if [[ -f "$record" ]]; then sed -n "s/^$1=//p" "$record"; fi; }

mkdir -p "$releases"
exec 9>"$root/deploy.lock"
flock -n 9 || fail "Ya hay una operación de despliegue en curso."
[[ ! -e "$current" || -L "$current" ]] || fail "current debe ser un enlace simbólico."
[[ -f "$env_file" ]] || fail "Falta la configuración de producción."
last_sha="$(field SHA)"
previous_sha="$(field PREVIOUS_SHA)"
backup="$(field BACKUP)"
[[ -z "$last_sha" ]] || valid_sha "$last_sha" || fail "SHA inválido en last-deploy."
[[ -z "$previous_sha" ]] || valid_sha "$previous_sha" || fail "PREVIOUS_SHA inválido en last-deploy."

compose_at() {
  local directory="$1"
  shift
  docker compose --env-file "$env_file" -f "$directory/$compose_file" "$@"
}
compose() { compose_at "$release" "$@"; }

if [[ "$mode" == deploy ]]; then
  valid_sha "$sha" || fail "SHA de despliegue inválido."
  [[ -r "$root/.secrets/google-service-account.json" ]] || fail "Falta la cuenta de servicio de Google."
  release="$releases/$sha"
  if [[ -e "$release" || -L "$release" ]]; then
    [[ ! -L "$release" && -f "$release/.verified-sha" && "$(<"$release/.verified-sha")" == "$sha" ]] ||
      fail "Ya existe una release sin procedencia verificada para $sha."
    cat >/dev/null
  else
    staging="$(mktemp -d "$releases/.incoming-$sha.XXXXXX")"
    trap 'rm -rf -- "$staging"' EXIT
    tar -xf - -C "$staging"
    [[ -f "$staging/$compose_file" ]] || fail "La release no incluye el Compose productivo."
    printf '%s\n' "$sha" > "$staging/.verified-sha"
    mv -T "$staging" "$release"
    trap - EXIT
  fi
  if [[ "$sha" != "$last_sha" ]]; then previous_sha="$last_sha"; fi
elif [[ "$mode" == rollback ]]; then
  if [[ -f "$pending" ]]; then
    sha="$last_sha"
  else
    sha="$previous_sha"
    previous_sha="$last_sha"
  fi
  valid_sha "$sha" || fail "No hay una release anterior registrada para revertir."
  release="$releases/$sha"
else
  fail "Operación de despliegue desconocida."
fi

[[ ! -L "$release" && -f "$release/$compose_file" ]] || fail "Falta el Compose de la release $sha."
compose config --quiet

if [[ "$mode" == deploy ]]; then
  mkdir -p "$backups"
  backup="$(mktemp -d "$backups/$(date -u +%Y%m%dT%H%M%SZ)-$sha.XXXXXX")"
  install -m 600 "$env_file" "$backup/.env.production"
  if [[ -f "$root/compose.override.yml" ]]; then
    install -m 600 "$root/compose.override.yml" "$backup/compose.override.yml"
  fi
  if [[ -f "$current/$compose_file" ]]; then
    postgres="$(compose_at "$current" ps -q postgres)"
    if [[ -n "$postgres" ]]; then
      (umask 077; compose_at "$current" exec -T postgres sh -ec \
        'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
        < /dev/null > "$backup/database.sql")
    fi
  fi
  compose build --pull api web
  up=(up -d --no-build --remove-orphans)
else
  # Compose usa las mismas etiquetas de imagen en todas las releases.
  compose build api web
  up=(up -d --no-build --no-deps api web)
fi

verify_json() {
  compose exec -T api node -e '
    let value;
    try { value = JSON.parse(require("node:fs").readFileSync(0, "utf8")); }
    catch { process.exit(1); }
    if (!value || typeof value !== "object") process.exit(1);
    const check = process.argv[1];
    if (check === "catalog" && value.code === "unavailable") {
      console.error("Aviso: WordPress no está disponible. Se comprueba la lista de ofertas.");
    }
    const ok = check === "health" ? value.status === "ok" && value.database === "up"
      : check === "catalog" ? (value.status === "ok" && value.code === "ok") || value.code === "unavailable"
      : Array.isArray(value.targets);
    if (!ok) process.exit(1);
  ' "$1"
}

smoke() {
  web_address="$(compose port web 80)" || return 1
  [[ "$web_address" =~ ^127\.0\.0\.1:[0-9]+$ ]] || return 1
  local url="http://$web_address" ready=false response attempt
  for ((attempt=1; attempt<=30; attempt++)); do
    if curl -fsS --max-time 2 "$url/api/health" 2>/dev/null | verify_json health 2>/dev/null; then
      ready=true
      break
    fi
    if ((attempt < 30)); then sleep 2; fi
  done
  [[ "$ready" == true ]] || { echo "Falló /api/health." >&2; return 1; }
  response="$(curl -fsS --max-time 15 -o /dev/null -w '%{http_code}' "$url/")" || return 1
  [[ "$response" == 200 ]] || { echo "La web respondió HTTP $response." >&2; return 1; }
  curl -fsS --max-time 15 "$url/api/health/catalog" | verify_json catalog ||
    { echo "Falló /api/health/catalog." >&2; return 1; }
  curl -fsS --max-time 15 "$url/api/targets" | verify_json targets ||
    { echo "Falló /api/targets." >&2; return 1; }
}

(umask 077; printf '%s\n' "$sha" > "$pending")
if ! compose "${up[@]}" || ! smoke; then
  compose logs --tail=120 api web >&2 || true
  fail "Falló la activación de $sha. Si hay una release confirmada, podés recuperar con --rollback."
fi

(umask 077; printf 'SHA=%s\nPREVIOUS_SHA=%s\nBACKUP=%s\nWEB_PORT=%s\n' \
  "$sha" "$previous_sha" "$backup" "${web_address##*:}" > "$record.new")
ln -sfn "$release" "$current.new"
mv -Tf "$current.new" "$current"
mv -Tf "$record.new" "$record"
rm -f "$pending"
echo "Release activa: $sha. Puerto de Apache: ${web_address##*:}."
