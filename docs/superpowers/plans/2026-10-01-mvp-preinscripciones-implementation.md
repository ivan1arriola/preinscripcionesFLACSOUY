# MVP de Preinscripciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un MVP Dockerizado con React y Node.js, completamente TypeScript, que descubra formularios desde fixtures simuladas de WordPress, los valide y registre envíos en PostgreSQL normalizado en 3FN.

**Architecture:** Monorepo TypeScript con `apps/web` para React y `apps/api` para Express. El backend se divide en presentación HTTP, aplicación, dominio puro, puertos e infraestructura; `FixtureAcademicCatalog` simula WordPress y `PostgresSubmissionRepository` implementa la persistencia mediante Kysely. Docker Compose ejecuta web, API y PostgreSQL.

**Tech Stack:** TypeScript, React, Vite, Node.js, Express, Zod, Kysely, PostgreSQL, Docker Compose, Vitest, React Testing Library y Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-mvp-preinscripciones-design.md`

## Global Constraints

- Todo el código de aplicación, pruebas, scripts y adaptadores será TypeScript; los datos de fixtures podrán ser JSON.
- La ejecución local será mediante Docker Compose con frontend, API y PostgreSQL.
- La arquitectura será por capas: Presentación, Aplicación, Dominio, Puertos e Infraestructura.
- Las funciones del dominio serán puras y no dependerán de HTTP, filesystem, reloj, variables de entorno ni base de datos.
- PostgreSQL será la persistencia del MVP y su modelo deberá cumplir tercera forma normal.
- React consumirá únicamente la API propia.
- La API volverá a consultar y validar el catálogo durante cada envío.
- No se implementarán todavía WordPress real, Google Sheets, Google Drive, archivos reales ni panel administrativo.
- No se expondrán secretos ni datos sensibles en errores o fixtures.

## Review Focus

- Un destino cerrado o incompatible debe aparecer, pero nunca aceptar envíos: prueba en Task 3 y Task 5.
- Una mención perteneciente a otra orientación debe rechazarse: prueba en Task 2.
- Una clave de input desconocida debe producir diagnóstico de incompatibilidad, no un control genérico: prueba en Task 2 y Task 3.
- Un envío válido debe persistirse sin perder campos ni depender del orden del formulario: prueba en Task 4 y Task 5.
- Un contenedor iniciado sin PostgreSQL disponible debe devolver un estado de salud no listo sin filtrar credenciales: prueba en Task 1 y Task 7.

### Task 1: Bootstrap del monorepo TypeScript y Docker

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `docker-compose.yml`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `apps/api/src/presentation/http/health.ts`
- Create: `apps/api/src/main.ts`
- Test: `apps/api/src/presentation/http/health.test.ts`

**Interfaces:**
- Produces `GET /api/health`, returning `{ status: "ok" }` when the API process is alive and a non-secret readiness result when PostgreSQL is unavailable.
- Produces workspace scripts `test`, `lint`, `typecheck`, `build` and `compose:up`.

- [ ] **Step 1: Write the failing health test**

  Create `health.test.ts` asserting that `healthResponse({ database: "up" })` returns `{ status: "ok", database: "up" }` and `healthResponse({ database: "down" })` returns `{ status: "degraded", database: "down" }` without including connection details.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `pnpm --filter api test -- health.test.ts`
  Expected: FAIL because the health module does not exist.

- [ ] **Step 3: Implement the workspace and Docker skeleton**

  Add package scripts, shared strict compiler settings, Vite configuration, Dockerfiles and Compose services. Implement `healthResponse(status: { database: "up" | "down" })` and wire `GET /api/health` in the Express bootstrap.

- [ ] **Step 4: Run the focused test and static checks**

  Run: `pnpm --filter api test -- health.test.ts && pnpm typecheck`
  Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Verify the Compose configuration**

  Run: `docker compose config`
  Expected: valid configuration containing `web`, `api`, `postgres` and a named PostgreSQL volume.

- [ ] **Step 6: Commit the bootstrap**

  ```bash
  git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore apps packages docker-compose.yml
  git commit -m "feat: bootstrap Docker TypeScript monorepo"
  ```

### Task 2: Dominio puro y contratos compartidos

**Files:**
- Create: `packages/contracts/src/catalog.ts`
- Create: `packages/contracts/src/submissions.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `apps/api/src/domain/form-definition.ts`
- Create: `apps/api/src/domain/form-composition.ts`
- Create: `apps/api/src/domain/form-validation.ts`
- Create: `apps/api/src/domain/diagnostics.ts`
- Create: `apps/api/src/domain/form-composition.test.ts`
- Create: `apps/api/src/domain/form-validation.test.ts`
- Create: `apps/api/src/domain/diagnostics.test.ts`

