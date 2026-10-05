# Notificaciones por SMTP administradas desde Preinscripciones

## Objetivo

Reemplazar el envío mediante la API de Amazon SES por SMTP de Amazon SES. El
equipo administrará la configuración completa desde la aplicación, sin agregar
variables de entorno para el correo y sin reiniciar los contenedores cuando
cambie una credencial.

La aplicación conservará la outbox, los reintentos y el historial de envíos. El
cambio afecta al proveedor de transporte y a la pantalla administrativa; no
cambia cuándo se generan las notificaciones ni sus destinatarios.

## Decisiones

- SMTP será el único transporte de correo activo.
- La aplicación retirará el SDK de AWS y no usará credenciales de la API de SES.
- Amazon SES seguirá siendo el proveedor, mediante su interfaz SMTP.
- La configuración se guardará en `system_settings` con cifrado AES-256-GCM.
- Se reutilizará `APP_SETTINGS_ENCRYPTION_KEY`, que ya protege la configuración
  sensible. No se agregará otra variable de entorno.
- La contraseña SMTP nunca volverá al navegador. La API informará solamente si
  está configurada.
- Los valores AWS API existentes quedarán cifrados e inactivos como datos
  históricos. La migración no los borrará.
- La activación y las pruebas reales en producción requerirán una acción
  administrativa posterior. El despliegue de código no enviará mensajes.

## Configuración persistente

La tabla genérica `system_settings` seguirá siendo la fuente de verdad. La
migración `014_smtp_email_settings` insertará sólo valores no secretos cuando
la clave correspondiente no exista.

| Clave | Contenido | Valor inicial |
| --- | --- | --- |
| `email_provider` | Transporte activo | `smtp` |
| `smtp_host` | Servidor SMTP | `email-smtp.us-east-1.amazonaws.com` |
| `smtp_port` | Puerto | `587` |
| `smtp_security` | `starttls` o `tls` | `starttls` |
| `smtp_username` | Usuario SMTP | vacío |
| `smtp_password` | Contraseña SMTP | vacío |
| `email_from` | Remitente | vacío |
| `email_reply_to` | Dirección de respuesta | vacío |

Se conservan estas claves actuales:

- `email_notifications_enabled`;
- `notification_master_emails`.

La API escribirá todos los cambios administrativos mediante
`EncryptedSettingsService`. La migración podrá sembrar en texto plano los
valores iniciales no secretos porque el servicio admite leer ese formato; el
primer guardado administrativo los reescribirá cifrados. Usuario, contraseña,
remitente, Reply-To y destinatarios se cifrarán desde su primera escritura.

La migración será aditiva e idempotente. No modificará el indicador de
activación ni copiará credenciales AWS API a campos SMTP porque una Access Key
no es un usuario SMTP válido y una Secret Access Key no es una contraseña SMTP.
El `down` conservará las filas para no borrar credenciales introducidas después
del despliegue.

## Contrato de dominio

`email-config.ts` expondrá un contrato independiente del proveedor:

```ts
type SmtpSecurity = 'starttls' | 'tls';

interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromEmail: string;
  replyToEmail?: string;
}

interface ResolvedEmailConfig {
  enabled: boolean;
  provider: 'smtp' | 'fake' | 'disabled';
  masterEmails: string[];
  smtp?: SmtpConfig;
}
```

La configuración SMTP se considera completa cuando contiene host, puerto,
seguridad, usuario, contraseña y remitente válidos. `replyToEmail` sigue siendo
opcional. La API rechazará la activación si falta un campo obligatorio.

El modo falso seguirá disponible mediante inyección de dependencias en pruebas.
La configuración operativa de producción no dependerá de `EMAIL_PROVIDER`.
El proveedor falso implementará `verify()` como una operación sin efectos.

## Proveedor SMTP

Un nuevo `SmtpEmailProvider` implementará el puerto `EmailProvider`. Usará
`nodemailer` para crear un transporte en tiempo de ejecución con la
configuración recuperada de PostgreSQL:

- `starttls`: conexión en texto seguida de STARTTLS, normalmente por el puerto
  587;
- `tls`: conexión TLS directa, normalmente por el puerto 465.

El proveedor ofrecerá dos operaciones:

