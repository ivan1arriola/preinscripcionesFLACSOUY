# Rediseño de Esquema de Planillas, Enlaces a Documentos y Migración Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el esquema de Google Sheets fusionando género y título, reordenando documento/país emisor, agregando país del celular y columnas de documentos con hipervínculos a Drive (y subcarpetas por postulante), con un script de migración retroactiva sin pérdida de datos.

**Architecture:** Se actualizan las definiciones canónicas en `canonical-forms.ts` y las funciones puras en `spreadsheet-schema.ts` para soportar las fusiones, reordenamiento, país telefónico e hipervínculos. `GoogleDriveRepository` crea una subcarpeta dedicada por postulante para sus archivos. Las rutas de envío y reintento pasan el contexto de Drive a `buildSpreadsheetValues`. Se implementa `migrate-target-spreadsheets.ts` y el CLI `scripts/migrate-spreadsheets.ts` para reescribir planillas históricas cruzando Google Sheets con PostgreSQL.

**Tech Stack:** TypeScript, Node.js, Kysely (PostgreSQL), Google Drive API v3, Google Sheets API v4, `libphonenumber-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-hojas-de-calculo-columnas-documentos-y-migracion-design.md`

## Global Constraints

- Columna `Identidad de género`: fusiona `genero` y `generoOtra`; no existe columna separada de especificación.
- Columna `País emisor del documento` precede inmediatamente a `Número de documento`.
- Columna `País del celular`: adyacente a `Celular`, contiene `UY` para Uruguay o código ISO de 2 letras.
- Columna `Denominación del título`: fusiona `tituloDenominacion` y `sinTituloActual` (escribe `"No posee actualmente título"` si marcó excepción).
- Columna `Carpeta de documentos`: fórmula `=HYPERLINK("https://drive.google.com/drive/folders/<id>", "Abrir carpeta")`.
- Columnas de documentos: `=HYPERLINK("https://drive.google.com/file/d/<id>/view", "Ver archivo")` para 1 archivo, o enlace a la carpeta si son múltiples archivos.
- Subcarpeta por postulante en Drive: `Preinscripciones / Documentación / <apellidos-nombres-submissionId>`.
- Ninguna preinscripción existente ni celda de Google Sheets debe perder datos durante la migración.

---

### Task 1: Rediseño del Esquema de Columnas y Transformación en `spreadsheet-schema.ts`

**Files:**
- Modify: `packages/contracts/src/canonical-forms.ts:21-58`
- Modify: `apps/api/src/domain/spreadsheet-schema.ts:1-93`
- Modify: `apps/api/src/domain/spreadsheet-schema.test.ts:1-75`

**Interfaces:**
- `buildSpreadsheetSchema(form: FormDefinition): SpreadsheetSchema`
- `buildSpreadsheetValues(form: FormDefinition, normalizedValues: Record<string, string>, submissionId: string, submittedAt?: Date, driveContext?: { documentsFolderUrl?: string; files?: Array<{ fieldKey?: string; token?: string; driveFileId?: string }> }): Record<string, string>`
- `extractPhoneCountryCode(celular: string): string`

- [ ] **Step 1: Write failing unit tests** in `spreadsheet-schema.test.ts` for:
  - Reordering of `País emisor del documento` before `Número de documento`.
  - Fusion of `genero` and `generoOtra` into `Identidad de género`.
  - Adding `País del celular` (verifying `UY` for Uruguayan numbers and international codes for foreign numbers).
  - Fusion of `tituloDenominacion` and `sinTituloActual` into `Denominación del título`.
  - Adding `Carpeta de documentos` and document columns with `=HYPERLINK(...)` formulas.
- [ ] **Step 2: Run focused test** `pnpm --filter api test spreadsheet-schema.test.ts` and confirm failure.
- [ ] **Step 3: Update `canonical-forms.ts`** to reorder `paisEmisorDocumento` before `documento` and update column headers if necessary.
- [ ] **Step 4: Implement schema and value builders in `spreadsheet-schema.ts`**:
  - Implement `extractPhoneCountryCode` using `parsePhoneNumberFromString`.
  - Collapse `generoOtra` into `Identidad de género`.
  - Collapse `sinTituloActual` into `Denominación del título`.
  - Support `driveContext` in `buildSpreadsheetValues` generating `=HYPERLINK(...)` for `Carpeta de documentos` and each document in `form.documents`.
- [ ] **Step 5: Run focused test** `pnpm --filter api test spreadsheet-schema.test.ts` and confirm pass.
- [ ] **Step 6: Commit** `feat: update spreadsheet schema with fused fields, phone country and drive links`.

---

### Task 2: Subcarpeta por Postulante en Google Drive

**Files:**
- Modify: `apps/api/src/domain/google-drive-naming.ts:80-104`
- Modify: `apps/api/src/infrastructure/google/google-drive-repository.ts:82-152`
- Modify: `apps/api/src/domain/google-drive-naming.test.ts`
- Modify: `apps/api/src/infrastructure/google/google-drive-repository.test.ts:80-150`

