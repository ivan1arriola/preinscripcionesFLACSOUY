# Correcciones y mejoras de Preinscripciones FLACSO Uruguay - Plan de implementación

> **Para agentes de implementación:** usar `superpowers:subagent-driven-development` o `superpowers:executing-plans` y ejecutar las tareas en orden. Cada paso debe producir una comprobación verificable.

**Objetivo:** Resolver los seis problemas reportados en el formulario y hacer que la relación entre la carpeta raíz de Google Drive y las planillas por oferta sea dinámica, idempotente y resistente a cambios de carpeta.

**Arquitectura:** El trabajo se divide en tres bloques independientes: UX y contratos del formulario; normalización de datos provenientes de WordPress; y reconciliación Drive–Sheets más persistencia de filas. La carpeta raíz configurada en `system_settings` es la única configuración manual. Las planillas se descubren por metadatos de dominio (`targetId`) en Drive; un `spreadsheetId` usado durante una llamada no es la fuente persistente de verdad.

**Stack:** React 18, TypeScript, CSS nativo, Vitest, Testing Library, `country-flag-icons`, Google Drive API y Google Sheets API.

**Documentos de referencia:**
- `docs/ARQUITECTURA.md`, especialmente las secciones de jerarquía Drive, identificadores y persistencia.
- `docs/superpowers/specs/2026-10-02-google-drive-hierarchy-and-semantic-files-design.md`.
- Feedback del usuario del 2026-10-04.

## Estado previo y límites

- El checkout tiene cambios locales no relacionados en `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/app.css`, `TargetList.tsx`, `HomePage.tsx` y `HomePage.test.tsx`. No deben incluirse en los commits de este plan.
- Antes de implementar, ejecutar `git status --short --branch` y conservar esos cambios. No usar `git reset`, `git clean`, `git stash` ni reemplazos amplios para ocultarlos.
- Los cambios que toquen `app.css`, `package.json` o `pnpm-lock.yaml` deben separarse cuidadosamente del diff local existente. Si no es posible separar el archivo de forma segura, detener la tarea y revisar el diff manualmente antes de hacer commit.
- El plan no autoriza todavía cambios de producción, creación de planillas reales, movimiento de archivos reales ni envío de correos.

## Puntos de entrada actuales que deben corregirse

- `apps/web/src/components/UniversalFields.tsx` actualmente muestra emojis en las opciones del país y `apps/web/src/app.css` conserva `.phone-input input { padding-left: 5.7rem; }`.
- `packages/contracts/src/canonical-forms.ts` y `apps/api/src/domain/form-definition.ts` todavía contienen la pregunta antigua de difusión.
- `apps/api/src/infrastructure/wordpress/wordpress-client.ts::getAgreements()` aplica `trim()` sin decodificar entidades.
- `apps/web/src/components/PreinscriptionWizard.tsx` llama `onSubmit` directamente desde el último paso.
- `apps/api/src/application/target-spreadsheet-service.ts::ensureForTarget()` retorna inmediatamente desde `TargetSpreadsheetRepository.get()` y por eso no reevalúa la carpeta raíz.
- `apps/api/src/presentation/http/admin-settings-routes.ts::PUT /google-drive` actualiza la configuración, pero no inicia reconciliación de planillas.
- `apps/api/src/infrastructure/google/google-spreadsheet-provisioner.ts` crea la planilla directamente bajo la carpeta recibida; debe recibir la carpeta específica del target y escribir `appProperties`.
- `apps/api/src/infrastructure/google/google-sheets-repository.ts::appendByHeaders()` lanza `IncompatibleSpreadsheetError` cuando falta una columna y no intenta una reparación aditiva.
- `target_spreadsheets` y `spreadsheet_operations` pueden conservar IDs históricos para auditoría e idempotencia de operaciones anteriores, pero no deben ser la fuente única para resolver la planilla vigente.

## Reglas globales

