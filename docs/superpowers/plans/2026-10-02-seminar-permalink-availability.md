# Disponibilidad de seminarios y permalink de preinscripción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el permalink de cada seminario resuelva la única edición abierta, muestre un aviso cuando no haya preinscripciones abiertas y bloquee inconsistencias de catálogo.

**Architecture:** WordPress será la fuente de verdad de la ventana temporal y publicará el estado de disponibilidad de cada edición. La API normalizará ese estado y aplicará la misma regla al diagnóstico y al envío. La web resolverá el permalink agrupando destinos, sin depender del orden en que WordPress devuelve los posts.

**Tech Stack:** WordPress/PHP, REST v1, TypeScript, React, Vitest, Testing Library y Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-seminar-permalink-availability.md`

## Global Constraints

- El permalink permanece en `urls.legacyRegistration` y no cambia por edición.
- Las ediciones históricas se conservan; no se eliminan ni se reemplazan por una sola fila.
- La ventana de seminario usa la zona horaria de WordPress y cierra al comenzar el día posterior a `fecha_inicio + 10 días`.
- Más de una edición abierta, o más de un permalink para el mismo seminario, es un conflicto; nunca se elige la primera por orden de respuesta.
- Las ofertas académicas mantienen su comportamiento actual.
- La revalidación del servidor sigue siendo obligatoria al cargar el formulario y al enviar la solicitud.
- No se versionan secretos ni se realizan cambios de producción como parte de esta implementación.

## Review Focus

- Dos ediciones del mismo seminario con el mismo permalink: la app debe resolver una única abierta o mostrar conflicto, nunca elegir por orden.
- Exactamente el límite temporal: debe permanecer abierta durante el décimo día y cerrarse al comenzar el día siguiente.
- Edición sin `fecha_inicio`: debe quedar cerrada y no debe producir una ventana temporal inventada.
- Respuesta de WordPress anterior sin `registrationAvailability`: debe conservar compatibilidad durante el despliegue.
- Cambio de estado entre la carga y el envío: el servidor debe rechazar la solicitud si la edición dejó de estar abierta.

### Task 1: Formalizar el estado temporal de una edición en el plugin

**Files:**
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/seminarios/includes/class-edicion.php`
- Test: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/tests/seminar-registration-availability-contract-test.php`

**Interfaces:**
- Produce `FLACSO_Edicion::registration_availability(int $edition_id, ?int $timestamp = null): array` con `status`, `from` y `until`.
- Mantiene `FLACSO_Edicion::accepts_registration()` como fachada booleana que devuelve `status === 'open'`.

- [ ] **Step 1: Escribir las pruebas de límite temporal y datos incompletos**

  Cubrir una edición con `fecha_inicio` válida en los siguientes casos: antes del cierre, durante el décimo día, exactamente al inicio del día posterior y después del cierre. Cubrir también fecha ausente, estado cancelado y cierre administrativo explícito.

- [ ] **Step 2: Ejecutar el test del plugin y verificar que falla**

  Run: `php tests/seminar-registration-availability-contract-test.php`

  Expected: FAIL porque todavía no existe el estado calculado ni el límite temporal verificable.

- [ ] **Step 3: Implementar la función de disponibilidad**

  Usar `wp_timezone()` y `DateTimeImmutable` para calcular `until` de forma determinista. La fecha `from` será `null` mientras el modelo no tenga una fecha explícita de apertura; la ausencia de `fecha_inicio` será `closed` con `until: null`. La apertura administrativa no puede extender el cierre de diez días.

- [ ] **Step 4: Ejecutar las pruebas del plugin**

  Run: `php tests/seminar-registration-availability-contract-test.php`

  Expected: PASS, incluyendo la frontera exacta del cierre.

- [ ] **Step 5: Commit del cambio aislado**

  En el checkout del plugin: `git add modules/seminarios/includes/class-edicion.php tests/seminar-registration-availability-contract-test.php && git commit -m "feat(seminars): formalize registration availability window"`

### Task 2: Publicar la ventana y detectar conflictos por seminario en WordPress

**Files:**
- Modify: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/modules/preinscripciones/includes/class-preinscriptions-serializer.php`
- Test: `/home/ivan/repositorios/FLACSO Uruguay/Migrar/flacso-uruguay-plugin/tests/seminar-permalink-serializer-test.php`

