# Recuperación de fallos, Telegram y mejoras UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conservar y recuperar preinscripciones que fallen en Drive/Sheets, alertar al equipo por Telegram configurable desde Administración y mejorar la claridad de las pantallas SMTP y documentación.

**Architecture:** Se agregará una cola durable de incidentes de procesamiento y una cola durable de Telegram sobre PostgreSQL, con repositorios, leases, backoff y un worker separado. El envío público seguirá persistiendo primero la preinscripción; los reintentos administrativos reutilizarán ese registro y los archivos ya confirmados. La configuración sensible se guardará mediante `EncryptedSettingsService` y se expondrá enmascarada.

**Tech Stack:** TypeScript, Express, Kysely, PostgreSQL, React, Vitest, Tailwind existente, cliente HTTP nativo para Telegram.

**Spec:** `docs/superpowers/specs/2026-10-05-recuperacion-fallos-telegram-y-ux-design.md`

## Global Constraints

- Toda la configuración de Telegram debe administrarse desde la UI; no agregar una ruta operativa que dependa de variables de entorno.
- Token, chat IDs y datos de postulantes no pueden aparecer en logs, errores públicos ni mensajes de Telegram.
- La retención de casos fallidos es de 7 días; los formularios abandonados conservan su TTL normal.
- Los reintentos son idempotentes y no duplican `submissions` ni archivos de Drive confirmados.
- Se preservan rutas, contratos académicos, permisos y acciones existentes.
- Las migraciones son aditivas, reversibles y deben ejecutarse antes del arranque de la aplicación.
- Cada tarea termina con pruebas enfocadas y un commit descriptivo.

## Review Focus

- Dos reintentos concurrentes del mismo caso no deben duplicar Drive ni Sheets; fijar en la tarea 4 con una prueba de lease/idempotencia.
- Un token Telegram malformado o un proveedor que devuelve PII no debe filtrarse; fijar en la tarea 3 con pruebas de validación y sanitización.
- Un fallo al enviar Telegram no debe alterar el estado de la preinscripción; fijar en la tarea 3 con prueba de aislamiento.
- Un caso con documento temporal vencido debe quedar no recuperable y explicar el documento faltante; fijar en la tarea 4.
- Guardar SMTP sin editar un valor enmascarado debe conservar el valor real; fijar en la tarea 7 junto con la regresión visual existente.

---

### Task 1: Persistencia de recuperación y retención

**Files:**
- Create: `apps/api/src/infrastructure/database/migrations/015_submission_recovery.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/ports/submission-recovery-repository.ts`
- Create: `apps/api/src/infrastructure/database/postgres-submission-recovery-repository.ts`
- Create: `apps/api/src/infrastructure/database/in-memory-submission-recovery-repository.ts`
- Test: `apps/api/src/infrastructure/database/postgres-submission-recovery-repository.test.ts`

**Interfaces:**
- Produce `SubmissionRecoveryRepository` with `listFailed`, `findById`, `claim`, `release`, `markRetryResult`, `discard`, `deleteExpired`.
- Produce `SubmissionRecoveryRecord` containing submission/target metadata, stage, safe error, attempt timestamps, retention expiry, file summaries and lease fields.

- [x] **Step 1: Write failing migration/repository tests** for failed-case metadata, 7-day expiry, claiming, idempotent discard and expired cleanup.
- [x] **Step 2: Run the focused repository tests** and confirm they fail because the table and port do not exist.
- [x] **Step 3: Implement migration and repositories** using additive tables/indexes. Store only operational metadata in the recovery table; keep applicant values in existing tables and use foreign keys with cascade cleanup.
- [x] **Step 4: Run migration and repository tests** and confirm PostgreSQL and in-memory behavior match.
- [x] **Step 5: Commit** `feat: persist failed submission recovery cases`.

### Task 2: Capture failures and retain associated temporary files

