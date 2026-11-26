#!/usr/bin/env bash
set -Eeuo pipefail

deploy_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/deploy-production.sh"
sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT
export TEST_GIT="$(command -v git)"
export TEST_ORIGIN="$sandbox/origin.git"
export TEST_REMOTE="https://github.com/example/preinscripciones.test.git"
export TEST_LOG="$sandbox/calls"
export TEST_STREAM="$sandbox/ssh-stdin"
export TEST_REMOTE_ARGS="$sandbox/ssh-args"
export TEST_RESULT=success
mkdir -p "$sandbox/bin" "$sandbox/repo/scripts"
git init --quiet --bare "$TEST_ORIGIN"
cd "$sandbox/repo"
git init --quiet --initial-branch=main
git config user.name 'Deploy Test'
git config user.email 'deploy@example.test'
git config core.autocrlf false
git config commit.gpgsign false
git remote add origin "$TEST_ORIGIN"
cp "$deploy_script" scripts/deploy-production.sh
cat > scripts/deploy-production-remote.sh <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "script 'remoto'" "$3" "${4:-}" > "$TEST_REMOTE_ARGS"
EOF
printf 'release elegida\n' > release.txt
git add .
git commit --quiet -m 'Release elegida'
export TEST_SHA="$(git rev-parse HEAD)"
printf 'release de HEAD\n' > release.txt
git commit --quiet -am 'Release de HEAD'
git push --quiet origin main
git remote set-url origin "$TEST_REMOTE"
git switch --quiet -c local
git commit --quiet --allow-empty -m 'Commit fuera de main'
off_main="$(git rev-parse HEAD)"

cat > "$sandbox/bin/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == fetch ]]; then
  exec "$TEST_GIT" -c "url.$TEST_ORIGIN.insteadOf=$TEST_REMOTE" "$@"
fi
exec "$TEST_GIT" "$@"
EOF

cat > "$sandbox/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -eu
printf 'gh %s %s\n' "$1" "$2" >> "$TEST_LOG"
case "$1 $2" in
  'run list')
    args=" $* "
    [[ "$args" == *' --repo example/preinscripciones.test '* &&
       "$args" == *' --workflow ci.yml '* &&
       "$args" == *' --branch main '* &&
       "$args" == *' --event push '* &&
       "$args" == *" --commit $TEST_SHA "* &&
       "$args" != *' --status '* ]]
    [[ "$TEST_RESULT" != missing ]] || exit 0
    printf '123\n'
    ;;
  'run view')
    [[ "$3" == 123 ]]
    shift 3
    while [[ "$1" != --jq ]]; do shift; done
    query="$2"
    sha="$TEST_SHA"
    branch=main
    event=push
    status=completed
    conclusion=success
    jobs='["Verificar y cobertura","Compilar e imágenes Docker","Migraciones (aditivas e idempotentes)","Docker Compose config","Playwright E2E sobre imágenes Docker","Seguridad e higiene"]'
    case "$TEST_RESULT" in
      old-ci) jobs='["Typecheck, tests y compose"]' ;;
      failed) conclusion=failure ;;
      pending) status=in_progress; conclusion= ;;
      other-sha) sha=unexpected ;;
      other-branch) branch=local ;;
      pr) event=pull_request ;;
    esac
    if command -v jq >/dev/null; then
      jq -n --arg headSha "$sha" --arg headBranch "$branch" --arg event "$event" --arg status "$status" \
        --arg conclusion "$conclusion" --argjson jobs "$jobs" --arg result "$TEST_RESULT" \
        '{headSha: $headSha, headBranch: $headBranch, event: $event, status: $status, conclusion: $conclusion,
          jobs: ($jobs | map({name: ., status: "completed", conclusion: "success"}))}
          | if $result == "skipped-job" then .jobs[0].conclusion = "skipped" else . end' |
        jq -r "$query"
    elif [[ "$TEST_RESULT" == success ]]; then
      printf 'true\n'
    else
      printf 'false\n'
    fi
    ;;
  *) exit 2 ;;
esac
EOF

cat > "$sandbox/bin/ssh" <<'EOF'
#!/usr/bin/env bash
printf 'ssh\n' >> "$TEST_LOG"
cat > "$TEST_STREAM"
bash -c "$2" < "$TEST_STREAM"
EOF

cat > "$sandbox/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$TEST_LOG"
EOF

chmod +x "$sandbox/bin/"*
export PATH="$sandbox/bin:$PATH"

fail() {
  printf 'Fallo: %s\n' "$1" >&2
  cat "$sandbox/output" >&2
  exit 1
}

deploy() {
  : > "$TEST_LOG"
  : > "$TEST_STREAM"
  bash scripts/deploy-production.sh "$@" < /dev/null > "$sandbox/output" 2>&1
}

if deploy --sha "$off_main" --dry-run; then fail 'se aceptó un SHA fuera de main'; fi
[[ ! -s "$TEST_LOG" ]] || fail 'el SHA fuera de main llegó a GitHub o SSH'

for result in missing old-ci failed pending skipped-job other-sha other-branch pr; do
  if TEST_RESULT="$result" deploy --sha "$TEST_SHA"; then fail "se aceptó CI: $result"; fi
  grep -q '^gh run list$' "$TEST_LOG" || fail "no se consultó CI: $result"
  if grep -q '^ssh$' "$TEST_LOG"; then fail "se llamó a SSH con CI: $result"; fi
done

deploy --sha "$TEST_SHA" --dry-run || fail 'falló el dry-run con CI verde'
grep -q '^gh run view$' "$TEST_LOG" || fail 'el dry-run no verificó los jobs'
if grep -q '^ssh$' "$TEST_LOG"; then fail 'el dry-run llamó a SSH'; fi

deploy --sha "$TEST_SHA" || fail 'falló el despliegue con CI verde'
[[ "$(tar -xOf "$TEST_STREAM" release.txt)" == 'release elegida' ]] || fail 'el archivo enviado no corresponde al SHA pedido'
[[ "$(cat "$TEST_REMOTE_ARGS")" == $'script \'remoto\'\ndeploy\n'"$TEST_SHA" ]] || fail 'el comando SSH no ejecutó el script remoto correcto'

deploy --rollback || fail 'falló el rollback'
grep -qxF ssh "$TEST_LOG" || fail 'el rollback no llamó a SSH'
grep -qxF rollback "$TEST_REMOTE_ARGS" || fail 'el comando SSH no recibió el modo rollback'
if grep -q '^gh ' "$TEST_LOG"; then fail 'el rollback consultó CI'; fi
if tar -tf "$TEST_STREAM" >/dev/null 2>&1; then fail 'el rollback envió un archivo Git'; fi

deploy --check || fail 'fallaron los chequeos locales'
grep -qxF 'pnpm test' "$TEST_LOG" || fail 'no se ejecutaron los chequeos locales'
if grep -Eq '^(gh |ssh$)' "$TEST_LOG"; then fail 'los chequeos locales hicieron una llamada remota'; fi

printf 'Pruebas de deploy aprobadas.\n'
if ! command -v jq >/dev/null; then
  printf 'Sin jq: se simularon los resultados del filtro de GitHub CLI.\n'
fi
