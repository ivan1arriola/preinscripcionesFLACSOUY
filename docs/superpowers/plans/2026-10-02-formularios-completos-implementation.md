# Formularios completos de preinscripción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ampliar la nueva aplicación para reproducir los campos y documentos del formulario anterior, con configuración dinámica desde WordPress, carga temporal segura y transferencia final a Google Drive.

**Architecture:** La app mantendrá los campos universales en el dominio y recibirá desde el REST de WordPress los campos variables, las orientaciones, las menciones y los documentos requeridos. El flujo de archivos tendrá un puerto de almacenamiento temporal y otro de Drive; la solicitud solo confirmará cuando la persistencia y la transferencia estén consistentes. La extensión del contrato REST será aditiva y conservará `configRevision` y la revalidación al enviar.

**Tech Stack:** TypeScript, React, Fastify, Zod, Kysely/PostgreSQL, Vitest, WordPress PHP, PHPUnit-style contract tests, Google Drive API.

**Spec:** `docs/superpowers/specs/2026-10-02-formularios-completos-design.md`

## Global Constraints

- Mantener el contrato REST v1 existente; las nuevas propiedades serán aditivas.
- Orientación y mención son independientes y provienen de la Oferta Académica.
- Los seminarios no muestran orientación ni mención.
- No eliminar temporales antes de confirmar la transferencia a Drive.
- No publicar URLs públicas para temporales o documentos privados.
- Revalidar destino, estado y `configRevision` durante el envío.
- Preservar los cambios existentes y publicar solo commits relacionados en `main`.

## Review Focus

- Tipo de documento extranjero sin país emisor: debe fallar con error de campo; se prueba en validación de datos personales.
- “Otra” identidad de género sin detalle: debe fallar; se prueba en reglas condicionales.
- Orientación y mención seleccionadas en cualquier combinación: ambas deben validarse independientemente; se prueba en composición del formulario.
- Seminario con configuración accidental de orientación/mención: debe ignorarla y no renderizar esos campos; se prueba en contrato y UI.
- Error de Drive después de guardar temporales: los temporales deben conservarse y la operación debe quedar reintentable; se prueba en el servicio de archivos.

### Task 1: Contrato de campos universales y documentos

**Files:**
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `packages/contracts/src/submissions.ts`
- Modify: `apps/api/src/domain/form-definition.ts`
- Modify: `apps/api/src/domain/form-composition.ts`
- Test: `apps/api/src/domain/form-composition.test.ts`
- Test: `apps/api/src/domain/form-validation.test.ts`

**Interfaces:**
- Produce `DocumentDefinition`, `TargetDocumentConfig` y los tipos de valores de formulario que consumirán la API y la UI.
- Produce la lista completa de universales y la composición independiente de `orientacion` y `mencion`.

- [ ] Escribir pruebas que exijan los campos universales completos, sus tipos, etiquetas, orden y columnas de planilla.
- [ ] Ejecutar las pruebas y comprobar que fallan por campos o tipos ausentes.
- [ ] Implementar el catálogo universal, documentos y reglas de composición sin alterar el contrato existente.
- [ ] Agregar pruebas para orientación y mención independientes y para ignorarlas en destinos `seminar`.
- [ ] Ejecutar `pnpm --filter api test -- form-composition form-validation` y comprobar que pasa.
- [ ] Commit: `feat: ampliar contrato de campos de preinscripcion`.

### Task 2: Validación condicional y persistencia de valores

