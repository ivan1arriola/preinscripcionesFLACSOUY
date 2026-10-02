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
| WordPress | Catálogo académico, tipo de oferta, fechas de apertura/cierre, orientaciones y menciones |
| Plataforma de Preinscripciones | Perfiles de formulario versionados por tipo de oferta, validación, asistente en pasos, envío y administración técnica |
| Google Sheets | Persistencia de preinscripciones y trabajo de las asistentes |
| Google Drive | Documentación y estructura de archivos |
| Servidor de Preinscripciones | Archivos temporales antes del envío, sesiones OIDC y snapshots de perfiles |

### 2.2. PostgreSQL como estado interno, perfiles versionados y auditoría

La plataforma utilizará **PostgreSQL** para su estado técnico y operativo interno.

PostgreSQL almacena:

- perfiles de formulario versionados e inmutables por tipo de oferta (`maestria`, `especializacion`, `diplomado`, `diploma`, `seminar`);
- usuarios administrativos autorizados con Google OIDC (`web@flacso.edu.uy`);
- eventos de auditoría administrativa (creación y activación de versiones);
- instantáneas (*snapshots*) canónicas de perfil asociadas a cada preinscripción enviada;
- caché de respuestas de WordPress;
- referencias técnicas a carpetas y Spreadsheets;
- sesiones de carga temporal y metadata de archivos temporales;
- errores y eventos del sistema.

PostgreSQL **no es la fuente de verdad del catálogo académico** (que reside en WordPress) ni sustituye a Google Sheets como espacio institucional de trabajo sobre las preinscripciones.

Las fuentes de verdad quedan separadas:

- **WordPress**: qué ofertas, cohortes, seminarios y ediciones existen, sus tipos y opciones de orientación/mención, y su estado de apertura.
- **Preinscripciones (PostgreSQL)**: estructura del formulario por tipo de oferta (pasos, campos, documentos, cartas), versionado inmutable y control administrativo Google.
- **Google Sheets**: datos finales de las preinscripciones.
- **Google Drive**: documentos definitivos.
- **PostgreSQL**: estado técnico y snapshots de auditoría.

Puede existir una copia técnica mínima de identificadores o estados de procesamiento, pero no debe transformarse en una segunda configuración académica independiente.

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
- lista ordenada de inputs específicos que utiliza el formulario;
- overrides permitidos por input, cuando correspondan;
- datos necesarios para construir el formulario.

Para seminarios:

- ID estable;
- nombre;
- slug;
- edición;
- estado de preinscripción;
- lista ordenada de inputs específicos que utiliza el formulario;
- overrides permitidos por input, cuando correspondan;
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

WordPress también define **qué inputs específicos solicita cada destino académico y en qué orden**, utilizando únicamente claves de inputs soportadas por la plataforma.

La plataforma no debe mantener listas duplicadas de ofertas, cohortes, seminarios, ediciones, orientaciones, menciones ni configuraciones de formulario por oferta.

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

## 6.1. Composición de formulario

La plataforma no conoce de antemano qué ofertas académicas o seminarios existen.

WordPress devuelve cada destino académico junto con la configuración de su formulario expresada como **claves de inputs soportadas por la aplicación**.

Ejemplo conceptual de una respuesta de WordPress:

```json
{
  "id": "davia-c11",
  "kind": "oferta",
  "name": "DAVIA",
  "registrationOpen": true,
  "form": {
    "inputs": [
      { "key": "documento", "position": 10 },
      { "key": "fechaNacimiento", "position": 20 },
      { "key": "orientacion", "position": 30, "required": true },
      { "key": "mencion", "position": 40 },
      { "key": "titulo", "position": 50 }
    ]
  }
}
```

La aplicación combina:

```text
inputs universales definidos en código
+
inputs específicos pedidos por WordPress
=
formulario final
```

La aplicación resuelve cada clave contra su catálogo de inputs y genera a partir de esa composición:

1. la interfaz;
2. la validación cliente;
3. la validación servidor;
4. las columnas esperadas de Sheets;
5. la normalización del envío;
6. el diagnóstico administrativo.

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

El administrador ingresará el ID o la URL de esa carpeta desde el panel administrativo. La aplicación guardará el identificador en `system_settings`, comprobará el nombre y los permisos de escritura con la cuenta de servicio, y utilizará esa carpeta como raíz de toda la estructura. La carpeta raíz no se configura mediante una variable de entorno.

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

