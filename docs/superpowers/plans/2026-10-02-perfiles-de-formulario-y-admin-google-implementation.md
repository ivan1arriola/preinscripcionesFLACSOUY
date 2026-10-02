# Perfiles de formulario y administración con Google Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover la composición de preinscripciones desde WordPress a perfiles versionados administrados por la app, y permitir administrar esos perfiles exclusivamente a `web@flacso.edu.uy` mediante Google.

**Architecture:** El plugin reduce su contrato a información académica y operativa: tipo, estado, URLs y listas de textos para orientación/mención. La API almacena perfiles y versiones, combina el perfil activo con el destino de WordPress y genera una revisión efectiva para cada envío. Un área administrativa Fastify protegida por OpenID Connect permite gestionar versiones; React consume el formulario compuesto y lo presenta como un asistente por pasos.

**Tech Stack:** TypeScript, Fastify, React, Zod, Kysely/PostgreSQL, Vitest, OpenID Connect con Google, WordPress PHP y PHPUnit-style contract tests.

**Spec:** `docs/superpowers/specs/2026-10-02-perfiles-de-formulario-y-autenticacion-admin-design.md`

## Global Constraints

- WordPress solo provee datos académicos y operativos; no campos, orden ni documentos del formulario.
- Tipos admitidos: `maestria`, `especializacion`, `diplomado`, `diploma` y `seminar`; `doctorado` es incompatible sin perfil.
- Orientación y mención son listas independientes de texto, sin IDs, y no existen en seminarios.
- Los perfiles y sus versiones viven en PostgreSQL; una versión activada nunca se modifica.
- El único administrador es `web@flacso.edu.uy`, autenticado solo por Google OIDC con `openid email profile`.
- No se eliminan metadatos legados de WordPress ni solicitudes existentes.
- Mantener subida temporal, transferencia a Drive al enviar y eliminación temporal únicamente después del éxito confirmado.
- Todo cambio debe tener pruebas, una migración explícita si afecta datos, commit descriptivo y publicación en `main`.

## Review Focus

- Un `doctorado` publicado sin perfil debe ser incompatible y no aceptar un envío; se prueba en la composición de perfiles (Task 3).
- Una oferta con solo orientación o solo mención debe mostrar y validar únicamente esa pregunta; se prueba en contrato, composición y UI pública (Tasks 1, 3 y 6).
- Dos versiones activadas consecutivamente no pueden cambiar la solicitud ya iniciada; un envío con revisión efectiva obsoleta debe devolver `STALE_REVISION` (Task 4).
- Un token Google válido de cualquier otro correo, o un correo no verificado, debe denegarse aun si el dominio es `flacso.edu.uy` (Task 5).
- Un archivo temporal no se elimina cuando una versión de perfil vuelve obsoleto el formulario ni cuando Drive falla; se prueba en la orquestación de envío existente ampliada (Task 4).

---

## File Structure

- Plugin: `modules/preinscripciones/includes/class-preinscriptions-{admin,config,serializer}.php` deja de configurar formularios y publica tipo/atributos académicos desde la oferta.
- Contratos: `packages/contracts/src/catalog.ts` declara `offerType`, atributos académicos y la referencia de perfil/versiones.
- Persistencia: migraciones Kysely agregan perfiles, versiones, auditoría, administrador Google y referencias de versión en solicitudes.
- Dominio: `apps/api/src/domain/form-profiles.ts` valida definiciones; `form-composition.ts` mezcla perfil y destino.
- Aplicación: servicios para perfiles, autenticación y administración exponen rutas privadas; el adaptador WordPress se simplifica al nuevo contrato.
- Web: componentes de asistente, formulario por pasos y panel administrativo consumen APIs separadas.

### Task 1: Simplificar el contrato público del plugin

