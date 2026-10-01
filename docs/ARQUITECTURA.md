# Arquitectura de la plataforma de Preinscripciones FLACSO Uruguay

## 1. Objetivo

La plataforma permitirá gestionar la recepción de preinscripciones de ofertas académicas y seminarios de FLACSO Uruguay manteniendo **Google Sheets y Google Drive como destino final de la información**.

La aplicación debe proporcionar una experiencia de formulario clara para las personas que se preinscriben, pero sin reemplazar el flujo de trabajo que el equipo académico realiza directamente sobre Google Sheets.

La plataforma actuará como una capa de presentación, validación, integración y escritura controlada sobre los servicios institucionales existentes.

---

## 2. Principios de diseño

### 2.1. Separación de responsabilidades

Cada sistema tendrá una responsabilidad explícita:

| Sistema | Responsabilidad |
|---|---|
| WordPress | Catálogo académico y configuración académica |
| Plataforma de Preinscripciones | Formularios, validación, envío, diagnóstico y administración técnica |
| Google Sheets | Persistencia de preinscripciones y trabajo de las asistentes |
| Google Drive | Documentación y estructura de archivos |
| Servidor de Preinscripciones | Archivos temporales antes del envío |

### 2.2. Sin base de datos de preinscripciones propia

La nueva plataforma no tendrá PostgreSQL, MySQL ni otra base de datos como fuente de verdad de las preinscripciones.

La persistencia final será:

- Google Sheets para datos estructurados.
- Google Drive para documentos.

Puede existir almacenamiento técnico de configuración, caché o logs si la implementación lo requiere, pero **no debe transformarse en una segunda fuente de verdad de los datos académicos o de las preinscripciones**.

### 2.3. Formularios sin memoria

La aplicación no mantendrá:

- borradores;
- formularios iniciados;
- pasos completados;
- datos personales antes del envío;
- sesiones persistentes de preinscripción.

Los datos escritos en el formulario existen únicamente en el navegador hasta el envío.

La única excepción son los archivos adjuntos, que se almacenan temporalmente en el servidor.

### 2.4. Headers como contrato

La posición de una columna en un Spreadsheet nunca forma parte del contrato.

La aplicación debe identificar cada dato por el **nombre estable de su columna**.

Se permite:

- mover columnas;
- ordenar columnas;
- agregar columnas manuales;
- editar las filas;
- agregar observaciones;
- utilizar filtros y colores.

No se debe depender de referencias del tipo "columna C" o "columna 7".

---

# 3. Arquitectura general

```text
┌───────────────────────────────────────────────┐
│              PRESENTACIÓN                    │
│                                               │
│  Formulario público        Panel admin        │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│               APLICACIÓN                     │
│                                               │
│ Obtener formulario                           │
│ Procesar preinscripción                      │
│ Resolver destino                             │
│ Diagnosticar formularios                     │
│ Gestionar configuración                      │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│                 DOMINIO                      │
│                                               │
│ Oferta · Cohorte · Seminario · Edición       │
│ Orientación · Mención                        │
│ Definición de formulario                     │
│ Preinscripción                               │
│ Reglas de validación                         │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│              PUERTOS / CONTRATOS             │
│                                               │
│ AcademicCatalog                              │
│ SpreadsheetRepository                       │
│ DriveRepository                             │
│ TemporaryFileStorage                        │
│ ErrorRepository / Logger                    │
└───────────────┬───────────────┬───────────────┘
                │               │
                ▼               ▼
┌──────────────────────┐  ┌─────────────────────┐
│ WordPress REST API   │  │ Google APIs         │
│                      │  │                     │
│ catálogo académico   │  │ Sheets              │
│ apertura/cierre      │  │ Drive               │
└──────────────────────┘  └─────────────────────┘
```

---

# 4. Capa de presentación

La presentación tendrá dos superficies independientes.

## 4.1. Formulario público

Responsabilidades:

- mostrar el formulario correspondiente;
- mostrar campos según el tipo de oferta;
- cargar orientaciones y menciones;
- permitir adjuntar documentos;
- realizar validaciones de UX;
- enviar la preinscripción completa;
- mostrar confirmación o error.

El frontend no debe acceder directamente a WordPress, Sheets o Drive.

Debe utilizar casos de uso expuestos por la capa de aplicación.

## 4.2. Panel administrativo

Existirá **un único usuario administrador**.

El panel no es una herramienta de administración académica.

Su objetivo es configurar y diagnosticar la plataforma.

El administrador podrá:

