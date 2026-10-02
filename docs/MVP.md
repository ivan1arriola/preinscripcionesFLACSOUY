# MVP de Preinscripciones FLACSO Uruguay

Documentación técnica y operativa del MVP de la plataforma de preinscripciones.

## 1. Objetivo y Alcance

El MVP valida de forma local y reproducible la arquitectura por capas, los contratos compartidos de TypeScript y la integración funcional antes de conectar WordPress, Google Sheets y Google Drive reales.

### Incluido en este MVP:
- **Frontend React 18 + Vite:** interfaz dinámica de selección de propuestas y formulario reactivo con dependencias dinámicas (orientación → mención).
- **Backend Node.js + Express:** API HTTP estructurada por capas (Presentación, Aplicación, Dominio, Puertos, Infraestructura).
- **Contratos compartidos (`@flacso/contracts`):** tipos e interfaces compartidos entre cliente y servidor.
- **Núcleo de Dominio Puro:** funciones deterministas sin efectos secundarios para composición de formularios, validación de envíos y diagnóstico de compatibilidad.
- **Fuente simulada WordPress REST v1 (`FixtureAcademicCatalog`):** simulación fidedigna del endpoint `GET /wp-json/flacso/v1/preinscripciones`.
- **Persistencia en PostgreSQL 3FN (`PostgresSubmissionRepository`):** almacenamiento normalizado en tercera forma normal mediante Kysely, con snapshots técnicos para trazabilidad.
- **Docker Compose:** orquestación de servicios `web`, `api` y `postgres`.
- **Pruebas integrales:** suites unitarias de dominio, integración HTTP, integración PostgreSQL y suites E2E.

### Fuera de alcance del MVP (fases posteriores):
- Conexión real con servidor WordPress (Fases 2 y 3).
- Integración directa con Google Sheets y Google Drive (Fases 4 y 5).
- Carga de archivos físicos y worker de expiración (Fase 5).
- Panel de administración autenticado (Fase 6).

---

## 2. Arquitectura de Software

```text
packages/contracts/        Tipos compartidos (AcademicTarget, FormDefinition, DiagnosticTarget, etc.)
apps/web/                  Frontend React
  src/api/client.ts        Cliente HTTP tipado hacia /api
  src/components/          DynamicForm, TargetList, OrientationMentionFields
  src/pages/               HomePage, TargetPage
apps/api/                  Backend Express
  src/domain/              Funciones puras (form-composition, form-validation, diagnostics, form-definition)
  src/ports/               Interfaces de puertos (AcademicCatalog, SubmissionRepository)
  src/application/         Casos de uso (discoverTargets, getTargetForm, submitPreinscription)
  src/infrastructure/      Adaptadores concretos (FixtureAcademicCatalog, PostgresSubmissionRepository, Kysely, migraciones)
  src/presentation/        Rutas Express, controladores y manejo seguro de errores
```

---

## 3. Contrato WordPress REST v1 y Fixtures

Las fixtures se encuentran en `apps/api/src/fixtures/wordpress-preinscriptions.json` y replican la estructura canónica:
- `version`: 1
- `targets`: lista de destinos, conteniendo:
  - `id`: identificador estable (ej: `davia-c11`).
  - `kind`: discriminado como `academic_offer` o `seminar`.
  - `title`: nombre descriptivo de la cohorte o edición.
  - `registrationOpen`: booleano de apertura.
  - `registrationWindow`: rango de fechas ISO o null.
  - `configRevision`: huella de revisión para prevenir envíos con formularios obsoletos.
  - `form`: `{ valid: boolean, inputs: TargetInputConfig[], issues: string[] }`.
  - `orientations`: lista estructurada de orientaciones con sus respectivas menciones dependientes.
  - `urls`: enlaces públicos, de edición y legacy.

---

## 4. Persistencia Relacional 3FN en PostgreSQL

Tablas normalizadas creadas mediante Kysely:
- `targets`: snapshot técnico del destino.
- `input_definitions`: catálogo de inputs semánticos reconocidos.
- `target_inputs`: relación de inputs requeridos/posicionados por destino (clave primaria compuesta: `(target_id, input_key)`).
- `orientations`: orientaciones disponibles por destino.
- `mentions`: menciones académicas.
- `orientation_mentions`: relación de menciones pertenecientes a cada orientación (clave primaria compuesta: `(orientation_id, mention_id)`).
- `submissions`: registro central del envío (ID opaco `sub_...`, timestamp, revisión de configuración).
- `submission_values`: campos individuales almacenados por clave de input (clave primaria compuesta: `(submission_id, input_key)`).

---

## 5. Instrucciones de Operación Local

### Requisitos previos:
- Node.js >= 22 (recomendado Node 24).
- Corepack / pnpm (`corepack enable && pnpm --version`).
- Docker y Docker Compose.

### Inicio rápido con Docker Compose:
```bash
# Levantar todos los servicios y compilar imágenes
docker compose up -d --build

# Verificar estado de salud de la API
curl http://localhost:3000/api/health
# Respuesta: {"status":"ok","database":"up"}

# Abrir la aplicación web en el navegador
# http://localhost:5173
```

### Ejecución de Pruebas y Verificación:
```bash
# Ejecutar pruebas unitarias e integración en todos los paquetes
pnpm test

# Ejecutar comprobación estática de tipos estricta
pnpm typecheck

# Ejecutar migraciones sobre PostgreSQL local
pnpm db:migrate
```
