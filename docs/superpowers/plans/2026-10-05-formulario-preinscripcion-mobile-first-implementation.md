# Formulario de preinscripción mobile-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehacer la experiencia pública del formulario para celular, separando claramente trayectoria de la persona y datos específicos de la preinscripción, sin cambiar contratos ni reglas.

**Architecture:** El wizard actual seguirá siendo dueño del estado y del envío. Se extraerán componentes presentacionales para introducción, progreso móvil, resumen de errores, tarjetas documentales y resumen final; las reglas de validación seguirán derivándose de `FormDefinition`. La vista de orientación/mención será una sección separada y condicional, no parte de trayectoria académica.

**Tech Stack:** React, TypeScript, CSS existente, Vite, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-formulario-preinscripcion-mobile-first-design.md`

## Global Constraints

- “La trayectoria académica describe a la persona postulante.”
- “Orientación y mención describen la propuesta de preinscripción.”
- Se mantienen documentos obligatorios, cartas de recomendación de Maestría, país/ciudad de residencia y revalidación del destino.
- El diseño debe funcionar primero entre 360 y 430 px.
- No agregar guardado silencioso de datos personales ni nuevas dependencias.
- No cambiar API, claves canónicas, persistencia, Google Drive ni Google Sheets.

## Review Focus

- iPhone/Android con teclado abierto: ningún CTA debe quedar oculto ni provocar zoom horizontal; fijar en Tarea 3.
- Orientación/mención ausentes: no debe quedar una sección vacía ni un paso fantasma; fijar en Tarea 2.
- Subida de varios documentos con una carga fallida: los archivos correctos deben conservarse; fijar en Tarea 4.
- Error de validación en una sección anterior: el usuario debe llegar al campo correcto sin perder valores; fijar en Tarea 3.
- Pantalla de revisión larga: editar una sección no debe limpiar archivos ni reiniciar el wizard; fijar en Tarea 5.

---

### Task 1: Modelar agrupaciones visuales y estados derivados

**Files:**
- Create: `apps/web/src/components/preinscription-form-view-model.ts`
- Test: `apps/web/src/components/preinscription-form-view-model.test.ts`
- Modify: `packages/contracts/src/canonical-forms.ts` only if an existing label/description is technically incorrect; do not alter field keys or validation rules.

**Interfaces:**
- Produce pure functions:
  - `getMobileFormSections(form: FormDefinition): MobileFormSection[]`.
  - `getDocumentProgress(documents: DocumentDefinition[], files: SubmissionFileToken[]): { uploaded: number; required: number; complete: boolean }`.
  - `getFirstErrorSectionIndex(sections: MobileFormSection[], errors: Record<string, string>): number`.
- `MobileFormSection` must distinguish `academic-history` from `preinscription-options`.

- [ ] **Step 1: Write failing unit tests** for the section order, conditional omission of orientation/mención, document progress and first-error mapping.
- [ ] **Step 2: Run the focused tests** and confirm the new view model is missing.
- [ ] **Step 3: Implement the pure view-model functions** without duplicating validation rules.
- [ ] **Step 4: Run the focused tests** and confirm they pass.
- [ ] **Step 5: Commit** `feat: model mobile preinscription sections`.

### Task 2: Add the mobile-first introduction and semantic section copy

**Files:**
- Create: `apps/web/src/components/PreinscriptionStartCard.tsx`
- Create: `apps/web/src/components/PreinscriptionStartCard.test.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modify: `apps/web/src/components/FormStep.tsx`
- Test: `apps/web/src/components/PreinscriptionWizard.test.tsx`

**Interfaces:**
- `PreinscriptionStartCard` receives `title`, `documentSummary`, `sectionCount`, `onStart` and `disabled`.
- `PreinscriptionWizard` owns `hasStarted` and renders the start card before the first form section.

- [ ] **Step 1: Write failing component tests** for the start card copy, document checklist, start action and absence of form fields before starting.
- [ ] **Step 2: Write failing semantic tests** asserting that trajectory headings do not contain orientation/mención and that a separate “Sobre esta preinscripción” section renders only when options exist.
- [ ] **Step 3: Run focused tests** and confirm the current wizard fails these expectations.
- [ ] **Step 4: Implement the introduction card and semantic section labels/descriptions** while preserving existing field keys and values.
- [ ] **Step 5: Run wizard/component tests** and confirm existing validation behavior remains green.
- [ ] **Step 6: Commit** `feat: clarify preinscription context and academic sections`.

### Task 3: Replace desktop-style progress/navigation with mobile-first controls

