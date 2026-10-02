# Jerarquía de Google Drive y nombres semánticos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear automáticamente la jerarquía institucional de Google Drive y subir nuevos documentos con nombres semánticos, conservando el flujo de archivos temporales y la trazabilidad.

**Architecture:** Una unidad pura de dominio construirá los segmentos de carpeta y el nombre final del archivo. El repositorio de Google Drive resolverá o creará las carpetas hijas bajo la raíz configurada y subirá cada archivo a `Documentación`; la ruta de envío pasará el destino revalidado, los valores de identidad y la clave documental.

**Tech Stack:** TypeScript, Node.js, Express, Vitest, Google Drive REST API v3, PostgreSQL para la configuración de la raíz.

**Spec:** `docs/superpowers/specs/2026-10-02-google-drive-hierarchy-and-semantic-files-design.md`

## Global Constraints

- La carpeta raíz se obtiene de `system_settings` y sigue siendo configurable desde `/admin/perfiles`.
- Las ofertas académicas usan `Ofertas académicas/<oferta>/<cohorte>/`; los seminarios usan `Seminarios/<seminario>/<edición>/`.
- Cada destino crea `Preinscripciones` y `Documentación`; los documentos cargados van a `Documentación`.
- Los nombres de archivo usan `apellidos-...__nombres-...__tipo-documento__id-solicitud.extensión`.
- Segundo apellido y segundo nombre se omiten completamente cuando están vacíos.
- Se conservan los archivos temporales hasta completar correctamente la subida.
- Los archivos históricos no se migran ni se renombran.
- No se agregan credenciales ni valores sensibles al repositorio.

## Review Focus

- Campos opcionales de identidad: comprobar que no haya segmentos vacíos ni separadores duplicados.
- Destinos académicos y seminarios: comprobar que cada tipo construya el nivel correcto y nunca mezcle ramas.
- Reintentos/concurrencia de creación: comprobar que una carpeta existente se reutilice y no se creen duplicados innecesarios.
- Nombres originales y extensiones: comprobar que la semántica nueva no pierda el nombre original ni genere extensiones inválidas.
- Errores parciales de Drive: comprobar que falle el envío y se conserve el temporal si falla la creación o la subida.

---

### Task 1: Utilidades puras para destino y nombre semántico

**Files:**
- Create: `apps/api/src/domain/google-drive-naming.ts`
- Test: `apps/api/src/domain/google-drive-naming.test.ts`

**Interfaces:**
- Produces `DriveTargetDescriptor` con `targetId`, `kind`, `offerName`, `cohortName`, `cohortNumber`, `seminarName`, `editionName` y `editionNumber` opcionales según corresponda.
- Produces `buildDriveFolderNames(target: DriveTargetDescriptor): string[]`, incluyendo únicamente la rama y los niveles del destino, sin `Preinscripciones` ni `Documentación`.
- Produce `buildSemanticDriveFileName(input: { submissionId: string; fieldKey: string; originalName: string; mimeType: string; values: Record<string, string>; ordinal: number }): string`.
- Produce `sanitizeDriveSegment(value: string): string` como función pura y determinista.

- [ ] **Step 1: Write the failing tests**

  En `google-drive-naming.test.ts`, cubrir:
  - oferta académica `Maestría en Educación` + `Cohorte VII` → `['Ofertas académicas', 'Maestría en Educación', 'Cohorte VII']`;
  - seminario + número de edición cuando no hay nombre → rama `Seminarios` y fallback `Edición <número>`;
  - `Pérez` + `Gómez` + `Ana` + `María` → `apellidos-perez-gomez__nombres-ana-maria__cv__sub-1.pdf`;
  - segundo apellido y segundo nombre vacíos → `apellidos-perez__nombres-ana__cv__sub-1.pdf`;
  - acentos, barras, espacios repetidos y nombres originales sin extensión usando el MIME permitido;
  - ordinal distinto para dos archivos del mismo campo.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @flacso/api exec vitest run src/domain/google-drive-naming.test.ts`

  Expected: FAIL porque el módulo y las funciones todavía no existen.

- [ ] **Step 3: Implement the pure naming module**

  Implementar los tipos y funciones en `google-drive-naming.ts`. Usar etiquetas explícitas `apellidos-` y `nombres-`; omitir completamente el segundo valor si está vacío; derivar el tipo documental desde `fieldKey`; conservar o inferir la extensión permitida; usar `postulante` solo como respaldo cuando no haya ningún nombre disponible.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter @flacso/api exec vitest run src/domain/google-drive-naming.test.ts`

  Expected: todos los tests del módulo pasan.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/domain/google-drive-naming.ts apps/api/src/domain/google-drive-naming.test.ts
  git commit -m "feat(drive): add semantic path and file naming rules"
  ```

### Task 2: Resolución y creación de la jerarquía en Google Drive

**Files:**
- Modify: `apps/api/src/ports/google-drive-repository.ts`
- Modify: `apps/api/src/infrastructure/google/google-drive-repository.ts`
- Test: `apps/api/src/infrastructure/google/google-drive-repository.test.ts`

**Interfaces:**
- `DriveUploadFile` agrega `fieldKey: string`.
- `StoreSubmissionFilesCommand` agrega `target: DriveTargetDescriptor` y `values: Record<string, string>`.
- `GoogleDriveRepository.storeSubmissionFiles` resuelve la rama del destino, garantiza `Preinscripciones` y `Documentación`, y sube los archivos a `Documentación` con nombre semántico.

- [ ] **Step 1: Write the failing tests**

  Agregar pruebas que simulen la API REST de Drive y verifiquen:
  - búsqueda de cada carpeta hija mediante `files.list` con padre, nombre, tipo folder y `trashed = false`;
  - creación solo cuando no existe;
  - creación de ambas carpetas finales;
  - carga con `parents` apuntando a `Documentación`, nombre semántico y `appProperties` completos;
  - reutilización de carpetas existentes;
  - propagación de un HTTP 403 sin devolver falsos éxitos.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @flacso/api exec vitest run src/infrastructure/google/google-drive-repository.test.ts`

  Expected: FAIL porque el repositorio todavía usa directamente la raíz y no recibe contexto de destino.