**Files:**
- Modify: `apps/api/src/domain/form-validation.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/infrastructure/database/migrations/004_complete_form_submissions.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Modify: `apps/api/src/infrastructure/database/in-memory-submission-repository.ts`
- Test: `apps/api/src/domain/form-validation.test.ts`
- Test: `apps/api/src/application/submit-preinscription.test.ts`

**Interfaces:**
- Consumes the form definitions from Task 1.
- Produces validated submission values with conditional errors and a stable submission identifier for file operations.

- [ ] Add failing tests for document type/country rules, “Otra” gender, convenio, posgrado and independent select values.
- [ ] Add failing tests proving stale revisions and closed destinations still reject submissions.
- [ ] Implement backend validation and normalization; never rely only on browser conditions.
- [ ] Add migration/schema support for document metadata and submission processing status without deleting existing rows.
- [ ] Run the focused API suite and the migration/type checks.
- [ ] Commit: `feat: validar campos completos de preinscripcion`.

### Task 3: REST WordPress configuration

**Files:**
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-field-catalog.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-meta.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-admin.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-serializer.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-rest.php`
- Test: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/tests/preinscriptions-rest-contract-test.php`

**Interfaces:**
- Consumes offer, cohort and edition metadata already used by REST v1.
- Produces additive `form.documents`, independent `form.orientations` and `form.mentions`; seminars emit empty orientation and mention collections.

- [ ] Add failing contract tests for the new JSON shape, offer-level orientation/mention sources and seminar exclusion.
- [ ] Add admin/meta persistence for document requirements and offer-level independent lists, preserving existing metadata keys.
- [ ] Serialize deterministic ordering and include the configuration revision in changes.
- [ ] Run plugin syntax, focused contract tests and the complete plugin suite.
- [ ] Commit and push the plugin change only after local tests pass; record deploy workflow and public endpoint evidence.

### Task 4: Temporary file storage and Drive port

**Files:**
- Create: `apps/api/src/ports/file-storage.ts`
- Create: `apps/api/src/infrastructure/files/temporary-file-storage.ts`
- Create: `apps/api/src/ports/google-drive-repository.ts`
- Create: `apps/api/src/infrastructure/google/google-drive-repository.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/infrastructure/database/migrations/005_submission_files.ts`
- Test: `apps/api/src/infrastructure/files/temporary-file-storage.test.ts`
- Test: `apps/api/src/infrastructure/google/google-drive-repository.test.ts`

**Interfaces:**
- `TemporaryFileStorage.save(sessionId, fieldKey, upload)` returns a private token and metadata.
- `TemporaryFileStorage.open(token)` returns a readable private file only for the owning session/submission.
- `GoogleDriveRepository.storeSubmissionFiles(command)` returns Drive identifiers and is idempotent by submission/file token.
- `TemporaryFileStorage.remove(token)` runs only after the Drive result is confirmed.

- [ ] Write failing tests for private temporary paths, ownership, allowed MIME/size/count and cleanup expiry.
- [ ] Write failing tests for Drive success, Drive failure, duplicate retry and no-delete-before-success.
- [ ] Implement local private storage and the Drive adapter behind ports; credentials come only from runtime configuration.
- [ ] Add persistent file-operation states `pending`, `success`, `failed` and `unknown` with retry-safe keys.
- [ ] Run infrastructure tests with credentials absent and verify safe failure without secrets in logs.
- [ ] Commit: `feat: agregar almacenamiento temporal y drive`.

### Task 5: HTTP upload and submission orchestration

**Files:**
- Create: `apps/api/src/presentation/http/upload-routes.ts`
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Test: `apps/api/src/presentation/http/upload-routes.test.ts`
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`

**Interfaces:**
- `POST /api/uploads` accepts one multipart file plus target/session/field context and returns a temporary token.
- Submission accepts values plus temporary tokens, revalidates the catalog, persists the request, sends files to Drive and removes temporaries only after confirmation.

- [ ] Add failing route tests for upload token creation, invalid files, session ownership and missing target.
- [ ] Add failing route tests for successful transfer, Drive failure, retry and stale configuration.
- [ ] Implement orchestration with explicit transaction/state boundaries; do not report success before the required Drive result.
- [ ] Add cleanup invocation and bounded retry behavior for failed operations.
- [ ] Run all API tests and typecheck.
- [ ] Commit: `feat: conectar carga de archivos con preinscripciones`.

### Task 6: React form and document UX

**Files:**
- Modify: `apps/web/src/components/DynamicForm.tsx`
- Modify: `apps/web/src/components/OrientationMentionFields.tsx`
- Create: `apps/web/src/components/UniversalFields.tsx`
- Create: `apps/web/src/components/DocumentUploadFields.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/TargetPage.tsx`
- Test: `apps/web/src/components/DynamicForm.test.tsx`
- Test: `apps/web/src/pages/TargetPage.test.tsx`

**Interfaces:**
- Consumes the extended `FormDefinition` from Task 1.
- Produces values and temporary file tokens compatible with Task 5.

- [ ] Add failing UI tests for all universal fields and conditional questions.
- [ ] Add failing UI tests for independent orientation/mención selects and their absence on seminars.
- [ ] Add failing UI tests for immediate upload, replacement, removal, validation messages and submit progress.
- [ ] Implement accessible grouped sections with clear file status and no public file URLs.
- [ ] Run web tests, lint, typecheck and build.
- [ ] Commit: `feat: incorporar formulario completo en la interfaz`.

### Task 7: End-to-end verification and publication

**Files:**
- Modify: `tests/e2e/preinscriptions.spec.ts`
- Modify: `README.md`
- Modify: `docs/INTEGRACION_WORDPRESS.md`

**Interfaces:**
- Verifies WordPress REST, API, browser UI, persistence and Drive using test configuration.

- [ ] Add an E2E scenario for an academic offer with independent orientation/mención and all document types.
- [ ] Add an E2E scenario for a seminar without orientation/mención.
- [ ] Exercise a Drive failure and confirm temporary preservation, then retry and confirm deletion.
- [ ] Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and E2E tests.
- [ ] Inspect the final diff, publish app and plugin commits to `main`, and verify CI separately.
- [ ] Verify deployed SHA, service health, REST payload, browser submission and Drive result before claiming completion.
