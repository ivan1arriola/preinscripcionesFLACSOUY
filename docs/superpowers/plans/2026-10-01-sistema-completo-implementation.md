# Sistema completo de Preinscripciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolucionar el MVP simulado hacia la plataforma completa de preinscripciones con WordPress, Google Sheets, Google Drive, archivos temporales, administración, diagnóstico, seguridad y rollout reversible.

**Architecture:** La plataforma seguirá una arquitectura por capas y un núcleo funcional puro. La aplicación React/Node mantendrá contratos y puertos estables; los adaptadores reales de WordPress, Sheets, Drive, PostgreSQL y almacenamiento temporal quedarán en infraestructura. La integración del plugin WordPress se implementará en su checkout independiente, sin trasladar reglas académicas a la aplicación.

**Tech Stack:** TypeScript, React, Vite, Node.js, Express, Zod, Kysely, PostgreSQL, Docker Compose, Google APIs oficiales para Node.js, Vitest, React Testing Library, Playwright y el stack de pruebas existente del plugin WordPress.

**Spec:** `docs/superpowers/specs/2026-10-01-mvp-preinscripciones-design.md` y el contrato WordPress–Preinscripciones incorporado en esa especificación.

## Global Constraints

- Todo el código de la aplicación será TypeScript; los datos declarativos y fixtures podrán ser JSON.
- La ejecución local y de prueba será reproducible mediante Docker Compose.
- La arquitectura será por capas: Presentación, Aplicación, Dominio, Puertos e Infraestructura.
- El dominio usará funciones puras y no dependerá de HTTP, filesystem, reloj, entorno ni base de datos.
- PostgreSQL y todo nuevo modelo persistido cumplirán tercera forma normal.
- WordPress será la fuente de verdad académica; Google Sheets será el destino institucional de datos; Google Drive será el destino documental.
- El plugin conservará `link_preinscripcion` y el flujo legacy durante todo el rollout.
- Ninguna integración real se activará en producción sin backup, pruebas de lectura, pruebas controladas y criterio explícito de reversión.
- No se guardarán secretos en el repositorio ni se expondrán en logs, diagnósticos o respuestas.

## Review Focus

- La configuración cambia entre GET y POST: la aplicación debe comparar `configRevision` y rechazar formularios obsoletos.
- Sheets tiene columnas reordenadas o columnas manuales: la escritura debe resolver por nombre y conservar columnas/filas existentes.
- Drive o Sheets falla después de comenzar el flujo: el estado debe quedar diagnosticado y no debe confirmarse una preinscripción incompleta.
- Una sesión de archivos queda abandonada: los binarios deben expirar después de 30 minutos sin actividad y fuera del web root.
- Un error contiene datos sensibles: el panel debe mostrar contexto técnico seguro, sin tokens, credenciales ni datos personales innecesarios.

## Fases y dependencias

```text
Fase 1 MVP local
        ↓
Fase 2 contrato real WordPress + plugin
        ↓
Fase 3 adaptador WordPress real
        ↓
Fase 4 Sheets + Drive
        ↓
Fase 5 archivos temporales y documentos
        ↓
Fase 6 administración, diagnóstico y seguridad
        ↓
Fase 7 operación, rollout y producción
```

Cada fase debe terminar con pruebas automatizadas, documentación actualizada y un commit revisable. Las fases 2 y 3 requieren trabajar además en el checkout del plugin WordPress.

### Task 1: Cerrar y verificar el MVP local

**Files:**
- Modify: `apps/api/src/**`
- Modify: `apps/web/src/**`
- Modify: `packages/contracts/src/**`
- Modify: `docker-compose.yml`
- Create: `tests/e2e/**`
- Modify: `README.md`

**Interfaces:**
- `GET /api/targets` y `GET /api/targets/:id` consumen fixtures REST v1.
- `POST /api/targets/:id/submissions` recibe `configRevision` y valores.
- PostgreSQL registra envíos en un modelo 3FN.

