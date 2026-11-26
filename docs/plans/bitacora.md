# Bitácora de implementación del plan maestro

Registro vivo y cronológico de ejecución de [plan-maestro.md](./plan-maestro.md), pensado para que cualquier persona del equipo o agente de IA pueda retomar el trabajo sin perder contexto.

## Convención de mantenimiento
- Toda entrega (`incremento`) actualiza esta bitácora **en el mismo commit**.
- Cada entrada documenta **quién hizo qué** (persona desarrolladora y/o agente/proveedor: Claude, Codex, Antigravity), **fecha y hora (`YYYY-MM-DD HH:MM -03:00`)**, épica/incremento, rama, qué se hizo, decisiones o desvíos acordados, verificaciones reales con sus resultados exactos, y qué queda pendiente o no verificado.
- No incluir correos reales institucionales ni secretos en este archivo.

---

## Estado general de épicas

> Estado verificado al 2026-11-26: `main` en GitHub está en `1b97dd4` (**PR #19**: E1 / Incremento 4 con los 6 jobs paralelos de CI en verde).

| Épica | Estado | Rama | Responsable / Autor | Notas |
|---|---|---|---|---|
| **E0** Hotfixes inmediatos | Cerrada en `main` (PR #15) | `main` (`cbe04e6`) | Iván Arriola + Claude (código/plan); Codex y Antigravity (revisiones, QA e integración) | 4 commits de código E0 sobre `main` (`586a378`) + `.max-w-md`/`.shadow-xl`/`border: 0`, `keepMessages` en `AdminSpreadsheetSettingsCard`, no disparo GA4/Meta sin sesión y `overflow-x: clip` en E2E; fusionada por squash en `cbe04e6`. |
| **E1** Base de calidad (reducida) | En cierre (E1.1–E1.4 en main #16–#19; E1.5 en PR; resta activar protección de main en GitHub) | `ci/e1-5-despliegue-rollback` (sobre `main` `1b97dd4`) | Iván Arriola (decisiones), Antigravity (planificación y ejecución) y Codex (CI y despliegue) | E1.1–E1.4 fusionados en `main` (`e9041e1` PR #16, `bfa4959` PR #17, `207f1de` PR #18, `1b97dd4` PR #19); E1.5 en `ci/e1-5-despliegue-rollback` (implementación inicial `8b874a3` integrada sobre `main` `1b97dd4`). Restan PR de E1.5, CI en GitHub y activación de protección de `main`. |
| **E2** Dependencias (`a` / `b` / `c`) | **En curso** (E2a adelantada localmente; E2b y E2c pendientes) | `epica/e2-dependencias` (`56f8ee6`) | Por asignar | E2a adelantada localmente (pendiente de alinear tras cerrar E1); E2b y E2c bloqueadas hasta cerrar E1 y protección de `main`. |
| **E3** Seguridad (reducida) | Pendiente | — | Por asignar | — |
| **E4** Panel: navegación y base de UI | Asignada (no iniciada) | — | Antigravity con equipo de agentes (ver [`AGENTS.md`](../../AGENTS.md)); Iván Arriola (decisiones) | Roles y modelos en [`AGENTS.md`](../../AGENTS.md). Arranca cuando E1, E2, E3 y E5 estén cerradas y `main` protegida. |
| **E5** Administradores por UI | Pendiente | — | Por asignar | — |
| **E6** Configuración en UI | Pendiente | — | Por asignar | — |
| **E7** Portal y wizard | Pendiente | — | Por asignar | — |
| **E8** Analítica mínima | Pendiente | — | Por asignar | — |
| **E9** Documentación mínima | Pendiente | — | Por asignar | — |
| **E10** Cierre de calidad | Pendiente | — | Por asignar | — |
| **E11** Rendimiento (quick wins) | Pendiente (repartida) | — | Por asignar | Línea base medida en E1 / Incremento 3 (ver `plan-maestro.md`). |

---

## Acuerdos de arranque en E1 (2026-11-21)

Decisiones operativas propuestas por Antigravity tras contrastar E1 con el estado real del repo y confirmadas por Iván Arriola antes de iniciar los cambios:

1. **Guarda de correos reales en CI:** en E1 bloquea correos reales nuevos introducidos en el diff del PR (conservando excepción explícita para `inscripciones@flacso.edu.uy`); la limpieza completa y el chequeo sobre todo el repo se activan en E3.
2. **`pnpm audit` en CI:** corre en CI como aviso (`continue-on-error: true`) durante E1 y E2 mientras existan vulnerabilidades conocidas pendientes de las actualizaciones de E2 (hoy 2 críticas en dev y 6 altas en prod); pasa a bloqueante al cerrar E2.
3. **Ajustes técnicos mínimos en E1 para que `docker build` y `e2e` pasen en verde:** alinear `pnpm@12.14.0` en Dockerfiles y CI, agregar `apps/api/tsconfig.build.json` para no compilar `*.test.ts` en `dist/`, ajustar los e2e desactualizados respecto a E0 (`overflow-x: clip`, rutas relativas `/api/` y modo `WEB_URL` sin `webServer` en `playwright.config.ts`).
4. **Ramas y validación de CI en despliegue:** rama lineal `epica/e1-base-calidad` desde `epica/e0-hotfixes` con un commit atómico por incremento; `scripts/deploy-production.sh` usa `gh` CLI para exigir un SHA de `main` con CI verde.

---

## Registro de entregas

### 2026-11-26 17:55 -03:00 — E1 / Incremento 5: Despliegue verificado por CI, prueba de humo y --rollback
- **Quién y rama.** Codex + Antigravity (implementación inicial `8b874a3`, integración sobre `main` `1b97dd4`): `Orchestrator` (`Gemini 4 Carbon Medium`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`). Rama: `ci/e1-5-despliegue-rollback`.
- **Qué se hizo.** Actualización de `scripts/deploy-production.sh` y extracción de `scripts/deploy-production-remote.sh` (exige SHA de `main` con los 6 jobs exitosos vía `gh`, `--check`, `--dry-run`, `--rollback` reconstruyendo/levantando release anterior sin tocar PostgreSQL y conservando `umask 077`, más prueba de humo sobre `/api/health`, `/api/health/catalog`, web y `GET /api/targets`); suites de prueba con dobles `scripts/ci/test-deploy-production.sh` y `scripts/ci/test-deploy-production-remote.sh` ejecutadas dentro del job `Docker Compose config` de `.github/workflows/ci.yml`; estabilización de `apps/web/src/api/client.upload.test.ts` (reloj controlado y archivo por caso); y actualización de `docs/DEPLOY.md`.
- **Revisión independiente.** `Reviewer` (`pro`): **`APROBADO`** (0 críticos/altos/medios; 3 observaciones menores `low` no bloqueantes; confirmada coincidencia exacta de los 6 nombres de jobs entre `scripts/deploy-production.sh:67-68` y `.github/workflows/ci.yml`).
- **Verificaciones (`QA`).** `bash -n` OK en los 4 `.sh`; `bash scripts/ci/test-deploy-production.sh` PASS en Git Bash y WSL (modo sin `jq`); `node scripts/ci/check-migrations.mjs --base origin/main` y `node scripts/ci/check-hygiene.mjs --base origin/main` OK (`436` archivos); `pnpm --filter @flacso/contracts build`, `pnpm typecheck` y `pnpm build` en verde; `pnpm test` sin PG 16 (`apps/api` **83/96** suites [**679/747** tests, `68` saltados: `66` PG 16 + `2` `win32`]; `apps/web` **37/37** suites [**182/182** tests, `client.upload.test.ts` **6/6**]). **No verificado localmente (se valida en este PR en CI `ubuntu-latest`):** `scripts/ci/test-deploy-production-remote.sh` (`flock` ausente en Git Bash y `node` ausente en WSL Ubuntu), camino real con `jq`, 13 suites PostgreSQL 16 y `pnpm e2e` en Docker. Las operaciones de despliegue/rollback en `servidor-flacso` quedan sin ejecutar por regla.
- **Pendiente.** `push`, PR #20 hacia `main`, validación de los 6 jobs en verde (incluidos `test-deploy-production.sh` y `test-deploy-production-remote.sh` en Linux dentro de `Docker Compose config`) y merge squash; activar protección de rama `main` en GitHub y comprobar el rechazo de un PR con test roto antes de iniciar **E2a**.

### 2026-11-26 17:38 -03:00 — E1 / Incremento 4: Tubería CI paralela de 6 puertas, guardas de higiene/migraciones y MIME .mjs en Nginx
- **Quién y rama.** Antigravity + Codex (implementación inicial `2ea1104`, integración sobre `main` `207f1de` + corrección MIME `.mjs` en Nginx y margen de espera PG): `Orchestrator` (`Gemini 4 Carbon Medium`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`, relanzado tras ventana de cuota 429). Rama: `ci/e1-4-puertas-ci`.
- **Qué se hizo.** Incorporación de `.github/workflows/ci.yml` (6 jobs paralelos sobre Node 24 y `pnpm@12.14.0`: `verify`, `build`, `migrations`, `compose`, `e2e` con espera de 60 s para arranque inicial de PostgreSQL 16, y `security`), `scripts/ci/check-migrations.mjs`, `scripts/ci/check-hygiene.mjs`, actualización de `.dockerignore`, timeout 30 s en `014_smtp_email_settings.test.ts`, reloj PostgreSQL (`CURRENT_TIMESTAMP + INTERVAL '2 days'`) para `expires_at` en `tests/e2e/admin-session.spec.ts`, bloque `location ~* \.mjs$` con `text/javascript` y cabeceras de seguridad en `apps/web/nginx.conf` para resolver el error MIME del worker PDF, y actualización de `AGENTS.md:11`.
- **Revisión independiente.** `Reviewer` (`pro`): **`APROBADO`** (0 críticos/altos/medios; 5 observaciones menores `low`, incorporándose aquí la ampliación de `timeout 20s` → `60s` para `ci-e2e-pg` en `.github/workflows/ci.yml:218`).
- **Verificaciones (`QA`).** `node scripts/ci/check-migrations.mjs --base origin/main` y `node scripts/ci/check-hygiene.mjs --base origin/main` en verde (`433` archivos revisados, más batería de casos negativos/borde en aislado: rechazo de `.dropTable(`, excepción `// @migration-contraction`, bloqueo de `.env` y correos nuevos `@flacso.edu.uy`, excepción `inscripciones@flacso.edu.uy`); `docker compose config --quiet` (dev y prod) OK; `pnpm --filter @flacso/contracts build`, `pnpm typecheck`, `pnpm build` (`0` `*.test.js` en `dist/`) y `playwright test --list` (14 tests) en verde; `pnpm test` sin PG 16 (`apps/api` **83/96** suites [**679/747** tests, `68` saltados: `66` PG 16 + `2` `win32`]; `apps/web` **37/37** suites [**182/182** tests]). **Se valida en GitHub Actions al abrir este PR:** ejecución real en paralelo de los 6 jobs (incluyendo PostgreSQL 16 con candado V8 de `api`, `docker build` y `pnpm e2e` 14/14 en Docker).
- **Pendiente.** Ninguno: el **PR #19** pasó los **6 jobs en verde** en GitHub Actions (`run 45892592432`: `Compilar e imágenes Docker` 1m23s, `Docker Compose config` 6s, `Migraciones` 36s, `Playwright E2E sobre imágenes Docker` 2m0s con **14/14 passed en 20.4 s** y sin errores MIME de `.mjs`, `Seguridad e higiene` 21s, `Verificar y cobertura` 1m26s con PostgreSQL 16 y candados V8) y se fusionó por squash en `main` (`1b97dd4`), habilitando **E1.5** (`deploy-production.sh` con `--rollback`, prueba de humo y CI verde).

### 2026-11-26 16:44 -03:00 — E1 / Incremento 3: Cobertura V8 con candado, tsconfig.build.json y Dockerfiles pnpm@12.14.0
- **Quién y rama.** Antigravity (ejecución/mediciones iniciales `fdecfa2`, integración sobre `main` `bfa4959`): `Orchestrator` (`Gemini 4 Carbon Medium`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`). Rama: `chore/e1-3-cobertura-v8`.
- **Qué se hizo.** Instalación de `@vitest/coverage-v8@3.2.7` en `api` y `web` sin alterar otras dependencias del lockfile; `pnpm@12.14.0` en `apps/api/Dockerfile` y `apps/web/Dockerfile`; `apps/api/tsconfig.build.json` (`0` archivos `*.test.js` en `dist/`); candados de cobertura V8 (`api`: `78/78/87/79` cuando hay `CI` o `PREINSCRIPTIONS_TEST_DATABASE_URL`; `web`: `80/80/63/79`); fix de reloj `availableAt: now` en `postgres-telegram-alert-repository.test.ts`; actualización de `README.md` y `AGENTS.md:17`.
- **Revisión independiente.** `Reviewer` (`pro`): **`APROBADO`** (0 críticos/altos/medios; 4 observaciones menores no bloqueantes).
- **Verificaciones (`QA`).** `pnpm install --frozen-lockfile` OK (`256 ms`); `pnpm --filter @flacso/contracts build` y `pnpm typecheck` en verde; limpieza de `apps/api/dist` + `pnpm build` en verde (`0` archivos `*.test.js`/`*.spec.js` en `dist/` y `apps/api/dist/main.js` presente); `$env:CI=""; $env:PREINSCRIPTIONS_TEST_DATABASE_URL=""; pnpm test:coverage`: `apps/api` **83/96** suites (**679/747** tests, `68` saltados: `66` sin PostgreSQL 16 local y `2` `win32`; V8 sin PG: `68.35/68.35/75.21/79.40`) y `apps/web` **37/37** suites (**182/182** tests, V8 con candado `80/80/63/79` en verde: `80.41/80.41/63.79/80.09`). **No verificado localmente:** candado de `apps/api` (`78/78/87/79`), 13 suites PostgreSQL 16 (incluido `postgres-telegram-alert-repository.test.ts`), 2 tests `win32`, `docker build` y `pnpm e2e` (entran en E1.4).
- **Pendiente.** Ninguno: el **PR #18** pasó CI en verde y se fusionó por squash en `main` (`207f1de`), habilitando **E1.4** (tubería CI paralela de 6 puertas, guardas de higiene/migraciones y corrección MIME `.mjs` en `apps/web/nginx.conf`).

### 2026-11-26 16:28 -03:00 — E1 / Incremento 2: Entidades HTML, limpieza de tests obsoletos y preparación de Playwright
- **Quién y rama.** Antigravity (implementación inicial `4949437`, integración sobre `main` `e9041e1`): `Orchestrator` (`Gemini 4 Carbon Medium`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`). Rama: `chore/e1-2-entidades-tests-e2e`.
- **Qué se hizo.** Ampliación de `NAMED_ENTITIES` (+41 entidades) en `apps/api/src/infrastructure/wordpress/html-entities.ts` y `html-entities.test.ts`; consolidación de `admin-profile-routes.test.ts` usando `admin@example.test`; limpieza de `profileVersionId` obsoletos en `form-validation.test.ts` y `spreadsheet-schema.test.ts`; preparación de `playwright.config.ts` (`WEB_URL` sin `webServer` y `admin@example.test`), actualización de `tests/e2e/document-flow.spec.ts` y `preinscriptions.spec.ts`, incorporación de `tests/e2e/admin-session.spec.ts`, y actualización de `AGENTS.md:19`.
- **Revisión independiente.** `Reviewer` (`pro`): **`APROBADO`** (0 críticos/altos/medios; 4 observaciones menores no bloqueantes, incluyendo el ajuste de reloj `NOW()` de `admin-session.spec.ts` previsto para E1.4).
- **Verificaciones (`QA`).** Cero `@flacso.edu.uy` nuevos en diff y archivos tocados; `pnpm --filter @flacso/contracts build`, `pnpm typecheck` y `pnpm build` en verde (`195` módulos Vite); `pnpm test` (sin `PREINSCRIPTIONS_TEST_DATABASE_URL`): `apps/api` **83/96** suites (**679/747** tests, con `admin-profile-routes.test.ts` 1/1, `html-entities.test.ts` 7/7, `form-validation.test.ts` 13/13, `spreadsheet-schema.test.ts` 11/11; 13 suites / 66 tests saltados por falta de PostgreSQL 16 local y 2 por plataforma `win32`) y `apps/web` **37/37** suites (**182/182** tests); `playwright test --list` (default y con `WEB_URL`) listó 14 tests en 4 specs. **No verificado localmente:** `pnpm e2e` en vivo (sin stack ni PostgreSQL 16 local; entra con el job `e2e` en E1.4) ni `tsc` sobre `tests/e2e/`.
- **Pendiente.** Ninguno: el **PR #17** pasó CI en verde y se fusionó por squash en `main` (`bfa4959`), habilitando **E1.3** (cobertura V8 con candado, `tsconfig.build.json` y Dockerfiles `pnpm@12.14.0`).

### 2026-11-26 16:17 -03:00 — E1 / Incremento 1: Retiro del worker duplicado e integración sobre main
- **Quién y rama.** Antigravity (planificación/implementación inicial `81011f8`, integración sobre `main` `cbe04e6`): `Orchestrator` (`Gemini 4 Carbon Medium`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`). Rama: `chore/e1-1-retiro-worker`.
- **Qué se hizo.** Eliminación de `apps/api/src/worker-notifications.ts` (conservando `worker-recovery.test.ts`), retiro de `"worker:notifications"` en `apps/api/package.json` y servicio `notification-worker` en `docker-compose.yml`, y actualización de `docs/ARQUITECTURA.md`, `docs/DEPLOY.md`, `docs/MAUTIC.md`, `docs/SES-NOTIFICACIONES.md` y `docs/TELEGRAM-Y-PLANILLAS.md`.
- **Revisión independiente.** `Reviewer` (`pro`): **`APROBADO`** (0 críticos/altos/medios; observación menor en `docs/SES-NOTIFICACIONES.md:115` con mención genérica `"worker"` en tabla, a retirar en E9).
- **Verificaciones (`QA`).** `git grep` limpio (0 referencias vivas); `docker compose -f docker-compose.yml config --quiet` y `docker compose --env-file .env.production.example -f deploy/docker-compose.production.yml config --quiet` OK; `pnpm --filter @flacso/contracts build`, `pnpm typecheck` y `pnpm build` en verde (`195` módulos Vite); `pnpm test` (sin `PREINSCRIPTIONS_TEST_DATABASE_URL`): `apps/api` **83/96** suites (**683/751** tests, `worker-recovery.test.ts` 3/3; 13 suites / 66 tests saltados por falta de PostgreSQL 16 local y 2 por plataforma `win32`) y `apps/web` **37/37** suites (**182/182** tests). **No verificado localmente:** suites reales PostgreSQL 16, `pnpm e2e` y `docker build` (entran en E1.4).
- **Pendiente.** Ninguno: el **PR #16** pasó CI en verde y se fusionó por squash en `main` (`e9041e1`), habilitando **E1.2** (entidades HTML, limpieza de tests obsoletos y preparación de Playwright).

### 2026-11-26 15:20 -03:00 — E0: Hotfixes inmediatos en main
- **Quién y rama.** Iván Arriola + Claude (commits originales `96ad0f7`, `72f71f1`, `75a7ae2`, `a496b2d`); Antigravity en integración sobre `main` (`586a378`): `Orchestrator` (`Gemini 4 Carbon Medium`), `Explorer` (`flash`), `Implementer` (`inherit`), `Reviewer` (`pro`), `QA` (`inherit` / `qa-verifier`). Rama: `fix/e0-hotfixes`.
- **Qué se hizo.**
  - Aplicación de los 4 hotfixes de E0 sobre `main` (`586a378`): orden CSS en `main.tsx`, reparación de selectores `\\:` en `app.css`, `overflow-x: clip`, `.phone-input` en `form.css`, estilos de botones/modales (`.max-w-md`, `.shadow-xl`, `border: 0` y `.fixed.inset-0`), `keepMessages` en `AdminDriveSettingsCard`, `AdminRecoverySettingsCard` y `AdminSpreadsheetSettingsCard` (con tests), provisión explícita de planillas, rechazo temprano `400` con archivos sin sesión antes de guardar/cupo/Meta/GA4 (`submission-routes.ts`, probado en `submission-pinning.test.ts`), retiro de parseo manual redundante de cookies (`admin-session.ts`, `admin-auth-routes.ts`), `umask 077` en `scripts/deploy-production.sh` y `overflow-x: clip` en `tests/e2e/mobile-preinscription.spec.ts`.
- **Revisión independiente.** `Reviewer` (`pro`): 1.ª pasada detectó `medium` (`.max-w-md`/`.shadow-xl` faltantes) y 4 `low`; corregidos por `Implementer` (`inherit`). 2.ª pasada sobre el diff completo y archivos reales emitida como **`APROBADO`** (0 críticos/altos/medios; 1 observación `low` de seguimiento para E4 en `admin-responsive.css:183` para el modal de `AdminNotificationsSettingsCard` en `<= 760 px`).
- **Verificaciones (`QA`).**
  - `pnpm --filter @flacso/contracts build`, `pnpm typecheck`, `pnpm build` y `bash -n scripts/deploy-production.sh`: en verde (`exit 0`, `195` módulos Vite).
  - `pnpm test` (sin `PREINSCRIPTIONS_TEST_DATABASE_URL`): `apps/api` **83** suites en verde y **13** saltadas (`96` total; **683** tests en verde y **68** saltados de `751`: `66` por falta de PostgreSQL 16 y `2` por plataforma `win32`); `apps/web` **37/37** suites en verde (**182/182** tests).
  - Verificación visual a `1280 px` y `360 px` (`vite preview` + mocks API, 18 capturas): `0` desbordamientos horizontales (`scrollWidth` 1280/360), `0` imágenes rotas, `0` errores de consola/página, `.phone-input` a 1 columna en móvil, `0` llamadas a `provision` al montar `AdminSpreadsheetSettingsCard` y modales/contraste conformes (observación `low` en `.target-list-card-actions` a `1280 px` con `gapPx: 0` para seguir en E7).
  - **No verificado localmente:** `pnpm e2e` (`Timed out` en `webServer` porque `/api/health` responde `503 database: down` sin Docker Desktop / PostgreSQL 16 en este entorno Windows) ni las 13 suites reales de PostgreSQL 16; quedan sujetos a la puerta de CI en GitHub Actions.
- **Pendiente.** Ninguno: el **PR #15** pasó CI en verde y se fusionó por squash en `main` (`cbe04e6`), habilitando el inicio de **E1** (Incrementos 1–5).

### 2026-11-26 14:02 -03:00 — Documentación inicial en main: plan maestro v3, bitácora, metodología de agentes y GA4_API_SECRET en E6 (Incremento 0)
- **Quién y rama.** Iván Arriola (decisiones) y Antigravity — nota de transparencia sobre modelos respecto a los IDs de [`AGENTS.md`](../../AGENTS.md): la sesión expuso `Orchestrator` en `Gemini 4 Carbon Medium` (en lugar de `gemini-4-neon-medium`), `Implementer` en tier `inherit` (hereda `Gemini 4 Carbon Medium` en lugar de `gemini-4-carbon-medium`) y `Reviewer` en tier `pro` (en lugar de `gemini-4-neon-high`); rama `docs/plan-maestro-y-metodologia` creada desde `origin/main` (`37480b5`).
- **Qué se hizo.**
  - Traspaso limpio a `main` de `AGENTS.md`, `CLAUDE.md`, `docs/plans/plan-maestro.md` y `docs/plans/bitacora.md`, resguardando en `wip/docs-e4-e6-20261126` (`f421dcd`) el borrador previo sin commit.
  - Incorporación de la metodología de equipo de agentes en `AGENTS.md` (`## Equipo de agentes y delegación`) y en `docs/plans/plan-maestro.md` (`### 4b. Metodología de agentes y delegación`).
  - Actualización de E2b/E2 (`@types/node` `22 → 24`, alineación de `typescript` raíz y `@types/express` v5) y de E4/E6 con `GA4_API_SECRET` (PR #13 `37480b5`).
  - Limpieza de ref huérfana de Codex que bloqueaba `git fetch` y actualización de la tabla de estado general de épicas al 2026-11-26.
- **Verificaciones.** `git diff --check` limpio; chequeo de correos `@flacso.edu.uy` limpio (solo excepción documentada `inscripciones@flacso.edu.uy` y regex); `pnpm install --frozen-lockfile`, `pnpm --filter @flacso/contracts build`, `pnpm typecheck` y `pnpm build` en verde; `pnpm test` (sin `PREINSCRIPTIONS_TEST_DATABASE_URL`): `apps/api` 83 suites en verde y 13 saltadas (682 tests en verde, 68 saltados de 750) y `apps/web` 36/36 suites en verde (178/178 tests). Sin ejecutar en este incremento documental: `pnpm e2e`, `docker compose config` y suites reales contra PostgreSQL 16.
- **Revisión.** `Reviewer` independiente (`pro`): 1.ª pasada detectó citas de línea en `plan-maestro.md` (`medium`) y ajustes menores (`low`), todos corregidos por `Implementer` (`inherit`); 2.ª pasada sobre el diff completo y código real de `origin/main` emitida como **`APROBADO`** (0 críticos/altos/medios; 2 menores resueltos en este cierre).
- **Cierre e integración.** El **PR #14** pasó CI en verde y se fusionó por squash en `main` (`586a378`), habilitando el inicio de la integración de E0 sobre `main`.

### 2026-11-26 13:09 -03:00 — E4 y E6 (planificación): especificación de pantallas del panel, «Estructura de los formularios» y panel como única fuente de configuración
- **Quién y rama.** Iván Arriola decidió y Claude (Opus 5.5) exploró el código y redactó. Solo cambia documentación; se hizo en la rama de trabajo `epica/e2-dependencias`, sin commit.
- **Qué se hizo.**
  - Se agregó a E4, en `plan-maestro.md`, la especificación de pantallas: shell, rutas, contenido de cada sección, `SecretField` y convenciones.
  - Se sumó una 8.ª sección, **«Estructura de los formularios»**: auditoría de solo lectura de cómo se arma cada formulario, por tipo de oferta y por oferta publicada.
  - En `plan-maestro.md` se actualizaron la decisión «Cuándo entra en vigor un ajuste», las reglas de «Producción siempre lista» y «listo para producción», y E6 (importación única, orden de entrega y rollback).
- **Decisiones del usuario (2026-11-26).**
  - Alinear el rediseño con E4 sin reabrir las decisiones de la sección 2 y respetando el orden de épicas.
  - «Formularios Canónicos» se reemplaza por «Estructura de los formularios», en lugar de solo retirarse.
  - Los secretos ya guardados se muestran como «Configurado» con un «Reemplazar» explícito y un aviso de sobrescritura, nunca como input vacío.
  - Las listas suman paginación y, en la cola de correos, búsqueda por destinatario y filtro por fecha (cambio aditivo en `GET /notifications`).
  - Los ajustes de E6 (Meta, GA4, WordPress y retención) se configuran **solo por el panel**: una importación única desde el entorno al arrancar la API (después de las migraciones, con validación y cifrado; si falla, la API sale con error) y desde ahí el entorno no se lee. La UI no muestra origen. Las variables quedan en el `.env` solo durante la ventana de rollback. Siguen en el entorno las de infraestructura (`DATABASE_URL`, `APP_SETTINGS_ENCRYPTION_KEY`, credenciales de Google, etc.).
  - Revisión UX complementaria de E4 incorporada al plan (shell con migas, panel lateral de detalle, estado del correo separado del último intento, `ConnectionStatus`, `SaveBar`, matriz de formularios con columna fija y vista móvil secuencial, componentes compartidos acotados y criterios de aceptación WCAG 2.2 AA). Entran también, como PR opcionales después de las secciones, el menú contraíble, el orden por columnas en el servidor, los atajos de teclado con interruptor y la densidad de tablas.
  - La implementación de E4 se delega a Antigravity, con modelos por rol: tier bajo para explorar código, tier medio para escribirlo y tier medio-alto para revisar su calidad antes de cada merge.
  - Modelos de Antigravity: Gemini 4 completo (ver tabla). No se lanza hasta cumplir las precondiciones.
  - Revisión UX complementaria II incorporada a E4, con notas para E5 y E8; se corrigieron tres supuestos que el backend no cumple (historial por intento en fallidas y en la cola, y última verificación guardada de Drive).
- **Hallazgo.** Meta y GA4 hoy solo se configuran por entorno (`META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE`, `GA4_MEASUREMENT_ID`). Pasan al panel en E6, dentro de «Marketing y analítica», como única fuente.
- **Verificaciones.** No aplica: no hay cambios de código. No se ejecutaron `typecheck`, `test` ni `build`.
- **Pendiente.** Incluir este cambio de documentación en `main` (hoy está sin commit en `epica/e2-dependencias`), porque Antigravity lo necesita como especificación. E4 está asignada a Antigravity y arranca cuando se cumplan sus precondiciones.

### 2026-11-21 16:50 -03:00 — E1 / Incremento 5: Validación, prueba de humo y reversión de releases
- **Quién y rama.** Codex implementó y verificó el incremento en `epica/e1-base-calidad`. Un subagente de mayor capacidad revisó la operación y probó el flujo remoto simulado. Un subagente rápido verificó GitHub CLI y probó el flujo local.
- **Despliegue.** El comando actualiza `origin/main` y exige el último *push* con los seis jobs exitosos para el SHA exacto. Transfiere `git archive` de ese commit y conserva las releases ya copiadas. `--check` conserva las validaciones locales y `--dry-run` comprueba CI sin conectar al servidor de despliegue.
- **Activación y reversión.** El servidor serializa operaciones, conserva los respaldos y comprueba la web, la API, el catálogo y los destinos. Ante fallo muestra logs y conserva el último despliegue confirmado. `--rollback` reconstruye la release anterior con Compose y levanta API y Web conservando PostgreSQL. Si hay una activación incompleta, usa el último SHA confirmado. Se documentó el flujo en `docs/DEPLOY.md`.
- **Pruebas.** Se agregaron pruebas con dobles al job de Compose. La prueba de progreso de carga ahora usa un reloj controlado y un archivo independiente por caso, tras observar dos fallos en la primera corrida del monorepo.
- **Verificaciones ejecutadas.** Los scripts de despliegue y reversión pasaron sus pruebas en Linux sin red. También pasó la matriz de GitHub CLI en Git Bash con `jq`. Una consulta de solo lectura a GitHub confirmó que la guarda rechazaba la ejecución histórica `44915389414`, con conclusión `success` y una sola puerta. Ambos Compose validaron con `config --quiet` sin cargar el `.env` local y el workflow pasó `actionlint`.
- **Monorepo.** `pnpm typecheck`, `pnpm test` y `pnpm build` pasaron en la repetición con PostgreSQL 16. API pasó 741 pruebas en 95 suites y omitió 2 pruebas. Web pasó 181/181 en 37 suites. La ejecución anterior de Web falló en 2 casos de `client.upload.test.ts`, que pasaron 6/6 al repetir el archivo después de la corrección.
- **Playwright.** `pnpm e2e` pasó 14/14 en 36,7 s contra las imágenes de E1 y un PostgreSQL 16 nuevo. El primer intento agotó los 20 s de espera de PostgreSQL. En la repetición local se amplió esa espera a 120 s sin modificar el workflow. Sigue registrado el error de tipo MIME del worker de PDF en Nginx.
- **Pendiente de E1.** PR y CI en GitHub. La API de GitHub reportó `main` sin protección, cuya activación está a cargo del usuario. También queda comprobar que un PR fallido no se puede fusionar. Las operaciones de despliegue y reversión en producción quedan sin verificar.

### 2026-11-21 16:07 -03:00 — E1 / Incremento 4: Tubería CI paralela en `.github/workflows/ci.yml` y puertas de calidad
- **Quién:** Antigravity (planificación e implementación inicial), conforme a los acuerdos de arranque de E1 confirmados por Iván Arriola. Codex (diagnóstico, ajustes y verificación local).
- **Rama:** `epica/e1-base-calidad`
- **Qué se hizo:**
  - Se creó `scripts/ci/check-migrations.mjs` para rechazar `DROP`/`RENAME` en el `up()` de migraciones nuevas/modificadas y `>= 031_*` (salvo marcador `// @migration-contraction`).
  - Se creó `scripts/ci/check-hygiene.mjs` para verificar archivos prohibidos (`.env`, `.secrets/*`), patrones de secretos de alta confianza y correos `@flacso.edu.uy` nuevos en el diff (excepción pública `inscripciones@flacso.edu.uy`; soporta `--all` para activar sobre todo el repo en E3).
  - Se renovó `.github/workflows/ci.yml` con 6 jobs paralelos sobre Node 24 y pnpm `12.14.0`: `verify` (PostgreSQL 16 + `pnpm test:coverage`), `build` (`pnpm build` + `docker build` de `api`/`web` + dist sin `*.test.js` ni `tsx`), `migrations` (chequeo DDL + base vacía + reaplicación idempotente), `compose`, `e2e` (Playwright contra las imágenes Docker levantadas) y `security` (`check-hygiene.mjs` bloqueante + `pnpm audit --audit-level=high` en aviso hasta cerrar E2).
  - Se registró el alcance de ambas puertas en `docs/plans/plan-maestro.md`.
  - Se actualizó `AGENTS.md` para exigir fecha y hora en las entradas de la bitácora. La guarda de higiene admite el marcador ficticio documentado de AWS y rechaza rutas sensibles rastreadas antes de escanear contenido.
  - A pedido de Iván Arriola, Codex agregó a `AGENTS.md` la delegación a subagentes con roles, alcances y tiers elegidos según la complejidad y el riesgo.
  - Se ajustó la espera de PostgreSQL a TCP y se hizo fallar el job e2e si vence el plazo. La guarda de migraciones también usa el SHA anterior en ejecuciones por `push`.
  - Se corrigió el vencimiento de la sesión sembrada en Playwright. La columna carece de zona horaria y el fixture ahora usa el reloj de PostgreSQL con margen para el desfase entre el host y la API.
  - `.dockerignore` excluye dependencias y artefactos generados también en los subproyectos. Se comprobó que el contexto anterior copiaba enlaces de Windows a la imagen Linux y que el nuevo contexto resuelve Vitest desde las dependencias de la imagen.
  - Se ajustó a 30 s el plazo de la prueba de integración de la migración 014. Aplica toda la cadena y la reaplica, y superó el límite de 5 s en Windows y en corridas Linux bajo carga.
- **Verificaciones ejecutadas:**
  - `pnpm --filter @flacso/contracts build`, `pnpm typecheck` y `pnpm build` pasaron. Los dos Compose validaron con `config --quiet`, sin cargar el `.env` local.
  - `actionlint` validó `.github/workflows/ci.yml`.
  - En Linux con PostgreSQL 16, las fases de API de `pnpm test` y `pnpm test:coverage` pasaron 743/743 pruebas en 95 suites. Las corridas simultáneas del monorepo fallaron en Web (1 caso de `CountrySelect` en `test`, 4 de `PreinscriptionWizard` en `test:coverage`). Repetidos por separado, `pnpm --filter web test` y `pnpm --filter web test:coverage` pasaron 181/181 pruebas en 37 suites. Ambas aplicaciones cumplieron los umbrales de cobertura: API `79,32/79,32/88,11/79,71` y Web `80,60/80,60/64,36/80,08` (líneas/sentencias/funciones/ramas).
  - La primera corrida de `pnpm test` en Windows registró 740 pruebas de API aprobadas, 2 omitidas y 1 fallida por el plazo de la migración 014. Tras el ajuste, ese caso pasó en las dos corridas de API en Linux.
  - `docker build` reconstruyó `preinscripciones-api:ci` y `preinscripciones-web:ci`. La imagen de API contiene `main.js` y carece de tests compilados y de `tsx`. La imagen web contiene `index.html`.
  - PostgreSQL 16.15 aplicó y reaplicó las migraciones en una base vacía. La guarda de DDL rechazó un `DROP` sintético y aceptó la contracción marcada y una migración aditiva. La guarda de higiene pasó sobre el diff con `origin/main`, aceptó ejemplos ficticios y rechazó un correo institucional sintético y una ruta sensible sintética rastreada.
  - `pnpm e2e` pasó 14/14 en 48,7 s sobre las imágenes finales y PostgreSQL 16 vacío, con el paso de arranque del workflow. Los envíos de documentos pasaron y el navegador registró un error de tipo MIME para el worker `.mjs` de PDF servido por Nginx.
  - `pnpm audit --audit-level=high` salió con código 1 (2 críticas, 7 altas, 12 moderadas y 1 baja). Se mantiene como aviso según el acuerdo de E1/E2.
- **Pendiente de E1:** PR y ejecución de los seis jobs en GitHub Actions, Incremento 5 (`scripts/deploy-production.sh` con SHA de `main` + CI verde, `--rollback` y prueba de humo) y activación de protección de `main` por el usuario. Queda pendiente revisar el tipo MIME del worker PDF.

### 2026-11-21 15:07 -03:00 — E1 / Incremento 3: Cobertura V8 con candado, `tsconfig.build.json` y líneas base de cobertura/rendimiento
- **Quién:** Antigravity (ejecución y mediciones); corrección de carrera en `postgres-telegram-alert-repository.test.ts` aprobada en revisión de plan.
- **Rama:** `epica/e1-base-calidad`
- **Qué se hizo:**
  - Se instaló `@vitest/coverage-v8@3.2.7` en `apps/api` y `apps/web` (sin alterar versiones de ninguna dependencia existente en `pnpm-lock.yaml`).
  - Se alineó `pnpm@12.14.0` en `apps/api/Dockerfile` y `apps/web/Dockerfile`.
  - Se agregó `apps/api/tsconfig.build.json` (excluyendo `*.test.ts` y `*.spec.ts`) y se actualizó `"build"` en `apps/api/package.json` (`0` archivos de prueba dentro de `apps/api/dist/`).
  - Se configuró `apps/api/vitest.config.ts` y `apps/web/vite.config.ts` con exclusiones legítimas, scripts `test:coverage` en raíz/api/web, y candados `Math.floor`: API `78/78/87/79` (`lines/statements/functions/branches`, activos cuando `CI` o `PREINSCRIPTIONS_TEST_DATABASE_URL` están definidos) y Web `80/80/63/79`.
  - Se corrigió una condición de carrera de 1 ms en `apps/api/src/infrastructure/database/postgres-telegram-alert-repository.test.ts` pasando `availableAt: now` explícitamente en los casos de prueba que luego invocan `claimPending(..., now)`.
  - Se midieron y registraron en `docs/plans/plan-maestro.md` las líneas base reales de cobertura (total y por capa) y rendimiento (bundle crudo/gzip, 140 consultas/min en reposo con 136 lecturas a `system_settings`, latencia `POST /api/uploads` con 0/500/2.000 archivos retenidos: 17,18 ms → 677,73 ms → 2.163,05 ms) y se documentó `pnpm test:coverage` en `README.md`.
- **Verificaciones ejecutadas:**
  - `pnpm typecheck` y `pnpm build`: en verde (`0` archivos `*.test.js` dentro de `apps/api/dist/`).
  - `PREINSCRIPTIONS_TEST_DATABASE_URL=... pnpm test:coverage` contra PostgreSQL 16 (`flacso-e1-pg`) con los candados ya activados: `apps/api` 95/95 suites en verde (candado `78/78/87/79` cumplido sobre base medida `78,48/78,48/87,26/79,56`); `apps/web` 37/37 suites en verde (candado `80/80/63/79` cumplido sobre base medida `80,40/80,40/63,79/79,96`).
  - `git diff --check` y revisión de `pnpm-lock.yaml`: sin cambios en versiones de paquetes existentes ni correos reales nuevos.
- **Pendiente de E1:** Incrementos 4 (`ci.yml` completa, `docker build`, migraciones y e2e en Docker) y 5 (`deploy-production.sh`).

### 2026-11-21 14:38 -03:00 — E1 / Incremento 2: `AGENTS.md`, `html-entities` ampliado, auditoría de tests y e2e sobre PostgreSQL 16
- **Quién:** Antigravity (planificación y ejecución).
- **Rama:** `epica/e1-base-calidad`
- **Qué se hizo:**
  - Se crearon `AGENTS.md` (guía operativa del monorepo, referencia al plan maestro y bitácora viva obligatoria con atribución) y `CLAUDE.md` (de una línea apuntando a `AGENTS.md`).
  - Se amplió `NAMED_ENTITIES` en `apps/api/src/infrastructure/wordpress/html-entities.ts` (+41 entidades tipográficas y romances frecuentes en títulos de WordPress) y se agregaron pruebas en `html-entities.test.ts`.
  - Se consolidó `apps/api/src/presentation/http/admin-profile-routes.test.ts` usando `admin@example.test` y `ADMIN_ALLOWED_EMAILS=admin@example.test` (sin correos reales ni fixtures obsoletos).
  - Se actualizaron `profileVersionId` obsoletos en `apps/api/src/domain/spreadsheet-schema.test.ts` y `form-validation.test.ts`.
  - Se actualizaron los e2e para correr contra dev o stack Docker (`playwright.config.ts` omite `webServer` si `WEB_URL` está definida, pasa `DATABASE_URL` al servidor local y reemplaza el correo literal por `process.env.ADMIN_ALLOWED_EMAILS || 'admin@example.test'`; rutas relativas `/api/...`, texto `"esta propuesta"` y comentario `404`/`401` corregidos en `tests/e2e/preinscriptions.spec.ts`; `overflow-x: clip` en `tests/e2e/mobile-preinscription.spec.ts`).
  - Se agregó `tests/e2e/admin-session.spec.ts` (siembra una fila en `admin_sessions`, fija la cookie `flacso_admin_session`, verifica `/admin/perfiles` autenticado sin código de prueba en la app y limpia la fila en `finally`).
  - **Desvío menor aprobado durante el incremento:** al ejecutar `pnpm e2e` por primera vez fallaron 6 pruebas preexistentes porque el contrato `canonical-forms.ts` fijó `titulo.maxFiles = 2` (en pantalla muestra `"1 de 2 archivos cargados"`) y `aceptaComunicaciones` obligatorio; se actualizaron `tests/e2e/document-flow.spec.ts` y `tests/e2e/preinscriptions.spec.ts`.
- **Verificaciones ejecutadas:**
  - `pnpm --filter @flacso/contracts build`, `pnpm typecheck`, `pnpm build`: en verde.
  - `pnpm test` contra PostgreSQL 16 desechable (`flacso-e1-pg`, `PREINSCRIPTIONS_TEST_DATABASE_URL`): `apps/api` 95 suites en verde con las 13 de integración reales activas (741 tests en verde, 2 saltados); `apps/web` 37 suites y 181 tests en verde.
  - `pnpm e2e` contra el mismo PostgreSQL 16 (tras instalar Chromium de Playwright): 14/14 pruebas en verde.
- **Pendiente de E1:** Incrementos 3 (`@vitest/coverage-v8`, candado, `tsconfig.build.json` y líneas base de cobertura y rendimiento), 4 (`ci.yml` completa) y 5 (`deploy-production.sh`), además de probar `pnpm e2e` contra las imágenes Docker construidas (se verifica en Incremento 4).

### 2026-11-21 14:18 -03:00 — E1 / Incremento 1: Retiro del worker duplicado e inicio de bitácora
- **Quién:** Antigravity (planificación y ejecución), sobre decisiones confirmadas por Iván Arriola.
- **Rama:** `epica/e1-base-calidad` (desde `epica/e0-hotfixes` `96ee2cf`)
- **Qué se hizo:**
  - Se eliminó `apps/api/src/worker-notifications.ts` (se conserva `apps/api/src/worker-recovery.test.ts`, que prueba `TelegramRecoveryAlertDispatcher` y `cleanupExpiredRecoveries`).
  - Se eliminó el script `"worker:notifications"` de `apps/api/package.json`.
  - Se eliminó el servicio `notification-worker` de `docker-compose.yml`.
  - Se actualizaron las referencias operativas vigentes en `docs/SES-NOTIFICACIONES.md`, `docs/MAUTIC.md`, `docs/DEPLOY.md`, `docs/TELEGRAM-Y-PLANILLAS.md` y `docs/ARQUITECTURA.md` (los documentos históricos en `docs/superpowers/` y `docs/AUDITORIA-2026-10-24.md` quedan intactos).
  - Se creó esta bitácora (`docs/plans/bitacora.md`) y se enlazó desde `docs/plans/plan-maestro.md`.
- **Verificaciones ejecutadas:**
  - `git grep -n "worker-notifications\|notification-worker\|worker:notifications"`: solo permanecen menciones en documentos históricos y en `docs/plans/plan-maestro.md`.
  - `docker compose -f docker-compose.yml config --quiet` y `docker compose --env-file .env.production.example -f deploy/docker-compose.production.yml config --quiet`: en verde.
  - `pnpm --filter @flacso/contracts build`, `pnpm typecheck`, `pnpm build`: en verde.
  - `pnpm test` (sin PostgreSQL de pruebas): `apps/api` 82 suites en verde y 13 saltadas por falta de `PREINSCRIPTIONS_TEST_DATABASE_URL` (679 tests en verde, 68 saltados); `apps/web` 37 suites y 181 tests en verde.
- **Pendiente de E1:** Incrementos 2 (`AGENTS.md`, `html-entities`, tests obsoletos y e2e), 3 (`@vitest/coverage-v8`, candado y líneas base), 4 (`ci.yml` completa con PostgreSQL 16) y 5 (`deploy-production.sh` con `--rollback`, CI verde y prueba de humo), además de las pruebas de integración con PostgreSQL 16 y las acciones de GitHub del usuario.

### 2026-11-21 13:48 -03:00 — E0: Hotfixes inmediatos y Plan maestro v3 (referencia)
- **Quién:** Iván Arriola y Claude (autoría y commits en `epica/e0-hotfixes`); auditorías y revisiones técnicas previas con aporte de Claude, Codex y Antigravity.
- **Rama:** `epica/e0-hotfixes` (`e5b139a` .. `96ee2cf`, 6 commits locales sin fusionar aún a `main`)
- **Qué se hizo:**
  - `e5b139a`, `96ee2cf`: incorporación y actualización del plan maestro v3 (`docs/plans/plan-maestro.md`) orientado a integración continua y entrega siempre lista.
  - `96ad0f7`: orden de importación CSS en `main.tsx`, reparación de selectores con doble escape y estilos de botones/modal en panel admin y tarjetas públicas.
  - `72f71f1`: preservación de mensajes de error en tarjetas Drive/Telegram y eliminación de provisión automática al abrir la pestaña de planillas.
  - `75a7ae2`: rechazo temprano de envíos con archivos sin sesión (`submission-routes.ts`) y eliminación de parseo manual de cookies redundante en `admin-session.ts` y `admin-auth-routes.ts`.
  - `a496b2d`: permisos `700`/`600` (`umask 077`) en volcados de base de `scripts/deploy-production.sh`.
- **Nota de relevo:** El e2e `tests/e2e/mobile-preinscription.spec.ts` quedó con aserción vieja (`overflow-x: hidden` vs `clip`); se corrige en E1 / Incremento 2.