- Mantener los endpoints públicos existentes y los contratos TypeScript compatibles.
- No perder datos obligatorios de una preinscripción por un fallo de Drive o Sheets.
- No crear planillas duplicadas cuando ya existe una planilla del mismo `targetId`.
- No usar el título visible de la oferta como identificador; los nombres pueden cambiar.
- No reconstruir planillas completas, borrar columnas manuales, reordenar filas ni sobrescribir observaciones.
- Las reparaciones de encabezados deben ser aditivas y preservar todos los encabezados existentes.
- La configuración persistente manual será únicamente el ID/URL de la carpeta raíz de Drive.
- Se puede persistir auditoría o caché, pero una asociación persistida `targetId -> spreadsheetId` nunca debe evitar una verificación dinámica cuando cambia la carpeta raíz.
- Los nombres y textos aprobados en español deben conservarse exactamente.

## Protocolo de ejecución para el agente

- Trabajar sobre el checkout actual, sin crear cambios en otro repositorio.
- Antes de cada tarea, leer los archivos indicados y comparar sus interfaces reales con este plan. Si una firma difiere, ajustar primero el plan o documentar la diferencia en el commit.
- Aplicar TDD: prueba que falla, implementación mínima, prueba enfocada, typecheck del paquete y revisión del diff.
- No ejecutar `pnpm install` si la dependencia ya está presente. Si el lockfile necesita cambiar, justificarlo en el diff.
- Después de cada tarea, ejecutar `git diff --check` y revisar `git diff --name-only` para confirmar que no entraron cambios de HomePage, TargetList u otros cambios locales.
- Crear un commit por tarea terminada, salvo la Tarea 1, que es solo inspección. Usar mensajes descriptivos y agregar únicamente archivos de la tarea.
- No hacer push, deploy, migraciones de producción, llamadas contra Drive productivo ni movimientos reales de planillas durante la implementación local.

## Review Focus

- Cambiar la carpeta raíz después de haber creado planillas: debe reconciliar las planillas existentes, no crear duplicados.
- Dos ofertas con títulos iguales o títulos modificados: deben seguir diferenciándose por `targetId`.
- Drive sin permisos para mover o crear: la operación debe informar el bloqueo y no registrar una asociación incompleta.
- Sheets con una columna requerida ausente: debe agregarse de forma aditiva; si no se puede, la preinscripción no puede terminar como exitosa y perder el dato.
- Volver desde la revisión del formulario y modificar datos o archivos: la pantalla de confirmación debe mostrar el estado actualizado y evitar doble envío.

---

### Tarea 1: Preparar el trabajo y aislar cambios locales

**Archivos:**
- Inspección: `git status`, `git diff`, `git diff --stat`.
- No modificar los archivos locales no relacionados.

- [ ] **Paso 1: Registrar el estado inicial**

Ejecutar:

```bash
git status --short --branch
git diff --stat
git diff -- apps/web/package.json apps/web/src/app.css apps/web/src/components/TargetList.tsx apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx
```

Resultado esperado: el diff local queda identificado y los commits posteriores solo incluyen archivos o hunks pertenecientes a esta implementación.

- [ ] **Paso 2: Confirmar el estado de dependencias existente**

Verificar si `country-flag-icons`, `@testing-library/react` y `@testing-library/jest-dom` ya están en `apps/web/package.json`. No volver a agregarlos ni commitear cambios de ordenamiento del JSON o del lockfile que no sean necesarios.

---

### Tarea 2: Restaurar banderas del selector telefónico

**Archivos:**
- Modificar: `apps/web/src/components/UniversalFields.tsx`
- Modificar: `apps/web/src/app.css` únicamente en el bloque `.phone-input`.
- Modificar: `apps/web/src/components/UniversalFields.test.tsx`

**Interfaces:** Mantener sin cambios las props de `UniversalFields`. Mantener el `<select id="phone-country">` nativo, accesible y operable con teclado/táctil.

- [ ] **Paso 1: Agregar pruebas de comportamiento**

Cubrir:

```tsx
it('renders the Uruguay SVG flag and calling code by default', () => { /* assert select=UY, SVG flag, +598 */ });
it('updates the visible flag and calling code when country changes', () => { /* change select to AR, assert +54 and Argentina SVG */ });
```

La prueba debe verificar un elemento SVG real, no solo un fallback textual.

- [ ] **Paso 2: Ejecutar las pruebas y confirmar el fallo inicial**

```bash
pnpm --filter web test src/components/UniversalFields.test.tsx
```

- [ ] **Paso 3: Implementar el disparador visual**