- configurar variables del sistema;
- ver los formularios detectados en WordPress;
- ver el estado abierto/cerrado;
- ver cohorte o edición asociada;
- ver menciones y orientaciones disponibles;
- diagnosticar la estructura de los Spreadsheets;
- ver enlaces operativos;
- consultar errores;
- probar integraciones;
- comprobar la salud general del sistema.

El administrador **no** deberá crear ni editar:

- ofertas académicas;
- seminarios;
- cohortes;
- ediciones;
- orientaciones;
- menciones;
- apertura o cierre de preinscripciones.

Todo eso se administra en WordPress.

---

# 5. WordPress como catálogo académico

WordPress será la fuente de verdad para determinar **qué se puede preinscribir**.

La plataforma consultará la API del plugin de FLACSO.

## 5.1. Información requerida

Para ofertas académicas:

- ID estable;
- nombre;
- slug;
- tipo de oferta;
- cohorte vigente;
- estado de preinscripción;
- orientaciones;
- menciones;
- relación entre orientación y mención;
- datos necesarios para construir el formulario.

Para seminarios:

- ID estable;
- nombre;
- slug;
- edición;
- estado de preinscripción;
- datos necesarios para construir el formulario.

## 5.2. Responsabilidades de WordPress

WordPress define:

```text
Oferta académica
├── Cohorte
│   ├── abierta/cerrada
│   ├── orientaciones
│   └── menciones
│
Seminario
└── Edición
    └── abierta/cerrada
```

La plataforma no debe mantener listas duplicadas de cohortes, orientaciones o menciones.

## 5.3. API específica

Se recomienda exponer endpoints específicos desde el plugin de FLACSO, por ejemplo:

```text
GET /wp-json/flacso/v1/preinscripciones/ofertas
GET /wp-json/flacso/v1/preinscripciones/ofertas/{id}
GET /wp-json/flacso/v1/preinscripciones/cohortes/{id}

GET /wp-json/flacso/v1/preinscripciones/seminarios
GET /wp-json/flacso/v1/preinscripciones/seminarios/{id}
GET /wp-json/flacso/v1/preinscripciones/ediciones/{id}
```

La plataforma no debería depender directamente de la estructura interna de Custom Post Types o metadatos de WordPress.

El adaptador de WordPress debe transformar las respuestas en entidades del dominio.

---

# 6. Formularios dinámicos

## 6.1. Definición de formulario

Cada tipo de oferta académica o seminario puede tener campos diferentes.

Debe existir un modelo explícito de definición de formulario.

Ejemplo conceptual:

```ts
interface FormDefinition {
  id: string;
  fields: FormField[];
  spreadsheetColumns: SpreadsheetColumn[];
}

interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "select" | "textarea" | "file";
  required: boolean;
  options?: FormOption[];
}
```

La definición debe ser la fuente común para:

1. construir el formulario;
2. validar el envío;
3. conocer las columnas requeridas;
4. escribir correctamente el Spreadsheet.

## 6.2. Orientación y mención

La nueva versión deberá incorporar explícitamente:

- orientación;
- mención.

Estos datos deben ser estructurados y no texto libre cuando WordPress defina opciones disponibles.

Ejemplo:

```text
Orientación
[ Educación ▼ ]

Mención
[ Tecnología educativa ▼ ]
```

Si las menciones dependen de una orientación, WordPress debe devolver esa relación y el formulario debe actualizar las opciones disponibles.

---

# 7. Google Sheets

## 7.1. Rol

Google Sheets es la fuente final de los datos estructurados de preinscripción.

Las asistentes podrán continuar trabajando directamente sobre las planillas.

## 7.2. Escritura por nombre de columna

La aplicación nunca escribirá según posición.

Ejemplo incorrecto:

```ts
row[2] = email;
```

Ejemplo correcto:

```ts
const columnIndex = headers.indexOf("Correo electrónico");
```

Antes de insertar una fila se leen los encabezados actuales y se construye la fila respetando su posición real.

Conceptualmente:

```ts
const row = headers.map((header) => valuesByColumnName[header] ?? "");
```

## 7.3. Cambios permitidos por las asistentes

Se permite:

- mover columnas;
- agregar columnas;
- editar valores;
- agregar observaciones;
- aplicar colores;
- filtros;
- ordenamientos.

Las columnas adicionales que la aplicación no conoce deben ser ignoradas.

## 7.4. Cambios incompatibles

Renombrar una columna requerida rompe el contrato.

Si una columna requerida no existe, la plataforma debe:

1. detectar el problema;
2. impedir una escritura incorrecta;
3. registrar el error;
4. mostrarlo en el diagnóstico del administrador.