```ts
interface EmailProvider {
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
```

`verify()` abrirá la conexión, negociará la seguridad y autenticará al usuario
sin enviar un mensaje. `send()` enviará las versiones de texto y HTML, junto
con remitente y Reply-To.

La aplicación reemplazará `SesEmailProviderError` por
`EmailProviderError`. El error indicará uno de estos resultados:

- `retryable`: rechazo SMTP 4xx o fallo previo a `DATA` que permite reintento;
- `permanent`: destinatario, configuración o autenticación inválida, incluido
  un rechazo SMTP 5xx;
- `unknown`: corte o timeout durante o después de `DATA`, cuando el servidor
  podría haber aceptado el mensaje.

El dispatcher conservará la política actual: backoff para `retryable`, fallo
definitivo para `permanent` y revisión manual para `unknown`.

## API administrativa

### Lectura

`GET /api/admin/settings/email` devolverá:

```ts
interface AdminEmailSettings {
  enabled: boolean;
  configured: boolean;
  provider: 'smtp';
  smtp: {
    host: string;
    port: number;
    security: 'starttls' | 'tls';
    username: string;
    hasPassword: boolean;
    fromEmail: string;
    replyToEmail: string | null;
  };
  masterEmails: string[];
  status: {
    lastConnectionTestAt: string | null;
    lastConnectionTestOk: boolean | null;
    lastConnectionTestError: string | null;
    lastSentAt: string | null;
  };
  updatedAt: string | null;
  updatedBy: string | null;
}
```

La respuesta no incluirá contraseña, ciphertext, claves AWS API ni tokens de
sesión. El usuario SMTP se mostrará porque el equipo lo necesita para operar y
cambiar la configuración.

### Escritura

`PUT /api/admin/settings/email` aceptará los campos SMTP, activación y
destinatarios maestros. Una contraseña vacía conservará la existente. El
cliente enviará `replacePassword: true` junto con una contraseña no vacía para
reemplazarla. La API validará:

- host sin protocolo ni ruta;
- puerto entero entre 1 y 65535;
- seguridad `starttls` o `tls`;
- usuario no vacío;
- remitente, Reply-To y destinatarios con formato de correo válido;
- configuración completa antes de activar las notificaciones.

La ruta seguirá exigiendo sesión administrativa y CSRF.

### Prueba de conexión

`POST /api/admin/settings/email/verify` cargará la configuración persistida y
ejecutará `verify()`. No aceptará credenciales en el body y no enviará correo.
Guardará fecha, resultado y un error saneado en claves de estado. La respuesta
no incluirá detalles del secreto ni el mensaje original del servidor cuando
pueda contener datos sensibles.

### Correo de prueba

`POST /api/admin/settings/email/test` conservará el contrato actual de
destinatario, pero enviará mediante SMTP. La respuesta incluirá el identificador
devuelto por el servidor. La acción de la interfaz seguirá separada de la
prueba de conexión.

## Interfaz administrativa

La pestaña se llamará “Notificaciones por correo”. La pantalla conservará la
outbox, sus contadores, filtros, reintentos y despacho manual.

La sección “Configuración” mostrará:

- habilitación de notificaciones automáticas;
- proveedor fijo “Amazon SES (SMTP)”;
- servidor, puerto y seguridad;
- usuario SMTP;
- estado de la contraseña y botón “Cambiar contraseña”;
- remitente y Reply-To;
- destinatarios maestros;
- botón “Guardar cambios”.

La contraseña aparecerá como “Configurada” o “Sin configurar”. Al pulsar
“Cambiar contraseña”, la interfaz mostrará un input vacío. Cancelar cerrará el
input y descartará el valor local. El navegador no recibirá ni reconstruirá la
contraseña guardada.

La sección “Estado” mostrará:

- configuración completa o incompleta;
- última prueba de autenticación y su fecha;
- último envío confirmado por la outbox;
- notificaciones habilitadas o deshabilitadas;
- botón “Probar conexión”.

La sección “Enviar correo de prueba” conservará el campo de destinatario y su
botón. La interfaz explicará que esta acción realiza un envío real.

Desaparecerán la región, Configuration Set, AWS Access Key ID, AWS Secret
Access Key y AWS Session Token. También se reemplazarán las referencias
visibles a “Notificaciones SES” por “Notificaciones por correo”.