Usar `country-flag-icons/react/3x2`, resolver el componente por `phoneCountry`, mostrar la bandera, el código de llamada y un indicador visual, y superponer el `<select>` nativo transparente sin quitar su accesibilidad.

Eliminar el `padding-left: 5.7rem` y no afectar campos de texto fuera del selector telefónico.

- [ ] **Paso 4: Ejecutar pruebas y typecheck del paquete**

```bash
pnpm --filter web test src/components/UniversalFields.test.tsx
pnpm --filter web typecheck
```

- [ ] **Paso 5: Validar visualmente móvil y escritorio**

Comprobar que el selector no tapa el input, que el foco es visible y que el texto de la opción sigue siendo accesible.

---

### Tarea 3: Corregir la autorización de difusión de imagen

**Archivos:**
- Modificar: `packages/contracts/src/canonical-forms.ts`
- Modificar: `apps/api/src/domain/form-definition.ts`
- Modificar: pruebas que contengan la etiqueta anterior bajo `apps/api` y `apps/web`.

**Texto exacto:** `¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?`

- [ ] **Paso 1: Actualizar pruebas primero**

Actualizar las expectativas de formularios canónicos y agregar una aserción de que la etiqueta anterior no aparece en la definición expuesta.

- [ ] **Paso 2: Actualizar ambas fuentes de definición**

Modificar la definición compartida y la definición backend sin alterar la clave `aceptaDifusion`, el tipo, la obligatoriedad ni la columna `Autoriza difusión`.

- [ ] **Paso 3: Ejecutar auditoría residual y pruebas**

```bash
rg -n "nombre y foto|difusión de tu nombre" apps packages
pnpm --filter @flacso/contracts build
pnpm --filter api test src/domain/form-validation.test.ts
pnpm --filter web test src/components/UniversalFields.test.tsx
```

La búsqueda no debe encontrar la redacción anterior fuera de documentación histórica explícitamente clasificada.

---

### Tarea 4: Decodificar títulos de convenios provenientes de WordPress

**Archivos:**
- Crear: `apps/api/src/infrastructure/wordpress/html-entities.ts`
- Crear: `apps/api/src/infrastructure/wordpress/html-entities.test.ts`
- Modificar: `apps/api/src/infrastructure/wordpress/wordpress-client.ts`
- Modificar: `apps/api/src/infrastructure/wordpress/wordpress-contract.test.ts`

**Interfaz:** `decodeHtmlEntities(raw: string): string` debe ser pura, conservar texto inválido sin lanzar y decodificar las referencias requeridas por WordPress: decimales, hexadecimales y entidades nombradas usadas en títulos institucionales.

- [ ] **Paso 1: Escribir pruebas unitarias**

Cubrir `&#8211;`, `&#243;`, `&#x2013;`, `&amp;`, `&quot;`, texto sin entidades, referencias desconocidas y referencias numéricas inválidas.

- [ ] **Paso 2: Escribir prueba de contrato WordPress**

Agregar una respuesta REST con un convenio como `Antígona &#8211; Asociación Civil` y esperar el label Unicode correcto.

- [ ] **Paso 3: Implementar el decodificador acotado**

No introducir HTML en la interfaz ni descodificar dos veces. La función debe trabajar solo sobre texto de títulos y conservar referencias desconocidas.

- [ ] **Paso 4: Integrar únicamente en la salida de convenios**

Aplicar la función antes de `trim()` en `getAgreements()`. Si otro endpoint de WordPress expone títulos que llegan codificados, agregar una prueba y una integración explícita para ese endpoint; no declarar corregidos “todos los títulos” si no se integran todos.

- [ ] **Paso 5: Verificar**

```bash
pnpm --filter api test src/infrastructure/wordpress/html-entities.test.ts src/infrastructure/wordpress/wordpress-contract.test.ts
pnpm --filter api typecheck
```

---

### Tarea 5: Unificar el botón de envío con la paleta institucional

**Archivos:**
- Modificar: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modificar: `apps/web/src/app.css` únicamente en el bloque del botón.
- Modificar: `apps/web/src/components/PreinscriptionWizard.test.tsx`

- [ ] **Paso 1: Fijar el contrato de texto y estado**

El botón del paso final debe iniciar la revisión, no enviar directamente. Su texto será `Revisar datos` hasta que exista la pantalla de confirmación. El botón de envío definitivo se definirá en la Tarea 6.

