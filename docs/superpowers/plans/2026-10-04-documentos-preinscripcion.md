# Documentos de preinscripción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar el formulario documental de ofertas y seminarios, conservar los archivos durante el asistente y enviarlos a Drive y Sheets sólo al confirmar la preinscripción.

**Architecture:** El dominio canónico definirá documentos, alternativas y reglas por tipo de propuesta. La API validará destino, sesión, archivos y estados de procesamiento; PostgreSQL conservará metadatos e idempotencia, mientras el volumen mantiene los binarios temporales. React renderizará el bloque de título y las elecciones de recomendaciones a partir del contrato, sin duplicar reglas.

**Tech Stack:** TypeScript, React 18, Express, Zod, Kysely, PostgreSQL, Google Drive API, Google Sheets API, Vitest, Testing Library, Playwright y Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-04-documentos-preinscripcion-design.md`

## Global Constraints

- `Escolaridad` no forma parte del formulario.
- Identidad y CV son obligatorios en ofertas y seminarios.
- El título exige denominación y archivo, o `sinTituloActual=Si`.
- La carta de motivación es obligatoria en ofertas y no corresponde a seminarios.
- Las cartas de recomendación sólo corresponden a maestrías y permiten “Adjuntar ahora” o “Adjuntar posteriormente”.
- Cada archivo admite 10 MiB; la suma por preinscripción admite 25 MiB.
- Los temporales se eliminan sólo después de confirmar Drive y Sheets.
- No se agrega una pantalla de carga posterior; las recomendaciones pendientes se gestionan por correo.
- Los cambios se implementan en `/home/ivan/repositorios/FLACSO Uruguay/preinscripcionesFLACSOUY`, sobre `main`, preservando cambios ajenos.

## Review Focus

- El título marcado como ausente no puede conservar denominación ni token de archivo. Test: `titleAbsenceToggleClearsCompanionAndRejectsFiles` en la suite de dominio y `rendersReversibleTitleAbsenceToggle` en la suite web.
- Una recomendación pendiente no puede enviar un archivo y una recomendación cargada no puede quedar marcada pendiente. Test: `validateRecommendationCompletionChoices` en dominio.
- Un token de otra sesión o de otro campo no puede entrar al envío. Test: `rejectsForeignOrMismatchedUploadTokens` en las rutas HTTP.
- Un fallo después de Drive no puede crear otra preinscripción ni subir de nuevo un archivo confirmado. Test: `retriesSubmissionWithoutDuplicateDriveFiles` en la suite de procesamiento.
- Seminarios no deben mostrar ni validar motivación o recomendaciones. Test: `canonicalDocumentsForSeminarExcludeLetters` en dominio y `rendersOnlySeminarDocuments` en web.

---

### Task 1: Contrato documental y reglas puras

**Files:**
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `packages/contracts/src/canonical-forms.ts`
- Modify: `apps/api/src/domain/form-validation.ts`
- Create: `apps/api/src/domain/document-rules.test.ts`
- Modify: `apps/api/src/domain/canonical-forms.test.ts`
- Modify: `apps/api/src/domain/form-validation.test.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`

**Interfaces:**
- `DocumentDefinition` produce `companionInputKey?: string` y `alternative?: { kind: 'absence' | 'defer'; valueKey: string; activeValue: 'Si'; label: string }`.
- `getCanonicalFormDefinition(target, agreements)` produce `tituloDenominacion`, `sinTituloActual`, la matriz documental y `canDefer`/alternativas correctas por oferta.
- `validateSubmission(form, values, configRevision)` valida título ausente, título cargado y estados de recomendación.

- [ ] **Step 1: Write the failing tests**
  - Add tests for the three document matrices.
  - Assert that `escolaridad` is absent and `tituloDenominacion` is present.
  - Assert the valid and invalid combinations of title declaration and recommendation choices.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter api test -- src/domain/document-rules.test.ts src/domain/canonical-forms.test.ts src/domain/form-validation.test.ts`

  Expected: FAIL because the current canonical form still publishes `escolaridad` and uses `titulo` for the text input.

