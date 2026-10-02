# Preinscripciones FLACSO Uruguay

Nueva plataforma de preinscripciones de FLACSO Uruguay.

La aplicación tendrá una arquitectura en capas y utilizará:

- **WordPress** como fuente de verdad del catálogo académico y del estado de las inscripciones.
- **Google Sheets** como persistencia de las preinscripciones y espacio de trabajo editable por las asistentes.
- **PostgreSQL** para estado técnico interno y caché.

PostgreSQL no será una fuente de verdad académica ni reemplazará a Google Sheets como persistencia institucional de las preinscripciones.

## Documentación

La especificación funcional y arquitectónica se encuentra en:

- [Arquitectura de la plataforma](docs/ARQUITECTURA.md)
- [Integración con el plugin FLACSO / WordPress](docs/INTEGRACION_WORDPRESS.md)
- [Documentación y Operación del MVP](docs/MVP.md)

## Ejecución Local y Docker

```bash
# Iniciar servicios con Docker Compose
docker compose up -d --build

# Ejecutar migraciones (si se corre fuera de Docker)
pnpm --filter api db:migrate

# Ejecutar pruebas unitarias y de integración
pnpm test

# Construir las aplicaciones
pnpm build
```

## Principios principales

1. El formulario y el Spreadsheet se construyen a partir de un mismo esquema lógico.
2. Las columnas del Spreadsheet se identifican por nombre, nunca por posición.
3. Las asistentes pueden reordenar columnas, agregar columnas y editar los datos.
4. WordPress define qué ofertas, cohortes, seminarios, ediciones, orientaciones y menciones existen.
5. WordPress determina si una preinscripción está abierta o cerrada y qué inputs específicos utiliza cada formulario.
6. La aplicación define en código qué inputs existen, cómo se validan, renderizan y guardan.
7. Google Sheets es la persistencia final de las preinscripciones.
8. Los formularios no mantienen borradores ni sesiones de datos personales.

## Catálogo real de WordPress

La API puede leer el catálogo REST v1 del plugin FLACSO mediante:

```bash
WORDPRESS_URL=https://flacso.edu.uy docker compose up -d --build api web
```

La aplicación consulta `GET /wp-json/flacso/v1/preinscripciones`, valida la respuesta y conserva una caché técnica de 60 segundos en PostgreSQL. Antes de aceptar un envío vuelve a consultar WordPress para revalidar el destino y su `configRevision`.

Si `WORDPRESS_URL` no está definida, el entorno local usa las fixtures incluidas para desarrollo. El endpoint del plugin debe estar publicado y devolver el contrato REST v1 antes de activar la variable.
