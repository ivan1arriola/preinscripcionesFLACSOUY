# Plan detallado de corrección de la integración FLACSO ↔ Preinscripciones ↔ Mautic

Versión 1.2 · 28 de octubre de 2026 · Documento de planificación.

**Cambios respecto de la versión 1.1:**

- Se agrega Mautic como parte del plan: sección de arquitectura, cruces con las fases 1 a 4 y fase 7 nueva.
- Se incorpora la verificación del plan contra el código (sección 0) y el estado de avance de la fase 1.
- Se corrige el diagnóstico del token del catálogo: un token incorrecto sí se detecta (401); lo silencioso es el token ausente.
- Se agrega el hallazgo de que el tag de edición de Mautic depende del mismo defecto de INT-002.

**Cambios de la versión 1.1 respecto de la 1.0:** la fase 1 incorporó la protección de la regla "una sola cohorte abierta por oferta" (INT-004 y escritura por API) y la visibilidad de destinos rechazados (INT-007). Se agregó la decisión sobre el orden de la planilla, de la que depende el enlace estable. Se marcaron como ya resueltos en código la idempotencia de avisos y la ruta de notificaciones del Anexo A. Se agregó el requisito de entorno para correr la suite de Preinscripciones.

## Resumen ejecutivo

El propósito es asegurar que cada preinscripción válida quede registrada una sola vez en Google Sheets, con su documentación en Google Drive, con notificaciones correctas y con el contacto y las campañas de Mautic consistentes. WordPress sigue siendo la autoridad sobre las convocatorias; Preinscripciones (React/Vite + Express) es el canal de recepción. PostgreSQL se usa para persistencia técnica, recuperación e idempotencia, no para gestionar admisiones. Mautic recibe contactos, tags y avisos de inscripción, y es opcionalmente el proveedor de correo.

La intervención se limita a:

- autenticación del catálogo;
- protección de la regla de una cohorte abierta por oferta;
- notificaciones;
- consistencia de Sheets;
- identificación de ediciones y organización de Drive;
- integración con Mautic;
- pruebas y despliegue.

El rediseño general de la disponibilidad académica y la navegación entre varias ediciones abiertas quedan fuera de esta entrega.

## 0. Verificación del plan contra el código (28/10/2026)

Se revisó este plan contra los repositorios locales. No se ejecutó la suite de Preinscripciones (faltan dependencias en la máquina de revisión) ni se verificó infraestructura productiva.

**Versiones revisadas:** WP `6be7c16` (igual al auditado); PRE `60465a5`. Preinscripciones tiene tres commits más que el auditado (`88eee99`), entre ellos el aviso de inscripción a Mautic (`a6d3b59`). Ninguno toca los puntos de este plan.

**Hallazgos confirmados en el código:**

| Hallazgo | Evidencia |
| --- | --- |
| INT-002, nombre de edición incorrecto | El serializador de WP lee `numero` y `nombre` (`class-preinscriptions-serializer.php:255-256`); el modelo guarda `anio` y `semestre` (`class-edicion.php:35-36`). El nombre correcto ya se calcula en `class-academic-repositories.php:140`. |
| INT-004, apertura legacy | `class-cohorte.php:119-124` abre toda cohorte sin bandera si la oferta tiene `inscripciones_abiertas`. |
| Regla de una cohorte abierta | `set_single_open_instance` solo se invocaba desde los botones de wp-admin. El guardado por la API académica no la aplicaba (corregido, ver 5.3). |
| Sheets | La escritura hace `insertRows` y luego `updateValues` (`google-sheets-repository.ts:117-120`), sin búsqueda previa por ID. `appendValues` existe y no se usa. `spreadsheet_operations` solo aparece en esquema y migraciones. |
| Idempotencia de avisos | La migración 013 crea `idx_email_notifications_unique_delivery`. |
| Drive | Las planillas ya se buscan por `flacsoTargetId`. |

**Correcciones al diagnóstico original:**

1. **El token del catálogo está mejor cubierto de lo que decía el plan.** El compose de producción lo exige (`WORDPRESS_CATALOG_TOKEN:?...`), `main.ts` avisa al arrancar si falta, y existe una auditoría previa (`docs/AUDITORIA-2026-10-24.md`, hallazgo F-27) que confirmó el problema. Lo que falta es verificar que el arreglo llegó a producción.
2. **Un token incorrecto sí se detecta.** WordPress responde 401 (`authorize` en `class-preinscriptions-rest.php`). El caso silencioso es el token **ausente**: WordPress entrega el catálogo público, sin correos.
3. **El health check no cubría el catálogo.** `/api/health` solo informa la base de datos. El chequeo de catálogo era trabajo nuevo (hecho, ver 5.1).
4. **`rejectedTargets` ya se calcula y se registra** (`wordpress-client.ts:167-190`), pero no se muestra en ningún panel.
5. **Ya existe una cola en memoria por planilla** (`serializePerSpreadsheet`). Protege dentro de un solo proceso; el bloqueo en PostgreSQL del paso 27 lo extiende a varios procesos.
6. **El serializador ya publica como cerradas** las ofertas con dos cohortes abiertas (comentario en `class-preinscriptions-serializer.php`). Falta confirmarlo con una prueba (paso 16).