**Files:**
- Modify: `apps/api/src/ports/submission-repository.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Modify: `apps/api/src/infrastructure/database/in-memory-submission-repository.ts`
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/ports/file-storage.ts`
- Modify: `apps/api/src/infrastructure/files/temporary-file-storage.ts`
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`
- Test: `apps/api/src/presentation/http/submission-files.test.ts`

**Interfaces:**
- Add `recordProcessingFailure(id, stage, safeError, retentionDays)` or equivalent application-level operation that is atomic with the recovery record.
- Add a temporary-storage operation to extend an upload’s expiry for an existing failed submission without changing the normal abandoned-form TTL.

- [ ] **Step 1: Add failing route tests** asserting that Drive and Sheets failures return a tracking ID, retain values/files, create a recovery case and classify the failing stage.
- [ ] **Step 2: Add the failed-file retention test** asserting abandoned uploads still expire normally while files attached to a failed submission survive seven days.
- [ ] **Step 3: Implement failure capture** at every post-save failure path, sanitize/truncate provider messages, and return a safe pending-processing response.
- [ ] **Step 4: Run submission and document-flow tests** and confirm successful submissions still clean temporary files only after all processing succeeds.
- [ ] **Step 5: Commit** `feat: retain failed submissions for recovery`.

### Task 3: Telegram provider, encrypted settings and durable alert queue

**Files:**
- Create: `apps/api/src/infrastructure/database/migrations/016_telegram_recovery_alerts.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/ports/telegram-provider.ts`
- Create: `apps/api/src/infrastructure/telegram/telegram-provider.ts`
- Create: `apps/api/src/application/telegram-recovery-alert-dispatcher.ts`
- Create: `apps/api/src/infrastructure/database/postgres-telegram-alert-repository.ts`
- Create: `apps/api/src/infrastructure/database/in-memory-telegram-alert-repository.ts`
- Modify: `apps/api/src/infrastructure/security/encrypted-settings.ts` only through existing public API
- Test: `apps/api/src/infrastructure/telegram/telegram-provider.test.ts`
- Test: `apps/api/src/application/telegram-recovery-alert-dispatcher.test.ts`
- Test: `apps/api/src/infrastructure/database/postgres-telegram-alert-repository.test.ts`

**Interfaces:**
- `TelegramProvider.verify(): Promise<void>` and `send(message: string, chatId: string): Promise<{ providerMessageId?: string }>`.
- `TelegramAlertRepository` with enqueue, claim batch, mark sent/failed, retryable classification and counts.
- Settings keys: `telegram_recovery_enabled`, encrypted `telegram_bot_token`, encrypted `telegram_chat_ids`, plus non-secret status timestamps/errors.

- [ ] **Step 1: Write provider tests** for successful send, timeout, non-2xx response, malformed configuration and sanitized/truncated provider errors.
- [ ] **Step 2: Write dispatcher/repository tests** for lease, backoff, max attempts, multiple recipients and failure isolation.
- [ ] **Step 3: Implement the Telegram client** with native HTTPS/fetch, bounded timeout and no secret/body logging.
- [ ] **Step 4: Implement the durable queue and dispatcher** reusing the existing email outbox lease/backoff conventions.
- [ ] **Step 5: Run focused Telegram tests** and confirm all pass.
- [ ] **Step 6: Commit** `feat: add durable Telegram recovery alerts`.

### Task 4: Administrative retry, discard and retention worker

**Files:**
- Create: `apps/api/src/application/retry-failed-submission.ts`
- Create: `apps/api/src/application/cleanup-expired-recoveries.ts`
- Modify: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/presentation/http/submission-recovery-routes.test.ts`
- Test: `apps/api/src/application/retry-failed-submission.test.ts`
- Test: `apps/api/src/application/cleanup-expired-recoveries.test.ts`

**Interfaces:**
- Admin endpoints under `/api/admin/settings/recoveries`: list/detail, `POST /:id/retry`, `DELETE /:id`.
- `retryFailedSubmission(id, dependencies)` reuses stored values and file states, skips confirmed Drive files and writes exactly one Sheets operation.
- All endpoints require the existing admin session and CSRF for mutations.

- [ ] **Step 1: Write failing application tests** for retry success, already-stored files, missing temporary file, concurrent claim and discard confirmation.
- [ ] **Step 2: Write failing route tests** for authentication, CSRF, safe metadata response, retry and deletion.
- [ ] **Step 3: Implement retry and discard use cases** with explicit state transitions and safe error handling.
- [ ] **Step 4: Add periodic cleanup** to the API/worker process and ensure expired records delete their private data idempotently.
- [ ] **Step 5: Run recovery tests and the full API suite**.
- [ ] **Step 6: Commit** `feat: add administrative recovery workflow`.

### Task 5: Wire Telegram alerts and worker process

**Files:**
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/worker-notifications.ts`
- Create: `apps/api/src/worker-recovery.ts` if separation is needed after wiring review
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`
- Test: `apps/api/src/worker-recovery.test.ts`

- [ ] **Step 1: Add a failing integration test** proving a Sheets failure creates the Telegram alert without changing the failed recovery result when the provider is unavailable.
- [ ] **Step 2: Wire alert enqueueing after failure capture** and include only safe operational fields.
- [ ] **Step 3: Wire the worker** to resolve encrypted settings at dispatch time, process Telegram alerts and run retention cleanup.
- [ ] **Step 4: Verify startup/shutdown behavior** and that disabled or incomplete Telegram configuration leaves queued alerts pending without noisy failures.
- [ ] **Step 5: Run API, worker and Compose checks**.
- [ ] **Step 6: Commit** `feat: wire recovery alerts and cleanup worker`.