**Interfaces:**
- `buildSubmissionFolderName(input: { submissionId: string; values: Record<string, string> }): string`
- `storeSubmissionFiles` returns `documentsFolderUrl` pointing to the applicant-specific subfolder.

- [ ] **Step 1: Write failing unit tests** in `google-drive-naming.test.ts` for `buildSubmissionFolderName`.
- [ ] **Step 2: Implement `buildSubmissionFolderName`** in `google-drive-naming.ts` producing `apellidos-${surname}__nombres-${givenName}__${sanitizeDriveSegment(submissionId)}`.
- [ ] **Step 3: Write failing repository test** in `google-drive-repository.test.ts` expecting the applicant subfolder to be created under `Documentación` and files placed inside it.
- [ ] **Step 4: Update `GoogleDriveRepository.storeSubmissionFiles`** to ensure the applicant subfolder under `Documentación` and upload files inside it.
- [ ] **Step 5: Run tests** `pnpm --filter api test google-drive-repository.test.ts google-drive-naming.test.ts` and confirm all pass.
- [ ] **Step 6: Commit** `feat: create dedicated Google Drive folder per submission`.

---

### Task 3: Integración de Enlaces a Drive en Envíos y Reintentos

**Files:**
- Modify: `apps/api/src/application/submit-preinscription.ts:135-154`
- Modify: `apps/api/src/presentation/http/submission-routes.ts:300-330`
- Modify: `apps/api/src/application/retry-failed-submission.ts:285-315`
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`
- Test: `apps/api/src/application/retry-failed-submission.test.ts`

**Interfaces:**
- `buildSpreadsheetValues` called with `driveContext: { documentsFolderUrl, files: storedDriveFiles }` in both `submission-routes.ts` and `retry-failed-submission.ts`.

- [ ] **Step 1: Update `submission-routes.ts`** to build spreadsheet values passing `storedDriveFiles` and `documentsFolderUrl` after Drive upload completes.
- [ ] **Step 2: Update `retry-failed-submission.ts`** to retrieve existing `submission_files` with `drive_file_id` and pass `driveContext` to `buildSpreadsheetValues`.
- [ ] **Step 3: Run existing test suites** `pnpm --filter api test submission-routes.test.ts retry-failed-submission.test.ts` and update mocks if needed.
- [ ] **Step 4: Verify typecheck** with `pnpm --filter api typecheck`.
- [ ] **Step 5: Commit** `feat: pass Drive folder and file links to spreadsheet row builder`.

---

### Task 4: Script de Migración y Reescritura Retroactiva de Planillas

**Files:**
- Create: `apps/api/src/application/migrate-target-spreadsheets.ts`
- Create: `apps/api/src/application/migrate-target-spreadsheets.test.ts`
- Create: `scripts/migrate-spreadsheets.ts`
- Modify: `package.json`

**Interfaces:**
- `migrateTargetSpreadsheets(dependencies: MigrateSpreadsheetsDependencies, options?: { dryRun?: boolean; targetId?: string }): Promise<MigrationSummary>`
- `pnpm run migrate:spreadsheets [--dry-run] [--target=<id>]`

- [ ] **Step 1: Write unit tests** in `migrate-target-spreadsheets.test.ts` verifying:
  - Header row updated with new columns in correct order.
  - Existing row matching `submission_id` enriched with Drive links and transformed fields.
  - Row without DB submission preserved with transformed fields.
  - `dryRun: true` does not make mutating calls to `SheetsClient`.
- [ ] **Step 2: Run focused test** and confirm failure.
- [ ] **Step 3: Implement `migrate-target-spreadsheets.ts`**:
  - Read registered target spreadsheets from database / port.
  - For each target, compute canonical `FormDefinition` schema.
  - Read Google Sheet headers and data rows.
  - Fetch submissions, values, and files from DB.
  - Transform rows to the new schema without losing data.
  - Write new headers and update rows atomically.
- [ ] **Step 4: Implement CLI runner `scripts/migrate-spreadsheets.ts`** with argument parsing, environment loading, DB connection, and summary logger.
- [ ] **Step 5: Add script entry** `"migrate:spreadsheets": "tsx scripts/migrate-spreadsheets.ts"` to root `package.json`.
- [ ] **Step 6: Run focused test** and confirm pass.
- [ ] **Step 7: Commit** `feat: implement retroactive spreadsheet migration tool`.

---

### Task 5: Documentación y Verificación Integral

**Files:**
- Create: `docs/MIGRACION-PLANILLAS.md`
- No credentials or sensitive data in repository.

- [ ] **Step 1: Create operator guide** in `docs/MIGRACION-PLANILLAS.md` documenting the new column structure, Drive folder layout, and instructions for running the migration script (including `--dry-run`).
- [ ] **Step 2: Run full repository test suite** `pnpm test`.
- [ ] **Step 3: Run full typecheck** `pnpm typecheck`.
- [ ] **Step 4: Run production build** `pnpm build`.
- [ ] **Step 5: Run git diff audit** confirming no private tokens, PII, or unintended file changes.
- [ ] **Step 6: Commit** `docs: document spreadsheet schema and migration procedures`.