**Files:**
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-admin.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-config.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-serializer.php`
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-meta.php`
- Test: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/tests/preinscriptions-rest-contract-test.php`

**Interfaces:**
- Produces WordPress targets with `offer.type`, `offer.orientations: string[]` and `offer.mentions: string[]`; seminar targets use `type: 'seminar'` and empty arrays.
- Removes the form/document metaboxes from cohorts and editions but preserves existing post meta untouched.

- [ ] **Step 1: Write failing plugin contract tests**

Assert a `maestria` offer serializes its taxonomy type and the existing academic `orientaciones`/`menciones` meta as deduplicated text lists; assert no record contains `id`, `form.inputs` or `form.documents`. Assert a seminar emits `type: 'seminar'` and empty lists.

- [ ] **Step 2: Run the focused plugin test to verify it fails**

Run: `php tests/preinscriptions-rest-contract-test.php`

Expected: FAIL because the serializer still derives `form` and uses preinscription meta.

- [ ] **Step 3: Implement the reduced serializer and admin cleanup**

Add a text-list sanitizer that preserves presentation order while deduplicating exact normalized values. Read type through `FLACSO_Oferta_Academica::get_tipo()`, and read `orientaciones`/`menciones` from the offer’s academic metadata. Include only the operational WordPress fields in `configRevision`.

- [ ] **Step 4: Run plugin contract and syntax checks**

Run: `php tests/preinscriptions-rest-contract-test.php && find modules/preinscripciones -name '*.php' -print0 | xargs -0 -n1 php -l`

Expected: PASS with no PHP syntax errors.

- [ ] **Step 5: Commit and publish the plugin contract**

```bash
git add modules/preinscripciones tests/preinscriptions-rest-contract-test.php
git commit -m "feat: expose academic attributes for preinscriptions"
git push origin main
```

### Task 2: Model profiles, versions and administrative identity

**Files:**
- Create: `apps/api/src/infrastructure/database/migrations/003_form_profiles_and_admin_auth.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts`
- Create: `apps/api/src/domain/form-profiles.ts`
- Create: `apps/api/src/domain/form-profiles.test.ts`
- Create: `apps/api/src/infrastructure/database/postgres-form-profile-repository.ts`
- Create: `apps/api/src/ports/form-profile-repository.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Produces `FormProfile`, immutable `FormProfileVersion`, `EffectiveProfile`, `AdminUser`, and `FormProfileRepository`.
- `FormProfileRepository.getActive(type: OfferType): Promise<EffectiveProfile | null>` is consumed by Task 3.
- `FormProfileRepository.createVersion(command, actorId): Promise<FormProfileVersion>` validates before persisting and Task 5 uses it.

- [ ] **Step 1: Write failing domain tests for profile definitions**

Test default documents for every supported type, two recommendation letters for a maestría, no academic-attribute rules for a seminar, duplicate keys/orders, and an unsupported `doctorado` profile.

- [ ] **Step 2: Run the domain tests to verify they fail**

Run: `pnpm --filter api test -- form-profiles.test.ts`

Expected: FAIL because profile types and repository do not exist.

- [ ] **Step 3: Add additive database schema and validated profile types**

Create tables `admin_users`, `form_profiles`, `form_profile_versions` and `form_profile_audit_events`. Use immutable version rows with a JSON definition validated by Zod; seed exactly one active version for the five supported types. Add a nullable submission reference/snapshot only through additive columns, never rewriting old rows.

- [ ] **Step 4: Run focused tests and a clean migration**

Run: `pnpm --filter api test -- form-profiles.test.ts postgres-submission-repository.test.ts && pnpm --filter api typecheck`

Expected: PASS and migration completes against the test PostgreSQL database.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat: add versioned preinscription form profiles"
```

### Task 3: Compose an effective form from profile plus WordPress target

**Files:**
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`
- Modify: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`
- Modify: `apps/api/src/domain/form-composition.ts`
- Modify: `apps/api/src/domain/form-definition.ts`
- Modify: `apps/api/src/application/discover-targets.ts`
- Modify: `apps/api/src/application/get-target-form.ts`
- Test: `apps/api/src/infrastructure/wordpress/wordpress-contract.test.ts`
- Test: `apps/api/src/domain/form-composition.test.ts`
- Test: `apps/api/src/application/catalog.test.ts`

**Interfaces:**
- Consumes the Task 1 JSON contract and `FormProfileRepository.getActive` from Task 2.
- Produces `FormDefinition` containing `profileVersionId` and `effectiveRevision` for the frontend and Task 4.

- [ ] **Step 1: Write failing adapter and composition tests**

Cover five recognized types, `doctorado` incompatibility, independent orientation/mención conditions, empty lists, seminar exclusion, and type/schema rejection for WordPress records that try to supply fields or IDs.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter api test -- wordpress-contract.test.ts form-composition.test.ts catalog.test.ts`

Expected: FAIL because the old adapter expects WordPress form configuration.

- [ ] **Step 3: Implement the new composed catalog**

Extend Zod schemas with `offer.type`, academic text lists and seminar type. Remove dependence on `raw.form`; compose profile rules only after loading the active profile. Hash the WordPress revision and profile version/revision into an opaque `effectiveRevision`.

