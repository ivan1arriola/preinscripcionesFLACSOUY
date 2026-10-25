# Integración con Mautic

Preinscripciones usa Mautic para dos cosas, que se activan por separado desde
**Administración → Notificaciones**:

1. **Contactos**: cada preinscripción crea o actualiza al postulante como contacto.
2. **Correos**: Mautic puede ser el proveedor de envío de las notificaciones
   (postulante, oferta o seminario, y destinatarios maestros). SMTP sigue
   disponible como alternativa.

## Credenciales

Crear en Mautic un **API client OAuth2** exclusivo para preinscripciones
(Configuración → Credenciales de API), para poder revocarlo sin afectar a
WordPress. En la tarjeta **Mautic** del admin se cargan:

| Campo | Valor |
| --- | --- |
| URL de Mautic | `https://…` (sin barra final) |
| Clave Pública | Client ID del API client |
| Clave Secreta | Client Secret (se guarda cifrada y nunca se devuelve al navegador) |
| ID de plantilla para el postulante | ID del correo "Preinscripción — Postulante" |
| ID de plantilla para el equipo | ID del correo "Preinscripción — Equipo" |

"Probar conexión" obtiene un token y lista un contacto.

## Contactos

Se envía sólo **perfil estable**: `email`, `firstname`, `lastname`,
`flacso_origen = preinscripciones`, `flacso_pais` (país de residencia) y
`flacso_profesion` (ocupación). Los datos de cada preinscripción (documento,
fecha de nacimiento, estudios, archivos) no salen del sistema.

Tags (se agregan sin quitar los existentes):

| Tag | Cuándo |
| --- | --- |
| `preinscripcion-{codigo}` | siempre que haya código |
| `{codigo}-c{n}` | cohorte número `n` de una oferta |
| `{codigo}-e{n}` | edición número `n` de un seminario |
| `origen-preinscripciones` | siempre |

`{codigo}` es la **abreviación de la oferta** (o su slug si no tiene) y, en
seminarios, el nombre del seminario, con el mismo `slug` que usan las consultas
del plugin (`FLACSO_Inquiry_Tag_Factory`). Así una misma persona queda con tags
coherentes entre consultas y preinscripciones.

**No se inscribe a nadie en campañas.** El formulario no tiene consentimiento
comercial: `aceptaDifusion` es sobre difusión de imagen. El aviso de inscripción
(ver más abajo) sólo saca a la persona de campañas.

La sincronización usa el outbox `mautic_contact_sync`, escrito en la misma
transacción que la preinscripción. El worker de notificaciones lo procesa con
reintentos y backoff. Un rechazo de datos (4xx) o 20 intentos fallidos dejan la
fila en `failed` y generan una alerta de Telegram. Al sincronizar, el payload se
vacía y queda el ID del contacto.

## Aviso de inscripción

Cada oferta académica tiene en Mautic una campaña de seguimiento para quienes pidieron información en la web. El aviso de inscripción saca de esa campaña a quien se preinscribe. Diseño: `FLACSO-Uruguay-Mautic-Plugin/docs/2026-10-25-campanas-por-oferta-diseno.md`.

- Se activa con "Avisar cada inscripción a una oferta" en la tarjeta **Mautic** y requiere el **Secreto del aviso de inscripción**, de al menos 32 caracteres. El secreto debe ser idéntico a `flacso_enrollment_secret` en `config/local.php` de Mautic.
- Cada preinscripción a una oferta, no a un seminario, escribe en la misma transacción una fila en el outbox `mautic_enrollment_notify`. Se envía **aunque el postulante no acepte comunicaciones**: Mautic sólo agrega el tag `inscripto-oferta-{id}` y saca al contacto de la campaña si ya existe, y nunca crea contactos con este aviso.
- El worker hace `POST {URL de Mautic}/flacso/enrollments` con `{eventId, email, offerWpId}`, firmado con HMAC-SHA256 en `X-Flacso-Timestamp` y `X-Flacso-Signature`.
  - Mautic es idempotente por `eventId`.
  - 401, 503, 5xx y los fallos de red se reintentan con backoff.
  - Un 422 o 20 intentos dejan la fila en `failed` con una alerta de Telegram.
  - Al confirmar, el payload se vacía.

## Correos con plantillas

Las plantillas MJML de `docs/mautic/` aportan el diseño institucional; el
contenido de cada notificación llega en estos tokens:

| Token | Contenido |
| --- | --- |
| `{preinscripcion_asunto}` | asunto que hoy usa la notificación |
| `{preinscripcion_contenido}` | cuerpo HTML de la notificación |
| `{preinscripcion_texto}` | versión en texto plano |
| `{preinscripcion_id}` | código de seguimiento |

- El asunto de la plantilla en Mautic debe ser `{preinscripcion_asunto}`. Si la
  prueba de tokens muestra que Mautic no los reemplaza en el asunto, usar un
  asunto fijo.
- Las plantillas no admiten Reply-To dinámico: el correo del postulante va visible
  en el cuerpo del correo al equipo.
- Cada destinatario del equipo se crea en Mautic como contacto, sin tags ni campos.
- Un 2xx de Mautic sólo significa que aceptó la solicitud, no que el correo llegó.

## Activación

1. Desplegar con todo apagado: proveedor SMTP y "Registrar a cada postulante"
   sin marcar.
2. Crear el API client y las dos plantillas en Mautic, y cargar las claves y los IDs.
   "Probar conexión" debe dar OK.
3. **Prueba de tokens** con un contacto interno autorizado: enviar dos
   preinscripciones distintas y verificar que el asunto y el cuerpo de cada
   correo correspondan a su preinscripción. Registrar sólo evidencia redactada.
4. Activar "Registrar a cada postulante" y verificar el contacto y sus tags.
5. Elegir **Mautic** como proveedor en la tarjeta de notificaciones. Para volver
   atrás, elegir SMTP otra vez.