## 1. Alcance, fuentes y niveles de certeza

La base documental es "Auditoría de integración Plugin FLACSO ↔ Preinscripciones", en su revisión del 28/10/2026 (11:07–11:17), sobre los commits WP `6be7c16` y PRE `88eee99`. El informe auditó código, ejecutó 122 pruebas PHP y reprodujo los fallos de ediciones y de aperturas legacy. No ejecutó la suite de Preinscripciones ni validó la infraestructura productiva. Todas las rutas y diagnósticos deben reconfirmarse contra `main` antes de editar. Para Mautic, la base es el código de `preinscripcionesFLACSOUY/docs/MAUTIC.md` y de `FLACSO-Uruguay-Mautic-Plugin`, y los documentos `2026-10-25-campanas-por-oferta-diseno.md` y `-plan.md`. La especificación del 22/10 de campañas está obsoleta y no se usa como base.

| Incluido | Excluido |
| --- | --- |
| Token y diagnóstico del catálogo | Gestión de estados de admisión |
| Regla de una cohorte abierta por oferta en todos los caminos de escritura | Panel de evaluación y expedientes |
| Notificaciones y enlaces correctos | Estadísticas y webhooks de estado |
| Idempotencia y recuperación de Sheets | Cambio de reglas o navegación de ediciones simultáneas |
| Carpetas estables y nombres de edición | Rediseño integral de formularios |
| Contactos, tags y aviso de inscripción de Mautic | Rediseño de las campañas de Mautic |
| Pruebas y despliegue reversible | Rediseño de caché y disponibilidad general |

## 2. Principios técnicos y límites

- WordPress es la única fuente de datos académicos y de destinatarios configurados. Preinscripciones no infiere reglas de negocio nuevas. Mautic guarda un estado derivado (tags y membresía de campañas) que se reconstruye a partir de esos datos.
- Una solicitud tiene un ID de seguimiento estable. Ese ID debe producir una sola fila lógica y un conjunto único de archivos.
- Una falla de correo o de Mautic no revierte una inscripción ya registrada. Las operaciones técnicas pendientes quedan trazables y reintentables.
- No se registran secretos, documentos ni datos personales completos en logs o diagnósticos.
- Los cambios sobre carpetas existentes en Drive requieren inventario, simulación y plan de reversión.
- Compatibilidad progresiva: se despliega primero el productor compatible y después el consumidor, sin cortar inscripciones activas.
- Preinscripciones no inscribe a nadie en campañas de Mautic: el formulario no tiene consentimiento comercial.

## 3. Arquitectura objetivo y contrato mínimo

El flujo es: WordPress (catálogo autenticado, ediciones y correos) → API de Preinscripciones (validación, ID de solicitud y persistencia técnica) → Drive (documentos), Sheets (fila), cola de notificaciones (correo) y outboxes de Mautic (contacto y aviso de inscripción). El formulario web consulta la API y no debe conocer el token de WordPress.

| Elemento | Responsabilidad | Invariante |
| --- | --- | --- |
| Catálogo WP | Publicar destinos, IDs y, con autenticación, `notificationEmails` | La respuesta sin autenticación no expone correos |
| Escritura WP | Abrir y cerrar convocatorias | Nunca hay dos cohortes abiertas en la misma oferta |
| API PRE | Validar la solicitud y coordinar los efectos externos | El mismo ID no duplica efectos |
| PostgreSQL | Registrar la operación y su estado técnico | Se puede recuperar un fallo parcial |
| Google Sheets | Registro administrativo definitivo | Una fila por ID de seguimiento |
| Google Drive | Documentación por solicitud y edición | Carpetas identificadas por ID estable |
| Correo | Confirmación y aviso a la coordinación | Los enlaces identifican siempre la misma solicitud |
| Mautic: contacto | Perfil estable y tags por oferta | Mismo código de tag que las consultas del plugin; sin campañas |
| Mautic: aviso | Sacar de la campaña de la oferta a quien se preinscribe | Idempotente por `eventId`; nunca crea contactos |

### Canales hacia Mautic