### Task 6: Admin API and UI for Telegram/recovery

**Files:**
- Modify: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/AdminProfilesPage.tsx`
- Create: `apps/web/src/components/AdminRecoverySettingsCard.tsx`
- Create: `apps/web/src/components/AdminFailedSubmissionsCard.tsx`
- Tests: `apps/api/src/presentation/http/admin-settings-routes.test.ts`
- Tests: `apps/web/src/pages/AdminProfilesPage.test.tsx`
- Tests: new component tests under `apps/web/src/components/`

- [ ] **Step 1: Write failing API tests** for masked Telegram settings, validation, test send, recovery list, retry and discard.
- [ ] **Step 2: Extend the client types and methods** with exact response contracts and safe error details.
- [ ] **Step 3: Implement Telegram configuration UI** with sections, validation, masked state, save, test and delivery status.
- [ ] **Step 4: Implement recovery UI** with filters, metadata-only list, detail drawer, retry progress, missing-file explanation and destructive confirmation.
- [ ] **Step 5: Run API and web focused tests**, then full web tests.
- [ ] **Step 6: Commit** `feat: add recovery and Telegram administration UI`.

### Task 7: Improve SMTP error UX and title-document component

**Files:**
- Modify: `apps/api/src/infrastructure/email/email-config.ts`
- Modify: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/AdminNotificationsSettingsCard.tsx`
- Modify: `apps/web/src/components/TitleDocumentFields.tsx`
- Test: `apps/api/src/infrastructure/email/email-config.test.ts`
- Test: `apps/api/src/presentation/http/admin-settings-routes.test.ts`
- Test: `apps/web/src/components/AdminNotificationsSettingsCard.test.tsx`
- Test: `apps/web/src/components/TitleDocumentFields.test.tsx`

- [ ] **Step 1: Add failing tests** for exact invalid-from/reply-to error details, masked address preservation and accessible title toggle behavior.
- [ ] **Step 2: Implement structured validation errors** with field and action details while preserving existing HTTP error codes.
- [ ] **Step 3: Refactor SMTP layout** into connection, credentials, sender/reply-to and recipients sections; make masked current values read-only and keep edits empty.
- [ ] **Step 4: Redesign title-document decision control** as accessible cards/radios or checkbox card, preserving conditional clearing/upload behavior.
- [ ] **Step 5: Run component tests and typecheck/build**.
- [ ] **Step 6: Commit** `fix: clarify notification errors and document controls`.

### Task 8: End-to-end verification and publication

**Files:**
- Modify: `docs/DEPLOY.md` or the current operational documentation with Telegram setup and recovery runbook.
- Modify: `.env.example` only if a non-secret worker setting is genuinely needed; never add real credentials.

- [ ] **Step 1: Run focused API, worker and web tests.**
- [ ] **Step 2: Run full API/web tests, typechecks and production build.**
- [ ] **Step 3: Run `git diff --check` and audit for secrets, PII in Telegram templates, masked-address regressions and unrelated changes.**
- [ ] **Step 4: Execute local Compose validation**, including migration, API, web, worker and a simulated provider failure/retry flow.
- [ ] **Step 5: Commit documentation and verification fixes.**
- [ ] **Step 6: Fast-forward/push `origin/main` from the clean worktree, preserving the unrelated credential CSV in the main checkout.**
- [ ] **Step 7: Run the official deployment workflow, verify deployment SHA, backup, service health and public API health.**
- [ ] **Step 8: Perform authenticated browser review of SMTP, Telegram configuration, recovery list and document toggle; verify no secrets or PII appear in the UI/Telegram message.**

## Self-review

- Spec coverage: failure capture/retention is covered by Tasks 1–2; Telegram configuration/provider/queue by Task 3; retry/discard/cleanup by Task 4; runtime wiring by Task 5; admin UI by Task 6; approved SMTP/document UX by Task 7; publication and live verification by Task 8.
- Type consistency: `SubmissionRecoveryRepository`, `TelegramProvider` and `TelegramAlertRepository` are introduced before their consumers; route and client contracts are defined in the producing tasks.
- Review focus coverage: each of the five high-risk conditions has a named test in Tasks 2, 3, 4 and 7.
- Proportion: tasks separate persistence, integrations, recovery, UI and release gates; no task assumes production credentials or silently changes deployment data.
