# Guía Operativa de Migración y Esquema de Planillas de Google Sheets

Esta guía documenta la reestructuración del esquema de columnas de Google Sheets, la organización de carpetas y enlaces en Google Drive, y el procedimiento para ejecutar la herramienta de migración retroactiva sin pérdida de datos.

---

## 1. Esquema de Columnas de las Planillas

El nuevo diseño unifica campos redundantes, clarifica el origen de los datos de contacto y documentales, e incorpora hipervínculos directos a los archivos de los postulantes en Google Drive.

### 1.1 Modificaciones Principales

1. **Fusión de Identidad de Género:**
   - La columna `Identidad de género` contiene la opción seleccionada o, si seleccionó `"Otra"`, el valor ingresado en la especificación.
   - La columna `"Especificación de identidad de género"` fue retirada.

2. **Reordenamiento de Documento:**
   - La columna `País emisor del documento` ahora precede inmediatamente a `Número de documento`.

3. **País del Celular:**
   - Se añade la columna `País del celular` inmediatamente a la derecha de `Celular`.
   - Registra el código ISO de 2 letras: `UY` para números de Uruguay o el código internacional correspondiente (ej. `AR`, `BR`, `ES`).

4. **Fusión de Título y Excepción:**
   - La columna `Denominación del título` unifica ambos conceptos: si el postulante marcó la excepción, se registra `"No posee actualmente título"`; en caso contrario, se registra el nombre del título de grado.
   - La columna separada `"No posee actualmente título"` fue retirada.

5. **Enlaces a Google Drive:**
   - **`Carpeta de documentos`**: Contiene la fórmula `=HYPERLINK("https://drive.google.com/drive/folders/...", "Abrir carpeta")` apuntando a la subcarpeta del postulante.
   - **Columnas de Documentos (`Documento de identidad`, `Curriculum Vitae`, `Título de grado o terciario`, etc.):**
     - Si el postulante subió **1 archivo**: `=HYPERLINK("https://drive.google.com/file/d/.../view", "Ver archivo")`.
     - Si subió **múltiples archivos** (ej. cédula frente y dorso): `=HYPERLINK("https://drive.google.com/drive/folders/...", "Ver en carpeta")`.
     - Si marcó la excepción de no poseer título: se indica `"No posee actualmente título"`.

---

## 2. Estructura de Carpetas en Google Drive

Los archivos de las preinscripciones se organizan con subcarpetas dedicadas por postulante bajo la jerarquía de la oferta académica:

```text
Google Drive
└── Ofertas académicas (o Seminarios)
    └── <Nombre de la Oferta>
        └── <Cohorte / Edición>
            └── Preinscripciones
                └── Documentación
                    └── apellidos-<apellido>__nombres-<nombre>__<submissionId>
                        ├── apellidos-perez__nombres-ana__documento-de-identidad__sub-123-1.jpg
                        ├── apellidos-perez__nombres-ana__documento-de-identidad__sub-123-2.jpg
                        ├── apellidos-perez__nombres-ana__cv__sub-123.pdf
                        └── apellidos-perez__nombres-ana__titulo__sub-123.pdf
```

---

## 3. Herramienta de Migración Retroactiva

Para actualizar planillas existentes creadas con el formato anterior, se dispone del comando `pnpm run migrate:spreadsheets`.

### 3.1 Modo Simulación (`--dry-run`)

Permite previsualizar la cantidad de planillas, filas totales, preinscripciones cruzadas con la base de datos y filas manuales preservadas sin modificar ninguna celda en Google Sheets:

```bash
pnpm run migrate:spreadsheets --dry-run
```

### 3.2 Migrar un Destino Específico

Permite migrar únicamente la planilla asociada a una oferta o seminario específico:

```bash
# Simular migración de un destino
pnpm run migrate:spreadsheets --dry-run --target=diplomado-salud-c2

# Ejecutar migración real de ese destino
pnpm run migrate:spreadsheets --target=diplomado-salud-c2
```

### 3.3 Migración Completa en Vivo

Ejecuta la actualización de todas las planillas registradas en `target_spreadsheets`:

```bash
pnpm run migrate:spreadsheets
```

### 3.4 Garantías de Seguridad y Preservación de Datos

1. **Cruce con PostgreSQL:** Las preinscripciones registradas en el sistema se enriquecen con sus enlaces a Drive, códigos de país y valores normalizados.
2. **Preservación de Filas Manuales:** Si el equipo administrativo agregó filas manualmente en Google Sheets que no provienen de la web, la herramienta preserva la fila adaptando los valores al nuevo orden de cabezales y transformando los campos fusionados sin borrar ningún dato.
3. **Escritura Atómica con Fórmulas:** Los nuevos valores se escriben con `valueInputOption: 'USER_ENTERED'`, garantizando que las fórmulas `=HYPERLINK` se interpreten como enlaces interactivos clicables.
