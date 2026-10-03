# Formularios canónicos de preinscripción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir los perfiles de formulario editables por un formulario canónico en código, con cartas de recomendación obligatorias únicamente para Maestría.

**Architecture:** Una fábrica pura de formulario canónico reemplaza el repositorio de perfiles para composición y validación. La API conserva el contrato de formulario público con `profileVersionId: "canonical-v1"`, mientras que las tablas y las solicitudes históricas se preservan sin consumidores nuevos. El frontend continúa renderizando la definición servida por la API, pero se retira la administración de perfiles.

**Tech Stack:** TypeScript, Node.js, Express, React, Vite, PostgreSQL, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-10-03-formularios-canonicos-design.md`

## Global Constraints

- WordPress sigue siendo la fuente de verdad de propuestas, apertura, convenios, orientaciones y menciones.
- Los formularios se definen únicamente en código; no habrá JSON ni edición web de campos, pasos, documentos o versiones.
- Todos los tipos usan el mismo formulario base; Maestría agrega exactamente dos cartas de recomendación.
- Documento de identidad, CV, título, carta de motivación y las cartas de Maestría son obligatorios al enviar; no existe envío posterior.
- Residencia contiene `paisResidencia` y `ciudadResidencia`; no contiene domicilio completo.
- No eliminar ni reescribir solicitudes históricas ni tablas de perfiles en esta entrega.
- Mantener las rutas y la autenticación administrativa no relacionadas con Perfiles, Drive y Planillas.

## Review Focus

- Una Maestría sin una de sus cartas debe rechazar el envío con un error del campo faltante; cubrir en Task 2.
- Un Seminario no debe recibir cartas de recomendación, pero sí los documentos comunes obligatorios; cubrir en Task 1.
- Una respuesta afirmativa de convenio sin convenio disponible o seleccionado debe rechazar el envío; cubrir en Task 2.
- Un destino sin orientaciones o menciones no debe renderizar ni aceptar esas claves; cubrir en Task 1.
- Una solicitud histórica con `profile_version_id` y `profile_snapshot` debe permanecer legible tras la migración; cubrir en Task 4.

---

## File structure

- Create `apps/api/src/domain/canonical-forms.ts`: pasos, campos, documentos y composición pura por tipo y opciones WordPress.
- Create `apps/api/src/domain/canonical-forms.test.ts`: matriz de tipos, documentos, residencia y condiciones de catálogo.
- Modify `apps/api/src/domain/form-definition.ts`: reemplazar `domicilio` por `ciudadResidencia`; declarar documentos sin `canDefer`.
- Modify `apps/api/src/domain/form-composition.ts`: delegar en la definición canónica y calcular revisión con `canonical-v1`.
- Modify `apps/api/src/application/get-target-form.ts` and `apps/api/src/application/submit-preinscription.ts`: eliminar la dependencia de `FormProfileRepository`.
- Modify `apps/api/src/presentation/http/app.ts` and `apps/api/src/main.ts`: retirar la inyección y las rutas de perfiles, conservando auth y settings.
- Delete `apps/api/src/presentation/http/admin-profile-routes.ts` and its test: la administración de perfiles deja de existir.
- Modify `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/pages/AdminProfilesPage.tsx` and related tests: retirar la ruta y navegación de Perfiles; conservar Drive y Planillas.
- Modify `apps/web/src/components/UniversalFields.tsx`, `apps/web/src/components/PreinscriptionWizard.tsx` and tests: presentar ciudad de residencia y ningún control de documento diferible.
- Modify `apps/api/src/infrastructure/database/migrations/006_form_profiles_and_admin_auth.ts` only if needed to avoid sembrar perfiles en instalaciones nuevas; no incluir `down` destructivo ni borrar las tablas existentes.

### Task 1: Definición canónica y composición de formulario

**Files:**
- Create: `apps/api/src/domain/canonical-forms.ts`
- Create: `apps/api/src/domain/canonical-forms.test.ts`
- Modify: `apps/api/src/domain/form-definition.ts`
- Modify: `apps/api/src/domain/form-composition.ts`
- Test: `apps/api/src/domain/form-composition.test.ts`

**Interfaces:**
- Consumes: `AcademicTarget` y `AgreementOption` de `@flacso/contracts`.
- Produces: `composeCanonicalForm(target: AcademicTarget, agreements: AgreementOption[]): CompositionResult` y `CANONICAL_FORM_VERSION = 'canonical-v1'`.

- [ ] **Step 1: Escribir las pruebas fallidas de la matriz canónica**

```ts
expect(composeCanonicalForm(maestria, agreements).value.documents.map(({ key }) => key))
  .toEqual(['identidad', 'cv', 'titulo', 'cartaMotivacion', 'cartaRecomendacion1', 'cartaRecomendacion2']);
