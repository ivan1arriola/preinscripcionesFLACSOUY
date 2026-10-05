# Notificaciones Telegram por preinscripción y bandeja de planillas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encolar una notificación Telegram por cada preinscripción exitosa sin bloquear el flujo público y convertir la lista administrativa de planillas en una bandeja buscable, filtrable y priorizada.

**Architecture:** Se ampliará la cola Telegram existente con tipo de evento e idempotencia por `submission_id`, `chat_id` y tipo. La preinscripción solo encolará el evento después de marcarse exitosa y aislará cualquier error de Telegram. La pantalla de planillas conservará el contrato API actual y aplicará búsqueda, filtros, métricas y agrupación en el cliente.

**Tech Stack:** TypeScript, Express, Kysely, PostgreSQL, React, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-10-05-telegram-y-bandeja-planillas-design.md`

## Global Constraints

- Telegram nunca debe bloquear ni cambiar el resultado del flujo público de preinscripción.
- Cada combinación `submission_id + chat_id + event_type` debe ser idempotente.
- Token, chat IDs completos y datos personales no pueden aparecer en mensajes, logs ni respuestas HTTP.
- Se conservan todas las rutas, endpoints, datos y acciones actuales de Google Sheets.
- La migración de Telegram será aditiva y mantendrá la tabla física `telegram_recovery_alerts`.
- No se instalarán dependencias nuevas.
- Antes de publicar, el agente ejecutor debe validar código, pruebas, build y diff; este plan no autoriza despliegue automático.

## Review Focus

- Reenvío del mismo `clientSubmissionId`: no debe duplicar trabajos Telegram; fijar en la Tarea 2.
- Falla al guardar la cola Telegram: la respuesta y el estado de la preinscripción deben permanecer exitosos; fijar en la Tarea 3.
- Configuración con alertas de recuperación desactivadas y preinscripciones activadas: solo debe enviarse el evento correcto; fijar en las Tareas 1 y 3.
- Títulos largos, caracteres acentuados y resultados vacíos en la bandeja: la búsqueda y el layout no deben romperse; fijar en la Tarea 5.
- Acciones de abrir y desvincular después de filtrar: deben operar sobre el `targetId` original, no sobre el índice visual; fijar en la Tarea 5.

---

### Task 1: Ampliar configuración y contrato de eventos Telegram

**Files:**
- Modify: `apps/api/src/infrastructure/telegram/telegram-config.ts`
- Modify: `apps/api/src/ports/telegram-alert-repository.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/infrastructure/database/migrations/017_telegram_event_types.ts`
- Modify: `apps/api/src/infrastructure/database/migrate.ts`
- Test: `apps/api/src/infrastructure/telegram/telegram-config.test.ts`
- Test: `apps/api/src/infrastructure/database/in-memory-telegram-alert-repository.test.ts`

**Interfaces:**
- Add `SETTING_TELEGRAM_PREINSCRIPTION_ENABLED = 'telegram_preinscription_enabled'`.
- Extend `TelegramConfig` and `MaskedTelegramConfig` with `preinscriptionEnabled: boolean`.
- Extend `EnqueueTelegramAlertInput` and `TelegramAlertRecord` with `eventType: 'recovery' | 'preinscription'` and `dedupeKey: string`.
- Add an idempotent repository method:
  `ensureForSubmission(input: EnqueueTelegramAlertInput | EnqueueTelegramAlertInput[]): Promise<TelegramAlertRecord[]>`.

- [ ] **Step 1: Write failing config tests** asserting independent recovery/preinscription flags and masked output.
- [ ] **Step 2: Write failing repository tests** asserting duplicate `dedupeKey` values return one logical job and distinct chat IDs create distinct jobs.
- [ ] **Step 3: Run the focused tests** and confirm failure is caused by the missing setting/contract/migration behavior.
- [ ] **Step 4: Add migration 017** with `event_type`, `dedupe_key`, a default `recovery` value for existing rows, a unique index on `dedupe_key`, and the required schema types.
- [ ] **Step 5: Implement config loading/saving and repository idempotency** for both in-memory and PostgreSQL adapters.
- [ ] **Step 6: Run focused config and repository tests** and confirm they pass.
- [ ] **Step 7: Commit** `feat: distinguish Telegram preinscription events`.

### Task 2: Build the safe preinscription Telegram event

**Files:**
- Create: `apps/api/src/application/preinscription-telegram-notification.ts`
- Test: `apps/api/src/application/preinscription-telegram-notification.test.ts`

**Interfaces:**
- Produce `buildPreinscriptionTelegramMessage(input: { submissionId: string; targetTitle: string; targetKind: 'offer' | 'seminar'; occurredAt: Date }): string`.
- Produce `enqueuePreinscriptionTelegramNotifications(input: { repository: TelegramAlertRepository; submissionId: string; target: AcademicTarget; chatIds: string[]; occurredAt?: Date }): Promise<TelegramAlertRecord[]>`.

- [ ] **Step 1: Write failing message tests** for offer/seminar labels, safe truncation of a long title, and absence of PII-like values.
- [ ] **Step 2: Write failing idempotency tests** proving two calls with the same submission and chat IDs return the existing jobs.
- [ ] **Step 3: Run the focused tests** and confirm the new module is missing.
- [ ] **Step 4: Implement the message builder** with the exact safe operational copy from the spec and no links or form values.
- [ ] **Step 5: Implement enqueueing** with one `dedupeKey` per `submissionId + chatId + preinscription` and `eventType: 'preinscription'`.
- [ ] **Step 6: Run the focused tests** and confirm they pass.
- [ ] **Step 7: Commit** `feat: build safe Telegram preinscription events`.

### Task 3: Wire Telegram into successful submissions without blocking

**Files:**
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/application/retry-failed-submission.ts`
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`
- Test: `apps/api/src/application/retry-failed-submission.test.ts`

**Interfaces:**
- Extend `SubmissionRecoveryDependencies` or introduce a separate `SubmissionTelegramDependencies` with `telegramAlertRepository`, `getTelegramConfig`, and an optional logger.
- Resolve configuration at request time from `EncryptedSettingsService`; only enqueue when `preinscriptionEnabled` is true and there is at least one configured chat ID.

- [ ] **Step 1: Write failing route tests** for one job per configured chat after a successful submission.
- [ ] **Step 2: Write failing isolation tests** where `ensureForSubmission` rejects and the route still returns 201 with the submission marked successful.
- [ ] **Step 3: Write failing retry tests** proving a successful administrative retry does not create duplicate preinscription events.
- [ ] **Step 4: Run the focused route/application tests** and confirm they fail before wiring.
- [ ] **Step 5: Enqueue after `markProcessing(..., 'success')` and after normal notification enqueueing** inside a narrow `try/catch`; log only the safe error message.
- [ ] **Step 6: Wire the same helper into successful recovery retry paths**, relying on the repository dedupe key.
- [ ] **Step 7: Run the focused route and retry tests** and confirm public success/failure responses are unchanged.
- [ ] **Step 8: Commit** `feat: notify Telegram for every preinscription`.

### Task 4: Expose independent Telegram controls in Administration

**Files:**
- Modify: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/AdminRecoverySettingsCard.tsx`
- Test: `apps/api/src/presentation/http/admin-settings-routes.test.ts`
- Test: `apps/web/src/components/AdminRecoverySettingsCard.test.tsx`

