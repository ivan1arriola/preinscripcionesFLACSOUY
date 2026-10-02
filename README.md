# Preinscripciones FLACSO Uruguay

Nueva plataforma de preinscripciones de FLACSO Uruguay.

La aplicación tendrá una arquitectura en capas y utilizará:

- **WordPress** como fuente de verdad del catálogo académico y del estado de las inscripciones.
- **Google Sheets** como persistencia de las preinscripciones y espacio de trabajo editable por las asistentes.
- **Google Drive** para la documentación adjunta y la estructura de archivos.
- **PostgreSQL** para estado técnico interno, caché, errores y sesiones temporales.
- **Almacenamiento temporal en volumen Docker** únicamente para archivos cargados antes de enviar un formulario.

PostgreSQL no será una fuente de verdad académica ni reemplazará a Google Sheets como persistencia institucional de las preinscripciones.

## Documentación

La especificación funcional y arquitectónica se encuentra en:

- [Arquitectura de la plataforma](docs/ARQUITECTURA.md)
- [Integración con el plugin FLACSO / WordPress](docs/INTEGRACION_WORDPRESS.md)
- [Documentación y Operación del MVP](docs/MVP.md)
- [Manual de Operación y Observabilidad](docs/OPERACION.md)

## Ejecución Local y Docker

```bash
# Copiar plantilla de variables de entorno
cp .env.example .env

# Iniciar servicios con Docker Compose
docker compose up -d --build

# Ejecutar migraciones (si se corre fuera de Docker)
pnpm --filter api db:migrate

# Ejecutar pruebas unitarias y de integración
pnpm test

# Ejecutar pruebas de extremo a extremo (E2E) con Playwright
pnpm e2e

# Realizar respaldo de PostgreSQL
./scripts/backup-db.sh

# Limpiar archivos temporales expirados
./scripts/cleanup-uploads.sh
```

## Principios principales

1. El formulario y el Spreadsheet se construyen a partir de un mismo esquema lógico.
2. Las columnas del Spreadsheet se identifican por nombre, nunca por posición.
3. Las asistentes pueden reordenar columnas, agregar columnas y editar los datos.
4. WordPress define qué ofertas, cohortes, seminarios, ediciones, orientaciones y menciones existen.
5. WordPress determina si una preinscripción está abierta o cerrada y qué inputs específicos utiliza cada formulario.
6. La aplicación define en código qué inputs existen, cómo se validan, renderizan y guardan.
7. Google Sheets y Google Drive son la persistencia final de datos y documentos.
8. Los formularios no mantienen borradores ni sesiones de datos personales.
9. Los archivos adjuntos se conservan temporalmente durante un máximo de 30 minutos sin actividad.
10. Existe un único usuario administrador para configuración, diagnóstico y revisión de errores.
