# Formularios canónicos de preinscripción

## Objetivo

Reemplazar los perfiles de formulario editables por una definición canónica
declarada en TypeScript. El equipo no editará campos, pasos, documentos ni
versiones desde la aplicación. Los cambios futuros de formulario serán cambios
de código revisados y publicados.

El objetivo es recuperar el modelo simple de la aplicación anterior: un
formulario estable, reglas explícitas y solo una diferencia funcional por tipo
de propuesta: las maestrías solicitan dos cartas de recomendación.

## Alcance

- Hay un único formulario base para `maestria`, `especializacion`,
  `diplomado`, `diploma` y `seminar`.
- Todos los tipos usan los mismos pasos, campos personales, de contacto,
  trayectoria, documentación y declaraciones.
- La maestría agrega dos campos de documentación: primera y segunda carta de
  recomendación. Ambos pueden enviarse después.
- Las orientaciones y menciones no son configuración de formulario. Se muestran
  únicamente cuando WordPress las entrega para la propuesta; la ausencia de
  opciones omite la pregunta.
- Los convenios se consultan desde WordPress y el selector aparece solo cuando
  la persona responde que sí le corresponde un convenio.
- El panel de Perfiles de formulario, el editor guiado, el editor JSON, el
  historial de versiones y sus endpoints dejan de estar disponibles.

No modifica el catálogo WordPress, el envío de solicitudes, los documentos ya
recibidos, Google Drive, Google Sheets ni la autenticación administrativa.

## Formulario canónico

El formulario tendrá cinco pasos para todos los tipos:

1. Datos personales y demográficos.
2. Residencia y contacto.
3. Trayectoria académica.
4. Documentación requerida.
5. Convenios y declaraciones.

Los campos fijos serán los ya usados por la aplicación: nombres, apellidos,
fecha de nacimiento, documento, identidad de género, raza/etnia, países de
nacimiento y residencia, domicilio, celular, correo, ocupación, estudios,
posgrado FLACSO, título, escolaridad, institución, orientación, mención,
convenio, fuente y autorización de difusión.

Los documentos base serán documento de identidad, CV, título y carta de
motivación. Identidad, CV y título son obligatorios; la carta de motivación
puede declararse para envío posterior. Las maestrías suman dos cartas de
recomendación, ambas diferibles. No habrá diferencias de documentos entre los
otros tipos.

Las respuestas Sí/No se presentan como radios. Las reglas condicionales se
validan tanto en navegador como en API: convenio exige una selección cuando la
respuesta es Sí; el nombre del posgrado exige detalle cuando se respondió Sí;
orientación y mención solo aceptan valores presentes en WordPress.

## Arquitectura

`canonical-forms.ts` será la única fuente de verdad para pasos, campos,
documentos y validaciones por tipo. Expondrá una función pura que recibe el
tipo de propuesta y sus opciones de WordPress, y devuelve la definición
efectiva que consume el asistente público.

La API dejará de consultar `FormProfileRepository` para componer y validar una
solicitud. El contrato público conservará una identificación de esquema fija,
`canonical-v1`, para que el frontend y los registros de envío tengan una
referencia estable sin introducir perfiles editables.

El frontend seguirá renderizando la definición recibida por la API. No tendrá
lógica propia sobre qué documentos corresponden a una maestría; esa decisión
permanece en la definición canónica compartida por API y pruebas.

## Persistencia y compatibilidad

Las solicitudes existentes se preservan sin modificación, incluidas sus
instantáneas y referencias históricas a versiones de perfil. Las nuevas
solicitudes guardarán el identificador `canonical-v1` y una instantánea de la
definición efectiva usada al enviar.

Las tablas `form_profiles`, `form_profile_versions` y
`form_profile_audit_events` no se borrarán en esta entrega. Se dejarán sin
consumidores operativos para permitir reversión y auditoría de datos previos.
Una migración posterior, explícita y respaldada, decidirá su archivado o
eliminación.

Las rutas administrativas de perfiles responderán que la edición de formularios
ya no está disponible. La autenticación administrativa y las secciones no
relacionadas con perfiles permanecen intactas.

## Errores y revalidación

Antes de aceptar un envío, la API volverá a leer la propuesta desde WordPress y
rechazará el envío si cambió `configRevision`, se cerró la inscripción o las
opciones de orientación/mención ya no admiten el valor enviado. Las reglas del
formulario canónico no cambian en tiempo de ejecución, por lo que no existe una
segunda revisión de perfil.

Los mensajes de validación usarán las etiquetas públicas del formulario. Un
fallo de WordPress al obtener convenios impedirá seleccionar un convenio, pero
no permitirá enviar una respuesta afirmativa sin una opción válida.

## Migración

1. Introducir la definición canónica y sus pruebas unitarias.
2. Cambiar la composición, validación y cálculo de encabezados para usarla.
3. Mantener de forma transitoria el contrato de formulario consumido por el
   frontend, usando `canonical-v1` en lugar de una versión editable.
4. Retirar la interfaz y endpoints de perfiles; dejar los datos históricos en
   PostgreSQL sin uso operativo.
5. Verificar todos los tipos de propuesta y una solicitud ya existente antes de
   publicar.

No se ejecutará una migración destructiva ni se reescribirá una preinscripción
histórica.

## Pruebas de aceptación

- Cada tipo muestra el mismo formulario base y los mismos documentos base.
- Solo las maestrías muestran dos cartas de recomendación.
- Las opciones de orientación y mención dependen exclusivamente del catálogo
  WordPress, no de un perfil editable.
- Convenio y posgrado aplican sus reglas condicionales con radios Sí/No.
- Una nueva solicitud guarda `canonical-v1`; una histórica conserva su
  referencia previa.
- Las rutas y la pantalla de edición de perfiles no permiten cambios.
- No se modifica ninguna fila histórica ni se eliminan tablas durante el
  despliegue.
