# QA del formulario de preinscripción mobile-first

## Alcance verificado

- Entrada al formulario con tarjeta “Antes de comenzar”, sin mostrar campos antes de iniciar.
- Viewports de 360 × 800 y 390 × 844 px.
- Progreso compacto “Paso X de Y”, navegación con objetivos táctiles de al menos 44 px y sin scroll horizontal.
- Resumen de errores con enlaces que llevan el foco al campo correspondiente.
- Separación semántica entre “Trayectoria académica” y “Sobre esta preinscripción”.
- Tarjetas de documentos con estados pendiente, carga, listo y error sin perder otros archivos.
- Revisión final con acciones de edición y código de seguimiento copiable.

## Comandos de verificación

```bash
pnpm --filter web test
pnpm exec playwright test tests/e2e/mobile-preinscription.spec.ts
pnpm exec playwright test tests/e2e/preinscriptions.spec.ts tests/e2e/document-flow.spec.ts
pnpm typecheck
pnpm build
git diff --check
```

La revisión visual se realizó sobre el artefacto servido por Vite en 390 px, comprobando contenido visible, ausencia de overlay de errores y `document.documentElement.scrollWidth === window.innerWidth`.