- [ ] **Step 3: Implement folder resolution and upload metadata**

  Extender el repositorio con consultas `files.list` y creaciones `files.create`, escapando valores de nombre en la consulta de Drive. Mantener el token de acceso, timeout y manejo de HTTP existentes. Construir la ruta con las utilidades de Task 1, crear/reutilizar los niveles y cargar a `Documentación`; guardar también el nombre original, destino y clave documental en `appProperties`.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm --filter @flacso/api exec vitest run src/infrastructure/google/google-drive-repository.test.ts`

  Expected: todos los tests de repositorio pasan.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/ports/google-drive-repository.ts apps/api/src/infrastructure/google/google-drive-repository.ts apps/api/src/infrastructure/google/google-drive-repository.test.ts
  git commit -m "feat(drive): create academic and seminar folder hierarchy"
  ```

### Task 3: Integración con el envío de preinscripciones

**Files:**
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Modify: `apps/api/src/presentation/http/submission-routes.ts`
- Modify: `apps/api/src/presentation/http/submission-files.test.ts`
- Modify: `apps/api/src/presentation/http/submission-routes.test.ts` if required by the result contract

**Interfaces:**
- El resultado exitoso de `submitPreinscription` expone el `DriveTargetDescriptor` derivado del destino revalidado.
- La ruta construye cada `DriveUploadFile` con `fieldKey`, datos temporales, destino y valores enviados antes de llamar a `storeSubmissionFiles`.

- [ ] **Step 1: Write the failing tests**

  En las pruebas de orquestación, capturar el comando recibido por Drive y comprobar que contiene:
  - destino de seminario u oferta correspondiente;
  - valores de nombres y apellidos;
  - `fieldKey` de cada documento;
  - eliminación del temporal únicamente después de éxito;
  - conservación del temporal cuando falla Drive.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm --filter @flacso/api exec vitest run src/presentation/http/submission-files.test.ts`

  Expected: FAIL por el contrato actual del comando y porque el resultado de envío no expone el descriptor de Drive.

- [ ] **Step 3: Implement the integration**

  Derivar el descriptor con los nombres del `AcademicTarget` revalidado, conservar el guardado de la solicitud y pasar el contexto al repositorio solo después de que la validación y persistencia sean exitosas. No modificar la semántica de limpieza de temporales.

- [ ] **Step 4: Run focused and full API tests**

  Run: `pnpm --filter @flacso/api exec vitest run src/presentation/http/submission-files.test.ts src/presentation/http/submission-routes.test.ts`

  Expected: tests enfocados pasan.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/application/submit-preinscription.ts apps/api/src/presentation/http/submission-routes.ts apps/api/src/presentation/http/submission-files.test.ts apps/api/src/presentation/http/submission-routes.test.ts
  git commit -m "feat(submissions): pass Drive destination context"
  ```

### Task 4: Documentación y verificación final

**Files:**
- Modify: `docs/ARQUITECTURA.md`
- Modify: `docs/DEPLOY.md` if its Drive section describes the old direct-root behavior
- Test/verification: repository-wide checks

- [ ] **Step 1: Update documentation**

  Marcar en `docs/ARQUITECTURA.md` que la aplicación construye la jerarquía bajo demanda y que los documentos nuevos se almacenan en `Documentación` con nombres semánticos. Mantener explícito que la raíz se configura por UI y que los archivos históricos no se migran.

- [ ] **Step 2: Run the complete validation**

  Run:

  ```bash
  pnpm test
  pnpm typecheck
  pnpm build
  git diff --check
  ```

  Expected: 0 fallos en tests, typecheck y build; diff sin errores de whitespace.

- [ ] **Step 3: Commit documentation and verification-ready state**

  ```bash
  git add docs/ARQUITECTURA.md docs/DEPLOY.md
  git commit -m "docs(drive): document hierarchical storage behavior"
  ```

- [ ] **Step 4: Publish and report separately**

  Verificar `git status --short --branch`, publicar `main` en `origin/main` y reportar por separado validación local, publicación, CI y despliegue. No modificar Apache ni producción en este plan.