- [ ] **Paso 2: Agregar pruebas de clase y estado**

Comprobar que el botón no contiene clases verdes, usa `wizard-submit-action`, se deshabilita durante `isSubmitting` y mantiene el texto accesible.

- [ ] **Paso 3: Implementar estilos azules institucionales**

Usar la paleta existente (`#175cd3` / `#164cae`) y estados hover, focus-visible y disabled. No sustituir otros estilos locales del catálogo ni sobrescribir cambios ajenos de `app.css`.

- [ ] **Paso 4: Verificar**

```bash
pnpm --filter web test src/components/PreinscriptionWizard.test.tsx
pnpm --filter web typecheck
```

---

### Tarea 6: Agregar revisión de datos y estado de envío

**Archivos:**
- Crear: `apps/web/src/components/PreinscriptionSummary.tsx`
- Crear: `apps/web/src/components/PreinscriptionLoadingOverlay.tsx`
- Modificar: `apps/web/src/components/PreinscriptionWizard.tsx`
- Modificar: `apps/web/src/app.css`
- Modificar: `apps/web/src/components/PreinscriptionWizard.test.tsx`

**Interfaces:**

```ts
interface PreinscriptionSummaryProps {
  form: FormDefinition;
  values: Record<string, string>;
  files: SubmissionFileToken[];
  onEditStep: (stepIndex: number) => void;
  onConfirm: () => void;
  disabled: boolean;
}

interface PreinscriptionLoadingOverlayProps {
  title?: string;
  message?: string;
}
```

- [ ] **Paso 1: Escribir una prueba ejecutable del flujo completo**

La prueba debe completar datos mínimos, avanzar al último paso, pulsar `Revisar datos`, comprobar:

```tsx
expect(screen.getByRole('heading', { name: /Revisión de datos antes de enviar/i })).toBeInTheDocument();
expect(screen.getByText('Montevideo')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /Confirmar y enviar preinscripción/i })).toBeInTheDocument();
```

Luego debe pulsar el botón definitivo con una promesa de envío pendiente y comprobar `role="dialog"`, `aria-live="polite"`, el título de carga y que no se pueda iniciar un segundo envío.

- [ ] **Paso 2: Implementar `PreinscriptionSummary`**

Construir los bloques desde `form.inputs`, `form.documents` y `form.agreements`, respetando las condiciones actuales. Crear una función pura de presentación, por ejemplo `buildSummarySections(form, values, files)`, para que la prueba pueda verificar el contenido sin depender de CSS.

Cada campo debe mostrar la etiqueta de `InputDefinition.label` y el valor actual; los valores vacíos opcionales deben mostrarse como `No informado`, nunca como `undefined`. `convenioWordpressId` debe resolverse contra `form.agreements` para mostrar el label, no el ID. Los radios `Si`/`No` deben mostrarse como `Sí`/`No`.

Los documentos deben mostrar nombre original y tamaño desde `SubmissionFileToken`. Para una alternativa `defer`, mostrar `Se entregará posteriormente` cuando corresponda. No mostrar tokens internos ni URLs privadas.

Cada bloque debe tener un botón de edición que invoque `onEditStep` con el índice real del paso, no con una posición codificada independiente.

- [ ] **Paso 3: Implementar `PreinscriptionLoadingOverlay`**

Usar `role="dialog"`, `aria-modal="true"`, `aria-live="polite"`, foco inicial controlado y textos exactos:

`Enviando tu preinscripción…`

`Guardando tus datos y documentación en FLACSO Uruguay. Por favor aguardá unos instantes.`

- [ ] **Paso 4: Integrar estados en el wizard**

Agregar `isReviewing`. El botón final valida el paso y pasa a revisión. `Volver a modificar datos` desactiva la revisión y lleva al paso elegido. El envío definitivo debe volver a validar antes de invocar `onSubmit(values, files)`.

No duplicar el estado de `values` ni `files` dentro de `PreinscriptionSummary`; recibir siempre el estado actual del wizard. Al volver de una edición, el resumen debe reconstruirse con los nuevos valores. Si se elimina un archivo, la pantalla debe reflejarlo y la validación final debe volver a ejecutarse.