| Origen → destino | Mecanismo | Autenticación |
| --- | --- | --- |
| Plugin FLACSO → Mautic (consultas) | `POST /api/flacso/inquiries`; o acuse transaccional si la oferta no tiene campaña | OAuth2 client credentials |
| Mautic → WordPress (estado de oferta) | `GET /wp-json/flacso/v1/ofertas/{id}` y `/ofertas/{id}/consulta` | Pública |
| Preinscripciones → Mautic (contactos y correos) | Outbox `mautic_contact_sync`; API REST | OAuth2 |
| Preinscripciones → plugin de Mautic (aviso) | Outbox `mautic_enrollment_notify`; `POST /flacso/enrollments` con `{eventId, email, offerWpId}` | HMAC-SHA256 (`X-Flacso-Timestamp`, `X-Flacso-Signature`), ventana de 5 minutos |

## 4. Fase 0 — Preparación y verificación de producción

Objetivo: eliminar incertidumbres antes de tocar código o datos reales.

1. Comparar el `main` actual con los commits auditados; localizar las rutas efectivas y los tests, y registrar las diferencias.
2. Verificar, sin revelar secretos, que WordPress tenga definida `FLACSO_PREINSCRIPCIONES_CATALOG_TOKEN` y que Preinscripciones use `WORDPRESS_CATALOG_TOKEN` con el mismo valor. Si ambos están, comprobar que el hallazgo F-27 de la auditoría del 24/10 quedó resuelto.
3. Consultar el endpoint autenticado desde el servidor, no desde el navegador. Verificar el código HTTP, el esquema y la presencia del campo `notificationEmails`.
4. Inventariar:
   - convocatorias abiertas sin correos de coordinación;
   - cohortes y ediciones sin `preinscripcion_habilitada` explícita (las que hoy dependen del fallback legacy);
   - ofertas con más de una cohorte abierta;
   - carpetas genéricas "Edición", hojas y operaciones pendientes;
   - filas `failed` en `mautic_contact_sync` y `mautic_enrollment_notify`;
   - contactos de preinscripciones de seminarios sin tag de edición (`{codigo}-e{n}`).
5. Identificar el despliegue actual, los backups, las migraciones disponibles y el método de rollback.
6. Crear datos sintéticos y un destino de pruebas aislado. Establecer una ventana de despliegue sin envíos críticos.
7. Preparar un entorno con acceso al registro de npm (máquina local o CI de GitHub, que ya incluye PostgreSQL) para ejecutar la suite de Preinscripciones. Desde la sesión de auditoría el registro estaba bloqueado.

Entregable: inventario de riesgos con fecha, ambiente, resultado y responsable.

Criterio de salida: ninguna configuración crítica sin verificar, y los secretos se mantienen fuera del informe.

## 5. Fase 1 — Catálogo: autenticación, observabilidad y regla de cohortes

### 5.1 Autenticación y observabilidad

Hallazgo INT-005: riesgo crítico inferido, no confirmado en producción. Un token ausente es el caso silencioso; uno incorrecto devuelve 401.

Archivos de referencia: [WP] `class-preinscriptions-rest.php`; [PRE] `wordpress-client.ts`, `main.ts`, `deploy/docker-compose.production.yml`, `presentation/http/health.ts`.

8. Mantener el contrato Bearer existente. Configurar la constante en WordPress y la variable en Preinscripciones por el canal seguro del despliegue, sin incrustar valores en el código.
9. **Hecho (rama `feat/health-catalogo`, sin integrar).** Chequeo servidor a servidor `GET /api/health/catalog`, con los códigos `ok`, `token_missing`, `unauthorized`, `incompatible`, `unavailable` y `not_configured`, más el conteo de destinos descartados.
10. **Hecho.** El chequeo no expone tokens, correos ni mensajes de error, y recuerda su resultado 30 segundos para que un endpoint público no castigue a WordPress. `/api/health` sigue dependiendo solo de la base de datos.
11. **Hecho.** `scripts/deploy-production.sh` aborta antes de modificar Apache ante `token_missing`, `unauthorized` o `incompatible`. Ante `unavailable` o ausencia de respuesta, avisa y continúa.
12. **Parcial.** Pruebas unitarias del clasificador escritas en `health.test.ts`, sin ejecutar. Faltan las pruebas de token ausente, incorrecto y válido contra el cliente, y comprobar que la respuesta pública de WP no incluya `notificationEmails` (ya existe en `preinscriptions-rest-contract-test.php`).
13. **INT-007, pendiente.** Mostrar en el panel de administración los destinos que el cliente descarta por no cumplir el contrato, con su motivo y sin datos personales. Hoy solo se publica el conteo en el endpoint de salud; falta una ruta de admin autenticada con id y motivo.

### 5.2 Regla "una sola cohorte abierta por oferta"

