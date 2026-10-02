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

## Perfiles de Formulario Versionados y Administración

A partir de la actualización arquitectónica, la estructura del formulario (pasos, campos, reglas de documentos obligatorios o diferibles) ya no se configura por cohorte en WordPress. En su lugar, se gestiona mediante **Perfiles de Formulario Versionados** en PostgreSQL:

- **Tipos de Oferta Soportados:** `maestria`, `especializacion`, `diplomado`, `diploma` (asistente de 5 pasos académicos) y `seminar` (asistente de 4 pasos sin documentación).
- **Inmutabilidad y Versionado:** Cada edición genera una versión inmutable (`version_number`). La activación de versiones es explícita y permite rollback inmediato seleccionando una versión anterior.
- **Seguridad en Envíos:** Cada preinscripción enviada persiste una instantánea (*snapshot*) del perfil activo y valida la revisión efectiva (`effectiveRevision`). Si la oferta en WordPress o el perfil en la base cambian mientras el usuario completa el formulario, la solicitud se rechaza con `409 Conflict (STALE_REVISION)`.

### Administración con Google OIDC

### Configuración de Credenciales de Google (Drive, Sheets y OIDC)

El sistema soporta auto-detección de secretos mediante archivos JSON en la carpeta `.secrets/`, lo que permite iniciar el sistema copiando los archivos sin tener que editar manualmente el archivo `.env`:

1. **Cuenta de Servicio (Google Drive y Google Sheets):**
   Copiar el archivo de la cuenta de servicio como:
   `.secrets/google-service-account.json`
   El sistema lo detecta automáticamente, genera los tokens necesarios y se conecta a la carpeta oficial de Drive (`1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e`).

2. **OAuth 2.0 Web Client (Login de Google para Panel Admin):**
   Copiar el archivo de cliente web descargado de Google Cloud Console como:
   `.secrets/google-oauth-web-client.json`
   El sistema extrae automáticamente el `client_id` y `client_secret`.

#### Anulación o Configuración Manual vía `.env` (Opcional)

Si se prefiere configurar mediante variables de entorno en lugar de archivos JSON:

```bash
# Google Drive
GOOGLE_DRIVE_FOLDER_ID=1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e
GOOGLE_ACCESS_TOKEN=tu_access_token_opcional

# Google OIDC (Autenticación administrativa)
GOOGLE_OIDC_CLIENT_ID=tu_cliente_id.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_SECRET=tu_secreto_de_cliente
GOOGLE_OIDC_REDIRECT_URI=http://localhost:5173/admin/perfiles
ADMIN_ALLOWED_EMAILS=web@flacso.edu.uy
```
