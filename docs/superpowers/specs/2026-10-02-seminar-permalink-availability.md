# Disponibilidad de seminarios y permalink de preinscripción

## Objetivo

Hacer que el enlace de preinscripción de un seminario sea estable y pertenezca al seminario, sin quedar atado a una edición histórica concreta.

La aplicación debe permitir inscribirse a través de ese permalink solamente cuando existe exactamente una edición abierta. Si no existe una edición abierta, debe mostrar un aviso claro de que las preinscripciones no están abiertas. Si el catálogo contiene más de una edición abierta para el mismo seminario, debe fallar de forma segura y señalar una inconsistencia de configuración, sin elegir una edición al azar.

## Reglas de dominio

1. Un seminario puede conservar varias ediciones históricas.
2. Un seminario puede tener como máximo una edición abierta para preinscripciones.
3. Una edición de seminario requiere `fecha_inicio` válida para poder considerarse abierta.
4. La ventana de cierre se calcula con la zona horaria de WordPress y finaliza al terminar el día calendario `fecha_inicio + 10 días`. En consecuencia, la edición permanece abierta durante ese décimo día y queda cerrada al comenzar el día siguiente.
5. La apertura administrativa sigue siendo una condición necesaria: una edición cerrada manualmente no se abre por la fecha.
6. Una fecha de cierre histórica o un orden de publicación no pueden mantener abierta una edición más allá de la regla de los 10 días.
7. El permalink se conserva en `urls.legacyRegistration`; no se generan URLs nuevas por edición.
8. Todas las ediciones publicadas de un mismo seminario deben compartir el mismo permalink normalizado. Si difieren, el catálogo queda inconsistente y ningún enlace de ese seminario debe elegir una edición.
9. La app no debe resolver un permalink con `Array.find` sobre todos los destinos. Debe agrupar por permalink y resolver el estado completo: abierta única, cerrada o inconsistente.

## Contrato entre WordPress y la app

El endpoint público debe continuar devolviendo todas las ediciones publicadas para conservar diagnóstico e historial, pero cada destino de seminario debe publicar:

- `registrationOpen`: booleano compatible con el contrato actual.
- `registrationWindow.from`: fecha ISO o `null`.
- `registrationWindow.until`: fecha ISO calculada a partir de `fecha_inicio + 10 días` o `null` cuando no sea calculable.
- `registrationAvailability`: `open`, `closed` o `conflict`.

`conflict` se usa cuando el mismo seminario tiene más de una edición elegible simultáneamente. En ese estado no se permite iniciar ni enviar una preinscripción.

La app debe aceptar temporalmente respuestas que no tengan `registrationAvailability`, tratándolas con la lógica anterior basada en `registrationOpen`, para permitir un despliegue ordenado. Una vez publicado el plugin actualizado, los tests deben exigir el nuevo campo para los fixtures de seminarios.

## Comportamiento de la aplicación

- En la página principal, los seminarios se presentan agrupados por permalink; no se muestran como propuestas duplicadas por cada edición histórica.
- Si hay una edición abierta única, la tarjeta y el permalink conducen a esa edición.
- Si no hay edición abierta, la tarjeta puede mostrar el seminario como cerrado y el permalink muestra el aviso: “Las preinscripciones para este seminario no se encuentran abiertas en este momento.”
- Si hay conflicto, el permalink no abre ningún formulario y muestra un aviso de configuración, sin exponer una edición arbitraria.
- El endpoint de formulario y el endpoint de envío deben rechazar también un destino cerrado o en conflicto. La validación del navegador no es una garantía de seguridad.

## Compatibilidad y preservación

- No se elimina ninguna edición histórica ni se cambia su permalink.
- No se modifica el flujo de ofertas académicas ni la separación visual entre ofertas académicas y seminarios.
- Se conservan los IDs estables de destinos para no romper solicitudes existentes.
- La corrección debe incluir pruebas de límite temporal, datos incompletos, permalinks duplicados y revalidación al enviar.