- [ ] **Step 3: Implement the canonical contract and pure rules**
  - Rename the text input key to `tituloDenominacion`.
  - Remove `escolaridad`.
  - Add the exact alternatives from the spec.
  - Compose motivation only for non-seminars and recommendations only for `maestria`.
  - Make the application validation reject contradictory values and missing mandatory files.
  - Keep `titulo` as the file field key.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter api test -- src/domain/document-rules.test.ts src/domain/canonical-forms.test.ts src/domain/form-validation.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/contracts/src apps/api/src/domain apps/api/src/application/submit-preinscription.ts
  git commit -m "feat: definir reglas documentales canónicas"
  ```

### Task 2: Metadatos temporales y validación de carga

**Files:**
- Modify: `apps/api/src/ports/file-storage.ts`
- Modify: `apps/api/src/infrastructure/files/temporary-file-storage.ts`
- Create: `apps/api/src/ports/temporary-upload-repository.ts`
- Create: `apps/api/src/infrastructure/database/postgres-temporary-upload-repository.ts`
- Create: `apps/api/src/infrastructure/database/migrations/009_temporary_uploads.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Modify: `apps/api/src/presentation/http/upload-routes.ts`
- Modify: `apps/api/src/presentation/http/upload-routes.test.ts`
- Create: `apps/api/src/infrastructure/database/postgres-temporary-upload-repository.test.ts`

**Interfaces:**
- `TemporaryUploadRepository.create(record)`, `get(token, sessionId)`, `touch(sessionId)`, `remove(token, sessionId)`, `listExpired(before)` and `deleteMetadata(token)`.
- `createUploadRoutes(storage, catalog)` validates `targetId` and `fieldKey` against `getCanonicalFormDefinition` before saving.
- `DELETE /api/uploads/:token` removes only a token belonging to `x-preinscription-session`.

- [ ] **Step 1: Write the failing tests**
  - Cover metadata persistence and session ownership.
  - Cover unsupported field, wrong target, MIME, size, max-files and total-size errors.
  - Cover deletion of an owned token, rejection of a foreign token and cleanup after 30 minutes.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter api test -- src/presentation/http/upload-routes.test.ts src/infrastructure/database/postgres-temporary-upload-repository.test.ts`

  Expected: FAIL because uploads currently validate only global MIME/size and store metadata in the filesystem.

- [ ] **Step 3: Implement database-backed metadata and upload routes**
  - Add migration `009_temporary_uploads` with token, session, field, original name, MIME, size, timestamps and unique token.
  - Keep binary payloads in the configured volume with restrictive permissions.
  - Make `TemporaryFileStorage` read ownership and timestamps through the repository.
  - Add target-aware upload validation and the authenticated delete route.
  - Set the session TTL to 30 minutes and update activity after each valid upload.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter api test -- src/presentation/http/upload-routes.test.ts src/infrastructure/database/postgres-temporary-upload-repository.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/ports apps/api/src/infrastructure/files apps/api/src/infrastructure/database apps/api/src/presentation/http/upload-routes.ts apps/api/src/presentation/http/upload-routes.test.ts
  git commit -m "feat: validar y persistir cargas temporales"
  ```

### Task 3: Interfaz de documentación y estado reversible

**Files:**
- Create: `apps/web/src/components/TitleDocumentFields.tsx`
- Modify: `apps/web/src/components/DocumentUploadFields.tsx`
- Modify: `apps/web/src/components/FormStep.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/PreinscriptionWizard.test.tsx`
- Modify: `apps/web/src/components/DynamicForm.test.tsx`
- Create: `apps/web/src/components/TitleDocumentFields.test.tsx`