- [ ] **Step 4: Run focused API verification**

Run: `pnpm --filter api test -- wordpress-contract.test.ts form-composition.test.ts catalog.test.ts && pnpm --filter api typecheck`

Expected: PASS; a doctorado appears only as incompatible diagnostics.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src
git commit -m "feat: compose forms from offer type profiles"
```

### Task 4: Snapshot profile versions and revalidate submissions

**Files:**
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Modify: `apps/api/src/domain/form-validation.ts`
- Modify: `apps/api/src/domain/spreadsheet-row.ts`
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.ts`
- Modify: `apps/api/src/infrastructure/database/in-memory-submission-repository.ts`
- Modify: `apps/api/src/ports/submission-repository.ts`
- Test: `apps/api/src/application/submit-preinscription.test.ts`
- Test: `apps/api/src/domain/form-validation.test.ts`
- Test: `apps/api/src/presentation/http/submission-files.test.ts`

**Interfaces:**
- Consumes `effectiveRevision` and profile version identity from Task 3.
- Persists the immutable profile snapshot with each submission and returns existing error code `STALE_REVISION` when either source changes.

- [ ] **Step 1: Write failing submission tests**

Test a stale WordPress revision, a changed active profile, a prior submission retaining its profile snapshot, spreadsheet rows storing orientation/mención text, and a Drive failure retaining temporary files.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter api test -- submit-preinscription.test.ts form-validation.test.ts submission-files.test.ts`

Expected: FAIL because submissions only compare the WordPress revision.

- [ ] **Step 3: Implement effective revision revalidation and snapshot persistence**

Recompose the target at submit time, compare the submitted effective revision, persist `profileVersionId` plus canonical profile snapshot inside the same submission transaction, and use only selected text values for spreadsheet columns. Keep the existing Drive success/cleanup sequence unchanged.

- [ ] **Step 4: Run API checks**

Run: `pnpm --filter api test && pnpm --filter api typecheck`

Expected: PASS, including temporary-file preservation after failure.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat: snapshot profile versions on submissions"
```

### Task 5: Provide Google-only administration APIs

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/infrastructure/auth/google-oidc.ts`
- Create: `apps/api/src/application/admin-session.ts`
- Create: `apps/api/src/presentation/http/admin-auth-routes.ts`
- Create: `apps/api/src/presentation/http/admin-profile-routes.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Test: `apps/api/src/infrastructure/auth/google-oidc.test.ts`
- Test: `apps/api/src/presentation/http/admin-auth-routes.test.ts`
- Test: `apps/api/src/presentation/http/admin-profile-routes.test.ts`

**Interfaces:**
- `GoogleIdentityVerifier.verify(code, redirectUri): Promise<VerifiedGoogleIdentity>` verifies issuer, audience, nonce and `email_verified`.
- `requireAdminSession(request): Promise<AdminUser>` guards all profile mutation routes.
- `POST /api/admin/profiles/:type/versions` creates a version; `POST /api/admin/profiles/:type/activate/:versionId` activates it.

- [ ] **Step 1: Write failing authentication and authorization tests**

Mock Google OIDC discovery/token exchange. Assert only verified `web@flacso.edu.uy` receives a session; reject other users, unverified email, bad nonce and expired session. Assert unauthenticated profile edits return 401 and invalid definitions return 422.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter api test -- google-oidc.test.ts admin-auth-routes.test.ts admin-profile-routes.test.ts`

Expected: FAIL because no admin routes or Google verifier exist.

- [ ] **Step 3: Implement the minimal OIDC and session boundary**

Add one maintained OIDC dependency only. Store authorization state/nonce server-side, issue secure HTTP-only sessions, use `SameSite=Lax` and CSRF verification for mutations, and load OAuth client credentials exclusively from runtime configuration. Upsert the single Google identity in `admin_users`; log login and profile actions in audit events.

- [ ] **Step 4: Run auth and API verification**

Run: `pnpm --filter api test && pnpm --filter api typecheck`

Expected: PASS with no OAuth secrets or tokens printed by tests/logs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src
git commit -m "feat: add Google-only profile administration"
```

### Task 6: Build the public wizard and administrative profile editor