- [ ] **Step 1: Completar pruebas unitarias de dominio** para composición, campos universales, contratos inválidos, orientaciones/menciones y revisiones obsoletas.
- [ ] **Step 2: Completar pruebas HTTP** para destinos abiertos, cerrados, inválidos, inexistentes y revisiones cambiadas.
- [ ] **Step 3: Completar la interfaz React** con listado, formulario dinámico, dependencia orientación→mención y confirmación simulada.
- [ ] **Step 4: Ejecutar Compose, migraciones, pruebas, build y E2E** y registrar comandos reproducibles en `README.md`.
- [ ] **Step 5: Commit:** `feat: complete local preinscriptions MVP`.

### Task 2: Implementar el módulo WordPress de configuración y contrato v1

**Checkout:** repositorio del plugin FLACSO WordPress, no este checkout.

**Files:**
- Create: `modules/preinscripciones/class-preinscriptions-field-catalog.php`
- Create: `modules/preinscripciones/class-preinscriptions-config.php`
- Create: `modules/preinscripciones/class-preinscriptions-serializer.php`
- Create: `modules/preinscripciones/class-preinscriptions-rest.php`
- Create: `modules/preinscripciones/tests/**`
- Modify: loader principal y componentes de Cohorte/Edición

**Interfaces:**
- Meta de destino: `preinscripcion_formulario`.
- Meta estructurada de Cohorte: `preinscripcion_orientaciones`.
- `GET /wp-json/flacso/v1/preinscripciones` devuelve `{ version: 1, targets: [...] }`.
- Destinos usan `kind`, IDs nativos, `registrationOpen`, ventana ISO, `configRevision`, `form.valid/issues`, orientaciones/menciones y URLs.

- [ ] **Step 1: Escribir pruebas de catálogo, sanitización y deduplicación** para las ocho claves iniciales permitidas.
- [ ] **Step 2: Escribir pruebas de posiciones, obligatoriedad, nonce, capacidades y relación orientación→mención**.
- [ ] **Step 3: Escribir pruebas de IDs estables, hash canónico `configRevision`, apertura/cierre y serialización de ofertas/seminarios**.
- [ ] **Step 4: Escribir pruebas REST v1, datos legacy incompletos, ausencia de datos personales y preservación de `link_preinscripcion`**.
- [ ] **Step 5: Implementar el módulo aislado reutilizando `accepts_registration()` como única decisión de apertura**.
- [ ] **Step 6: Verificar `permission_callback` público solo para GET y `Cache-Control: max-age=60`**.
- [ ] **Step 7: Commit en el checkout del plugin:** `feat: add preinscriptions REST v1 contract`.

### Task 3: Conectar el adaptador WordPress real

