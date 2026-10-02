# Perfiles de formulario y autenticación administrativa

## Objetivo

Centralizar en la aplicación de preinscripciones la definición de cada
formulario. WordPress seguirá siendo la fuente de verdad de las propuestas,
sus cohortes o ediciones y sus atributos académicos; no decidirá campos,
orden, documentación ni requisitos de una preinscripción.

La aplicación administrará perfiles versionados para los tipos de oferta y un
único acceso administrativo mediante Google para `web@flacso.edu.uy`.

## Alcance

- Tipos configurables: `maestria`, `especializacion`, `diplomado`, `diploma`
  y `seminar`.
- El tipo `doctorado` se considera incompatible hasta que exista un perfil
  explícito; no expone formulario ni permite enviar una solicitud.
- Cada perfil define pasos, campos, orden, obligatoriedad, documentos,
  posibilidad de entregar después y cantidad de cartas de recomendación.
- La cantidad habitual de cartas para una maestría será dos, pero es editable
  por versión de perfil.
- Orientación y mención son atributos académicos independientes de la oferta,
  no entidades de preinscripción ni opciones identificadas por ID.
- Los seminarios no tienen orientación ni mención.

No se borra metadato histórico de WordPress ni se cambia el dominio público
como parte de este trabajo.

## Fuentes de verdad

| Información | Responsable |
| --- | --- |
| Oferta, tipo, cohorte o edición, publicación, apertura, URLs | WordPress |
| Orientaciones y menciones disponibles para una oferta | WordPress |
| Campos, pasos, documentos y reglas del formulario | Aplicación |
| Perfil activo, versiones y auditoría de configuración | Aplicación |
| Archivos temporales, solicitud, Drive y planilla | Aplicación |

WordPress no define el orden de preguntas. Las listas de orientación y mención
se mantienen en la información académica de la oferta y se asume que no cambian
entre cohortes. Sus valores se envían y se registran como texto.

## Contrato WordPress v1

El plugin publicará para una cohorte de oferta académica:

```json
{
  "kind": "academic_offer",
  "offer": {
    "id": 123,
    "slug": "maestria-en-genero",
    "name": "Maestría en Género",
    "type": "maestria",
    "orientations": ["Derechos humanos", "Políticas públicas"],
    "mentions": ["Investigación", "Gestión"]
  },
  "cohort": { "number": 6, "name": "Cohorte VI" },
  "registrationOpen": true,
  "configRevision": "sha256:..."
}
```

Para una edición de seminario:

```json
{
  "kind": "seminar",
  "seminar": { "id": 456, "slug": "seminario-x", "name": "Seminario X", "type": "seminar" },
  "orientations": [],
  "mentions": [],
  "registrationOpen": true,
  "configRevision": "sha256:..."
}
```

Las propiedades `orientations` y `mentions` son listas de cadenas, sin `id`,
sin relación entre ambas y sin configuración por cohorte o edición. El
`configRevision` de WordPress cubre solo la información que WordPress aún
provee y que afecta al destino: tipo, atributos académicos, estado y enlaces.

El plugin dejará de consumir o emitir como contrato operativo
`preinscripcion_formulario`, `preinscripcion_documentos`,
`preinscripcion_orientaciones` y `preinscripcion_menciones`. Las metas legadas
permanecerán almacenadas, sin borrado automático, para proteger el historial y
la convivencia temporal con la plataforma anterior.

## Perfiles de formulario en la aplicación

Un perfil representa un tipo de propuesta y tiene versiones inmutables. Cada
edición en el panel crea una nueva versión; las nuevas preinscripciones usan la
versión activa y las solicitudes existentes continúan asociadas a la versión
con la que fueron iniciadas o enviadas.

La definición versionada contendrá:

- Pasos y sus títulos.
- Reglas de campos: clave, grupo, orden, etiqueta, obligatoriedad y condición.
- Reglas de documentos: clave, orden, obligatoriedad, entrega diferida y máximo
  de archivos.
- Cantidad de cartas de recomendación y su condición dentro del perfil.

Las preguntas de orientación y mención son reglas condicionales del perfil:

- `orientacion` se muestra solo cuando la lista de orientaciones de WordPress
  no está vacía.
- `mencion` se muestra solo cuando la lista de menciones de WordPress no está
  vacía.
- Las dos reglas se evalúan por separado.
- Los perfiles de seminario no pueden incluir esas reglas.

Los perfiles iniciales reflejarán la práctica vigente:

