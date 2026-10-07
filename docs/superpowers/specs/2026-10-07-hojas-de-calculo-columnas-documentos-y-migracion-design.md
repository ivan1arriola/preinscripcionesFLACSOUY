# Rediseño del Esquema de Planillas de Google Sheets, Enlaces a Documentos y Script de Migración

**Fecha:** 2026-10-07  
**Estado:** Aprobado

---

## 1. Contexto y Objetivos

Las hojas de cálculo de Google Sheets asociadas a cada oferta académica y seminario de FLACSO Uruguay actúan como la bandeja operativa donde el equipo administrativo audita y gestiona las preinscripciones.

Este rediseño aborda:
1. **Fusión de columnas redundantes:**
   - `Identidad de género` y `Especificación de identidad de género (si seleccionó "Otra")` se fusionan en una única columna `Identidad de género`.
   - `Denominación del título` y `No posee actualmente título` se fusionan en una única columna `Denominación del título`.
2. **Reordenamiento de campos de identificación:**
   - `País emisor del documento` pasa a ubicarse antes de `Número de documento`.
3. **Identificación de país de celular:**
   - Incorporación de la columna `País del celular` contigua a `Celular`, registrando `UY` para Uruguay o el código ISO internacional correspondiente.
4. **Hipervínculos a documentación y carpetas:**
   - Subcarpetas por postulante en Google Drive dentro de la estructura de la oferta.
   - Columna `Carpeta de documentos` con enlace a la carpeta del postulante.
   - Columnas para cada documento solicitado con fórmula `=HYPERLINK(...)` al archivo o a la carpeta si el documento consta de múltiples archivos (como el documento de identidad frente y dorso).
5. **Script de migración y reescritura retroactiva:**
   - Herramienta para procesar todas las planillas históricas en Google Drive sin pérdida de datos.

---

## 2. Esquema Canónico de Columnas de la Planilla

### 2.1 Orden definitivo de cabezales (Fila 1)

1. **`ID de seguimiento`** (ej. `sub_37ac069da3a94b5683948ebd404070bf`)
2. **`Fecha de preinscripción`** (Timestamp ISO 8601 UTC)
3. **`Primer nombre`**
4. **`Segundo nombre`**
5. **`Primer apellido`**
6. **`Segundo apellido`**
7. **`Fecha de nacimiento`** (`YYYY-MM-DD`)
8. **`Tipo de documento`**
9. **`País emisor del documento`**
10. **`Número de documento`**
11. **`Identidad de género`**
12. **`Raza / etnia`**
13. **`País de nacimiento`**
14. **`País de residencia`**
15. **`Ciudad de residencia`**
16. **`Celular`**
17. **`País del celular`**
18. **`Correo electrónico`**
19. **`Ocupación actual`**
20. **`Estudios cursados`**
21. **`Posgrado en FLACSO`**
22. **`Denominación del título`**
23. **`Orientación`** *(Condicional si la propuesta tiene orientaciones)*
24. **`Mención`** *(Condicional si la propuesta tiene menciones)*
25. **`Convenio`**
26. **`Cómo conociste la propuesta`**
27. **`Autoriza difusión`**
28. **`Carpeta de documentos`**
29. **`Documento de identidad`**
30. **`Curriculum Vitae`**
31. **`Título de grado o terciario`** *(archivo adjunto)*
32. **`Carta de motivación`** *(condicional si la propuesta la requiere)*
33. **`Primera carta de recomendación`** *(si es Maestría)*
34. **`Segunda carta de recomendación`** *(si es Maestría)*

---

## 3. Reglas de Transformación de Valores

### 3.1 Identidad de género
* Si `genero === 'Otra'` y existe un valor no vacío en `generoOtra`, el valor de la columna es `generoOtra.trim()`.
* Si `genero === 'Otra'` pero `generoOtra` está vacío, el valor es `'Otra'`.
* Para cualquier otro valor de `genero`, se conserva dicho valor.
* La columna `Especificación de identidad de género` se retira del esquema de columnas activas.

