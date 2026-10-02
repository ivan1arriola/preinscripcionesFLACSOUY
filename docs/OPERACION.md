# Manual de Operación y Observabilidad - FLACSO Uruguay

Este documento detalla la operación, seguridad, observabilidad, procedimientos de respaldo y mantenimiento del Sistema de Preinscripciones de FLACSO Uruguay.

---

## 1. Arquitectura y Componentes

El sistema se compone de tres capas desacopladas:
1. **Frontend Web (`apps/web`)**: SPA en React + TypeScript + Tailwind CSS servida tras Nginx. Permite la visualización de ofertas abiertas, renderizado dinámico de formularios a partir de contratos REST v1 y panel de administración y diagnóstico.
2. **Backend API (`apps/api`)**: Servidor Node.js + Express + TypeScript con arquitectura en capas (Domain, Ports, Application, Infrastructure, Presentation).
3. **PostgreSQL (3FN)**: Persistencia de estado técnico, registro de envíos, transacciones con Google Sheets, sesiones temporales de subida y trazabilidad de errores del sistema.
4. **WordPress (Fuente de Verdad Académica)**: Expone `GET /wp-json/flacso/v1/preinscripciones` con el catálogo activo, configuración de campos por cohorte y `configRevision`.
5. **Google Sheets (Destino de Datos)**: Las filas de preinscripción se agregan por coincidencia estricta de nombres de columnas de cabecera, preservando columnas manuales agregadas por el equipo de coordinación.
6. **Google Drive (Destino de Documentos)**: Almacena los archivos subidos organizados por cohorte y subcarpeta "Documentación".

---

## 2. Variables de Entorno

Copie `.env.example` a `.env` en el servidor:

| Variable | Tipo | Descripción | Ejemplo |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | string | Entorno de ejecución (`production` / `development`) | `production` |
| `PORT` | number | Puerto HTTP en el que escucha la API | `3000` |
| `DATABASE_URL` | string | URI de conexión a PostgreSQL | `postgres://flacso:pass@postgres:5432/flacso_preinscripciones` |
| `POSTGRES_PORT` | number | Puerto del host para PostgreSQL | `5433` (evita conflicto con 5432) |
| `WORDPRESS_URL` | string | URL base de la instalación WordPress | `https://flacso.edu.uy` |
| `WORDPRESS_CACHE_TTL_SECONDS` | number | Duración en segundos de la caché en PostgreSQL | `300` (5 minutos) |
| `ADMIN_USERNAME` | string | Usuario del administrador único | `admin` |
| `ADMIN_PASSWORD` | string | Contraseña segura del administrador | Generada con alta entropía |
| `ADMIN_SESSION_SECRET` | string | Clave secreta (mínimo 32 caracteres) para firma HMAC | `f1ac50_s3cur3_k3y_...` |
| `UPLOADS_DIR` | string | Directorio fuera de DocumentRoot para archivos temporales | `/data/uploads` |
| `MAX_FILE_SIZE_BYTES` | number | Límite por archivo en bytes (default: 10MB) | `10485760` |
| `CORS_ALLOWED_ORIGINS` | string | Orígenes permitidos separados por coma | `https://flacso.edu.uy` |
| `GOOGLE_CLIENT_EMAIL` | string | Email de la cuenta de servicio de Google Cloud | `sa@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | string | Clave privada RSA de la cuenta de servicio | `"-----BEGIN PRIVATE KEY-----\n..."` |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`| string | ID de la carpeta raíz institucional en Google Drive | `1abcXYZ...` |

---

## 3. Seguridad y Protección

- **Headers Seguros**: La API emite automáticamente encabezados `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy`.
- **Límites de Payload**: `express.json({ limit: '2mb' })` previene ataques de denegación de servicio por memoria.
- **Rate Limiting**: Limitador de tasa en memoria por IP que restringe tráfico abusivo y emite encabezados estándar `X-RateLimit-*` y respuesta `429 Too Many Requests` con tiempo de reintento.
- **Autenticación con HMAC y Anti-CSRF**: La sesión de administración utiliza tokens seguros firmados con HMAC-SHA256, expiración estricta y verificación de tokens anti-CSRF en solicitudes mutantes (`POST`, `PUT`, `DELETE`).
- **Almacenamiento Temporal Seguro**: Los archivos adjuntos subidos se almacenan en `/data/uploads` fuera del DocumentRoot con nombres aleatorios y UUIDs, y expiran automáticamente tras 30 minutos sin actividad.

---

## 4. Observabilidad y Monitoreo

### Correlation ID y Logs Estructurados
Cada petición HTTP entrante recibe o propaga un identificador único mediante el encabezado `X-Correlation-ID`.
Los logs se emiten en formato JSON estructurado conteniendo:
```json
{
  "timestamp": "2026-10-02T02:12:00.000Z",
  "level": "info",
  "message": "POST /api/targets/davia-c11/submissions 201 in 45.2ms",
  "correlationId": "req_mf12_a8b9",
  "context": {
    "method": "POST",
    "url": "/api/targets/davia-c11/submissions",
    "statusCode": 201,
    "durationMs": 45.2
  }
}
```

### Redacción Automática de Secretos y PII
El sistema redacta recursivamente en memoria cualquier clave sensible antes de emitir logs o registrar errores técnicos (`password`, `token`, `secret`, `authorization`, `cookie`, `apiKey`, `email`, `cedula`, `ci`, `telefono`).

### Endpoints de Chequeo
- **Liveness (`GET /api/health`)**: Verifica que el proceso esté vivo y el estado de la base de datos (`200 OK` o `503 Service Unavailable`).
- **Readiness (`GET /api/ready`)**: Verifica conectividad con PostgreSQL y capacidad de escritura en el directorio de subidas temporales (`/data/uploads`).
- **Integraciones (`GET /api/admin/health/integrations`)**: Estado consolidado de WordPress REST, PostgreSQL, Google Sheets y Google Drive.

---

## 5. Procedimientos de Respaldo y Restauración

### Generar Respaldo
Ejecute el script automatizado:
```bash
./scripts/backup-db.sh
```
El script detectará el contenedor Docker `preinscripciones-postgres` (o la instancia local en el puerto 5433) y generará un dump comprimido en `backups/flacso_preinscriptions_YYYYMMDD_HHMMSS.sql.gz`.

### Restaurar Respaldo
Para restaurar una copia previa en caso de incidente:
```bash
./scripts/restore-db.sh backups/flacso_preinscriptions_20261002_021455.sql.gz
```
El script solicitará confirmación interactiva antes de aplicar el volcado sobre la base de datos técnica.

---

## 6. Limpieza de Archivos Temporales Expirados

El worker de limpieza (`apps/api/src/infrastructure/uploads/cleanup-worker.ts`) se encarga de eliminar sesiones y archivos cuya inactividad supere 30 minutos:
```bash
pnpm --filter api exec tsx src/infrastructure/uploads/cleanup-worker.ts
```
En entornos de producción puede ejecutarse periódicamente mediante un cron job o tarea programada cada 15 minutos:
```cron
*/15 * * * * cd /opt/flacso/preinscripciones && ./scripts/cleanup-uploads.sh >> /var/log/flacso_cleanup.log 2>&1
```