**Interfaces:**
- Extend GET/PUT `/api/admin/settings/telegram` with `preinscriptionEnabled` while preserving the existing recovery flag.
- Preserve token replacement, masked chat IDs, CSRF, validation and test-send behavior.
- Label the new control exactly as “Notificar cada preinscripción por Telegram”.

- [ ] **Step 1: Write failing API tests** for independent GET/PUT values and for not returning the token.
- [ ] **Step 2: Write failing component tests** for rendering, saving and retaining the recovery toggle independently.
- [ ] **Step 3: Run focused API/component tests** and confirm the new property/control is absent.
- [ ] **Step 4: Implement the API/client/UI changes** without changing existing routes or secrets behavior.
- [ ] **Step 5: Run focused tests and web typecheck** and confirm they pass.
- [ ] **Step 6: Commit** `feat: configure Telegram preinscription notifications`.

### Task 5: Redesign the spreadsheet administration as an operational inbox

**Files:**
- Modify: `apps/web/src/components/AdminSpreadsheetSettingsCard.tsx`
- Create: `apps/web/src/components/AdminSpreadsheetTargetRow.tsx`
- Modify: `apps/web/src/app.css`
- Test: `apps/web/src/components/AdminSpreadsheetSettingsCard.test.tsx`
- Test: `apps/web/src/components/AdminSpreadsheetTargetRow.test.tsx`