**Interfaces:**
- `TitleDocumentFields` receives `values`, `errors`, `files`, `disabled`, `onChange`, `onUpload`, `onFileToken` and `onRemoveToken`.
- `apiClient.removeUpload(token)` sends `DELETE /api/uploads/:token` with the current session header.
- `DocumentUploadFields` renders only the document definitions supplied by the canonical form and reports tokens through the existing callbacks.

- [ ] **Step 1: Write the failing tests**
  - Assert no `Escolaridad` field.
  - Assert title denomination and file input appear together.
  - Assert marking and unmarking the title alternative hides, cleans and restores both fields.
  - Assert recommendation choices switch between file input and “Adjuntar posteriormente”.
  - Assert the visible document set for offer, master and seminar forms.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter web test -- src/components/TitleDocumentFields.test.tsx src/components/PreinscriptionWizard.test.tsx src/components/DynamicForm.test.tsx`

  Expected: FAIL because the current wizard exposes `titulo` as a text input, has `escolaridad`, and does not render reversible alternatives.

- [ ] **Step 3: Implement the document UI**
  - Render the title text input and file input in one component.
  - Use a checked control for `sinTituloActual`; clear the companion value and token through `apiClient.removeUpload` when checked.
  - Render each recommendation as a reversible now/later choice.
  - Keep loading, upload and server errors next to their document.
  - Pass the canonical document definitions into the component; do not hard-code offer-type decisions in React.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter web test -- src/components/TitleDocumentFields.test.tsx src/components/PreinscriptionWizard.test.tsx src/components/DynamicForm.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/components apps/web/src/api/client.ts
  git commit -m "feat: completar interfaz documental del asistente"
  ```

### Task 4: Estados de envío, idempotencia y Drive

**Files:**
- Modify: `apps/api/src/ports/submission-repository.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/infrastructure/database/migrations/010_submission_idempotency.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Modify: `apps/api/src/ports/google-drive-repository.ts`
- Modify: `apps/api/src/infrastructure/google/google-drive-repository.ts`
- Modify: `apps/api/src/domain/google-drive-naming.ts`
- Modify: `apps/api/src/infrastructure/google/google-drive-repository.test.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.test.ts`

**Interfaces:**
- `ValidatedSubmissionRecord.clientSubmissionId` identifies a browser attempt.
- `SubmissionRepository.saveOrGet(record)` returns `{ id: string; existing: boolean }` and persists processing state.
- `SubmissionRepository.markProcessing(id, status, errorMessage?)` updates `submission_processing`.
- `SubmissionRepository.markFileStored(token, driveFileId)` and `markFileFailed(token, errorMessage)` update `submission_files`.
- `GoogleDriveRepositoryPort.storeSubmissionFiles` searches by `flacsoSubmissionId` and `flacsoFileToken` before uploading.

- [ ] **Step 1: Write the failing tests**
  - Assert repeated client submission IDs return the same submission.
  - Assert Drive uses `Preinscripciones/Documentación` as the parent hierarchy.
  - Assert a confirmed Drive file is not uploaded twice.
  - Assert Drive and file statuses are updated after success and failure.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter api test -- src/infrastructure/database/postgres-submission-repository.test.ts src/infrastructure/google/google-drive-repository.test.ts`

  Expected: FAIL because the repository always creates a new server-generated submission ID, does not update file statuses, and currently discards the `Preinscripciones` folder ID.

- [ ] **Step 3: Implement idempotent persistence and Drive lookup**
  - Add the unique client submission key and repository state methods.
  - Use the returned `Preinscripciones` folder ID before creating `Documentación`.
  - Query Drive app properties before uploading each token.
  - Store Drive IDs and status transitions in PostgreSQL.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter api test -- src/infrastructure/database/postgres-submission-repository.test.ts src/infrastructure/google/google-drive-repository.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/ports apps/api/src/infrastructure/database apps/api/src/infrastructure/google apps/api/src/domain/google-drive-naming.ts
  git commit -m "feat: hacer idempotente la persistencia documental"
  ```

### Task 5: Orquestación final Drive, Sheets y limpieza

**Files:**
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/presentation/http/submission-files.test.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/presentation/http/app.ts`

