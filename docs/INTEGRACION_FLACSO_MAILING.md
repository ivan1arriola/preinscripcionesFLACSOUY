# Integración con FLACSO Mailing

Preinscripciones persiste `registration.status.changed` en `registration_event_outbox` dentro de la misma transacción que registra la solicitud efectiva. El worker de notificaciones envía esos eventos al endpoint configurado y reintenta errores de red, timeout, HTTP 429 y 5xx con backoff. Los rechazos HTTP 4xx y el agotamiento de 20 intentos quedan en estado `failed` para conciliación operativa. Al confirmar una respuesta 2xx se borra el cuerpo personal del outbox y permanece la clave idempotente.

## Configuración

- `FLACSO_MAILING_REGISTRATIONS_URL`: `https://envios.flacso.edu.uy/api/v1/events/registrations`.
- `PREINSCRIPCIONES_HMAC_SECRET`: secreto compartido ya administrado fuera del repositorio, igual al configurado como `PREINSCRIPCIONES_HMAC_SECRET` en FLACSO Mailing; el webhook de WordPress conserva su secreto propio. No generar una credencial paralela ni guardar el valor real en el repositorio.
- Mantener `notification-worker` ejecutándose junto a la API; sin él, el outbox retiene eventos pendientes pero no los despacha.

El worker firma `epoch_seconds + "." + raw_body` con HMAC-SHA256 y envía `X-Flacso-Timestamp`, `X-Flacso-Signature` (`sha256=<hex>`) e `Idempotency-Key`. Mailing responde `202` al guardar un evento nuevo, `200` a una repetición exacta y `409` ante la misma clave con otro contenido. Las direcciones de correo no se escriben en logs.

## Verificación pendiente

En esta entrega pasaron `pnpm --filter @flacso/contracts build`, `pnpm --filter api typecheck`, la suite del API (`413` pruebas aprobadas, `34` omitidas) y `pnpm --filter api build`. Las pruebas de firma y endpoint HTTP no requieren servicios externos. Las 34 pruebas omitidas incluyen migraciones/repositorios que dependen de PostgreSQL. `registration-event.integration.test.ts` cubre transacción, idempotencia, reintento y borrado del payload después de confirmación, pero también quedó omitida porque no se configuró `PREINSCRIPCIONES_TEST_DATABASE_URL`.

Antes de aceptar el flujo entre servicios, ejecutar las pruebas omitidas sobre una base PostgreSQL 17 desechable y hacer una prueba de contrato entre ambos entornos con secretos de prueba. No usar una base institucional ni enviar correos por SES durante la validación del evento.