Durante `isSubmitting`, mostrar el overlay y bloquear navegación, edición y confirmación duplicada. Si `onSubmit` falla y el padre restablece `isSubmitting`, conservar los datos y volver a mostrar el error existente.

- [ ] **Paso 5: Verificar**

```bash
pnpm --filter web test src/components/PreinscriptionWizard.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

---

### Tarea 7: Descubrimiento dinámico y reconciliación Drive–Sheets

Esta tarea debe ejecutarse antes de modificar la reparación de columnas.

**Archivos:**
- Modificar: `apps/api/src/application/target-spreadsheet-service.ts`
- Modificar: `apps/api/src/infrastructure/google/google-drive-repository.ts`
- Modificar: `apps/api/src/infrastructure/google/google-spreadsheet-provisioner.ts`
- Modificar: `apps/api/src/ports/google-drive-repository.ts`
- Modificar: `apps/api/src/ports/target-spreadsheet-repository.ts`
- Modificar: `apps/api/src/infrastructure/database/postgres-target-spreadsheet-repository.ts`
- Modificar: `apps/api/src/presentation/http/admin-settings-routes.ts`
- Modificar: `apps/api/src/presentation/http/admin-settings-routes.test.ts`
- Modificar: `apps/web/src/api/client.ts`
- Modificar: `apps/web/src/components/AdminDriveSettingsCard.tsx`
- Modificar: `apps/web/src/components/AdminSpreadsheetSettingsCard.tsx`
- Modificar: pruebas de `target-spreadsheet-service`, Drive y provisioner.
- Crear migración solo si se necesita registrar estado de reconciliación; no borrar datos históricos automáticamente.

**Metadatos de propiedad de una planilla:**

```text
appProperties.flacsoResource = preinscription-spreadsheet
appProperties.flacsoTargetId = <target.id>
appProperties.flacsoTargetRevision = <target.configRevision>
```

El nombre visible de la planilla puede ser `target.title`, pero nunca debe utilizarse para resolver la identidad. La búsqueda debe filtrar por `mimeType = 'application/vnd.google-apps.spreadsheet'`, `trashed = false` y `appProperties.flacsoResource = 'preinscription-spreadsheet'`. El valor `flacsoTargetId` debe escaparse antes de construir la consulta de Drive.

La jerarquía de cada planilla debe ser:

```text
<raíz configurada>/
  Ofertas académicas/<oferta>/<cohorte>/Planilla de preinscripciones
  Seminarios/<seminario>/<edición>/Planilla de preinscripciones
```

La planilla debe estar directamente dentro de la carpeta del target, no dentro de `Preinscripciones/Documentación`; esas carpetas son exclusivamente para archivos documentales. Si la implementación existente aún crea la planilla directamente en la raíz, la tarea debe corregirlo y cubrirlo con una prueba de `parents`.

**Interfaces nuevas:**

```ts
interface SpreadsheetDiscovery {
  targetId: string;
  spreadsheetId: string;
  sheetName: string;
  parentFolderId: string;
  url: string;
}

interface SpreadsheetDiscoveryPort {
  findByTargetId(rootFolderId: string, targetId: string): Promise<SpreadsheetDiscovery | null>;
  moveToTargetFolder(input: { spreadsheetId: string; target: AcademicTarget; rootFolderId: string }): Promise<SpreadsheetDiscovery>;
}
```

La implementación concreta puede ampliar `GoogleDriveRepositoryPort`, pero no debe hacer que el frontend conozca tokens Google, IDs internos de carpetas ni consultas Drive. El servicio de aplicación debe recibir `AcademicTarget` y devolver `TargetSpreadsheetConfiguration`.

La búsqueda debe tener dos fases:

1. buscar dentro de la jerarquía de la carpeta raíz actual;
2. si no aparece allí, buscar globalmente entre los archivos accesibles por la cuenta de servicio usando `appProperties.flacsoTargetId`, para localizar una planilla que quedó bajo la raíz anterior y moverla.

Para planillas históricas creadas antes de `appProperties`, usar la fila existente de `target_spreadsheets` solo como puente de migración: consultar ese ID, verificar que sea una Spreadsheet accesible, escribir los metadatos de propiedad y luego continuar por el flujo dinámico. Si la fila histórica apunta a un archivo inexistente o a un tipo incorrecto, marcar el target como `blocked` y no crear una segunda planilla automáticamente.

- [ ] **Paso 1: Escribir pruebas de descubrimiento**

En `apps/api/src/infrastructure/google/google-drive-repository.test.ts`, agregar pruebas con `fetchImpl` que inspeccionen la URL y el cuerpo de cada request. Cubrir que encuentra una planilla por `appProperties.flacsoTargetId` aunque cambie su título, ignora archivos enviados a la papelera, distingue dos targets con el mismo título, devuelve `null` cuando no existe y no reutiliza una planilla sin el marcador de propiedad.

Las aserciones deben verificar `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, `mimeType` de Spreadsheet y la presencia de ambos metadatos. No usar `spreadsheet_id` almacenado como respuesta simulada de descubrimiento.