La regla de negocio se cumplía solo desde el botón Abrir de wp-admin. Había dos caminos que la saltean:

- la API académica permitía guardar `preinscripcion_habilitada` sin cerrar las demás cohortes;
- el fallback legacy de `FLACSO_Cohorte::accepts_registration` abre todas las cohortes sin bandera de una oferta con `inscripciones_abiertas`, incluidas las que están en curso (INT-004).

No se rediseña la disponibilidad: solo se hace cumplir la regla ya fijada.

14. **Hecho (rama `fix/una-cohorte-abierta-por-api`, sin integrar).** Abrir una cohorte por la API académica cierra las demás de la oferta (`close_sibling_cohorts`, invocado desde `FLACSO_Academic_Repository::save`). Prueba agregada en `tests/preinscription-local-opening-test.php`.
15. **Pendiente.** Con el inventario de la fase 0 en mano, fijar `preinscripcion_habilitada` explícita donde falte, conservando el estado que hoy ve el público. Recién entonces retirar el fallback por `inscripciones_abiertas` (cohorte sin bandera = cerrada).
16. **Pendiente.** Si aun así existieran dos cohortes abiertas por datos viejos, el comportamiento actual se mantiene (ambas publicadas como cerradas). Confirmarlo con una prueba y agregar un aviso en wp-admin para que se detecte.
17. Pruebas:
    - abrir por API una segunda cohorte cierra la primera (hecho);
    - cerrar por API no toca a las demás (hecho);
    - una cohorte sin bandera queda cerrada aunque la oferta tenga `inscripciones_abiertas` (pendiente, depende del paso 15);
    - el estado público de las convocatorias del inventario no cambia tras la migración de banderas (pendiente).

### 5.3 Estado de la fase

| Paso | Estado |
| --- | --- |
| 8 | Configuración, a verificar en la fase 0 |
| 9, 10, 11 | Hecho, sin integrar ni ejecutar las pruebas de Preinscripciones |
| 12 | Parcial |
| 13 | Pendiente |
| 14 | Hecho, prueba PHP pasa |
| 15, 16, 17 | Pendiente |

Aceptación:

- Con token válido, el catálogo autenticado es utilizable.
- Con token ausente o inválido, el error es detectable y el despliegue se detiene.
- Ningún camino de escritura deja dos cohortes abiertas en una oferta.
- Los destinos rechazados se ven en el panel.
- No se afirma que el token falta hasta comprobarlo en producción.

## 6. Fase 2 — Notificaciones y enlaces a Sheets

Hallazgo INT-015: análisis estático; la auditoría previa reporta cero avisos a coordinaciones en una muestra (20 preinscripciones, ninguna con destinatario `target`).

Referencias: [WP] `correo_oferta`, `correo_seminario`; [PRE] `apps/api/src/application/create-preinscription-notifications.ts`, `submission-routes.ts`, `google-sheets-repository.ts` y `sheets-client.ts`.

### 6.1 Destinatarios y validaciones

18. Revisar la normalización de las listas de direcciones y la herencia de destinatarios. Conservar la regla vigente de seminarios integrados salvo decisión explícita.
19. Mostrar una advertencia en wp-admin al abrir una convocatoria sin correos de coordinación, sin bloquear la apertura.
20. Agregar al diagnóstico de Preinscripciones la lista de destinos sin destinatarios, sin exponer correos públicamente.
21. Diferenciar la ausencia deliberada de destinatarios del fallo de autenticación del catálogo (usa el código de `/api/health/catalog`).

### 6.2 Encolado, reintentos y trazabilidad

22. Asegurar que el evento de notificación quede registrado de forma durable junto con el resultado de la inscripción, o mediante un mecanismo recuperable existente.
23. Registrar los fallos de encolado como tareas técnicas pendientes, no solo con `console.error`.
24. Idempotencia de avisos: **ya existe en el código.** La migración 013 crea un índice único en `email_notifications` sobre solicitud, audiencia, destinatario y versión de plantilla. Solo falta una prueba que demuestre que reencolar no duplica avisos completados.
25. Reconocer que un proveedor de correo puede aceptar el mensaje y perder la respuesta: la garantía de "exactamente una entrega" puede no ser posible. Documentar la estrategia y evitar los duplicados previsibles.
26. Si el proveedor elegido es Mautic, ejecutar la prueba de tokens de `MAUTIC.md` (dos preinscripciones distintas; verificar asunto y cuerpo de cada correo) y recordar que un 2xx solo significa que Mautic aceptó la solicitud.

### 6.3 Enlaces estables

No enlazar a A2: hoy cada solicitud se inserta en la fila 2 y las siguientes desplazan la posición.

El correo a la coordinación lleva tres datos:

