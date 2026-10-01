# Preinscripciones FLACSO Uruguay

Nueva plataforma de preinscripciones de FLACSO Uruguay.

La aplicación tendrá una arquitectura en capas y utilizará:

- **WordPress** como fuente de verdad del catálogo académico y del estado de las inscripciones.
- **Google Sheets** como persistencia de las preinscripciones y espacio de trabajo editable por las asistentes.
- **Google Drive** para la documentación adjunta y la estructura de archivos.
- **Almacenamiento temporal local** únicamente para archivos cargados antes de enviar un formulario.

La plataforma no tendrá una base de datos de preinscripciones propia.

## Documentación

La especificación funcional y arquitectónica se encuentra en:

- [Arquitectura de la plataforma](docs/ARQUITECTURA.md)

## Principios principales

1. El formulario y el Spreadsheet se construyen a partir de un mismo esquema lógico.
2. Las columnas del Spreadsheet se identifican por nombre, nunca por posición.
3. Las asistentes pueden reordenar columnas, agregar columnas y editar los datos.
4. WordPress define qué ofertas, cohortes, seminarios, ediciones, orientaciones y menciones existen.
5. WordPress determina si una preinscripción está abierta o cerrada.
6. Google Sheets y Google Drive son la persistencia final.
7. Los formularios no mantienen borradores ni sesiones de datos personales.
8. Los archivos adjuntos se conservan temporalmente durante un máximo de 30 minutos sin actividad.
9. Existe un único usuario administrador para configuración, diagnóstico y revisión de errores.