- [ ] **Paso 2: Escribir pruebas de reconciliación**

En `apps/api/src/application/target-spreadsheet-service.test.ts`, usar repositorios fake en memoria y un provisioner fake. Cubrir primer envío, asociación persistida antigua con carpeta raíz cambiada, planilla existente en la jerarquía anterior, cambio de nombre de oferta, error de permisos de movimiento y dos llamadas concurrentes.

La prueba de carpeta cambiada debe demostrar que `repository.get(target.id)` devuelve una asociación antigua, pero el servicio consulta Drive y devuelve la planilla descubierta/reubicada, no la asociación antigua automáticamente. La prueba concurrente debe comprobar que el provisioner recibe una sola orden `create`.

- [ ] **Paso 3: Implementar búsquedas y movimiento en Drive**

Usar `files.list` con `mimeType`, `trashed=false`, `appProperties` y `supportsAllDrives/includeItemsFromAllDrives`. Crear la jerarquía de carpetas de destino de forma idempotente. Mover con `files.update` usando `addParents` y `removeParents` cuando sea permitido.

Agregar métodos concretos equivalentes a:

```ts
findSpreadsheetByTargetId(rootFolderId: string, targetId: string): Promise<SpreadsheetDiscovery | null>;
ensureTargetFolder(rootFolderId: string, target: AcademicTarget): Promise<string>;
moveSpreadsheet(spreadsheetId: string, fromFolderId: string, toFolderId: string): Promise<void>;
```

`findSpreadsheetByTargetId` debe detectar más de un resultado para el mismo target y devolver un error de inconsistencia, nunca elegir arbitrariamente uno. `moveSpreadsheet` debe comprobar la respuesta HTTP y no actualizar la base local si Drive rechaza el movimiento.

La operación no debe mover ni modificar documentos de postulantes; solo la planilla de la oferta/seminario.

- [ ] **Paso 4: Cambiar `TargetSpreadsheetService`**

`ensureForTarget()` debe resolver en este orden: leer la carpeta raíz actual; buscar la planilla por `targetId` en Drive; reconciliar su ubicación y encabezados si existe; crearla con los metadatos si no existe; y guardar una referencia operativa/auditoría solo después de que Drive confirme la operación.

La firma pública debe continuar siendo:

```ts
ensureForTarget(target: AcademicTarget): Promise<TargetSpreadsheetConfiguration>
```

La configuración devuelta debe contener `targetId`, `spreadsheetId`, `sheetName` y `url`. El `spreadsheetId` se usa para la operación actual, pero el siguiente llamado debe poder resolver la planilla desde Drive aunque la fila local haya quedado desactualizada.

Si se mantiene `target_spreadsheets`, agregar al menos `root_folder_id`, `last_discovered_at` y un estado de reconciliación, o documentar por qué esos datos se mantienen solo como auditoría. No introducir una migración destructiva para eliminar asociaciones históricas.

La existencia de una fila en `target_spreadsheets` no puede producir un retorno inmediato sin validar la carpeta raíz actual.

- [ ] **Paso 5: Reconciliar al cambiar la carpeta desde administración**

El endpoint `PUT /api/admin/settings/google-drive` debe validar e inspeccionar la nueva carpeta, persistir el cambio solo después de comprobar permisos, ejecutar o iniciar una reconciliación de todos los targets provisionables, devolver estado por target (`reconciled`, `created`, `unchanged` o `blocked`) y no informar éxito global si algún target quedó bloqueado.