**Interfaces:**
- Keep `apiClient.getAdminSpreadsheets`, `provisionAdminSpreadsheets` and `unlinkAdminSpreadsheet` unchanged.
- Add local view state: `query`, `kindFilter`, `statusFilter`, and `expandedTargetId`.
- Add pure helpers in the component module or a colocated utility:
  `filterSpreadsheetTargets(targets, query, kindFilter, statusFilter)` and `summarizeSpreadsheetTargets(targets)`.

- [ ] **Step 1: Write failing helper tests** for case-insensitive accent-tolerant search, kind/status filters, attention-first ordering and summary counts.
- [ ] **Step 2: Write failing component tests** for search, filters, empty filtered state, expansion and preserving open/unlink actions.
- [ ] **Step 3: Run focused web tests** and confirm they fail for the missing controls/layout.
- [ ] **Step 4: Implement the compact header** with metrics and the existing preparation/retry action.
- [ ] **Step 5: Implement search, kind/status filters and clear-filters behavior** using client-side derived state only.
- [ ] **Step 6: Implement grouped sections** for “Requieren atención” and “Planillas disponibles”, with compact accessible rows and responsive mobile cards.
- [ ] **Step 7: Move secondary actions into the expandable row while preserving their labels, confirmation and target IDs.**
- [ ] **Step 8: Run focused component tests and web typecheck/build** and confirm no API contract changed.
- [ ] **Step 9: Commit** `fix: make spreadsheet administration operational`.

### Task 6: Full verification and handoff to Agy

**Files:**
- Modify: `docs/DEPLOY.md` or create `docs/TELEGRAM-Y-PLANILLAS.md`
- No production files or credentials may be added.

- [ ] **Step 1: Add operator documentation** for the two Telegram toggles, bot initialization by each chat, queue semantics, and the new planilla filters.
- [ ] **Step 2: Run API focused tests** for config, repository, route, dispatcher and retry behavior.
- [ ] **Step 3: Run web focused tests, typecheck and build.**
- [ ] **Step 4: Run the full repository test/typecheck/build commands:** `pnpm test`, `pnpm typecheck`, and `pnpm build`.
- [ ] **Step 5: Run `git diff --check` and an audit for tokens, PII, private URLs and accidental changes to the existing working tree.**
- [ ] **Step 6: Perform browser verification at the authenticated admin route:** configure both switches, filter the planilla list, expand a row, open a planilla and verify unlink confirmation without executing destructive confirmation.
- [ ] **Step 7: Review the resulting diff and hand it to Agy for execution.** Do not push, deploy, migrate production or claim live verification from this plan-only handoff.

## Execution order

Run Tasks 1–4 first because the Telegram event contract and independent setting must exist before successful submissions can enqueue notifications. Task 5 is independent after the current spreadsheet response contract is confirmed and can be executed in parallel with Tasks 1–4. Task 6 runs only after both lines are complete.

## Self-review

- Spec coverage: Telegram configuration, safe message, idempotency, non-blocking behavior, recovery compatibility and admin controls are covered by Tasks 1–4; search, filters, grouping, responsiveness and preserved actions are covered by Task 5; documentation and verification are covered by Task 6.
- Type consistency: `eventType` and `dedupeKey` are introduced in Task 1 and consumed by Tasks 2–4; the spreadsheet helpers and row component are introduced and consumed entirely within Task 5 without changing API types.
- Review focus coverage: duplicate submissions, queue failure isolation, independent toggles, long/empty UI states and filtered row actions each have an owning test task.
- Scope: this plan does not include implementation, deployment or production migration in the current turn.