**Interfaces:**
- Consume `FLACSO_Edicion::registration_availability()` de Task 1.
- Produce en cada destino de seminario `registrationAvailability`, `registrationWindow.from` y `registrationWindow.until`.

- [ ] **Step 1: Escribir pruebas del serializer**

  Preparar dos ediciones publicadas del mismo seminario con el mismo permalink. Verificar que una edición abierta queda como `open`, que una edición vencida queda como `closed`, que dos abiertas quedan como `conflict` y que ninguna respuesta depende del ID u orden de publicación. Verificar también que no se usa `fecha_limite_preinscripcion` para prolongar una edición más allá de los diez días.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

  Run: `php tests/seminar-permalink-serializer-test.php`

  Expected: FAIL porque el serializer actual solo expone `registrationOpen` y calcula `until` desde un meta legado.

- [ ] **Step 3: Implementar el segundo pase del serializer**

  Serializar primero todas las ediciones y agruparlas por `seminario_id` y permalink normalizado. Si hay exactamente una edición elegible, publicar `open` solo en ella; si no hay ninguna, publicar `closed`; si hay más de una, publicar `conflict` en todas las candidatas. Mantener cada destino y su ID para diagnóstico histórico.

  Antes de resolver la edición abierta, comparar todos los permalinks no vacíos del mismo `seminario_id`; si no coinciden después de normalizarlos, publicar `conflict` en todo el grupo.

- [ ] **Step 4: Ejecutar pruebas contractuales y de REST**

  Run: `php tests/seminar-permalink-serializer-test.php && php tests/preinscriptions-rest-contract-test.php`

  Expected: PASS, con el nuevo campo presente y sin regresiones para cohortes ni para el contrato v1 existente.

- [ ] **Step 5: Commit y publicación del plugin**

  En el checkout del plugin, revisar exclusivamente el diff de esta tarea, crear un commit descriptivo y publicar `main` solo si el checkout no contiene cambios de otra tarea. Reportar el SHA del plugin separado del SHA de la app.

### Task 3: Extender el contrato y normalizar disponibilidad en la API

**Files:**
- Modify: `packages/contracts/src/catalog.ts`
- Modify: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`
- Modify: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`
- Modify: `apps/api/src/domain/diagnostics.ts`
- Modify: `apps/api/src/application/discover-targets.ts`
- Test: `apps/api/src/domain/seminar-permalink-availability.test.ts`
- Test: `apps/api/src/infrastructure/wordpress/wordpress-contract.test.ts`

**Interfaces:**
- Add `RegistrationAvailability = 'open' | 'closed' | 'conflict'` to `packages/contracts/src/catalog.ts`.
- Add optional `registrationAvailability` to the raw and normalized academic target types for rollout compatibility.
- Add optional `registrationAvailability` to `DiagnosticTarget` so the web can distinguish a closed permalink from a catalog conflict.
- Add a pure function `resolveSeminarPermalinks(targets: AcademicTarget[]): Map<string, SeminarPermalinkResolution>` that returns `open`, `closed`, or `conflict` plus the selected target ID when applicable.

- [ ] **Step 1: Escribir pruebas de resolución pura**

  Probar un permalink con una edición abierta y una cerrada, un permalink sin edición abierta, dos abiertas, destinos sin permalink y ofertas académicas con el mismo path. Afirmar que solo la edición abierta se selecciona y que el conflicto no selecciona ninguna.