La aplicación utilizará el identificador de la carpeta raíz configurado desde la interfaz de administración (guardado en PostgreSQL) y creará la jerarquía mostrada arriba bajo demanda. Si los niveles ya existen, los reutilizará.

Dentro de `Documentación`, los archivos se almacenarán utilizando un nombre semántico (ej: `apellidos-perez__nombres-ana__cv__8f312...pdf`) para permitir una identificación clara sin abrir el archivo, manteniendo el archivo original y los metadatos de trazabilidad en los `appProperties` de Google Drive.

*Nota:* Los archivos históricos almacenados directamente en la raíz antes de esta actualización no se migrarán ni renombrarán automáticamente.
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

Los binarios se guardarán en un volumen persistente de Docker, fuera del web root.

Ejemplo lógico:

```text
/app/storage/uploads/
└── <upload-session-id>/
    ├── <file-id-1>
    └── <file-id-2>
```

PostgreSQL mantendrá la metadata técnica de la sesión y de los archivos temporales.

No se recomienda almacenar los binarios en PostgreSQL ni en RAM.

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

Un worker de la aplicación consultará periódicamente PostgreSQL y eliminará las sesiones expiradas junto con sus archivos del volumen temporal.

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
    ├── database/
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
5. puede descubrir formularios y sus inputs específicos desde WordPress sin registrar ofertas localmente;
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
17. registra errores útiles para administración técnica;
18. detecta y bloquea formularios que solicitan inputs desconocidos;
19. puede incorporar una nueva oferta publicada en WordPress sin alta manual en PostgreSQL, siempre que use inputs soportados.

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


---

# 22. Catálogo de inputs y composición de formularios

## 22.1. Principio

Los inputs de la plataforma se definen **en código** como componentes semánticos reutilizables.

La aplicación no mantiene una lista propia de ofertas ni configura qué campos usa DAVIA, MG, un seminario u otra propuesta concreta.

Esa relación pertenece a WordPress.

La separación es:

```text
WORDPRESS
qué destinos académicos existen
qué inputs específicos solicita cada uno
en qué orden
qué opciones académicas son válidas
        │
        ▼
PREINSCRIPCIONES
qué significa cada input
cómo se renderiza
cómo se valida
cómo se guarda en Sheets
        │
        ▼
SHEETS + DRIVE
persistencia final
```

## 22.2. Diferencia entre tipo de control e input semántico

Los tipos de control son detalles técnicos:

```ts
type InputType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "select"
  | "textarea"
  | "checkbox"
  | "file";
```

WordPress no configura directamente esos tipos.

WordPress referencia inputs semánticos conocidos:

```text
nombre
apellido
email
telefono
documento
fechaNacimiento
orientacion
mencion
titulo
escolaridad
institucion
ocupacion
```

Cada input semántico conoce en código:

- clave estable;
- etiqueta;
- tipo visual;
- validación;
- nombre de columna de Sheets;
- normalización;
- comportamiento;
- proveedor de opciones cuando corresponde.

## 22.3. Registro central de inputs

Ejemplo conceptual:

```ts
export interface InputDefinition {
  key: string;
  label: string;
  type: InputType;
  requiredByDefault?: boolean;
  placeholder?: string;
  helpText?: string;

  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  };

  spreadsheetColumn: string;
  optionsSource?: OptionsSource;
}
```

Ejemplo de registro:

```ts
export const INPUTS = {
  nombre: {
    key: "nombre",
    label: "Nombre",
    type: "text",
    requiredByDefault: true,
    spreadsheetColumn: "Nombre",
  },

  apellido: {
    key: "apellido",
    label: "Apellido",
    type: "text",
    requiredByDefault: true,
    spreadsheetColumn: "Apellido",
  },

  email: {
    key: "email",
    label: "Correo electrónico",
    type: "email",
    requiredByDefault: true,
    spreadsheetColumn: "Correo electrónico",
  },

  telefono: {
    key: "telefono",
    label: "Teléfono",
    type: "tel",
    spreadsheetColumn: "Teléfono",
  },

  orientacion: {
    key: "orientacion",
    label: "Orientación",
    type: "select",
    spreadsheetColumn: "Orientación",
    optionsSource: "wordpress.orientaciones",
  },

  mencion: {
    key: "mencion",
    label: "Mención",
    type: "select",
    spreadsheetColumn: "Mención",
    optionsSource: "wordpress.menciones",
  },
} satisfies Record<string, InputDefinition>;
```