- el ID de seguimiento;
- el enlace a la planilla;
- el enlace a la carpeta de Drive del postulante, que ya se identifica por ID y no se mueve.

Con esto el enlace exacto a la fila deja de ser crítico, y no se publican datos personales en ninguna URL. Si la decisión de la sección 7.1 es escribir al final de la hoja, el enlace a la fila también queda estable, salvo que alguien ordene la hoja manualmente.

Aceptación:

- El correo de prueba llega a los destinatarios esperados.
- Los datos del correo identifican la misma solicitud después de diez filas nuevas.
- Un fallo de encolado es visible y reintentable.

## 7. Fase 3 — Idempotencia de Sheets y recuperación

Hallazgo documentado: la escritura actual inserta la fila 2 y después escribe los valores. Un timeout puede dejar una fila vacía o producir una segunda fila al reintentar.

Referencias: `google-sheets-repository.ts`, `sheets-client.ts`, `retry-failed-submission.ts` y la tabla `spreadsheet_operations`, que existe y hoy no se usa.

### 7.1 Decisión previa: orden de la planilla

Hoy las solicitudes nuevas aparecen arriba (fila 2), y las asistentes ven primero lo más reciente. `values:append` escribe al final de la hoja. Antes de implementar, las asistentes deben elegir entre dos opciones:

- **Escribir al final (recomendado).** `values:append` hace una sola llamada y no deja filas vacías. Las filas existentes no se desplazan, así que el enlace a la fila queda estable. Para ver lo más reciente primero se usa una vista con orden o un filtro.
- **Mantener lo nuevo arriba.** Se conserva la inserción en la fila 2, ahora protegida por la búsqueda previa del ID. Sigue habiendo dos llamadas a Google y las posiciones se desplazan.

### 7.2 Diseño de la operación

27. Definir el ID de seguimiento como clave lógica inmutable en cada planilla.
28. Usar PostgreSQL para reclamar la operación por (`spreadsheet_id`, `submission_id`), con restricción única y transacción, y serializar los intentos sobre esa clave. Esto extiende a varios procesos la cola en memoria que hoy existe (`serializePerSpreadsheet`).
29. Antes de escribir, buscar el ID en la columna "ID de seguimiento" y recuperar su fila si ya existe. Es una sola lectura de columna por envío; el costo es despreciable para el volumen de FLACSO.
30. Según la decisión de 7.1, escribir con `values:append` (ya implementado sin uso en `sheets-client.ts`) o con la inserción actual protegida por el paso 29. Los encabezados faltantes se siguen reparando aparte, en forma aditiva, como hoy.
31. Guardar el ID de hoja, el ID de seguimiento, el estado, la marca temporal y la referencia de fila, sin asumir que el número de fila permanecerá fijo.
32. Ante un timeout ambiguo, volver a consultar por ID antes de repetir la escritura.
33. Si el proceso cae después de escribir pero antes de confirmar en PostgreSQL, reconciliar contra Sheets al recuperar.
34. Si aparecen duplicados históricos, informarlos y ofrecer una reparación explícita; no borrar filas automáticamente sin validación.

### 7.3 Límite de garantías

La lectura previa y la escritura no forman una transacción atómica en Google Sheets. El bloqueo en PostgreSQL controla los procesos propios que comparten la base. Las escrituras manuales o de clientes externos requieren detección posterior. La meta es una idempotencia operacional demostrada en los escenarios soportados, sin prometer garantías imposibles.

### 7.4 Matriz de pruebas

| Escenario | Resultado esperado |
| --- | --- |
| Mismo ID reenviado 10 veces | Una fila completa |
| Dos workers concurrentes | Una operación efectiva |
| Timeout después de escribir | Reconciliación sin fila nueva |
| Fallo antes de escribir | El reintento escribe una fila |
| Fallo al registrar el resultado en PostgreSQL | Reconciliación por ID |
| El correo falla después de Sheets | No se reescribe la fila |
| Fila movida u ordenada manualmente | Se localiza por ID, no por posición |
| Mautic no responde después de Sheets | No se reescribe la fila; el outbox reintenta |

## 8. Fase 4 — Ediciones y Drive

INT-002 está reproducido: el serializador de WordPress lee `numero` y `nombre`, pero el modelo real registra `anio` y `semestre`. INT-009 señala que buscar carpetas por nombre fragmenta la documentación al renombrar.

