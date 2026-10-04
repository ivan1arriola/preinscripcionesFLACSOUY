# Entrega completa de Preinscripciones FLACSO UY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar `preinscripcionesFLACSOUY` entregable, probado y publicable, cerrando la transición a formularios canónicos y documentando por separado cualquier operación productiva que requiera credenciales o aprobación.

**Architecture:** El formulario canónico será la única fuente operativa para composición y validación; se conservarán tablas y snapshots históricos. Las integraciones seguirán aisladas por puertos y repositorios, con outbox persistente para SES y un deploy independiente de la plataforma legacy.

**Tech Stack:** TypeScript, Node.js, Express, React, Vite, PostgreSQL, Kysely, Zod, Google Drive/Sheets, Amazon SES, Docker Compose, Vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-entrega-completa-preinscripciones-design.md`

## Global Constraints

- Preservar los cambios modificados y no versionados existentes hasta clasificarlos.
- No eliminar solicitudes históricas ni tablas antiguas de perfiles.
- WordPress sigue siendo la fuente de verdad de catálogo, apertura, convenios, orientaciones y menciones.
- Formularios definidos en código; Maestría agrega exactamente dos cartas obligatorias.
- Residencia usa país y ciudad, no domicilio completo.
- No versionar secretos, datos personales ni credenciales reales.
- No cambiar Apache, DNS ni el dominio público durante la implementación.
- Cada lote debe pasar sus pruebas antes de avanzar.

## Review Focus

- Una ruta pública no debe depender de un perfil editable ni aceptar una revisión inconsistente.
- Un formulario de Maestría debe rechazar una o ambas cartas faltantes; un Seminario no debe mostrarlas.
- Un token de archivo de otra sesión, destino o campo debe rechazarse sin filtrar metadatos.
- Un reintento posterior a Drive/Sheets no debe duplicar archivos ni la preinscripción.
- SES debe deduplicar destinatarios y dejar reintentables los fallos sin bloquear el `201` de la preinscripción.

---

### Task 1: Clasificar cambios locales y preparar el ledger

**Files:**
- Inspect: working tree, `git log`, `origin/main`, current plans.
- Create: `.superpowers/sdd/2026-10-04-entrega-completa-preinscripciones/progress.md`.
- Modify: none in product code.

**Interfaces:**
- Produces: inventario de cambios intencionales, commits locales y archivos que no deben tocarse.

- [ ] **Step 1: Registrar baseline**

  Ejecutar `git status --short --branch`, `git log --oneline origin/main..HEAD` y revisar el diff de cada archivo modificado.

- [ ] **Step 2: Clasificar cambios**

  Separar cambios ya implementados, cambios incompletos y cambios ajenos; ningún archivo será descartado ni sobrescrito.

- [ ] **Step 3: Crear ledger**

  Registrar baseline, interfaces compartidas y rulings necesarios para continuar.

- [ ] **Step 4: Verificar**

  Confirmar que el árbol sigue idéntico salvo el spec y este plan.

### Task 2: Completar la transición a formularios canónicos

**Files:**
- Modify: `apps/api/src/application/get-target-form.ts`.
- Modify: `apps/api/src/application/submit-preinscription.ts`.
- Modify: `apps/api/src/presentation/http/app.ts` and `apps/api/src/main.ts`.
- Modify: `apps/api/src/presentation/http/target-routes.ts` and submission routes/tests.
- Modify: `apps/web/src/App.tsx`, `apps/web/src/api/client.ts` and admin navigation.
- Delete only if unused: editable profile route/editor consumers, preserving migrations and historical repositories.
- Test: canonical, application, HTTP, auth and web tests.

**Interfaces:**
- Consumes: `getCanonicalFormDefinition(target, agreements)` and `CANONICAL_SCHEMA_VERSION`.
- Produces: profile-free public form composition and submission; historical profile data remains readable.

- [ ] **Step 1: Add failing regression tests**

  Assert that public form and submission paths work with no profile repository, profile routes are not operational, and historical snapshots remain readable.

- [ ] **Step 2: Run the focused tests and observe the expected failure**

  Run the API and web tests named above; failure must identify the remaining profile dependency or route.

- [ ] **Step 3: Remove operational profile dependencies**

  Stop constructing/injecting profile repositories in public composition and submission. Keep tables, migrations and read-only historical compatibility where required.

- [ ] **Step 4: Remove editable profile navigation and routes**

  Preserve admin authentication, Drive, Sheets and SES settings; remove only profile editing behavior required by the canonical design.

- [ ] **Step 5: Run the full suite**

  `pnpm test` must pass with the canonical regression coverage.

### Task 3: Close document and upload acceptance gaps

**Files:**
- Inspect/modify: `packages/contracts/src/canonical-forms.ts`.
- Inspect/modify: `apps/api/src/domain/document-rules.ts`, `form-validation.ts` and upload/submission routes.
- Inspect/modify: `apps/web/src/components/DocumentUploadFields.tsx`, `TitleDocumentFields.tsx`, `PreinscriptionWizard.tsx` and tests.
- Add/modify: document-flow integration tests.

**Interfaces:**
- Consumes: canonical form definitions and temporary upload ownership repository.
- Produces: consistent document matrix, mandatory files, title absence alternative, session-bound deletion and idempotent submission orchestration.

- [ ] **Step 1: Add failing tests for all document matrices**

  Cover regular offer, Maestría and Seminario; assert no `escolaridad`, correct title fields, exact recommendation behavior and mandatory common documents.

- [ ] **Step 2: Add failing ownership/idempotency cases**

  Cover foreign token, mismatched field, expired session and retry after a partial external failure.

- [ ] **Step 3: Implement the smallest contract and orchestration fixes**

  Keep validation in the domain/API and rendering driven by the returned contract.

- [ ] **Step 4: Run focused API/web/integration tests**

  All document and upload tests must pass before proceeding.

### Task 4: Verify and harden integrations and notifications

**Files:**
- Inspect/modify: WordPress client/catalog and contracts.
- Inspect/modify: Drive/Sheets repositories, reconciliation service and migrations.
- Inspect/modify: SES adapter, encrypted settings, outbox repository, worker and admin observability routes/UI.
- Modify: integration fixtures and operational documentation.

**Interfaces:**
- Consumes: canonical submission result and target notification metadata.
- Produces: safe reconciliation, additive headers, direct links, deduplicated notification jobs, retry/unknown handling and redacted diagnostics.

- [ ] **Step 1: Add missing regression tests**

  Cover removed/reordered Sheets headers, pre-existing Drive folders/sheets, missing notification email, duplicate recipients, failed SES delivery and unknown delivery confirmation.

- [ ] **Step 2: Run tests to establish any remaining failures**

  Use focused API suites for WordPress, Google, reconciliation, encrypted settings and notifications.

- [ ] **Step 3: Implement only the uncovered behavior**

  Preserve existing data and make all external operations idempotent or explicitly stateful.

- [ ] **Step 4: Run the complete test suite**

  `pnpm test` must pass with no new failures.

### Task 5: Make local and production operation reproducible

**Files:**
- Modify: `docker-compose.yml` and `deploy/docker-compose.production.yml`.
- Modify: `scripts/deploy-production.sh`.
- Modify: `docs/DEPLOY.md`, `README.md`, `docs/SES-NOTIFICACIONES.md` and operational docs.
- Add tests or shell checks where practical.

**Interfaces:**
- Consumes: build artifacts, health endpoint, environment contract and secret paths.
- Produces: check/dry-run deploy path, backup/rollback instructions, health checks and explicit separation from legacy Apache routing.

- [ ] **Step 1: Validate Compose and environment contracts**

  Run `docker compose config` with non-secret example values and verify required production variables fail closed.

- [ ] **Step 2: Add operational checks**

  Ensure deploy refuses dirty trees, resolves an explicit SHA, creates backups before changing services, verifies API/web health and records rollback metadata.

- [ ] **Step 3: Document external prerequisites**

  Document Google credentials, SES identity/Sandbox status, encrypted settings, service account permissions, backup restore and the no-cutover default.

- [ ] **Step 4: Run local operation checks**

  `pnpm typecheck`, `pnpm build`, Compose config and deploy `--check` must pass without contacting production.

### Task 6: End-to-end verification and release audit

**Files:**
- Inspect/modify: `tests/e2e/*.spec.ts`, `playwright.config.ts` and test fixtures.
- Modify: relevant README/plan status documentation.

**Interfaces:**
- Consumes: completed public routes and local Compose stack.
- Produces: evidence for target selection, canonical form, uploads, confirmation and legacy permalink compatibility.

- [ ] **Step 1: Add or repair E2E coverage**

  Cover public home, target, form steps, document upload, review/confirmation and legacy registration route.

- [ ] **Step 2: Run E2E against a disposable local stack**

  Record the command, browser result and any environment limitation; do not create production data.

- [ ] **Step 3: Run final verification**

  Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`, Compose config and E2E.

- [ ] **Step 4: Audit secrets and residual profile consumers**

  Search tracked files for credential material and operational profile dependencies; review the complete diff.

### Task 7: Publish and hand off

**Files:**
- Modify: plan checkboxes/status documentation only after evidence exists.

**Interfaces:**
- Consumes: final verified commit and clean intentional working tree.
- Produces: descriptive commit(s), `origin/main` publication, CI status, deploy status and production health status reported separately.

- [ ] **Step 1: Commit the coherent implementation**

  Include only classified intended changes, the spec, plan updates and product changes; never include secrets or unrelated work.

- [ ] **Step 2: Push `main`**

  Publish the exact SHA after local verification. Do not force-push.

- [ ] **Step 3: Verify CI and deployment**

  Inspect the workflow result and, if explicitly authorized with credentials available, run the isolated production deploy with backup and health checks.

- [ ] **Step 4: Report final state**

  State separately: local validation, publication, CI, deployment, public health, SES real-delivery readiness and whether Apache/DNS cutover happened.