**Files:**
- Create: `apps/web/src/components/PreinscriptionWizard.tsx`
- Create: `apps/web/src/components/WizardProgress.tsx`
- Create: `apps/web/src/components/FormStep.tsx`
- Modify: `apps/web/src/components/DynamicForm.tsx`
- Modify: `apps/web/src/components/OrientationMentionFields.tsx`
- Modify: `apps/web/src/pages/TargetPage.tsx`
- Create: `apps/web/src/pages/AdminLoginPage.tsx`
- Create: `apps/web/src/pages/AdminProfilesPage.tsx`
- Create: `apps/web/src/components/ProfileVersionEditor.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api/client.ts`
- Test: `apps/web/src/components/PreinscriptionWizard.test.tsx`
- Test: `apps/web/src/pages/AdminProfilesPage.test.tsx`
- Test: `apps/web/src/pages/TargetPage.test.tsx`

**Interfaces:**
- Consumes `FormDefinition.profileVersionId`, `effectiveRevision` and the Task 5 administration endpoints.
- Produces accessible 5-step offer and 4-step seminar flows; `DynamicForm` continues to return values and temporary upload tokens to `TargetPage`.

- [ ] **Step 1: Write failing UI tests**

Cover introduction/progress, blocked advance on invalid current step, navigation to visited steps, separate conditional orientation/mención fields, no attributes for seminars, final confirmation before submission, profile editor validation errors, and unauthenticated admin redirect.

- [ ] **Step 2: Run web tests to verify they fail**

Run: `pnpm --filter web test -- PreinscriptionWizard.test.tsx AdminProfilesPage.test.tsx TargetPage.test.tsx`

Expected: FAIL because wizard and admin UI do not exist.

- [ ] **Step 3: Implement the React flows**

Port the approved visual language as React components, not Django templates. Keep values in memory while navigating and retain the existing immediate temporary upload behavior. Render the current form profile exactly; never infer a question directly from cohort data. The editor always creates a new version and exposes activation separately.

- [ ] **Step 4: Run web validation**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

Expected: PASS with direct legacy URLs still resolving to their target forms.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add preinscription wizard and profile editor"
```

### Task 7: Integrate, document and release safely

**Files:**
- Modify: `apps/api/src/fixtures/wordpress-preinscriptions.json`
- Modify: `apps/api/src/infrastructure/fixtures/fixture-academic-catalog.ts`
- Modify: `tests/e2e/preinscriptions.spec.ts`
- Modify: `README.md`
- Modify: `docs/INTEGRACION_WORDPRESS.md`
- Modify: `docs/ARQUITECTURA.md`

**Interfaces:**
- Uses the live-shaped WordPress fixture and test profiles created in Tasks 1–6.
- Documents runtime variables `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `GOOGLE_OIDC_REDIRECT_URI` without values.

- [ ] **Step 1: Write failing end-to-end scenarios**

Add one maestría with only orientations, one offer with only mentions, one seminar, one doctorado, a profile activation yielding a stale submission, and a Google-denied admin route.

- [ ] **Step 2: Run E2E to verify it fails**

Run: `pnpm exec playwright test tests/e2e/preinscriptions.spec.ts`

Expected: FAIL until the new fixtures and flows are wired together.

- [ ] **Step 3: Update fixtures and operational documentation**

Document the changed responsibility boundary, Google redirect registration, profile seeding/activation and rollback by selecting an earlier version. Mark the older WordPress-integration document sections that claim per-cohort form ownership as superseded.

- [ ] **Step 4: Run full local verification**

Run: `pnpm test && pnpm --filter api typecheck && pnpm --filter web typecheck && pnpm --filter web build && pnpm exec playwright test tests/e2e/preinscriptions.spec.ts`

Expected: PASS with all unit, integration, build and browser checks green.

- [ ] **Step 5: Publish and verify separately**

Commit documentation and fixtures, push both repositories to `main`, then verify plugin release/deployment, application deployment, exact deployed SHAs, migrations, Google callback configuration, `/api/health`, live WordPress REST and one browser route. Do not claim production readiness before all are confirmed.

## Self-review

- Spec coverage: Tasks 1–4 implement the new data ownership, versions and submission safety; Task 5 implements the Google-only administrative boundary; Task 6 implements public/admin UI; Task 7 proves and documents the integrated result.
- Step scan: every task starts red, identifies exact files/interfaces, passes focused tests and has a commit boundary.
- Type consistency: `OfferType`, `FormProfileRepository`, `EffectiveProfile`, `effectiveRevision` and `profileVersionId` originate in Task 2 and are consumed consistently by Tasks 3–6.
- Review focus: each listed risk is covered in the named task.
- Proportion: this plan records decisions and checks, leaving implementation bodies to the executor.