**Interfaces:**
- `InputDefinition = { key: string; label: string; required: boolean }`.
- `FormDefinition = { targetId: string; inputs: InputDefinition[]; orientations: Orientation[] }`.
- `Orientation = { id: string; name: string; mentions: Mention[] }`.
- `composeForm(universalInputs, configuredInputs): Result<FormDefinition, DomainError>`.
- `validateSubmission(form, values): ValidationResult`.
- `diagnoseTarget(target, supportedInputKeys): DiagnosticResult`.
- `ValidationResult = { valid: boolean; fieldErrors: Record<string, string[]> }`.

- [ ] **Step 1: Write tests for pure composition**

  Assert that universal inputs precede configured inputs according to the configured `position`, duplicate keys are rejected, and an unknown configured key returns an incompatibility error.

- [ ] **Step 2: Write tests for pure validation**

  Assert required values are enforced, optional empty values pass, and a mention not contained in the selected orientation is rejected.

- [ ] **Step 3: Write tests for pure diagnostics**

  Assert a target with an unknown input is `incompatible` and a target with all supported inputs is `operational`.

- [ ] **Step 4: Run the domain tests and verify they fail**

  Run: `pnpm --filter api test -- src/domain`
  Expected: FAIL because the pure functions are not implemented.

- [ ] **Step 5: Implement the shared contracts and pure domain functions**

  Keep all functions deterministic and side-effect free. Do not import Express, Kysely, filesystem modules or environment access from `src/domain`.

- [ ] **Step 6: Run tests and typecheck**

  Run: `pnpm --filter api test -- src/domain && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 7: Commit the domain layer**

  ```bash
  git add packages/contracts apps/api/src/domain
  git commit -m "feat: add pure form domain and shared contracts"
  ```

### Task 3: Fixtures de WordPress y casos de uso de catálogo

**Files:**
- Create: `apps/api/src/fixtures/wordpress-preinscriptions.json`
- Create: `apps/api/src/ports/academic-catalog.ts`
- Create: `apps/api/src/application/discover-targets.ts`
- Create: `apps/api/src/application/get-target-form.ts`
- Create: `apps/api/src/infrastructure/fixtures/fixture-academic-catalog.ts`
- Create: `apps/api/src/application/catalog.test.ts`

**Interfaces:**
- `AcademicCatalog.listTargets(): Promise<AcademicTarget[]>`.
- `AcademicCatalog.getTarget(id: string): Promise<AcademicTarget | null>`.
- `AcademicCatalog.revalidateTarget(id: string): Promise<AcademicTarget | null>`.
- `discoverTargets(catalog): Promise<DiagnosticTarget[]>`.
- `getTargetForm(catalog, targetId): Promise<FormDefinition | CatalogFailure>`.

- [ ] **Step 1: Write catalog tests against fixture data**

  Assert the fixture catalog returns an open academic offer, a closed offer, an open seminar, related orientation/mention data, and an incompatible target with an unknown input.

- [ ] **Step 2: Run the catalog tests and verify they fail**

  Run: `pnpm --filter api test -- src/application/catalog.test.ts`
  Expected: FAIL because the fixture adapter and use cases do not exist.

- [ ] **Step 3: Add the fixture contract and adapter**

  Define `FixtureAcademicCatalog` to parse the JSON fixture into the shared contracts. It must not expose the raw fixture shape to callers.

- [ ] **Step 4: Implement catalog use cases**

  `discoverTargets` must compose forms and diagnostics using Task 2 pure functions. `getTargetForm` must return an explicit incompatibility result for unknown inputs rather than silently omitting them.

- [ ] **Step 5: Run tests and typecheck**

  Run: `pnpm --filter api test -- src/application/catalog.test.ts && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit the simulated catalog**

  ```bash
  git add apps/api/src/fixtures apps/api/src/ports apps/api/src/application
  git commit -m "feat: add simulated WordPress catalog"
  ```