- [ ] **Step 2: Ejecutar las pruebas nuevas y verificar que fallan**

  Run: `pnpm --filter api test -- seminar-permalink-availability.test.ts`

  Expected: FAIL porque la resolución agrupada aún no existe.

- [ ] **Step 3: Implementar el contrato y la resolución**

  Validar el nuevo campo con Zod sin romper respuestas antiguas. En la API, aplicar la resolución agrupada antes de construir diagnósticos: un conflicto debe producir `status: incompatible` e issue estable `multiple_open_seminar_editions`; sin edición abierta debe seguir siendo `closed`. No modificar el cálculo de ofertas académicas.

  Si las ediciones de un mismo seminario tienen permalinks distintos, el diagnóstico debe usar `status: incompatible` e issue estable `inconsistent_seminar_permalink`.

- [ ] **Step 4: Actualizar fixtures y pruebas de contrato**

  Añadir `registrationAvailability` a los fixtures de seminarios, conservar al menos un fixture legacy sin el campo y verificar que ambos se parsean según la política de compatibilidad.

- [ ] **Step 5: Ejecutar API y typecheck**

  Run: `pnpm --filter api test && pnpm --filter api typecheck`

  Expected: PASS.

- [ ] **Step 6: Commit de la API y contratos**

  `git add packages/contracts apps/api && git commit -m "feat(api): resolve seminar availability by permalink"`

### Task 4: Revalidar el destino antes de cargar y enviar el formulario

**Files:**
- Modify: `apps/api/src/ports/academic-catalog.ts`
- Modify: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`
- Modify: `apps/api/src/infrastructure/fixtures/fixture-academic-catalog.ts`
- Modify: `apps/api/src/application/get-target-form.ts`
- Modify: `apps/api/src/application/submit-preinscription.ts`
- Test: `apps/api/src/application/get-target-form.test.ts`
- Test: `apps/api/src/application/submit-preinscription.test.ts`

**Interfaces:**
- Add `revalidateTargets(): Promise<AcademicTarget[]>` to `AcademicCatalog` for checks that depend on sibling editions.
- Reuse `resolveSeminarPermalinks()` from Task 3 in both application services.

- [ ] **Step 1: Escribir pruebas de rechazo**

  Verificar que `getTargetForm` rechaza una edición cerrada o en conflicto, que `submitPreinscription` devuelve `CLOSED` sin persistir y que una edición que se cerró después de cargar el formulario también es rechazada. Verificar que una edición abierta única continúa componiendo y guardando la solicitud.

- [ ] **Step 2: Ejecutar pruebas y verificar que fallan**

  Run: `pnpm --filter api test -- get-target-form.test.ts submit-preinscription.test.ts`

  Expected: FAIL porque actualmente `getTargetForm` compone formularios cerrados y el envío solo valida el booleano del destino individual.

- [ ] **Step 3: Implementar la revalidación autoritativa**

  La implementación WordPress debe ignorar la caché al ejecutar `revalidateTargets()`. La implementación fixture debe devolver una copia aislada. Antes de componer o persistir, resolver el permalink del seminario y aceptar únicamente la edición abierta única.

- [ ] **Step 4: Ejecutar pruebas de aplicación y regresión**

  Run: `pnpm --filter api test`

  Expected: PASS sin cambiar códigos públicos existentes salvo el rechazo correcto de destinos cerrados o conflictivos.

- [ ] **Step 5: Commit**

  `git add apps/api/src/ports apps/api/src/infrastructure apps/api/src/application && git commit -m "fix(api): reject closed seminar submissions authoritatively"`

### Task 5: Resolver el permalink y mostrar el aviso correcto en la web

**Files:**
- Create: `apps/web/src/domain/legacy-permalink-resolution.ts`
- Create: `apps/web/src/components/ClosedRegistrationNotice.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/components/TargetList.tsx`
- Test: `apps/web/src/domain/legacy-permalink-resolution.test.ts`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/pages/HomePage.test.tsx`