No se debe inferir automáticamente que una columna con nombre parecido es equivalente.

## 7.5. Inserción

La aplicación debe insertar nuevas preinscripciones **al final de la tabla lógica**, sin reescribir ni normalizar las filas existentes.

La aplicación no debe:

- reordenar filas existentes;
- borrar columnas manuales;
- sobrescribir observaciones;
- reconstruir el Spreadsheet completo.

---

# 8. Google Drive

## 8.1. Configuración mínima

La aplicación solo necesitará conocer una **carpeta raíz del proyecto**.

Ejemplo de variable:

```text
GOOGLE_DRIVE_ROOT_FOLDER_ID
```

Toda la estructura inferior será creada y administrada por la aplicación.

## 8.2. Estructura propuesta

```text
Preinscripciones FLACSO/
│
├── Ofertas académicas/
│   ├── DAVIA/
│   │   ├── Cohorte 10/
│   │   │   ├── Preinscripciones
│   │   │   └── Documentación/
│   │   └── Cohorte 11/
│   │       ├── Preinscripciones
│   │       └── Documentación/
│   └── ...
│
└── Seminarios/
    ├── Seminario A/
    │   └── Edición 2027-01/
    │       ├── Preinscripciones
    │       └── Documentación/
    └── ...
```

La estructura exacta puede evolucionar durante la implementación, pero la aplicación debe poder construirla desde la carpeta raíz.

## 8.3. Identificadores

Los nombres visibles de carpetas no deben ser identificadores técnicos.

Se deben utilizar:

- IDs propios del dominio;
- IDs de Drive;
- IDs de Spreadsheet.

Cambiar el nombre visible de una carpeta no debe romper la aplicación.

---

# 9. Archivos temporales

## 9.1. Regla

Los archivos seleccionados por el usuario se cargarán temporalmente al servidor antes del envío final.

Los demás datos del formulario no se persisten en el servidor.

## 9.2. Almacenamiento

Los archivos deben guardarse en disco temporal fuera del web root.

Ejemplo:

```text
/var/tmp/preinscripciones/
└── <upload-session-id>/
    ├── manifest.json
    ├── <file-id-1>
    └── <file-id-2>
```

No se recomienda almacenar los binarios en RAM.

## 9.3. Sesión temporal

Al cargar el primer archivo se crea un identificador aleatorio:

```text
upload_session_id
```

El navegador mantiene únicamente ese identificador.

Debe ser criptográficamente aleatorio y no predecible.

## 9.4. Expiración

Una sesión temporal expira luego de **30 minutos sin actividad**.

Cada nueva carga válida puede actualizar la última actividad.

Un proceso periódico debe limpiar las sesiones expiradas.

Ejemplo conceptual:

```text
*/5 * * * * cleanup-expired-uploads
```

## 9.5. Envío exitoso

Cuando el formulario se envía correctamente:

1. se validan los datos;
2. se validan los archivos;
3. se crea/resuelve la estructura de Drive;
4. se suben los documentos;
5. se inserta la preinscripción en Sheets;
6. se eliminan los archivos locales;
7. se elimina la sesión temporal;
8. se devuelve confirmación.

Los temporales no deben eliminarse antes de confirmar que el flujo de persistencia terminó correctamente.

---

# 10. Flujo de lectura del formulario

```text
GET formulario
      │
      ▼
Consultar WordPress
      │
      ├── oferta / seminario
      ├── cohorte / edición
      ├── abierta/cerrada
      ├── orientaciones
      └── menciones
      │
      ▼
Construir definición
      │
      ▼
Renderizar formulario
```

Si la preinscripción está cerrada, no se debe presentar un formulario enviable.

---

# 11. Flujo de envío

El servidor debe volver a validar toda la información al recibir el envío.

No se debe confiar en el estado obtenido cuando el navegador cargó inicialmente la página.

```text
POST formulario
      │
      ▼
Consultar WordPress nuevamente
      │
      ├── ¿sigue abierta?
      ├── ¿cohorte/edición válida?
      ├── ¿orientación válida?
      └── ¿mención válida?
      │
      ▼
Validar campos
      │
      ▼
Validar archivos temporales
      │
      ▼
Resolver Drive + Spreadsheet
      │
      ▼
Validar headers
      │
      ▼
Subir archivos a Drive
      │
      ▼
Insertar fila en Sheets
      │
      ▼
Eliminar temporales
      │
      ▼
Confirmación
```

---

# 12. Panel administrativo

## 12.1. Usuario

Existirá un único usuario administrador.