35. En WordPress, derivar `edition.name` con la regla real de `FLACSO_Edicion::sync_title` (o con la ya usada en `class-academic-repositories.php:140`) y exponer `year` y `semester` de forma compatible. Corregir el fixture de prueba que usa metadatos inexistentes.
36. **Efecto en Mautic.** `buildMauticContactTags` (`mautic-contact.ts`) arma el tag `{codigo}-e{n}` con `edition.number`. Mientras ese valor salga de la meta inexistente `numero`, los contactos de seminarios probablemente no reciben el tag de edición. Definir qué es "número de edición" (¿año y semestre?) y ajustar el tag con una decisión explícita, sin renombrar tags ya aplicados.
37. En Preinscripciones, usar los atributos de edición para etiquetas y nombres visibles, pero identificar las carpetas por `appProperties.flacsoTargetId`.
38. Al renombrar una oferta o un seminario, localizar la carpeta por ID y renombrarla en lugar de crear otra.
39. Inventariar las carpetas existentes llamadas "Edición" y asociar los archivos a sus solicitudes por metadatos. Los archivos ambiguos no se mueven automáticamente.
40. Preparar una simulación y un registro de migración con origen, destino, ID, cantidad de archivos y posibilidad de reversión.
41. Verificar que las planillas por edición existentes se sigan localizando por su ID estable.

Aceptación:

- Dos ediciones diferentes tienen destinos independientes.
- Cambiar nombres no crea carpetas nuevas.
- Ninguna migración mueve documentos sin correspondencia comprobable.
- Un contacto de seminario recibe el tag de edición acordado.

## 9. Fase 5 — Contratos, pruebas y seguridad

INT-006: los tests de ambos repositorios usan fixtures escritos por separado. Esa divergencia permitió que el nombre de edición incorrecto pasara las pruebas.

42. Generar un fixture sintético desde el serializador real de WordPress y validarlo en Preinscripciones con Zod.
43. Incluir en el fixture:
    - una edición real, con `anio` y `semestre`;
    - una oferta sin tipo (INT-007);
    - dos cohortes de la misma oferta;
    - el catálogo autenticado, sin datos personales.
44. Ejecutar las pruebas PHP, el typecheck y los tests de API y web de Preinscripciones en el entorno preparado en el paso 7.
45. Probar la integración de extremo a extremo con datos sintéticos y servicios de prueba.
46. Revisar permisos de Drive, acceso a Sheets, registro de errores, retención de documentos y secretos.
47. Registrar resultados, comandos ejecutados, SHA de los commits y evidencia de aceptación.

## 10. Fase 6 — Despliegue controlado y reversión

48. Crear ramas específicas y PRs pequeños; mantener `main` estable hasta superar las pruebas. En el plugin de WordPress, `main` despliega a producción con cada push.
49. Desplegar primero lo compatible en WordPress (token, regla de cohortes y contrato de edición) y después Preinscripciones. Validar el endpoint antes y después.
50. Aplicar migraciones técnicas aditivas y reversibles; no eliminar columnas ni tablas en esta entrega.
51. Probar una inscripción sintética completa (formulario → PostgreSQL → Drive → Sheets → correo → Mautic) y verificar una sola fila y enlaces correctos.
52. Monitorear errores de catálogo, operaciones pendientes, duplicados detectados, fallos de correo y filas `failed` en los outboxes de Mautic durante la ventana acordada.
53. Si falla el nuevo flujo, detener las escrituras automatizadas cuando corresponda, conservar la cola técnica y revertir la versión sin borrar los datos ya creados.
54. Documentar las tareas manuales pendientes y cerrar con un informe de despliegue.

## 11. Fase 7 — Mautic

Objetivo: que los contactos, tags y avisos de inscripción de Mautic sean consistentes con el resto del flujo, sin cambiar el diseño de campañas.

Referencias: [PRE] `docs/MAUTIC.md`, `domain/mautic-contact.ts`, `domain/mautic-enrollment.ts`, `application/mautic-enrollment-notify-dispatcher.ts`, `application/mautic-contact-sync-dispatcher.ts`; [Mautic] `Controller/EnrollmentController.php`, `Service/WebhookSignature.php`, `Service/WordPressAcademicClient.php`, `Config/config.php`; [WP] `modules/consultas/`.