## 22.4. Inputs universales

Existe un grupo de inputs incluido automáticamente en todos los formularios.

Ejemplo conceptual:

```ts
export const UNIVERSAL_INPUTS = [
  "nombre",
  "apellido",
  "email",
  "telefono",
] as const;
```

La lista definitiva se fijará durante la implementación funcional.

WordPress no necesita repetir estos inputs para cada oferta.

## 22.5. Configuración específica: responsabilidad de WordPress

Cada oferta/cohorte o seminario/edición publicada por WordPress informa las claves de inputs específicos que requiere.

Ejemplo conceptual:

```json
{
  "id": "davia-c11",
  "form": {
    "inputs": [
      { "key": "documento", "position": 10 },
      { "key": "fechaNacimiento", "position": 20 },
      { "key": "orientacion", "position": 30, "required": true },
      { "key": "mencion", "position": 40 },
      { "key": "titulo", "position": 50 },
      { "key": "escolaridad", "position": 60 }
    ]
  }
}
```

La plataforma no guarda una tabla autoritativa del tipo:

```text
DAVIA → documento, orientación, mención...
MG    → ...
```

Puede cachear la respuesta de WordPress en PostgreSQL por rendimiento u observabilidad, pero el caché nunca es la configuración académica autoritativa.

## 22.6. Responsabilidades

### WordPress decide

- qué ofertas académicas existen;
- qué cohortes existen;
- qué seminarios y ediciones existen;
- cuáles están abiertas;
- qué orientaciones existen;
- qué menciones existen;
- qué inputs específicos usa cada formulario;
- en qué orden aparecen esos inputs;
- qué overrides permitidos aplica cada input.

### El código de Preinscripciones decide

- qué inputs están soportados;
- qué significa cada input;
- cómo se renderiza;
- cómo se valida;
- cómo se normaliza;
- qué columna de Sheets representa;
- qué tipo de dato produce;
- de dónde obtiene opciones dinámicas.

### PostgreSQL puede almacenar

- caché de la configuración recibida desde WordPress;
- timestamps de sincronización;
- referencias técnicas;
- diagnóstico de compatibilidad.

PostgreSQL no decide qué formulario pertenece a una oferta.

## 22.7. Overrides permitidos

WordPress puede solicitar overrides limitados que el contrato de la aplicación soporte explícitamente.

Ejemplo:

```json
{
  "key": "institucion",
  "required": true,
  "position": 30
}
```

Los overrides iniciales permitidos serán:

- orden/posición;
- obligatoriedad;
- habilitación, si fuera necesaria.

WordPress no podrá redefinir:

- el tipo visual;
- la clave técnica;
- la columna de Sheets;
- las reglas estructurales de validación;
- la semántica del input.

## 22.8. Fuentes dinámicas de opciones

Los inputs `select` pueden declarar proveedores de opciones.

```ts
type OptionsSource =
  | "static"
  | "wordpress.orientaciones"
  | "wordpress.menciones";
```

La definición del input vive en código; los valores académicos provienen de WordPress.

```text
orientacion
    ↓
WordPress → orientaciones válidas

mencion
    ↓
WordPress → menciones válidas para la oferta/orientación
```

La relación orientación/mención debe volver a validarse en servidor durante el envío.

## 22.9. Construcción del formulario

Conceptualmente:

```ts
async function buildForm(targetId: string) {
  const target = await academicCatalog.getTarget(targetId);

  const requested = target.form.inputs
    .sort((a, b) => a.position - b.position);

  const keys = [
    ...UNIVERSAL_INPUTS.map((key) => ({ key })),
    ...requested,
  ];

  return keys.map((field) => {
    const definition = INPUTS[field.key];

    if (!definition) {
      throw new UnsupportedInputError(field.key);
    }

    return {
      ...definition,
      ...allowedOverrides(field),
    };
  });
}
```

El formulario resultante alimenta:

```text
WordPress
   │
   ├── destino académico
   └── claves de inputs específicos
             │
             ▼
      catálogo INPUTS
             │
             ▼
      formulario final
             │
     ┌───────┼─────────┐
     ▼       ▼         ▼
     UI   validación  Sheets
                    + diagnóstico
```

