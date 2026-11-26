# Guía para desarrolladores e IAs (`AGENTS.md`)

Fuente de verdad del proyecto: [`docs/plans/plan-maestro.md`](docs/plans/plan-maestro.md).
Registro de entregas y estado actual: [`docs/plans/bitacora.md`](docs/plans/bitacora.md).

## Estructura del monorepo (`pnpm`)
- `apps/api`: backend Express + Kysely + PostgreSQL 16 + Zod (TypeScript, ESM `NodeNext`).
- `apps/web`: SPA React 18 + Vite 6 con CSS propio (`app.css`, `form.css`, `pages/admin-responsive.css`).
- `packages/contracts`: tipos compartidos y definición canónica de formularios (`@flacso/contracts`). API y web lo consumen desde `dist/`.
- `tests/e2e`: pruebas de extremo a extremo con Playwright.
- `deploy/` y `scripts/`: despliegue en producción (`deploy/docker-compose.production.yml`, `scripts/deploy-production.sh`) y scripts de CI (`scripts/ci/`, a incorporar en E1).

## Comandos principales
- `pnpm --filter @flacso/contracts build`: compila contratos (necesario tras cambios en `packages/contracts` antes de validar API/web).
- `pnpm typecheck`: verificación de tipos en todo el monorepo.
- `pnpm test`: ejecuta pruebas unitarias y de integración (`PREINSCRIPTIONS_TEST_DATABASE_URL` habilita las suites reales contra PostgreSQL 16).
- `pnpm test:coverage`: ejecuta Vitest con cobertura V8 y candado mínimo (definido a partir de E1).
- `pnpm build`: compila `contracts`, `api` y `web`.
- `pnpm e2e`: corre Playwright (con `WEB_URL` apunta a un stack ya levantado sin lanzar servidores de desarrollo).
- `docker compose config --quiet` / `docker compose --env-file .env.production.example -f deploy/docker-compose.production.yml config --quiet`: valida sintaxis y variables requeridas de Compose.
- En producción **no existe `tsx`** (es `devDependency`): todo script operativo corre con `docker compose run --rm api node apps/api/dist/...`.

## Reglas de trabajo obligatorias
1. **Plan y decisiones cerradas:** no reabrir las decisiones de la sección 2 de `docs/plans/plan-maestro.md`. Si algo del plan choca con el código real, frenar y avisar antes de improvisar.
2. **Bitácora viva obligatoria:** leer `docs/plans/bitacora.md` antes de empezar y actualizarla **en el mismo commit** de cada incremento registrando **quién hizo qué** (persona y/o agente/proveedor: Claude, Codex, Antigravity), **fecha y hora (`YYYY-MM-DD HH:MM -03:00`)**, qué se cambió, verificaciones reales con resultados y qué queda pendiente o sin verificar.
3. **Flujo de entrega (`main` siempre desplegable):** 1 incremento = 1 PR = 1 commit squash en `main` con CI en verde. Ramas cortas por incremento. Mensajes en español con formato `tipo(ámbito): descripción` y nota de relevo en el cuerpo. Si algo se rompe en `main`, usar `git revert` primero antes de corregir.
4. **Migraciones solo aditivas:** todo cambio de esquema nuevo lleva `IF NOT EXISTS`. Prohibido `DROP`, `RENAME` o borrado de columnas en migraciones nuevas salvo en un despliegue posterior de contracción marcado con `// @migration-contraction`.
5. **Cero correos reales ni secretos versionados:** usar `admin@example.test` (o equivalentes ficticios como `admin@example.com`). Nunca leer ni versionar `.env`, `.env.production` ni `.secrets/`.
6. **Verificación antes de cerrar:** ejecutar `pnpm typecheck`, `pnpm test`, `pnpm build` (y `pnpm e2e` cuando se toque navegación, formularios o envíos) e informar resultados reales, incluyendo fallos o suites saltadas.

## Equipo de agentes y delegación

### Equipo base
| Rol | Modelo | Permisos | Responsabilidad |
|---|---|---|---|
| `Orchestrator` | `gemini-4-neon-medium` | Coordina | Alcance, asignación, consolidación, PR y CI |
| `Explorer` | `gemini-4-carbon-low` (tier rápido) | Solo lectura | Hallazgos con `archivo:línea` y evidencia |
| `Architect` | `gemini-4-neon-high` (tier alto) | Solo lectura | Archivos a tocar, contratos, riesgos, tests y criterios de aceptación en incrementos |
| `Implementer` | `gemini-4-carbon-medium` (tier medio) | Escritura acotada al incremento | Código y tests |
| `Reviewer` | `gemini-4-neon-high` (tier alto) | Solo lectura | Revisión crítica del diff completo, hallazgos por severidad |
| `QA` | `gemini-4-carbon-high` (tier alto) | Ejecuta pruebas, no edita | Resultados reales, casos negativos/límites y aceptación |

*Si la plataforma solo expone tiers genéricos como `flash`/`inherit`/`pro`, se mapean por nivel manteniendo la misma separación de permisos.*

- **Especialistas bajo demanda:** Seguridad y Base de datos (`gemini-4-neon-high`), UX/UI, Accesibilidad y Rendimiento (`gemini-4-carbon-high`), Documentación (`gemini-4-carbon-low`, única que escribe solo documentos); todos los demás operan en solo lectura.
- **Flujo:** `Orchestrator → Explorer → Architect → [Especialistas] → Implementer → Reviewer → QA → Orchestrator → CI verde → merge squash`. Si `Reviewer` o `QA` encuentran problemas, vuelve a `Implementer` y se repiten revisión y pruebas afectadas. En cambios triviales de documentación alcanza con `Implementer` + `Reviewer`.
- **Reglas operativas:** nadie afirma que algo funciona sin comprobarlo; cada tarea define alcance, entradas, salidas y restricciones; `Reviewer` lee el código y diff real sin basarse solo en el informe de `Implementer`; dos agentes nunca editan los mismos archivos a la vez; todos leen `AGENTS.md` y la parte del plan aplicable; cada agente informa modelo usado, qué ejecutó y qué no pudo verificar; ningún incremento termina sin revisión independiente; `push`, apertura de PR y `merge squash` están autorizados tras revisión independiente, QA y CI en verde siempre que queden registrados en `docs/plans/bitacora.md`; nunca desplegar ni tocar producción ni leer `.env*`/`.secrets/`.
