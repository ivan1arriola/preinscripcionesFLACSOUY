# Cierre funcional de Preinscripciones - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar una plataforma de preinscripciones funcional, segura y operable: catálogo vigente, formulario completo, documentos, Drive, planillas automáticas, administración y despliegue verificable.

**Architecture:** WordPress conserva la verdad académica; la aplicación valida y persiste cada envío; Google Drive y Sheets son adaptadores operativos; PostgreSQL guarda estado e idempotencia; React sólo consume la API. La única configuración manual de archivos es la carpeta raíz de Drive. Las planillas se aprovisionan automáticamente por destino y no requieren IDs manuales.

**Tech Stack:** TypeScript, React/Vite, Express, PostgreSQL/Kysely, Google Drive/Sheets, WordPress REST v1, SMTP/Nodemailer, Docker Compose, Vitest, Playwright.

## Definition of Done

- Una persona puede elegir una oferta abierta, completar el formulario, adjuntar documentos obligatorios y recibir confirmación de envío.
- Cada envío válido queda persistido una sola vez, con documentos en Drive y una fila en la planilla del destino.
- Una instalación nueva sólo exige configurar y compartir la carpeta raíz de Drive; las carpetas y planillas se crean solas.
- Administración explica estados y recupera errores sin exponer secretos, IDs internos o acciones ambiguas.
- El correo SMTP se configura desde Administración, verifica conexión sin enviar y conserva una outbox auditable.
- Producción se publica con una migración reversible, health checks y un smoke test completo.

## Workstreams and Order

### 1. Freeze and verify the current foundation

- [ ] Record the exact SHA, current schema, active containers and configuration ownership.
- [ ] Run API/web focused tests, typechecks, builds and Compose health checks; classify every failure as introduced, pre-existing or environment-only.
- [ ] Remove stale SES API imports, types, package dependency and UI labels after the SMTP replacement is complete.
- [ ] Commit only coherent, reviewable changes; do not include `.env`, service-account files or data exports.

**Exit:** clean baseline with an evidence log and no unresolved compile errors in changed paths.

### 2. Finish SMTP administration and notification delivery

- [ ] Replace the remaining SES administrative DTO/routes with SMTP settings: host, port, security, username, password-presence, sender, reply-to and master recipients.
- [ ] Add `POST /email/verify` (SMTP authentication only) and preserve `POST /email/test` as a separately authorized send.
- [ ] Encrypt writes, preserve a password on blank edits, require `replacePassword` for replacement and invalidate verification after connection changes.
- [ ] Update the administration card and client types; remove every access key, region, configuration-set and SES-facing label.
- [ ] Verify outbox retry/failed/unknown/manual retry states; never auto-retry an ambiguous accepted message.

**Tests:** API route tests for authorization/CSRF/secret masking/invalid input; provider and dispatcher tests; web interaction tests.

### 3. Make Drive and Sheets genuinely automatic

- [ ] Treat the configured Drive root as the only manual file setting; check service-account editor permission before activation.
- [ ] On catalog discovery and before a submission, ensure the destination folder and spreadsheet exist; create headers idempotently and attach stable Drive app properties.
- [ ] Replace the administrative concept of “sync existing spreadsheets” with “automatic preparation”; load status automatically and reserve manual action for recovery.
- [ ] Add safe “Unlink spreadsheet” behavior: retain the Google file, remove its active target marker, store an audit record/status, and create a new spreadsheet only through an explicit prepare action or a future valid submission.
- [ ] Report per-target states: ready, preparing, created, recovered, detached, blocked by Drive permissions, or failed with safe remediation text.
- [ ] Keep historical rows/files intact on a root-folder change; dynamically reconcile the active target rather than trusting a stale database mapping.

**Tests:** no existing spreadsheet; repeated preparation; duplicate concurrent request; root-folder change; inaccessible historical sheet; detached sheet does not reattach; submission creates its row in the newly active sheet.

### 4. Complete the public preinscription flow

- [ ] Revalidate the target against WordPress immediately before accepting the form; reject closed, expired or inconsistent destinations.
- [ ] Enforce canonical form rules: residence country + city, documents required on submission, exactly two recommendation letters only for Maestría, and no obsolete fields.
- [ ] Preserve upload session ownership and size/type limits; never expose temporary tokens across users.
- [ ] Execute the durable order: validate → persist/idempotency → Drive → Sheets → mark success → cleanup → queue notifications.
- [ ] Make retries idempotent: no duplicate Drive file, sheet row, submission or notification.
- [ ] Give applicants clear loading, validation, error and final-confirmation states; do not reveal Drive/Sheets internals.

**Tests:** complete offer and seminar submissions; required-document error; Drive failure retains temporary files; Sheets failure cannot return success; retry produces one final result.

### 5. Finish the administration experience

- [ ] Rework Drive into a compact status card: root folder, permission check, service-account copy control, last preparation result and clear recovery instruction.
- [ ] Present automatic spreadsheets as an operational list, not configuration inputs; include safe unlink and explicit re-prepare actions.
- [ ] Preserve all existing notification/outbox data and actions while organizing settings into configuration, status and recovery sections.
- [ ] Improve responsive layout, focus states, empty/loading/error states and Spanish operational copy.

**Tests:** admin session/CSRF gates; visual/browser check at desktop and mobile widths; no secret or internal ID rendered.

### 6. Production readiness and release

- [ ] Audit every required production secret/configuration: database, encryption key, WordPress URL, Google OAuth, service account, Drive root, allowed admins, cookie/TLS and SMTP.
- [ ] Back up the current production route and database migration state before any mutation.
- [ ] Build images, run migrations once, start the isolated stack and verify health/readiness.
- [ ] Conduct a controlled end-to-end smoke test with a dedicated test target and test data: catalog, submission, Drive file, Sheet row, outbox and optional authorized SMTP test.
- [ ] Publish the exact reviewed SHA, observe CI/deployment, verify public browser behavior and retain rollback instructions.

## Release Gates

1. No release with a failing API/web build or undocumented pre-existing failure.
2. No production email test without explicit authorization and a designated recipient.
3. No destructive Drive action: unlink preserves files; migration is additive.
4. No cutover until catalog, Drive, Sheets and admin authentication pass end-to-end.
5. Report local validation, push, CI, deploy and production verification separately.