55. **Inventario (fase 0).** Confirmar, sin revelar valores, que el secreto compartido está cargado en ambos lados: "Secreto del aviso de inscripción" en Preinscripciones (mínimo 32 caracteres) y `flacso_enrollment_secret` en `config/local.php` de Mautic. Enviar un aviso sintético con un correo inexistente: debe responder **409**, sin crear contacto ni enviar correo, y dejar el evento disponible para reintento (antes de la rama `fix/reintentar-aviso-sin-contacto` respondía 200 y lo daba por procesado, como se verificó el 26/10 en la fase 4 del piloto). Luego crear el contacto y confirmar que el reintento termina con 200 y lo retira de la campaña.
56. **Contrato del aviso.** Probar que 401, 503, 5xx y los fallos de red se reintentan con backoff; que 422 es definitivo y genera alerta de Telegram; que el duplicado por `eventId` es aceptado sin repetir la acción; y que un desfase de reloj mayor a 5 minutos devuelve 401 y se recupera.
57. **Alcance de seminarios.** Hoy el aviso solo cubre ofertas, no seminarios. **Decisión pendiente:** confirmar si los seminarios también tienen campaña de seguimiento. Si la tienen, incluir el aviso para ediciones; si no, documentarlo como límite.
58. **Tags coherentes.** Verificar con un contacto real que una misma persona queda con tags coherentes entre consultas (plugin) y preinscripciones (`FLACSO_Inquiry_Tag_Factory` y `buildMauticContactTags`), incluido el tag de cohorte `{codigo}-c{n}`. Para el tag de edición ver el paso 36.
59. **Rotación del secreto.** Documentar el procedimiento: ambos lados cambian a la vez y el outbox puede tener filas pendientes firmadas con el secreto viejo (se reintentan con la firma nueva, porque la firma se calcula al enviar).
60. **Consentimiento.** Mantener la regla de no inscribir a nadie en campañas desde preinscripciones. Agregar una prueba que lo haga cumplir: ningún camino de Preinscripciones llama a endpoints de campaña de Mautic.
61. **Correo con plantillas.** Si Mautic es el proveedor, aplicar la prueba de tokens (paso 26) y verificar que cada destinatario del equipo existe como contacto sin tags ni campos.
62. **Despliegue del plugin de Mautic**, según el procedimiento acordado:
    - preflight en un contenedor descartable;
    - `rsync` en el servidor;
    - `cache:clear` antes de `plugins:reload`;
    - prueba local con Docker antes de producción.
63. **Rama pendiente del plugin de WordPress.** Existe `.worktrees/mautic-offer-campaigns` en `flacso-uruguay-plugin`. Si esa rama sigue abierta, decidir si entra antes de las fases 1 a 4, porque toca el módulo de consultas.

Aceptación:

- Una preinscripción sintética deja el contacto con los tags correctos.
- El aviso saca al contacto de la campaña de la oferta; un duplicado no repite la acción.
- Un fallo de Mautic no bloquea la inscripción y queda reintentable.
- Ningún camino de Preinscripciones inscribe a un contacto en una campaña.

## 12. Orden de trabajo y entregables

| Bloque | Entregable verificable | Condición de avance |
| --- | --- | --- |
| 0. Diagnóstico | Inventario de producción y entorno de pruebas con npm | Token, rutas y banderas de cohortes confirmados; secreto de Mautic verificado |
| 1. Catálogo | Health check, guardia de despliegue, regla de cohortes y destinos rechazados visibles | 200/401 probados; nunca dos cohortes abiertas |
| 2. Notificaciones | Encolado recuperable y correo con ID y carpeta | Correo + datos correctos tras 10 filas nuevas |
| 3. Sheets | Decisión de orden, idempotencia y conciliación | Pruebas de timeout y concurrencia |
| 4. Drive y ediciones | Nombres correctos, carpetas por ID, tag de edición definido | Pruebas sin pérdida de archivos |
| 5. Integración | Fixture común + suite + E2E | Sin regresiones |
| 6. Despliegue | Registro de versión, validación y rollback | Prueba sintética en el entorno objetivo |
| 7. Mautic | Aviso, tags y despliegue del plugin verificados | Prueba sintética completa y alcance de seminarios decidido |

## 13. Riesgos, decisiones y preguntas pendientes

| Tema | Decisión propuesta o pendiente |
| --- | --- |
| Cohortes simultáneas | Regla de negocio: una sola abierta por oferta. Se hace cumplir en todos los caminos de escritura (fase 1). |
| Fallback legacy de apertura | Se retira solo después de fijar banderas explícitas a partir del inventario, sin cambiar lo que hoy ve el público. |
| Orden de la planilla | Pendiente de decisión de las asistentes (7.1). Recomendado: escribir al final. |
| Correo de coordinación vacío | Advertencia, sin bloqueo automático. |
| Enlace en el correo | ID de seguimiento + planilla + carpeta de Drive. El enlace exacto a la fila es opcional. |
| Migración de carpetas | Solo con inventario y correspondencia comprobable. |
| Fallo ambiguo de correo | Reintento con la deduplicación existente; no se promete una entrega exactamente única. |
| Caché y disponibilidad general | No se rediseñan ahora; las incidencias se registran por separado. |
| PostgreSQL | Solo persistencia técnica, sin estados académicos. |
| Alcance de seminarios en Mautic | **Pendiente:** ¿tienen campaña de seguimiento? Determina si el aviso se extiende a ediciones. |
| Tag de edición de Mautic | **Pendiente:** definir qué es el "número de edición" (¿año y semestre?). No renombrar tags ya aplicados. |
| Rama `mautic-offer-campaigns` | **Pendiente:** decidir si entra antes de las fases 1 a 4. |