### Task 4: PostgreSQL 3FN y repositorio de envíos

**Files:**
- Create: `apps/api/src/infrastructure/database/kysely.ts`
- Create: `apps/api/src/infrastructure/database/migrations/001_initial_schema.ts`
- Create: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/ports/submission-repository.ts`
- Create: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Create: `apps/api/src/application/submit-preinscription.ts`
- Create: `apps/api/src/infrastructure/database/postgres-submission-repository.test.ts`
- Create: `apps/api/src/application/submit-preinscription.test.ts`

**Interfaces:**
- `SubmissionRepository.save(submission: ValidatedSubmission): Promise<{ id: string }>`.
- `submitPreinscription(catalog, repository, command): Promise<SubmissionResult>`.
- `ValidatedSubmission = { targetId: string; values: Record<string, string> }`.

- [ ] **Step 1: Write the repository integration test**

  Against PostgreSQL in Compose, assert a valid submission creates one row in `submissions` and one row per submitted field in `submission_values`, with foreign keys and unique constraints enforced.

- [ ] **Step 2: Write the application test with an in-memory repository**

  Assert the use case revalidates the target, rejects a closed target and persists a valid submission without depending on field order.

- [ ] **Step 3: Run tests and verify they fail**

  Run: `pnpm --filter api test -- src/infrastructure/database/postgres-submission-repository.test.ts src/application/submit-preinscription.test.ts`
  Expected: FAIL because the schema, repository and use case do not exist.

- [ ] **Step 4: Implement the normalized Kysely migration**

  Create separate tables for targets, input definitions, target inputs, orientations, mentions, orientation/mention relations, submissions and submission values. Add primary keys, foreign keys, uniqueness constraints and check constraints without storing repeated lists or derived values.

  Since the catalog source is fixture-based and not persisted as an independent academic source of truth, the submission use case will upsert a minimal target snapshot and the referenced input definitions before inserting the submission. This snapshot is technical traceability only; it must not become an editable academic catalog.

- [ ] **Step 5: Implement the PostgreSQL repository and submission use case**

  The repository handles only persistence. The use case calls `catalog.revalidateTarget`, invokes the pure validator, and then calls the repository. It must never write a submission for a closed or incompatible target.

- [ ] **Step 6: Run database and application tests**

  Run: `docker compose up -d postgres && pnpm --filter api db:migrate && pnpm --filter api test -- src/infrastructure/database/postgres-submission-repository.test.ts src/application/submit-preinscription.test.ts`
  Expected: PASS.

- [ ] **Step 7: Commit the database layer**

  ```bash
  git add apps/api/src/infrastructure/database apps/api/src/ports/submission-repository.ts apps/api/src/application/submit-preinscription.ts
  git commit -m "feat: persist simulated submissions in normalized PostgreSQL"
  ```

### Task 5: API HTTP por capas

**Files:**
- Create: `apps/api/src/presentation/http/app.ts`
- Create: `apps/api/src/presentation/http/target-routes.ts`
- Create: `apps/api/src/presentation/http/submission-routes.ts`
- Create: `apps/api/src/presentation/http/error-handler.ts`
- Create: `apps/api/src/presentation/http/target-routes.test.ts`
- Create: `apps/api/src/presentation/http/submission-routes.test.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- `GET /api/targets` returns `{ targets: DiagnosticTarget[] }`.
- `GET /api/targets/:id` returns `FormDefinition` or 404/409 for missing or incompatible targets.
- `POST /api/targets/:id/submissions` accepts `{ values: Record<string, string> }` and returns `{ submissionId: string }` on success.
- `createApp(dependencies: AppDependencies): Express` wires ports and use cases without constructing infrastructure inside route handlers.

- [ ] **Step 1: Write route tests**

  Assert list, detail, open submission, closed submission, unknown target, incompatible target and field validation responses. Assert error responses contain no connection string or secret.

- [ ] **Step 2: Run route tests and verify they fail**

  Run: `pnpm --filter api test -- src/presentation/http`
  Expected: FAIL because the HTTP application and routes do not exist.

- [ ] **Step 3: Implement dependency injection and routes**

  Build `createApp` from `AcademicCatalog` and `SubmissionRepository` ports. Parse request bodies with Zod, call application use cases, map domain failures to stable HTTP statuses, and keep business rules out of Express handlers.

