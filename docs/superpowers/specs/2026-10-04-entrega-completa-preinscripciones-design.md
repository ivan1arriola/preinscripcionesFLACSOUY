# Entrega completa de Preinscripciones FLACSO UY

## Objetivo

Dejar `preinscripcionesFLACSOUY` en un estado entregable y verificable: formularios canónicos sin dependencia operativa de perfiles editables, documentos y cargas temporales completos, integraciones WordPress/Drive/Sheets/SES coherentes, administración operable, pruebas reproducibles y despliegue preparado con rollback.

## Alcance

La entrega cubre el checkout actual sobre `main` y conserva los cambios locales existentes. Se auditarán y cerrarán los planes previos, pero no se reescribirá la plataforma legacy ni se eliminarán datos históricos.

### Incluido

- Formularios definidos en código con la matriz documental aprobada.
- Maestría con exactamente dos cartas de recomendación obligatorias.
- Documentos obligatorios, título con alternativa de ausencia y residencia como país más ciudad.
- Revalidación de catálogo WordPress y preservación de `link_preinscripcion`.
- Cargas temporales privadas, límites, ownership, expiración e idempotencia.
- Persistencia y reconciliación de Drive/Sheets sin duplicados ni pérdida de columnas manuales.
- Outbox, reintentos, configuración cifrada y observabilidad de Amazon SES.
- Autenticación administrativa y configuración de integraciones.
- Tests unitarios, HTTP, integración, build, typecheck, Compose y E2E disponibles.
- Documentación de instalación, operación, backup, rollback y publicación.
- Commit de los cambios intencionales en `main` y publicación en `origin/main`.

### Fuera del cambio automático

- No se borrarán solicitudes históricas ni tablas antiguas de perfiles.
- No se publicarán credenciales ni secretos.
- No se cambiará Apache/DNS ni se hará cutover del dominio público sin una confirmación operativa independiente.
- La salida efectiva de SES Sandbox, verificación DNS y prueba de envío real requieren credenciales y servicios externos disponibles.

## Estado inicial conocido

- El checkout de trabajo es `/home/ivan/repositorios/FLACSO Uruguay/preinscripcionesFLACSOUY`.
- `HEAD` local contiene 19 commits que todavía no están en `origin/main`.
- Existen cambios modificados y planes sin commit que deben preservarse y clasificarse antes de integrar.
- La suite local previamente observada estaba verde, pero la entrega final deberá repetirla después de los cambios.

## Diseño técnico

### Formularios

`getCanonicalFormDefinition()` será la única fuente operativa de la definición del formulario. `getTargetForm()` y `submitPreinscription()` no consultarán perfiles editables para decidir campos, documentos o validaciones. Las tablas y snapshots históricos de perfiles permanecerán legibles.

La API seguirá publicando el contrato existente y `profileVersionId: canonical-v1`. El frontend renderizará la definición recibida, sin duplicar reglas de tipo de oferta.

### Documentos y envío

La API validará cada token contra sesión, destino y campo. Los binarios vivirán fuera del web root y sus metadatos en PostgreSQL. El flujo será validar → Drive → Sheets → limpiar temporales; los fallos tendrán estado explícito e idempotencia.

### Integraciones y notificaciones

WordPress seguirá siendo fuente de verdad del catálogo. Drive y Sheets se resolverán por IDs/nombres contractuales y conservarán datos manuales. SES usará outbox persistente, destinatarios deduplicados, backoff y reintento manual seguro.

### Producción

El script de despliegue exigirá working tree limpio, SHA explícito, validaciones locales, backup de entorno/base y health checks. La nueva aplicación se levantará aislada de la legacy; el cutover público será una operación posterior y reversible.

## Criterios de aceptación

1. No quedan consumidores operativos de perfiles editables en la composición o envío canónico.
2. La matriz de formularios y documentos está cubierta por pruebas de dominio, API y web.
3. `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check` y Compose pasan en el checkout final.
4. E2E cubre selección de destino, formulario, documentos, confirmación y rutas legacy.
5. No hay secretos, datos personales ni cambios locales intencionales perdidos.
6. `main` remoto contiene el SHA entregado y se informa por separado el resultado de CI, despliegue y health público.
7. Si no se ejecuta el cutover, queda documentado como pendiente operativo, no como código incompleto.

## Estrategia de entrega

Se trabajará por lotes pequeños y verificables: primero formularios/documentos, luego integraciones/notificaciones, después operación/documentación y finalmente publicación. Cada lote tendrá pruebas específicas y una verificación completa antes de avanzar.