Definir explícitamente el JSON de respuesta para la operación síncrona:

```json
{
  "ok": false,
  "googleDriveFolderId": "folder-new",
  "reconciliation": {
    "status": "blocked",
    "targets": [
      { "targetId": "offer-1", "status": "reconciled", "spreadsheetId": "sheet-1" },
      { "targetId": "offer-2", "status": "blocked", "code": "DRIVE_MOVE_FORBIDDEN", "message": "..." }
    ]
  }
}
```

No guardar la nueva carpeta si la validación inicial falla. Si la carpeta se guarda pero una reconciliación posterior queda bloqueada, conservar la carpeta nueva, devolver estado parcial explícito y permitir reintentar sin duplicar planillas.

Si la cantidad de targets exige una operación asíncrona, el endpoint debe devolver un identificador de operación y la UI debe mostrar progreso y errores; no debe fingir que la migración terminó.

La reconciliación debe ser idempotente: repetir `PUT /google-drive` con la misma carpeta no debe mover nuevamente archivos, crear planillas nuevas ni duplicar carpetas. Si se detectan dos planillas con el mismo `flacsoTargetId`, el target queda `blocked` hasta una resolución administrativa explícita.

- [ ] **Paso 6: Actualizar la pantalla administrativa**

La pestaña de planillas debe mostrar estado y ubicación actual, no tratar el ID como configuración editable. Debe ofrecer `Sincronizar planillas` y mostrar bloqueos de permisos. La carpeta raíz debe explicar que cambiarla también reubica o reconcilia las planillas.

Actualizar `apps/web/src/api/client.ts` con tipos para el estado de reconciliación. `AdminDriveSettingsCard` debe mostrar una advertencia antes de guardar una carpeta distinta y el resultado por target después de guardar. `AdminSpreadsheetSettingsCard` debe mostrar el enlace generado desde la respuesta actual, pero no permitir editar `spreadsheetId` ni presentar el ID como configuración manual.

- [ ] **Paso 7: Verificar**

```bash
pnpm --filter api test src/application/target-spreadsheet-service.test.ts src/infrastructure/google/google-drive-repository.test.ts src/infrastructure/google/google-spreadsheet-provisioner.test.ts src/presentation/http/admin-settings-routes.test.ts
pnpm --filter api typecheck
pnpm --filter web test src/pages/AdminProfilesPage.test.tsx
```

---

### Tarea 8: Reparar encabezados de Sheets sin perder datos

**Archivos:**
- Modificar: `apps/api/src/infrastructure/google/google-sheets-repository.ts`
- Modificar: `apps/api/src/infrastructure/google/google-sheets-repository.test.ts`
- Modificar: `apps/api/src/domain/spreadsheet-row.ts`
- Modificar: `apps/api/src/domain/spreadsheet-row.test.ts`
- Modificar pruebas de flujo de envío que cubran el error de Sheets.

**Regla de integridad:** Si falta una columna requerida, el sistema intenta agregarla. Si no puede agregarla, no debe anexar una fila incompleta ni devolver éxito.

Definir un error específico, por ejemplo:

```ts
class SpreadsheetSchemaRepairError extends Error {
  constructor(public readonly missingColumns: string[], cause?: unknown) {}
}
```

El flujo HTTP de envío debe conservar los archivos temporales cuando recibe este error y responder con un error recuperable. No convertirlo en una respuesta `201` ni ocultarlo detrás de `console.warn`.

- [ ] **Paso 1: Agregar prueba de reparación aditiva**

Con encabezados `Timestamp`, `Nombre`, `País de residencia`, requerir también `Ciudad de residencia`. Verificar que se actualice la fila 1 conservando el orden y todos los encabezados existentes, y que luego se anexe la fila completa.

La prueba debe usar el `sheetName` explícito (`Inscripciones`) y esperar el rango exacto `Inscripciones!1:1`. También debe comprobar que una columna manual como `Observaciones Asistente` queda en la misma posición y recibe una celda vacía en la nueva fila.

- [ ] **Paso 2: Agregar pruebas de fallo seguro**

Cubrir `updateValues` rechazado, encabezados vacíos, encabezados manuales extra y que los valores de todas las columnas requeridas nunca se descarten silenciosamente. En el caso de fallo, comprobar explícitamente `expect(mockClient.appendValues).not.toHaveBeenCalled()`.