- [ ] **Step 4: Run route tests and API typecheck**

  Run: `pnpm --filter api test -- src/presentation/http && pnpm --filter api typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit the API**

  ```bash
  git add apps/api/src/presentation/http apps/api/src/main.ts
  git commit -m "feat: expose layered preinscription API"
  ```

### Task 6: React frontend y formularios dinámicos

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/TargetList.tsx`
- Create: `apps/web/src/components/DynamicForm.tsx`
- Create: `apps/web/src/components/OrientationMentionFields.tsx`
- Create: `apps/web/src/pages/HomePage.tsx`
- Create: `apps/web/src/pages/TargetPage.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/components/DynamicForm.test.tsx`
- Create: `apps/web/src/pages/HomePage.test.tsx`
- Create: `apps/web/src/pages/TargetPage.test.tsx`

**Interfaces:**
- `apiClient.listTargets(): Promise<DiagnosticTarget[]>`.
- `apiClient.getTarget(id: string): Promise<FormDefinition>`.
- `apiClient.submit(id: string, values: Record<string, string>): Promise<{ submissionId: string }>`.
- `DynamicForm` receives a `FormDefinition` and emits values only; it does not import backend modules or fixtures.

- [ ] **Step 1: Write component tests**

  Assert open and closed target rendering, dynamic required fields, dependent mention options, client-side required validation, incompatible-target messaging and successful confirmation after a mocked API response.

- [ ] **Step 2: Run frontend tests and verify they fail**

  Run: `pnpm --filter web test`
  Expected: FAIL because the React components do not exist.

- [ ] **Step 3: Implement the typed API client and pages**

  Render only the fields returned by the backend. Disable submit for closed or incompatible targets. When orientation changes, clear an invalid selected mention. Keep presentation state in React and rules in the backend/domain.

- [ ] **Step 4: Run frontend tests, lint and build**

  Run: `pnpm --filter web test && pnpm --filter web lint && pnpm --filter web build`
  Expected: PASS.

- [ ] **Step 5: Commit the frontend**

  ```bash
  git add apps/web/src
  git commit -m "feat: add React dynamic preinscription forms"
  ```

### Task 7: Integración Docker y verificación end-to-end

**Files:**
- Create: `tests/e2e/preinscriptions.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/web/Dockerfile`
- Modify: `README.md`
- Create: `docs/MVP.md`

**Interfaces:**
- Browser flow: home → open target → dynamic form → validation → successful simulated submission.
- Operational flow: `docker compose up --build` → health endpoint → browser verification.

- [ ] **Step 1: Write the Playwright end-to-end test**

  Assert the browser can list fixtures, open the academic offer, see its configured fields, select an orientation and valid mention, submit a valid payload, and see a confirmation. Also assert the closed target cannot submit.

- [ ] **Step 2: Run the E2E test and verify it fails**

  Run: `pnpm e2e`
  Expected: FAIL until both containers, API routes and React pages are integrated.

- [ ] **Step 3: Complete Compose wiring**

  Add health checks, service dependencies, internal API URL configuration, PostgreSQL environment variables and a named volume. Keep credentials in local Compose defaults or environment variables that are not committed.

- [ ] **Step 4: Document local operation**

  Document prerequisites, `docker compose up --build`, migrations, test commands, API health, fixture replacement points and the explicit non-scope of real external integrations.

- [ ] **Step 5: Run the full verification suite**

  Run:

  ```bash
  docker compose up -d --build
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm e2e
  curl --fail http://localhost:3000/api/health
  git diff --check
  ```

  Expected: all commands pass; the browser flow reaches confirmation; the health endpoint returns a non-secret healthy response.

- [ ] **Step 6: Commit the integrated MVP**

  ```bash
  git add docker-compose.yml apps/api/Dockerfile apps/web/Dockerfile tests/e2e README.md docs/MVP.md
  git commit -m "feat: integrate Dockerized preinscriptions MVP"
  ```

## Handoff

After the plan is approved, choose one execution method:

- **Subagent-driven:** each task is implemented and reviewed independently.
- **Native:** one agent implements all tasks and performs a final review.

The recommended method is **Native**, because the tasks share TypeScript contracts and layered interfaces, and a single implementation pass will reduce coordination overhead while the final end-to-end suite checks the complete flow.