**Files:**
- Modify: `apps/web/src/components/WizardProgress.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modify: `apps/web/src/app.css`
- Create: `apps/web/src/components/MobileWizardNavigation.tsx`
- Test: `apps/web/src/components/WizardProgress.test.tsx`
- Test: `apps/web/src/components/MobileWizardNavigation.test.tsx`
- Test: `tests/e2e/preinscriptions.spec.ts`

**Interfaces:**
- `WizardProgress` receives current/total state and exposes only reached-step navigation.
- `MobileWizardNavigation` receives `canGoBack`, `canContinue`, `isFinalStep`, `isSubmitting`, `onBack`, `onContinue` and `continueLabel`.

- [ ] **Step 1: Write failing tests** for “Paso X de Y”, compact progress, disabled/unreached steps, keyboard focus and fixed mobile navigation labels.
- [ ] **Step 2: Run focused tests** and confirm the current horizontal progress/navigation does not meet the mobile contract.
- [ ] **Step 3: Implement compact progress** with no horizontal scrolling requirement and visible `aria-current="step"`.
- [ ] **Step 4: Implement mobile navigation** with safe-area padding, 44 px minimum targets, and desktop fallback styling.
- [ ] **Step 5: Update scroll/focus behavior** so advancing, returning and validation errors land at an actionable location.
- [ ] **Step 6: Run focused tests and the mobile Playwright viewport checks** at 360 px and 390 px.
- [ ] **Step 7: Commit** `fix: make wizard navigation mobile first`.

### Task 4: Redesign document cards and mobile upload states

**Files:**
- Create: `apps/web/src/components/DocumentUploadCard.tsx`
- Modify: `apps/web/src/components/DocumentUploadFields.tsx`
- Modify: `apps/web/src/components/TitleDocumentFields.tsx`
- Modify: `apps/web/src/app.css`
- Test: `apps/web/src/components/DocumentUploadCard.test.tsx`
- Test: `apps/web/src/components/DocumentUploadFields.test.tsx`
- Test: `apps/web/src/components/TitleDocumentFields.test.tsx`

**Interfaces:**
- `DocumentUploadCard` receives document definition, current files, upload state, error state, disabled state and callbacks for add/remove/replace.
- Existing `onUpload`, `onFileToken`, `onRemoveToken` contracts remain unchanged.

- [ ] **Step 1: Write failing tests** for empty, uploading, uploaded, replacing, removing and failed states.
- [ ] **Step 2: Write failing tests** for aggregate progress and preservation of other files after one upload fails.
- [ ] **Step 3: Run focused tests** and confirm the current raw file inputs do not satisfy the card states.
- [ ] **Step 4: Implement accessible cards** with large “Agregar archivo” actions, accepted formats, size, filename, replace/remove and status text.
- [ ] **Step 5: Preserve title conditional behavior** for “No poseo actualmente título” and the required title denomination/file rules.
- [ ] **Step 6: Add mobile CSS** for readable cards, no clipped filenames, full-width actions and visible upload feedback.
- [ ] **Step 7: Run focused component tests and the document-flow E2E tests.**
- [ ] **Step 8: Commit** `fix: improve mobile document uploads`.

### Task 5: Improve validation summary, review and success states

**Files:**
- Create: `apps/web/src/components/FormErrorSummary.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modify: `apps/web/src/components/PreinscriptionSummary.tsx`
- Modify: `apps/web/src/pages/TargetPage.tsx`
- Modify: `apps/web/src/app.css`
- Test: `apps/web/src/components/FormErrorSummary.test.tsx`
- Test: `apps/web/src/components/PreinscriptionSummary.test.tsx`
- Test: `apps/web/src/pages/TargetPage.test.tsx`

**Interfaces:**
- `FormErrorSummary` receives ordered field errors and `onSelectField(key)`.
- The summary renders separate cards for personal data, residence/contact, academic history, preinscription options, documents, and declarations.

- [ ] **Step 1: Write failing tests** for ordered error links, focusing the correct input, separate academic/preinscription summary cards and edit actions.
- [ ] **Step 2: Run focused tests** and confirm the existing generic summary is insufficient.
- [ ] **Step 3: Implement the error summary** with accessible links and no color-only meaning.
- [ ] **Step 4: Implement the grouped review cards** without changing submitted values or file tokens.
- [ ] **Step 5: Improve success state** with copyable tracking code, concise next steps and mobile-sized actions.
- [ ] **Step 6: Run focused tests and existing full wizard tests.**
- [ ] **Step 7: Commit** `fix: clarify mobile review and submission states`.

### Task 6: Responsive visual verification and handoff

**Files:**
- Modify: `docs/DEPLOY.md` or create `docs/FORMULARIO-MOBILE.md`
- Test: `tests/e2e/preinscriptions.spec.ts`
- Test: `tests/e2e/document-flow.spec.ts`

- [ ] **Step 1: Add E2E coverage** for 360 px and 390 px: start card, section sequence, conditional orientation/mención, validation recovery, document upload and review.
- [ ] **Step 2: Run web typecheck, component tests, E2E tests and production build.**
- [ ] **Step 3: Review the real served artifact in a browser at mobile and desktop widths; inspect keyboard/focus, sticky navigation, long labels and file names.**
- [ ] **Step 4: Run `git diff --check` and audit that no fields, API contracts, document requirements or private data behavior changed.**
- [ ] **Step 5: Document the mobile QA checklist and hand off the branch to Agy.**
- [ ] **Step 6: Do not deploy or publish from this plan-only work.**

## Execution order

Tasks 1–2 establish the semantic model and section copy. Task 3 can follow them and changes the navigation shell. Task 4 can run in parallel with Task 3 after the existing upload contracts are confirmed. Task 5 depends on the final section model. Task 6 is the release gate and must run last.

## Self-review

- Spec coverage: mobile-first entry, semantic separation, progress/navigation, fields, documents, review, errors, success, accessibility and privacy are covered by Tasks 1–6.
- Contract safety: the plan explicitly preserves input keys, document keys, upload tokens, API routes and server validation.
- Review focus coverage: small viewports, absent options, partial upload failure, validation recovery and long review flows each have dedicated tests.
- Scope: no code, tests, build, migration, commit, push or deployment is executed by this planning turn.