expect(composeCanonicalForm(seminar, agreements).value.documents.map(({ key }) => key))
  .toEqual(['identidad', 'cv', 'titulo', 'cartaMotivacion']);
expect(form.inputs.find((input) => input.key === 'ciudadResidencia')).toBeDefined();
expect(form.inputs.find((input) => input.key === 'domicilio')).toBeUndefined();
```

- [ ] **Step 2: Ejecutar las pruebas para confirmar que fallan**

Run: `pnpm --filter api test -- canonical-forms.test.ts form-composition.test.ts`

Expected: FAIL porque no existe `composeCanonicalForm`.

- [ ] **Step 3: Implementar `composeCanonicalForm` y actualizar las definiciones de entradas y documentos**

Declarar cinco pasos para todos los tipos. Configurar documentos obligatorios y omitir `canDefer`; añadir cartas obligatorias solo cuando `offerType === 'maestria'`. Incluir orientación y mención solo cuando el catálogo tiene opciones. Calcular `effectiveRevision` con `target.configRevision`, `canonical-v1` y la definición efectiva.

- [ ] **Step 4: Ejecutar las pruebas de dominio**

Run: `pnpm --filter api test -- canonical-forms.test.ts form-composition.test.ts form-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain
git commit -m "feat(forms): define canonical registration forms"
```

### Task 2: Lectura, validación y envío sin perfiles

**Files:**
- Modify: `apps/api/src/application/get-target-form.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Modify: `apps/api/src/application/get-target-form.test.ts`
- Modify: `apps/api/src/application/submit-preinscription.test.ts`
- Modify: `apps/api/src/presentation/http/target-routes.ts`
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Test: `apps/api/src/presentation/http/target-routes.test.ts`
- Test: `apps/api/src/presentation/http/submission-routes.test.ts`

**Interfaces:**
- Consumes: `composeCanonicalForm(target, agreements)` from Task 1.
- Produces: `getTargetForm(catalog, targetId)` and `submitPreinscription(catalog, repository, command)` with no `FormProfileRepository` parameter.

- [ ] **Step 1: Escribir pruebas fallidas de integración para formulario y envío canónicos**

```ts
expect((await getTargetForm(catalog, target.id)).form.profileVersionId).toBe('canonical-v1');
expect(result.fieldErrors).toEqual({ cartaRecomendacion1: ['El documento Primera carta de recomendación es obligatorio.'] });
```

Agregar casos para convenio afirmativo sin selección, destino sin orientación/mención y documento obligatorio no adjuntado.

- [ ] **Step 2: Ejecutar las pruebas para confirmar que fallan**

Run: `pnpm --filter api test -- get-target-form.test.ts submit-preinscription.test.ts target-routes.test.ts submission-routes.test.ts`

Expected: FAIL porque las aplicaciones aún requieren `FormProfileRepository` y admiten documentos diferibles.

- [ ] **Step 3: Reemplazar la composición y guardar la instantánea canónica**

Eliminar las consultas a perfil activo. Cargar convenios cuando el formulario canónico los usa. En la persistencia pasar `profileVersionId: 'canonical-v1'` y una instantánea de la definición canónica efectiva; no cambiar la lectura de registros históricos.

- [ ] **Step 4: Ejecutar las pruebas de aplicación y HTTP**

Run: `pnpm --filter api test -- get-target-form.test.ts submit-preinscription.test.ts target-routes.test.ts submission-routes.test.ts submission-files.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/application apps/api/src/presentation/http apps/api/src/domain
git commit -m "feat(forms): submit canonical registration forms"
```