**Files:**
- Create: `apps/api/src/infrastructure/wordpress/wordpress-academic-catalog.ts`
- Create: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`
- Create: `apps/api/src/infrastructure/wordpress/wordpress-cache.ts`
- Create: `apps/api/src/infrastructure/wordpress/wordpress-contract.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/ports/academic-catalog.ts`

**Interfaces:**
- `WordPressClient.getPreinscriptions(): Promise<WordPressV1Response>`.
- `WordPressAcademicCatalog.listTargets(): Promise<AcademicTarget[]>`.
- `WordPressAcademicCatalog.revalidateTarget(id): Promise<AcademicTarget | null>`.

- [ ] **Step 1: Escribir pruebas de contrato con respuestas congeladas del endpoint v1**.
- [ ] **Step 2: Escribir pruebas de timeout, HTTP no exitoso, JSON inválido, versión desconocida y cache stale**.
- [ ] **Step 3: Implementar cliente HTTP con timeout, validación Zod y redacción segura de errores**.
- [ ] **Step 4: Implementar cache técnico en PostgreSQL sin convertirlo en catálogo académico editable**.
- [ ] **Step 5: Sustituir el adaptador fixture solo mediante configuración explícita**.
- [ ] **Step 6: Commit:** `feat: add WordPress academic catalog adapter`.

### Task 4: Integrar Google Sheets por nombres de columna

**Files:**
- Create: `apps/api/src/ports/spreadsheet-repository.ts`
- Create: `apps/api/src/infrastructure/google/sheets-client.ts`
- Create: `apps/api/src/infrastructure/google/google-sheets-repository.ts`
- Create: `apps/api/src/domain/spreadsheet-row.ts`
- Create: `apps/api/src/domain/spreadsheet-row.test.ts`
- Create: `apps/api/src/infrastructure/google/google-sheets-repository.test.ts`
- Modify: PostgreSQL schema/migrations for spreadsheet references and operation state

**Interfaces:**
- `SpreadsheetRepository.readHeaders(target): Promise<string[]>`.
- `SpreadsheetRepository.appendByHeaders(target, valuesByColumnName): Promise<AppendResult>`.
- `SpreadsheetRepository.diagnose(target): Promise<SpreadsheetDiagnostic>`.

- [ ] **Step 1: Probar resolución por encabezado, columnas reordenadas, columnas manuales y falta de columnas requeridas**.
- [ ] **Step 2: Probar que no se reescriben filas, columnas ni observaciones existentes**.
- [ ] **Step 3: Implementar cliente autenticado mediante credenciales inyectadas por entorno/secret manager**.
- [ ] **Step 4: Implementar append al final de la tabla lógica y diagnóstico seguro de permisos/hoja**.
- [ ] **Step 5: Implementar estado de operación para distinguir éxito, fallo y resultado desconocido sin reintento automático inseguro**.
- [ ] **Step 6: Commit:** `feat: add header-based Google Sheets repository`.

### Task 5: Integrar Google Drive y archivos temporales

**Files:**
- Create: `apps/api/src/ports/drive-repository.ts`
- Create: `apps/api/src/ports/temporary-file-storage.ts`
- Create: `apps/api/src/infrastructure/google/google-drive-repository.ts`
- Create: `apps/api/src/infrastructure/uploads/**`
- Create: `apps/api/src/domain/upload-session.ts`
- Create: `apps/api/src/domain/upload-session.test.ts`
- Create: `apps/api/src/application/upload-file.ts`
- Create: `apps/api/src/application/submit-with-documents.ts`
- Modify: PostgreSQL schema/migrations
- Modify: `docker-compose.yml` for a storage volume outside web root

**Interfaces:**
- `TemporaryFileStorage.createSession(): Promise<UploadSession>`.
- `TemporaryFileStorage.store(sessionId, file): Promise<TemporaryFile>`.
- `TemporaryFileStorage.deleteSession(sessionId): Promise<void>`.
- `DriveRepository.resolveTargetFolders(target): Promise<DriveFolders>`.
- `DriveRepository.uploadDocument(folderId, file): Promise<DriveFileReference>`.

- [ ] **Step 1: Probar IDs de sesión impredecibles, límites de tipo/tamaño y expiración a los 30 minutos sin actividad**.
- [ ] **Step 2: Probar que datos personales no se persisten al cargar solo un formulario sin archivos**.
- [ ] **Step 3: Implementar almacenamiento temporal fuera del web root y metadata normalizada en PostgreSQL**.
- [ ] **Step 4: Implementar resolución idempotente de carpetas por IDs y estructura visible configurable**.
- [ ] **Step 5: Implementar flujo ordenado: validar → Drive → Sheets → limpiar temporales, con estado explícito ante fallos**.
- [ ] **Step 6: Implementar worker/command TypeScript para eliminar sesiones expiradas**.
- [ ] **Step 7: Commit:** `feat: add temporary uploads and Google Drive integration`.

### Task 6: Panel administrativo, autenticación y diagnóstico

**Files:**
- Create: `apps/api/src/application/admin/**`
- Create: `apps/api/src/presentation/http/admin-routes.ts`
- Create: `apps/api/src/infrastructure/auth/**`
- Create: `apps/web/src/pages/admin/**`
- Create: `apps/web/src/components/admin/**`
- Create: `apps/api/src/domain/system-error.ts`
- Create: `apps/api/src/infrastructure/database/system-error-repository.ts`
- Create: tests for admin API, auth, diagnostics and UI

**Interfaces:**
- `GET /api/admin/targets`.
- `GET /api/admin/targets/:id/diagnostics`.
- `GET /api/admin/errors`.
- `POST /api/admin/errors/:id/resolve`.
- `GET /api/admin/health/integrations`.

- [ ] **Step 1: Definir autenticación de un único administrador y protección CSRF/sesión**.
- [ ] **Step 2: Probar autorización, redacción de secretos y denegación de usuarios no autenticados**.
- [ ] **Step 3: Implementar diagnóstico de WordPress, contrato, Sheets, Drive, permisos y columnas**.
- [ ] **Step 4: Implementar errores con severidad, origen, código, contexto seguro, resolución y trazabilidad**.
- [ ] **Step 5: Construir panel con formularios detectados, estados, enlaces operativos y acciones de diagnóstico**.
- [ ] **Step 6: Commit:** `feat: add administrative diagnostics panel`.

### Task 7: Seguridad, operación y observabilidad

**Files:**
- Modify: `.env.example`, Docker Compose, Dockerfiles and deployment manifests
- Create: `apps/api/src/infrastructure/observability/**`
- Create: `apps/api/src/presentation/http/security.ts`
- Create: security and operational tests
- Modify: `README.md` and create `docs/OPERACION.md`

- [ ] **Step 1: Separar configuración pública, secretos y credenciales de Google**; no versionar valores reales.
- [ ] **Step 2: Añadir límites de tamaño, rate limiting, headers seguros, CORS explícito y validación estricta de uploads**.
- [ ] **Step 3: Añadir logs estructurados con correlation ID y redacción de emails, tokens, IDs sensibles y payloads**.
- [ ] **Step 4: Añadir métricas/health/readiness para API, PostgreSQL, WordPress, Sheets, Drive y worker**.
- [ ] **Step 5: Añadir backups documentados de PostgreSQL y procedimiento de restauración probado fuera del checkout**.
- [ ] **Step 6: Ejecutar auditoría de dependencias, `git diff --check`, typecheck, tests y revisión de secretos**.
- [ ] **Step 7: Commit:** `chore: harden and document production operations`.

### Task 8: Rollout reversible y producción

**Files:**
- Create/modify: workflow CI/CD del checkout de la aplicación
- Create/modify: workflow del plugin WordPress
- Create: `docs/ROLLOUT.md`
- Create: staging smoke tests and production verification scripts

- [ ] **Step 1: Validar localmente contrato, migraciones, build, tests, Docker y E2E**.
- [ ] **Step 2: Desplegar primero la API WordPress v1 sin modificar `link_preinscripcion` ni botones legacy**.
- [ ] **Step 3: Ejecutar lectura REST y revisión manual del editor de Cohorte/Edición**.
- [ ] **Step 4: Probar la app contra WordPress real en staging con Sheets/Drive de prueba**.
- [ ] **Step 5: Crear backup protegido antes de migraciones o cambios operativos**.
- [ ] **Step 6: Publicar el commit exacto en `main`, verificar CI y confirmar el SHA desplegado**.
- [ ] **Step 7: Verificar servicio activo, migraciones, `/api/health`, integración de lectura, envío controlado y logs**.
- [ ] **Step 8: Activar por destino solo después de aceptación explícita; conservar rollback a legacy**.
- [ ] **Step 9: Commit/documentación:** `docs: document reversible production rollout`.

## Definition of Done

El sistema completo estará listo cuando:

1. WordPress publique el contrato REST v1 sin datos personales y con pruebas completas.
2. La app pueda cambiar entre fixtures y WordPress real por configuración.
3. Los formularios se construyan desde `form.inputs` y rechacen contratos inválidos.
4. `configRevision` evite envíos contra formularios obsoletos.
5. Sheets escriba por nombres de columna sin destruir trabajo manual.
6. Drive organice documentos por IDs y los temporales expiren correctamente.
7. PostgreSQL mantenga estado técnico en 3FN.
8. El panel admin diagnostique integraciones y muestre errores seguros.
9. CI, Docker, backups, health, logs y rollback estén documentados y probados.
10. El flujo legacy continúe funcionando hasta una activación reversible por destino.

## Handoff

Este plan es un plan maestro y debe ejecutarse por fases. Para comenzar la implementación, revisar primero la Fase 1 y elegir el método:

- **Subagent-driven:** recomendado para tareas independientes y revisión por fase.
- **Native:** recomendado si se desea mantener una única línea de implementación y revisión final.

No se deben realizar cambios reales en WordPress, Google Sheets, Google Drive o producción durante la Fase 1.