## 22.10. Input desconocido

Si WordPress solicita una clave que la aplicación no soporta, la plataforma debe considerarlo un error de compatibilidad.

Ejemplo:

```text
MG · Cohorte 9

ERROR
WordPress solicita un input no soportado:
experiencia_profesional
```

La aplicación:

1. no intenta adivinar su significado;
2. no genera un input genérico;
3. marca el formulario como no operativo;
4. muestra el problema en el panel de diagnóstico;
5. registra el error.

Para habilitar ese campo debe agregarse primero una definición explícita al catálogo de inputs del código.

## 22.11. Descubrimiento automático

La aplicación no necesita una migración ni una configuración local cuando WordPress incorpora una nueva oferta, cohorte, seminario o edición.

Si WordPress publica un nuevo destino que utiliza únicamente inputs soportados:

```text
WordPress publica nuevo destino
        ↓
Preinscripciones lo descubre
        ↓
resuelve sus inputs
        ↓
diagnostica Sheets/Drive
        ↓
formulario disponible
```

No existe un alta manual equivalente en PostgreSQL.

## 22.12. Regla arquitectónica

> **WordPress decide qué formularios existen y qué información necesita cada uno. Preinscripciones decide cómo interpretar, mostrar, validar y almacenar cada tipo de información.**

Esta separación permite que WordPress sea realmente la fuente de verdad académica y mantiene a Preinscripciones desacoplada de ofertas concretas.

---

# 23. Implementación técnica acordada

La implementación se realizará como un **monolito modular en TypeScript**, desplegado mediante Docker.

Stack previsto:

- Next.js para presentación pública, panel administrativo y endpoints de aplicación;
- TypeScript;
- PostgreSQL para estado técnico interno;
- Prisma como acceso a PostgreSQL;
- Docker Compose;
- un contenedor de aplicación;
- un contenedor worker basado en la misma imagen;
- un contenedor PostgreSQL;
- volumen persistente para PostgreSQL;
- volumen persistente para archivos temporales;
- API REST del plugin de WordPress;
- Google Sheets API;
- Google Drive API.

Esquema conceptual:

```text
                 Apache
                    │
                    ▼
          ┌─────────────────┐
          │ app             │
          │ Next.js         │
          └────────┬────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│ PostgreSQL      │  │ worker          │
│ estado interno  │  │ limpieza/jobs   │
└─────────────────┘  └─────────────────┘
          │
          └──────────────┐
                         ▼
                  volumen uploads

Integraciones externas:
WordPress · Google Sheets · Google Drive
```

La arquitectura en capas debe mantenerse dentro del monolito; utilizar una sola aplicación desplegable no autoriza a que los componentes de presentación accedan directamente a Prisma, WordPress o Google APIs.


---

# 24. Integración requerida con el plugin FLACSO

La nueva plataforma requiere actualizar el plugin de FLACSO para que WordPress pueda configurar y exponer el formulario asociado a cada destino académico.

La configuración efectiva del formulario pertenece a:

```text
Oferta académica → Cohorte → Configuración de preinscripción
Seminario        → Edición  → Configuración de preinscripción
```

Para la primera versión, Cohorte y Edición almacenan la configuración efectiva directamente. La herencia desde Oferta/Seminario queda como una posible evolución posterior.

El plugin deberá:

- mantener un catálogo administrativo de claves de input permitidas;
- permitir seleccionar campos específicos;
- permitir ordenarlos;
- permitir definir obligatoriedad dentro de los overrides soportados;
- impedir claves duplicadas o desconocidas;
- exponer orientación y mención estructuradamente;
- preservar la relación orientación → menciones cuando corresponda;
- exponer un contrato REST estable para la aplicación;
- incluir URLs públicas y de edición cuando sea posible.

WordPress conoce las **claves** de los inputs para poder configurarlos, pero no su implementación técnica. La definición de tipo, validación, normalización y columna de Sheets sigue perteneciendo al código de Preinscripciones.

El endpoint agregado recomendado es:

```http
GET /wp-json/flacso/v1/preinscripciones
```

La especificación detallada del cambio y del contrato REST está en:

- [Integración con el plugin FLACSO](./INTEGRACION_WORDPRESS.md)