## Outbox y generación de mensajes

`email_notifications` y sus índices no cambian. La creación de notificaciones,
las plantillas, las audiencias, la deduplicación, el leasing, los intentos y los
estados siguen vigentes.

El dispatcher resolverá la configuración en cada lote. Esto permite aplicar un
cambio guardado desde Administración sin reiniciar la API. Si las
notificaciones están deshabilitadas o la configuración está incompleta, el
dispatcher no reclamará filas pendientes. Las filas permanecerán en la outbox.

## Dependencias y retiro de SES API

El cambio agregará `nodemailer` y sus tipos, y retirará
`@aws-sdk/client-sesv2`. `ses-client.ts` y sus pruebas serán reemplazados por
`smtp-client.ts` y pruebas equivalentes.

Una búsqueda residual deberá confirmar que no quedan consumidores activos de:

- `SesEmailProvider` y `SesEmailProviderError`;
- `SETTING_SES_AWS_*`;
- región y Configuration Set en contratos administrativos;
- `@aws-sdk/client-sesv2`;
- textos que indiquen envío por la API de SES.

La documentación conservará una nota histórica de la migración, pero las guías
operativas describirán SMTP.

## Despliegue y transición

El despliegue ejecutará la migración idempotente y dejará valores SMTP no
secretos por defecto. No copiará ni activará credenciales.

Si el indicador antiguo estaba habilitado, la API no despachará correos hasta
que exista una configuración SMTP completa. Administración mostrará la
inconsistencia y exigirá guardar los campos antes de permitir la activación.
La outbox conservará los mensajes pendientes durante la transición.

La operación posterior al despliegue será:

1. ingresar usuario y contraseña SMTP en Administración;
2. guardar con notificaciones deshabilitadas;
3. ejecutar “Probar conexión”;
4. enviar un correo de prueba a una dirección controlada;
5. habilitar notificaciones;
6. comprobar un envío desde la outbox.

Los pasos 3 a 6 producen conexiones o envíos externos y requieren confirmación
operativa en producción.

## Pruebas

Las pruebas se escribirán antes de cada cambio de producción.

### Dominio y seguridad

- carga completa e incompleta de configuración SMTP;
- preservación de la contraseña cuando el formulario no la reemplaza;
- cifrado en PostgreSQL y ausencia del secreto en respuestas y logs;
- validación de host, puerto, seguridad y correos;
- migración idempotente que conserva claves históricas.

### Proveedor SMTP

- traducción correcta a opciones de `nodemailer` para STARTTLS y TLS directo;
- `verify()` sin envío;
- mensaje de texto y HTML, remitente y Reply-To;
- clasificación de errores 4xx, 5xx y entrega incierta;
- ausencia del cuerpo y las credenciales en errores saneados.

### API e interfaz

- sesión y CSRF en lectura y escritura;
- contrato sin secretos ni campos AWS;
- prueba de conexión separada del correo de prueba;
- pestaña y formulario SMTP;
- contraseña cerrada por defecto y reemplazo explícito;
- outbox, filtros y reintentos sin regresiones.

### Verificación completa

- `pnpm test`;
- `pnpm typecheck`;
- `pnpm build`;
- `pnpm e2e`;
- `docker compose --env-file .env.example config`;
- `git diff --check`;
- búsqueda residual de SDK, campos y proveedor SES API;
- revisión del panel en navegador en escritorio y móvil.

## Criterios de aceptación

1. Administración permite configurar SMTP sin editar archivos ni reiniciar la
   aplicación.
2. Ninguna respuesta, log o input repuebla la contraseña almacenada.
3. “Probar conexión” autentica sin enviar y “Enviar correo de prueba” realiza
   un envío real por una ruta independiente.
4. El worker usa la configuración SMTP guardada y conserva la semántica de la
   outbox.
5. El SDK y los contratos de SES API dejan de formar parte del runtime.
6. La migración conserva los valores históricos y no activa envíos.
7. Las pruebas específicas y la verificación completa pasan.
8. El commit final llega a `origin/main`; despliegue, configuración real,
   activación y envío de prueba se informan como pasos separados.