## 14. Definición de terminado

- Una solicitud válida produce una fila lógica y documentos correctamente asociados.
- Reintentos, timeouts y concurrencia no duplican registros en las condiciones ensayadas.
- Ningún camino de escritura en WordPress deja dos cohortes abiertas en la misma oferta.
- Los destinos que el catálogo rechaza son visibles en el panel.
- Las notificaciones a coordinaciones configuradas se generan y sus fallos son recuperables.
- El correo identifica la misma inscripción después de nuevas altas.
- Los nombres y carpetas de ediciones se basan en metadatos reales y claves estables.
- Los contactos de Mautic quedan con tags coherentes y el aviso de inscripción saca al contacto de la campaña de la oferta, sin inscribir a nadie en campañas.
- Las pruebas de ambos repositorios pasan y queda evidencia del flujo de extremo a extremo.
- El despliegue tiene verificación del catálogo y procedimiento de reversión documentado.
- No se introduce gestión académica.

## Anexo A. Mapa de archivos

Rutas confirmadas en los commits auditados (WP `6be7c16`, PRE `88eee99`) y revisadas contra el código local (WP `6be7c16`, PRE `60465a5`); revalidar contra `main` en la fase 0.

| Repositorio | Rutas |
| --- | --- |
| WP | `modules/preinscripciones/includes/class-preinscriptions-rest.php`; `class-preinscriptions-serializer.php` |
| WP | `modules/oferta-academica/includes/class-cohorte.php`; `class-academic-api.php`; `class-academic-repositories.php`; `class-preinscription-ajax-handlers.php` |
| WP | `modules/seminarios/includes/class-edicion.php` |
| WP | `modules/consultas/services/class-flacso-inquiry-delivery-service.php`; `includes/integrations/class-flacso-mautic-client.php` |
| PRE | `apps/api/src/infrastructure/wordpress/wordpress-client.ts`; `wordpress-academic-catalog.ts` |
| PRE | `apps/api/src/application/create-preinscription-notifications.ts` |
| PRE | `apps/api/src/infrastructure/database/migrations/013_email_notifications.ts` |
| PRE | `apps/api/src/infrastructure/google/google-sheets-repository.ts`; `sheets-client.ts`; `apps/api/src/application/retry-failed-submission.ts` |
| PRE | `apps/api/src/infrastructure/google/google-drive-repository.ts`; `apps/api/src/domain/google-drive-naming.ts` |
| PRE | `deploy/docker-compose.production.yml`; `scripts/deploy-production.sh`; `apps/api/src/presentation/http/health.ts`; `app.ts`; `main.ts` |
| PRE | `apps/api/src/domain/mautic-contact.ts`; `mautic-enrollment.ts`; `application/mautic-enrollment-notify-dispatcher.ts`; `mautic-contact-sync-dispatcher.ts`; `docs/MAUTIC.md` |
| Mautic | `Controller/EnrollmentController.php`; `Service/WebhookSignature.php`; `Service/WordPressAcademicClient.php`; `Config/config.php`; `docs/2026-10-25-campanas-por-oferta-diseno.md` |

## Anexo B. Trazabilidad de la fuente

Fuente: "Auditoría de integración Plugin FLACSO ↔ Preinscripciones", hallazgos INT-002, INT-004, INT-005, INT-006, INT-007, INT-009 e INT-015, las secciones "Alcance revisado" y "Registro consistente en Sheets y Drive", y la revisión de la versión 1.1 contra el código (28/10/2026, 11:26–11:49). La versión 1.2 agrega la verificación contra el código local y la integración con Mautic (28/10/2026). Antecedente: `docs/AUDITORIA-2026-10-24.md` (hallazgo F-27, token del catálogo).

## Anexo C. Estado de implementación al 28/10/2026

| Cambio | Repositorio | Rama | Commit | Estado |
| --- | --- | --- | --- | --- |
| Abrir una cohorte por API cierra las demás de la oferta | flacso-uruguay-plugin | `fix/una-cohorte-abierta-por-api` | `154b5f0` | Commit local; la prueba PHP pasa; sin push ni verificador completo |
| `GET /api/health/catalog` y guardia de despliegue | preinscripcionesFLACSOUY | `feat/health-catalogo` | `ee670d4` | Commit local; pruebas escritas sin ejecutar; sin push |

La rama `feat/health-catalogo` se creó desde `mautic-aviso-inscripcion`. Si esa rama no está integrada a `main`, el PR arrastrará sus commits.