### Task 3: Retiro de la administración de perfiles

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/presentation/http/app.ts`
- Create: `apps/api/src/presentation/http/app.test.ts`
- Delete: `apps/api/src/presentation/http/admin-profile-routes.ts`
- Delete: `apps/api/src/presentation/http/admin-profile-routes.test.ts`
- Delete: `apps/api/src/infrastructure/fixtures/memory-form-profile-repository.ts` if no runtime or test consumer remains
- Delete: `apps/api/src/ports/form-profile-repository.ts` if no runtime or test consumer remains
- Test: `apps/api/src/presentation/http/admin-auth-routes.test.ts`

**Interfaces:**
- Consumes: profile-free `getTargetForm` and `submitPreinscription` from Task 2.
- Produces: an Express app without `/api/admin/profiles` and without a profile repository dependency.

- [ ] **Step 1: Escribir pruebas fallidas de rutas retiradas y administración preservada**

```ts
expect((await fetch(`${baseUrl}/api/admin/profiles`)).status).toBe(404);
expect((await fetch(`${baseUrl}/api/admin/me`)).status).toBe(401);
```

- [ ] **Step 2: Ejecutar las pruebas para confirmar que fallan**

Run: `pnpm --filter api test -- app.test.ts admin-auth-routes.test.ts`

Expected: FAIL porque la ruta de perfiles sigue registrada.

- [ ] **Step 3: Retirar solo los consumidores operativos de perfiles**

Quitar la construcción de `PostgresFormProfileRepository`, la dependencia de `AppDependencies` y el montaje de `/api/admin/profiles`. Conservar `006_form_profiles_and_admin_auth.ts` y las tablas existentes; ajustar la siembra solo si una instalación nueva la ejecutaría sin necesidad.

- [ ] **Step 4: Ejecutar pruebas de arranque, migración y autenticación**

Run: `pnpm --filter api test -- admin-auth-routes.test.ts health.test.ts postgres-submission-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "refactor(admin): remove editable form profiles"
```

### Task 4: Interfaz pública y administración simplificada

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api/client.ts`
- Delete: `apps/web/src/pages/AdminProfilesPage.tsx`
- Delete: `apps/web/src/pages/AdminProfilesPage.test.tsx`
- Delete: `apps/web/src/components/ProfileVersionEditor.tsx`
- Modify: `apps/web/src/components/UniversalFields.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modify: `apps/web/src/components/UniversalFields.test.tsx`
- Modify: `apps/web/src/components/PreinscriptionWizard.test.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `FormDefinition` canónico de Task 2.
- Produces: asistente de cinco pasos sin domicilio ni adjuntos diferibles y sin ruta de edición de perfiles.

- [ ] **Step 1: Escribir pruebas fallidas de presentación canónica**

```tsx
expect(screen.getByLabelText('Ciudad de residencia')).toBeInTheDocument();
expect(screen.queryByLabelText(/Domicilio/)).not.toBeInTheDocument();
expect(screen.queryByText(/adjuntar después/i)).not.toBeInTheDocument();
```

Agregar un caso que muestra dos cartas obligatorias para Maestría y ninguno para Seminario.

- [ ] **Step 2: Ejecutar las pruebas para confirmar que fallan**

Run: `pnpm --filter web test -- UniversalFields.test.tsx PreinscriptionWizard.test.tsx App.test.tsx`

Expected: FAIL porque la interfaz aún representa domicilio, perfiles o diferimiento.

- [ ] **Step 3: Aplicar el contrato canónico en React**

Eliminar navegación, cliente y componentes de perfiles. Actualizar el control de residencia a país/ciudad y retirar cualquier estado, copia y envío asociado a documentos diferibles. Mantener navegación, autenticación y administración de Drive/Planillas que no dependan de perfiles.

- [ ] **Step 4: Ejecutar pruebas de interfaz y compilación**

Run: `pnpm --filter web test -- UniversalFields.test.tsx PreinscriptionWizard.test.tsx App.test.tsx TargetPage.test.tsx && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): render canonical registration form"
```

### Task 5: Compatibilidad histórica y verificación final

**Files:**
- Modify: `apps/api/src/infrastructure/database/postgres-submission-repository.test.ts`
- Modify: `apps/api/src/infrastructure/database/schema.ts` only if generated types require retaining nullable historical profile fields
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-03-formularios-canonicos-design.md` only if implementation reveals a non-ambiguous correction

**Interfaces:**
- Consumes: canonical submissions from Task 2 and unchanged historical columns.
- Produces: proof that historical rows remain readable and operational documentation that no longer advertises editable profiles.

- [ ] **Step 1: Escribir la prueba fallida de compatibilidad histórica**

```ts
await insertLegacySubmission({ profile_version_id: 'ver_legacy', profile_snapshot: { steps: [] } });
await expect(repository.findById(legacyId)).resolves.toMatchObject({ id: legacyId });
```

- [ ] **Step 2: Ejecutar la prueba para confirmar que falla o documentar que ya pasa**

Run: `pnpm --filter api test -- postgres-submission-repository.test.ts`

Expected: PASS after confirming that the canonical path did not change historical reads; if it already passes, record that as the regression test.

- [ ] **Step 3: Ajustar solo la documentación y tipos necesarios**

No crear una migración que borre perfiles ni columnas históricas. Actualizar README para indicar que la definición canónica se cambia por código y que todas las cargas son obligatorias al enviar.

- [ ] **Step 4: Ejecutar la verificación integral**

Run: `pnpm test && pnpm typecheck && pnpm build && git diff --check`

Expected: PASS en contratos, API y web.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/api/src/infrastructure/database docs/superpowers/specs
git commit -m "docs: document canonical form administration"
```