### 3.2 País del celular
* A partir del número normalizado o ingresado en `celular`, se utiliza `parsePhoneNumberFromString(celular, 'UY')`.
* Si el número detectado pertenece a Uruguay (`country === 'UY'` o prefijo `+598`), el valor es `'UY'`.
* Si pertenece a otro país, el valor es el código de 2 letras del país (`phone.country`), por ejemplo `'AR'`, `'BR'`, `'ES'`.
* Si no se pudo determinar el país y no hay prefijo internacional, por defecto en el contexto local es `'UY'`.

### 3.3 Denominación del título
* Si `sinTituloActual === 'Si'` o `'true'`: el valor es `'No posee actualmente título'`.
* En caso contrario: se escribe `tituloDenominacion?.trim() ?? ''`.
* La columna separada `No posee actualmente título` se retira del esquema.

### 3.4 Convenio y Posgrado en FLACSO
* Se mantienen las reglas de colapsado existentes:
  * `Posgrado en FLACSO`: nombre del posgrado si cursó, o `'No'`.
  * `Convenio`: etiqueta legible del convenio (resuelto desde `agreements`), o `'No'`.

---

## 4. Google Drive y Columnas Documentales

### 4.1 Subcarpeta por postulante en Google Drive
* Cuando se almacenan los archivos de una preinscripción (`storeSubmissionFiles`), se crea una subcarpeta dedicada por postulante bajo:
  `Ofertas académicas / <Oferta> / <Cohorte> / Preinscripciones / Documentación / <apellidos-nombres-submissionId>`
* Todos los archivos de esa postulación se suben dentro de esa subcarpeta.
* `documentsFolderUrl` apunta a esta subcarpeta específica.

### 4.2 Hipervínculos a la carpeta y documentos
* **`Carpeta de documentos`**:
  * Si existe `folderUrl`: `=HYPERLINK("${folderUrl}", "Abrir carpeta")`
  * Si no existe: `""`
* **Columnas de archivos:**
  * Si el documento tiene 1 archivo con `driveFileId`:
    `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "Ver archivo")`
  * Si el documento tiene 2 o más archivos (como cédula frente y dorso):
    `=HYPERLINK("${folderUrl}", "Ver en carpeta")`
  * Si es el documento de título y `sinTituloActual === 'Si'`:
    `"No posee actualmente título"`
  * Si no se cargó archivo (por ser opcional o diferido):
    `""`

---

## 5. Script de Migración Retroactiva de Planillas

### 5.1 Requisitos operativos
* Comando ejecutable: `pnpm run migrate:spreadsheets [--dry-run] [--target=<targetId>]`
* Acceso a PostgreSQL (vía Kysely / variables de entorno) y a Google Sheets/Drive mediante las credenciales configuradas.

### 5.2 Algoritmo de migración por planilla
1. Obtener destinos activos y sus planillas registradas en `target_spreadsheets`.
2. Para cada planilla:
   * Leer los cabezales actuales (Fila 1) y todas las filas de datos existentes.
   * Cargar las preinscripciones de la base de datos para ese `target_id`, incluyendo `submission_values` y `submission_files`.
   * Para cada fila de la planilla:
     * Si coincide con un `ID de seguimiento` en la base de datos:
       - Reconstruir la fila usando los datos completos de la base de datos, los `drive_file_id` y la carpeta en Drive.
     * Si no coincide (fila agregada manualmente en Google Sheets):
       - Migrar los valores existentes mapeando las columnas antiguas a las nuevas (reordenando documento, fusionando género y título, deduciendo país del celular).
   * Escribir la nueva fila 1 con el esquema actualizado.
   * Sobrescribir el rango de filas de datos `A2:...` en una sola llamada de actualización atómica.
3. Emitir resumen con métricas: planillas procesadas, filas migradas y validación de integridad.