La autenticación puede implementarse con el mecanismo más simple y seguro compatible con la infraestructura institucional.

## 12.2. Configuración

El admin podrá configurar variables operativas como:

- URL de WordPress;
- carpeta raíz de Drive;
- parámetros de integración;
- límites de archivos;
- correo técnico;
- opciones de comportamiento.

Los secretos deben almacenarse separadamente y nunca mostrarse completos en el panel.

## 12.3. Formularios detectados

El panel deberá leer WordPress y mostrar todos los formularios disponibles.

Ejemplo:

```text
DAVIA · Cohorte 11
Estado: Abierta
Diagnóstico: OK

MG · Cohorte 8
Estado: Abierta
Diagnóstico: ERROR
Falta columna: Mención

Seminario X · Edición 2027-01
Estado: Cerrada
Diagnóstico: OK
```

## 12.4. Enlaces

Cada formulario debe mostrar accesos rápidos a los recursos relacionados.

Como mínimo:

- formulario público;
- vista de la oferta/seminario en WordPress;
- edición en WordPress cuando corresponda;
- Spreadsheet;
- carpeta de Drive;
- carpeta de documentación cuando corresponda.

Ejemplo de tabla:

| Formulario | Estado | Diagnóstico | Formulario | WordPress | Sheet | Drive |
|---|---|---|---|---|---|---|
| DAVIA C11 | Abierta | OK | Abrir | Abrir | Abrir | Abrir |
| MG C8 | Abierta | Error | Abrir | Abrir | Abrir | Abrir |
| Seminario X | Cerrada | OK | Abrir | Abrir | Abrir | Abrir |

Los enlaces deben generarse a partir de IDs y datos reales, no mantenerse manualmente.

---

# 13. Diagnóstico

El panel debe incluir una pantalla de **Diagnóstico de formularios**.

Para cada formulario debe comprobar al menos:

- WordPress responde;
- la oferta/seminario existe;
- la cohorte/edición existe;
- estado abierto/cerrado;
- orientación y mención coherentes;
- carpeta Drive accesible;
- Spreadsheet localizado;
- hoja correcta localizada;
- columnas requeridas presentes;
- permisos suficientes para escribir;
- configuración válida.

Ejemplo:

```text
DAVIA · Cohorte 11

WordPress
✓ Oferta encontrada
✓ Cohorte encontrada
✓ Preinscripción abierta
✓ 3 orientaciones
✓ 6 menciones

Google Drive
✓ Carpeta localizada
✓ Permisos correctos

Google Sheets
✓ Spreadsheet localizado
✓ 18/18 columnas requeridas

Resultado
✓ Formulario operativo
```

---

# 14. Errores

Los errores técnicos relevantes deben quedar disponibles desde el panel.

Modelo conceptual:

```ts
interface SystemError {
  id: string;
  timestamp: Date;
  severity: "info" | "warning" | "error" | "critical";
  source: "wordpress" | "sheets" | "drive" | "uploads" | "application";
  code: string;
  message: string;
  context?: Record<string, unknown>;
  resolved: boolean;
}
```

El administrador debería poder:

- ver el error;
- ver fecha y origen;
- consultar contexto técnico seguro;
- marcarlo como resuelto;
- reintentar una operación cuando sea apropiado.

Nunca se deben mostrar secretos, tokens o datos sensibles innecesarios dentro del contexto del error.

---

# 15. Puertos principales

La capa de aplicación no debe depender directamente de SDKs concretos.

Ejemplos de contratos:

## 15.1. Catálogo académico

```ts
interface AcademicCatalog {
  getOffer(id: string): Promise<AcademicOffer | null>;
  getCohort(id: string): Promise<Cohort | null>;
  getSeminar(id: string): Promise<Seminar | null>;
  getEdition(id: string): Promise<Edition | null>;
  getFormDefinition(targetId: string): Promise<FormDefinition>;
  isRegistrationOpen(targetId: string): Promise<boolean>;
}
```

Implementación inicial:

```text
WordPressAcademicCatalog
```

## 15.2. Sheets

```ts
interface SpreadsheetRepository {
  getHeaders(spreadsheetId: string): Promise<string[]>;
  validateSchema(
    spreadsheetId: string,
    expectedColumns: string[]
  ): Promise<SchemaValidationResult>;
  append(
    spreadsheetId: string,
    valuesByColumnName: Record<string, unknown>
  ): Promise<void>;
}
```

## 15.3. Drive

```ts
interface DriveRepository {
  ensureStructure(target: RegistrationTarget): Promise<DriveStructure>;
  uploadDocument(
    folderId: string,
    file: TemporaryFile
  ): Promise<DriveFile>;
}
```

