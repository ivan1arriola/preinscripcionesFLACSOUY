# Amazon SES: Guía de Configuración, Infraestructura y Operación de Notificaciones

Esta guía describe los requisitos de infraestructura en Amazon Web Services (AWS), la configuración de Amazon SES (Simple Email Service) v2, la seguridad de credenciales y la operación del sistema de notificaciones transaccionales de preinscripciones para FLACSO Uruguay.

---

## 1. Arquitectura de Notificaciones

El sistema envía notificaciones transaccionales automáticas al completarse una preinscripción:

1. **Postulante (`applicant`)**: Notificación privada enviada a la dirección del interesado.
   - Incluye los datos personales y académicos completados en el formulario con etiquetas legibles.
   - **Privacidad estricta**: *Nunca* incluye enlaces a planillas Google Sheets, carpetas Google Drive ni identificadores internos de base de datos.
2. **Oferta Académica o Seminario (`target`)**: Notificación operativa enviada a `notificationEmail` de la oferta (si está configurado en WordPress).
   - Incluye enlaces directos a la fila registrada en Sheets y a la carpeta de documentos en Drive.
3. **Destinatarios Maestros (`master`)**: Notificaciones operativas enviadas a cada correo configurado en la lista de administración.
   - Reciben el enlace a la fila de Sheets, enlace a la carpeta de Drive y copia de respaldo de los datos.

### Seguridad de Credenciales y Clave Maestra

- Las credenciales de AWS (`accessKeyId`, `secretAccessKey`, `sessionToken`) y la lista de correos maestros se almacenan en la tabla `system_settings` de PostgreSQL **cifradas en reposo** usando AES-256-GCM (`enc:v1:`).
- La clave maestra de cifrado (`APP_SETTINGS_ENCRYPTION_KEY`) es un secreto externo provisto mediante variable de entorno o Docker Secret. **Nunca se persiste en PostgreSQL ni se commitea en Git**.
- Las credenciales descifradas existen únicamente en memoria durante el envío y jamás se exponen en logs ni respuestas de la API administrativa (se enmascaran como `AK***LE` y `pr***s@flacso.edu.uy`).

---

## 2. Requisitos de Infraestructura en AWS SES

### 2.1 Elección de Región AWS
- Se recomienda utilizar `us-east-1` (N. Virginia) o `sa-east-1` (São Paulo).
- La región configurada en el panel administrativo debe coincidir exactamente con la región donde se verificó la identidad de envío en AWS.

### 2.2 Verificación de Identidad de Dominio
Para garantizar alta entregabilidad y evitar que los correos terminen en la carpeta de Spam:

1. En la consola de AWS SES -> **Identities** -> **Create identity**.
2. Seleccionar **Domain** e ingresar `flacso.edu.uy`.
3. Configurar **Easy DKIM**:
   - AWS generará 3 registros DNS de tipo `CNAME`.
   - Publicar estos 3 registros CNAME en la zona DNS institucional de `flacso.edu.uy`.
4. Configurar **SPF (Sender Policy Framework)**:
   - En el registro TXT del dominio `flacso.edu.uy`, incluir el mecanismo de SES:
     ```text
     v=spf1 include:amazonses.com ~all
     ```
   - Si ya existe un registro SPF institucional, agregar `include:amazonses.com` antes del modificador `~all` o `-all`.
5. Configurar **DMARC**:
   - Crear un registro TXT en `_dmarc.flacso.edu.uy`:
     ```text
     v=DMARC1; p=none; rua=mailto:dmarc-reports@flacso.edu.uy; pct=100
     ```

### 2.3 Modo Sandbox vs. Acceso a Producción

Por defecto, todas las cuentas nuevas de AWS SES comienzan en **Amazon SES Sandbox**:
- **Restricciones del Sandbox**:
  - Límite de envío: máximo 200 mensajes cada 24 horas y 1 mensaje por segundo.
  - **Restricción crítica de destinatarios**: Solo se puede enviar a direcciones de correo o dominios que hayan sido *previamente verificados* en la consola de SES. Un postulante externo no recibirá correo mientras la cuenta esté en sandbox.
- **Salida del Sandbox (Production Access)**:
  1. En la consola de AWS SES -> **Account dashboard** -> **Request production access**.
  2. Tipo de correo: **Transactional**.
  3. URL del sitio: URL pública de la plataforma de preinscripciones.
  4. Descripción de uso: Explicar que la plataforma envía confirmaciones transaccionales inmediatas a postulantes que completan voluntariamente el formulario de preinscripción de FLACSO Uruguay, así como avisos operativos internos a la coordinación académica. Indicar que el proceso no realiza envíos masivos ni promocionales.
  5. Plazo habitual de aprobación por parte de AWS Trust & Safety: 24 a 48 horas.

### 2.4 Política IAM de Mínimo Privilegio

Para el usuario de servicio o rol que interactúa con SES, crear una política IAM que limite estrictamente las acciones a envío de correos:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSendEmailFromFlacsoIdentity",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "arn:aws:ses:us-east-1:*:identity/flacso.edu.uy"
    }
  ]
]
```

### 2.5 Configuration Sets y Destinos de Eventos (Opcional recomendado)
- En AWS SES -> **Configuration sets**, crear un conjunto (ej. `flacso-notifications-config`).
- Permite registrar métricas de entrega, rebotes (*bounces*) y quejas (*complaints*) mediante Amazon CloudWatch o Amazon SNS.
- El nombre del configuration set puede ingresarse en el formulario del panel administrativo de preinscripciones.

---

## 3. Operación del Despachador de Notificaciones

### 3.1 Worker en Segundo Plano

El worker procesa de manera continua e incremental la bandeja de salida (`email_notifications`):

```bash
pnpm --filter api worker:notifications
```

- **Mecanismo de Concurrencia**: Utiliza `SELECT ... FOR UPDATE SKIP LOCKED` y un sistema de leases temporales (5 minutos). Múltiples instancias del worker pueden correr concurrentemente sin duplicar envíos.
- **Esquema de Reintentos Exponenciales**:
  - Reintento 1: tras 1 minuto.
  - Reintento 2: tras 5 minutos.
  - Reintento 3: tras 30 minutos.
  - Reintento 4: tras 2 horas.
  - Máximo de 4 intentos automáticos antes de quedar en estado permanente `failed`.

### 3.2 Estados de Notificación y Gestión Administrativa

El panel administrativo (`/admin` -> pestaña **Notificaciones SES**) permite monitorear y gestionar la cola:

| Estado | Significado | Acción Operativa |
| :--- | :--- | :--- |
| `pending` | Esperando ser despachado o en período de backoff tras fallo transitorio. | Automático. |
| `processing` | En proceso de envío por un worker con lease activo. | Automático. |
| `sent` | Entregado exitosamente a Amazon SES. Registra `providerMessageId` y `sentAt`. | Ninguna (envío completado). |
| `failed` | Error definitivo (ej. dirección inexistente o intentos agotados). | Permite reintento manual seguro desde el panel tras corregir o verificar la dirección de correo. |
| `unknown` | Timeout de red o caída de conexión sin confirmación de MessageId de SES. | **Seguridad**: No se reintenta automáticamente para evitar correos duplicados. Requiere confirmación manual explícita (`force: true`) tras verificar en CloudWatch / logs de SES. |

### 3.3 Envío de Correo de Prueba

Desde la pestaña de Notificaciones SES en el panel de administración, se puede ingresar una dirección de correo para disparar una prueba síncrona inmediata mediante `POST /api/admin/settings/email/test`. Esto verifica conectividad, credenciales y estado de autorización de SES sin necesidad de crear una preinscripción.