- [ ] **Paso 3: Implementar resolución de encabezados**

Leer encabezados, calcular columnas faltantes por nombre normalizado y actualizar solo la fila 1 con la lista existente más las nuevas columnas. Reconstruir la fila usando los encabezados confirmados.

No declarar `buildSpreadsheetRow` exitoso mientras falte una columna requerida. Separar la función pura de cálculo de encabezados de la operación HTTP para probarla sin Drive. Después de `updateValues`, reconstruir la fila contra `updatedHeaders`, no contra los encabezados antiguos.

No usar un fallback que mapee únicamente columnas existentes si eso omite datos obligatorios. El error debe propagarse al flujo de envío, que conservará los temporales y expondrá un error recuperable.

- [ ] **Paso 4: Mantener compatibilidad del contrato de diagnóstico**

`diagnose()` debe seguir reportando encabezados faltantes. La reparación de un envío no debe hacer que un spreadsheet incompatible sea considerado válido antes de verificar la escritura.

- [ ] **Paso 5: Verificar**

```bash
pnpm --filter api test src/domain/spreadsheet-row.test.ts src/infrastructure/google/google-sheets-repository.test.ts src/presentation/http/submission-files.test.ts
pnpm --filter api typecheck
```

---

### Tarea 9: Verificación integral y revisión visual

**Archivos:**
- No crear archivos de producción.
- Actualizar documentación solo si las interfaces finales difieren de `docs/ARQUITECTURA.md`.

- [ ] **Paso 1: Ejecutar pruebas, tipos y build**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

- [ ] **Paso 2: Ejecutar auditorías residuales**

```bash
rg -n "nombre y foto|difusión de tu nombre|5\.7rem|bg-green-600|IncompatibleSpreadsheetError" apps packages
```

Clasificar cada coincidencia: código vigente, prueba intencional o documentación histórica. No declarar terminado mientras una referencia activa contradiga este plan.

- [ ] **Paso 3: Revisar el flujo visual del formulario**

Verificar selector de país, botón azul, revisión de datos, edición por sección, overlay de carga y estado de error de envío.

- [ ] **Paso 4: Verificar administración Drive–Sheets en entorno controlado**

Usar mocks o fixtures, no credenciales ni datos productivos, para comprobar cambio de carpeta, descubrimiento por `targetId`, ausencia de duplicados y bloqueo explícito ante permisos insuficientes.

- [ ] **Paso 5: Preparar publicación separada**

Revisar el diff por tarea, crear commits descriptivos sin cambios locales ajenos y reportar por separado validación local, publicación, CI, deploy y verificación de producción. Este plan no autoriza ejecutar la publicación automáticamente.

## Criterios de aceptación finales

El trabajo solo puede declararse completo cuando todas estas afirmaciones sean verdaderas:

1. El selector de teléfono muestra una bandera SVG, el prefijo correcto y sigue funcionando con teclado y lector de pantalla.
2. La etiqueta visible y el contrato backend usan exactamente `¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?`.
3. Un convenio WordPress con `&#8211;`, `&#243;` o `&amp;` aparece correctamente decodificado en el formulario.
4. El botón de revisión/envío usa la paleta azul institucional y no conserva clases verdes.
5. El usuario puede revisar los datos, volver a un paso, corregirlos, regresar a la revisión y confirmar una sola vez.
6. Mientras se envía, el overlay bloquea la interacción y desaparece correctamente ante éxito o error.
7. Cambiar la carpeta raíz de Drive encuentra las planillas existentes por `targetId`, las reubica cuando es posible y no crea duplicados.
8. El sistema no depende de que el administrador copie o edite IDs de Spreadsheet.
9. Las planillas antiguas sin metadatos se migran una sola vez mediante la referencia histórica, quedan marcadas y luego se resuelven dinámicamente.
10. Una columna faltante como `Ciudad de residencia` se agrega sin borrar columnas manuales.
11. Si Drive o Sheets no puede completar la operación, la preinscripción no se informa como exitosa con datos incompletos y los temporales quedan disponibles para reintento/diagnóstico.
12. `pnpm test`, `pnpm typecheck`, `pnpm build` y `git diff --check` pasan sin incorporar los cambios locales no relacionados.