## 15.4. Temporales

```ts
interface TemporaryFileStorage {
  createSession(): Promise<string>;
  put(sessionId: string, file: UploadedFile): Promise<TemporaryFile>;
  list(sessionId: string): Promise<TemporaryFile[]>;
  deleteFile(sessionId: string, fileId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  cleanupExpired(maxAgeMinutes: number): Promise<number>;
}
```

---

# 16. Estructura de código sugerida

La estructura concreta dependerá del framework elegido, pero conceptualmente:

```text
src/
├── presentation/
│   ├── public/
│   └── admin/
│
├── application/
│   ├── forms/
│   ├── registrations/
│   ├── diagnostics/
│   └── configuration/
│
├── domain/
│   ├── academic/
│   ├── forms/
│   ├── registrations/
│   └── shared/
│
├── ports/
│   ├── academic-catalog/
│   ├── spreadsheets/
│   ├── drive/
│   ├── temporary-files/
│   └── errors/
│
└── infrastructure/
    ├── wordpress/
    ├── google-sheets/
    ├── google-drive/
    ├── temporary-files/
    ├── auth/
    └── logging/
```

---

# 17. Seguridad

Como mínimo:

- validar todos los datos en servidor;
- no confiar en datos ocultos enviados por el frontend;
- revalidar el estado abierto/cerrado al enviar;
- validar tipo MIME y extensión de archivos;
- definir tamaño máximo por archivo;
- definir tamaño máximo total por envío;
- utilizar nombres internos aleatorios;
- impedir path traversal;
- almacenar temporales fuera del web root;
- aplicar expiración automática;
- usar IDs de sesión no predecibles;
- no exponer credenciales de Google o WordPress;
- proteger el panel de administración;
- evitar datos personales innecesarios en logs;
- aplicar rate limiting cuando corresponda.

---

# 18. Comportamiento ante fallas

## 18.1. WordPress no disponible

No se debe aceptar una preinscripción si no se puede comprobar que está abierta y que sus opciones siguen siendo válidas.

## 18.2. Spreadsheet incompatible

No se debe insertar parcialmente una fila usando posiciones o aproximaciones.

Se registra el error y se informa al administrador.

## 18.3. Drive falla

No se confirma la preinscripción hasta resolver correctamente la persistencia requerida.

## 18.4. Sheets falla después de subir documentos

La operación debe tratarse como una transacción lógica.

La implementación debe intentar evitar documentos huérfanos y mantener suficiente información temporal para poder manejar el error durante el request.

## 18.5. Temporales expirados

Si los archivos ya expiraron, el frontend debe informar que es necesario volver a adjuntarlos.

---

# 19. Decisiones deliberadamente fuera de esta versión

No forman parte del núcleo de la nueva plataforma:

- cuentas para estudiantes;
- seguimiento de una preinscripción por parte del estudiante;
- recuperación de borradores;
- base de datos académica paralela;
- edición de ofertas desde Preinscripciones;
- edición de cohortes desde Preinscripciones;
- edición de seminarios o ediciones;
- apertura/cierre desde Preinscripciones;
- reemplazar el trabajo cotidiano de las asistentes sobre Sheets.

---

# 20. Criterios de aceptación generales

La primera versión debe considerarse funcional cuando:

1. puede leer ofertas y seminarios desde WordPress;
2. puede resolver cohorte o edición;
3. puede saber si una inscripción está abierta;
4. puede obtener orientaciones y menciones;
5. puede construir formularios diferentes según su definición;
6. puede cargar documentos temporalmente;
7. elimina temporales luego de 30 minutos sin actividad;
8. puede crear la estructura necesaria bajo una única carpeta raíz de Drive;
9. puede localizar un Spreadsheet existente;
10. puede insertar por nombre de columna independientemente del orden;
11. tolera columnas adicionales creadas por las asistentes;
12. detecta columnas requeridas faltantes;
13. mueve documentos definitivos a Drive al enviar;
14. elimina temporales después de un envío exitoso;
15. cuenta con un panel de administrador;
16. muestra formularios, estados, enlaces y diagnósticos;
17. registra errores útiles para administración técnica.

---

# 21. Regla arquitectónica central

La arquitectura debe preservar esta separación:

```text
WORDPRESS
Qué existe y qué se puede elegir
        │
        ▼
PREINSCRIPCIONES
Cómo se presenta, valida y captura
        │
        ▼
SHEETS + DRIVE
Dónde queda registrada la información
```

La aplicación puede evolucionar internamente sin romper ese contrato.