| Tipo | Documentación inicial |
| --- | --- |
| Maestría | Identidad, CV, título, carta de motivación y dos cartas de recomendación |
| Especialización | Identidad, CV, título y carta de motivación |
| Diplomado | Identidad, CV, título y carta de motivación |
| Diploma | Identidad, CV y título |
| Seminario | Según perfil de seminario, sin orientación ni mención |

La configuración puede cambiar posteriormente desde el panel; la matriz es un
punto de partida, no una restricción codificada.

## Persistencia y revisión

El modelo propone:

- `admin_users`: identidad única de Google, correo, estado y fechas de acceso.
- `form_profiles`: tipo, nombre y referencia a la versión activa.
- `form_profile_versions`: definición JSON validada, número de versión,
  creador y fecha. No se edita una versión existente.
- `form_profile_audit_events`: creación, activación, desactivación y edición,
  con actor y detalle seguro.
- Las solicitudes guardarán la identificación y una instantánea de la versión
  de perfil utilizada, además de los valores y la revisión de WordPress.

La API compondrá una revisión efectiva a partir de la revisión de WordPress y
de la versión activa del perfil. Al enviar revalidará ambas. Un cambio en la
oferta o en el perfil obliga a recargar el formulario antes de la confirmación;
así no se aceptan valores contra reglas que dejaron de ser vigentes.

Las planillas conservarán columnas estables para `orientacion` y `mencion` y
guardarán el texto seleccionado, no un identificador.

## Panel administrativo

El panel pertenece a la aplicación y no depende de un metabox de WordPress.
Permitirá ver perfiles, crear una nueva versión, revisar su estructura y
activar una versión previamente validada. No incluye gestión de usuarios.

Cada versión debe pasar validaciones antes de activarse:

- El tipo está reconocido y tiene pasos utilizables.
- Las claves de campo y documento son admitidas por la API.
- No hay campos ni documentos duplicados y los órdenes son válidos.
- Las condiciones de orientación/mención son independientes y no aparecen en
  perfiles de seminario.
- La cantidad de cartas es coherente con los documentos configurados.

## Autenticación administrativa

Solo puede administrar `web@flacso.edu.uy` mediante Inicio de sesión con
Google. La aplicación utilizará OpenID Connect con los alcances mínimos de
identidad (`openid`, `email`, `profile`) y verificará que el correo esté
verificado y coincida exactamente con el correo permitido.

No habrá contraseñas. La base de datos conserva la identidad de Google, el
correo, el estado de la cuenta y eventos de acceso; no almacena credenciales de
Google. Las sesiones administrativas serán seguras, con expiración, cierre de
sesión y protección CSRF en acciones mutables.

El cliente OAuth y su secreto viven en la configuración protegida del entorno.
Se registrarán retornos para `localhost` durante desarrollo y para
`https://preinscripciones.flacso.edu.uy` antes de producción.

## Experiencia pública

El formulario público adoptará el asistente de cuatro pasos para seminarios y
cinco para ofertas académicas: introducción, progreso, agrupación de campos,
documentación y confirmación. Conserva la subida temporal al seleccionar un
archivo y el traslado a Drive solo luego de enviar correctamente.

La interfaz muestra orientación y mención únicamente cuando el destino las
tiene. La composición siempre parte del perfil activo y de los atributos
devueltos por WordPress, no de la cohorte como fuente de configuración.

## Migración compatible

1. Añadir el contrato enriquecido del plugin y mantener los metadatos legados
   sin eliminarlos.
2. Incorporar modelos, migraciones y perfiles iniciales en la aplicación.
3. Cambiar el adaptador de WordPress y la composición del formulario para usar
   el tipo y atributos académicos.
4. Activar el panel Google para el único administrador.
5. Cambiar la interfaz pública al asistente por pasos.
6. Mantener los enlaces históricos y verificar que una solicitud siempre se
   compone contra la revisión efectiva actual.

No se ejecutan migraciones de producción ni se modifican registros existentes
automáticamente durante la publicación del código.

## Pruebas de aceptación

- El plugin entrega tipo y listas de texto, sin IDs ni orden de preguntas.
- La API compone cada tipo desde su perfil activo.
- Una oferta sin orientaciones o menciones no muestra la pregunta respectiva.
- Un seminario nunca expone orientación ni mención.
- Doctorado es incompatible hasta crear su perfil.
- Cambiar un perfil crea una versión nueva y no altera solicitudes previas.
- Cambio de WordPress o de perfil invalida el envío con revisión obsoleta.
- Solo `web@flacso.edu.uy` con identidad Google verificada puede acceder al
  panel; las acciones quedan auditadas.
- El flujo de archivos sigue siendo temporal antes del envío, Drive al enviar y
  eliminación temporal solo tras éxito.