**Interfaces:**
- Produce `resolveLegacyPermalink(targets: DiagnosticTarget[], path: string): { kind: 'target'; target: DiagnosticTarget } | { kind: 'closed'; title?: string } | { kind: 'conflict'; title?: string } | { kind: 'not_found' }`.
- `ClosedRegistrationNotice` recibe `title?: string`, `onBack: () => void` y muestra el copy aprobado para seminarios cerrados.

- [ ] **Step 1: Escribir pruebas de resolución y UI**

  Probar que una ruta con edición cerrada y abierta carga solo la abierta; que una ruta con todas las ediciones cerradas muestra el aviso y no llama a `getTarget`; que dos abiertas muestran conflicto; y que la ruta académica existente sigue cargando como antes. Probar que la home no duplica tarjetas del mismo seminario por edición histórica.

- [ ] **Step 2: Ejecutar las pruebas y verificar que fallan**

  Run: `pnpm --filter web test -- App.test.tsx HomePage.test.tsx legacy-permalink-resolution.test.ts`

  Expected: FAIL porque `App.tsx` usa `targets.find(...)` y `HomePage` lista cada edición por separado.

- [ ] **Step 3: Implementar la resolución pura y la pantalla cerrada**

  Normalizar la ruta antes de agrupar. Para seminarios, usar `registrationAvailability` cuando exista y como fallback `registrationOpen`; nunca usar el primer candidato. La pantalla cerrada debe conservar el permalink, permitir volver al listado y no renderizar campos deshabilitados como si fueran un formulario disponible. El conflicto debe usar un aviso distinto y no iniciar el formulario.

- [ ] **Step 4: Agrupar la presentación pública de seminarios**

  En la home, agrupar por permalink y conservar como representante la edición abierta única; sin edición abierta, mostrar una sola tarjeta cerrada. Mantener la separación de secciones y grupos de ofertas académicas.

- [ ] **Step 5: Ejecutar pruebas web, typecheck y build**

  Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add apps/web/src && git commit -m "fix(web): resolve seminar permalinks by open edition"`

### Task 6: Verificación integrada, documentación y publicación

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-seminar-permalink-availability.md` si alguna decisión aprobada cambia durante la implementación.
- Modify: `docs/superpowers/plans/2026-10-02-seminar-permalink-availability.md` para marcar pasos completados.
- Test: `e2e/` o el archivo Playwright existente que cubra rutas públicas.

- [ ] **Step 1: Agregar escenario E2E con permalink histórico**

  Configurar fixtures con dos ediciones del mismo seminario, una abierta y una cerrada, y verificar que `/seminario/diseno-de-cursos-virtuales/` abre el formulario de la edición abierta. Repetir con ninguna abierta y verificar el aviso textual; repetir con dos abiertas y verificar el aviso de conflicto.

- [ ] **Step 2: Ejecutar la validación completa local**

  Run: `pnpm test && pnpm typecheck && pnpm build && pnpm e2e`

  Expected: PASS.

- [ ] **Step 3: Revisar el diff y los contratos publicados**

  Confirmar que no se incluyeron `.env`, secretos, credenciales, datos personales ni cambios de despliegue no solicitados. Confirmar que el plugin y la app tienen commits separados y que ambos usan el mismo nombre y semántica de `registrationAvailability`.

- [ ] **Step 4: Publicar cada repositorio con su SHA**

  Publicar primero el plugin, verificar el endpoint REST actualizado, luego publicar la app. Informar por separado commit local, push, CI, deploy y verificación pública; un push exitoso no se considera despliegue verificado.

- [ ] **Step 5: Commit final de documentación**

  `git add docs/superpowers/specs/2026-10-02-seminar-permalink-availability.md docs/superpowers/plans/2026-10-02-seminar-permalink-availability.md && git commit -m "docs: plan seminar permalink availability"`