**Interfaces:**
- `POST /api/targets/:id/submissions` accepts `clientSubmissionId`, `configRevision`, normalized values and upload tokens.
- The route returns `201 { submissionId }` only after Drive and Sheets succeed.
- `TemporaryFileStorage.cleanup(before)` removes expired records and payloads without touching active or completed records.

- [ ] **Step 1: Write the failing tests**
  - Assert the order Drive, Sheets, status success and cleanup.
  - Assert Drive failure leaves temporary files and returns `502`.
  - Assert Sheets failure leaves temporary files and allows an idempotent retry.
  - Assert Sheets receives title declaration and recommendation pending columns.
  - Assert cleanup failure after successful persistence does not turn the submission into a failure.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter api test -- src/presentation/http/submission-files.test.ts src/presentation/http/submission-routes.test.ts`

  Expected: FAIL because the current route saves a new submission before side effects, never marks Drive files, and does not pass document states to Sheets.

- [ ] **Step 3: Implement the processing sequence**
  - Validate the attempt ID and canonical form.
  - Recover an existing pending submission when the attempt ID repeats.
  - Open only session-owned tokens and upload the pending files.
  - Add explicit Sheets columns for title denomination, no-title declaration and recommendation pending states.
  - Mark success only after Sheets accepts the row.
  - Delete payloads and database metadata after success; retain them for retry after failure.
  - Run the 30-minute cleanup from the application lifecycle without blocking requests.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter api test -- src/presentation/http/submission-files.test.ts src/presentation/http/submission-routes.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/presentation/http apps/api/src/application apps/api/src/infrastructure/database/postgres-submission-repository.ts apps/api/src/main.ts
  git commit -m "feat: completar envío documental a Drive y Sheets"
  ```

### Task 6: Integración y verificación de la experiencia completa

**Files:**
- Create: `apps/api/src/presentation/http/document-flow.integration.test.ts`
- Modify: `apps/web/src/components/PreinscriptionWizard.test.tsx`
- Modify: `playwright.config.ts` only if the current server wiring requires it
- Create: `tests/document-flow.spec.ts`
- Modify: `docs/ARQUITECTURA.md` where the current hierarchy or lifecycle differs

**Interfaces:**
- The browser test uses the public target routes and the existing mock Drive/Sheets configuration.
- The integration test uses fake catalog, temporary storage, Drive and Sheets ports with the same interfaces as production.

- [ ] **Step 1: Write the failing end-to-end tests**
  - Complete one non-master offer with identity, CV, title and motivation.
  - Complete one master with both recommendation files.
  - Complete one master with both recommendations marked later.
  - Complete one seminar without motivation or recommendations.
  - Verify Drive receives the expected files and Sheets receives the expected status columns.

- [ ] **Step 2: Run the focused integration tests**

  Run: `pnpm --filter api test -- src/presentation/http/document-flow.integration.test.ts` and `pnpm exec playwright test tests/document-flow.spec.ts`

  Expected: PASS for all four flows.

- [ ] **Step 3: Update architecture documentation**
  - Document the final document matrix, temporary cleanup, retry behavior and Drive hierarchy.
  - Keep the Django project as a functional reference only.

- [ ] **Step 4: Run the complete local verification**

  Run: `pnpm test && pnpm typecheck && pnpm build && docker compose config && git diff --check`

  Expected: all commands exit successfully and no unrelated diff remains.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/presentation/http/document-flow.integration.test.ts apps/web/src/components tests docs/ARQUITECTURA.md playwright.config.ts
  git commit -m "test: verificar flujo documental completo"
  ```

- [ ] **Step 6: Publish and report separately**
  - Inspect `git status`, diff and current branch.
  - Push the validated commits to `origin/main`.
  - Report local tests, publication, CI, deployment and live/browser verification as separate facts.
