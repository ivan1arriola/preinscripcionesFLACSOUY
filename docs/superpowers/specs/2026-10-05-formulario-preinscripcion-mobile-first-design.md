# Formulario de preinscripción mobile-first

## Objetivo

Rediseñar la experiencia pública de preinscripción para que el celular sea el dispositivo principal: una persona debe poder entender qué necesita, completar el formulario con una mano, adjuntar documentos desde el teléfono y corregir errores sin perderse.

El rediseño conserva los contratos de datos, las validaciones, los documentos obligatorios, la revalidación de la propuesta y el envío actual. Cambia la arquitectura de interacción y presentación del frontend; no cambia el modelo académico ni permite enviar documentos posteriormente.

## Decisiones confirmadas

- La experiencia se diseña primero para anchos de 360–430 px y luego se amplía para tablet/escritorio.
- La trayectoria académica describe a la persona postulante.
- Orientación y mención describen la propuesta de preinscripción y se muestran en una sección separada.
- Orientación y mención solo aparecen cuando WordPress las entrega para el destino.
- Se mantienen los documentos obligatorios y las dos cartas de recomendación obligatorias para Maestría.
- Residencia continúa solicitando país y ciudad, sin domicilio completo.
- La secuencia visual será:
  1. Antes de comenzar.
  2. Datos personales.
  3. Residencia y contacto.
  4. Trayectoria académica.
  5. Sobre esta preinscripción: orientación y mención, cuando correspondan.
  6. Documentación requerida.
  7. Convenios y declaraciones.
  8. Revisión y envío.
- La sección de orientación/mención se omite completamente cuando la propuesta no tiene esas opciones.
- Los `stepId` y las claves canónicas del contrato pueden conservarse; la capa visual puede agrupar o presentar los campos de manera distinta sin alterar la persistencia.

## Experiencia mobile-first

### Antes de comenzar

La pantalla inicial del formulario presenta el nombre de la propuesta, una explicación breve, el tiempo estimado, la cantidad de secciones y una checklist de documentos. El botón principal es “Comenzar preinscripción”. No se muestran todos los campos antes de comenzar.

### Navegación

En móvil se muestra “Paso X de Y”, una barra de progreso y el título de la sección actual. No se usa una fila horizontal de tarjetas de pasos. El botón “Continuar” queda fijo en la parte inferior respetando `env(safe-area-inset-bottom)`; “Atrás” es secundario y nunca se confunde con el envío.

La pantalla desplaza el foco al comienzo de la sección al avanzar y mantiene visible el campo que originó un error. Los pasos anteriores se pueden editar desde el resumen, pero no se permite saltar a una sección no alcanzada sin validar la actual.

### Campos

- Una sola columna en móvil.
- Etiquetas encima del control, ayuda debajo y texto de error asociado mediante `aria-describedby`.
- Controles con altura táctil mínima de 44 px.
- Tipografía de entrada de al menos 16 px para evitar zoom automático en iOS.
- Radios y opciones Sí/No como tarjetas táctiles cuando haya pocas alternativas.
- Campos condicionales aparecen inmediatamente debajo de la respuesta que los activa.
- Los errores se muestran junto al campo y también en un resumen navegable al inicio de la sección.

### Documentos

Cada documento es una tarjeta independiente con etiqueta, obligatoriedad, formatos, tamaño máximo, botón “Agregar archivo”, estado de carga, nombre del archivo, tamaño, reemplazo y eliminación. El control debe permitir seleccionar archivos desde el gestor del teléfono, galería o cámara cuando el navegador lo soporte sin imponer cámara para documentos que ya existen.

La sección muestra avance agregado, por ejemplo “3 de 4 documentos cargados”. Los errores de un archivo no borran otros archivos. Una carga lenta tiene estado visible y no habilita falsamente el envío mientras el archivo siga pendiente.

### Revisión y envío

El resumen final se divide en tarjetas:

- Datos personales.
- Residencia y contacto.
- Trayectoria académica.
- Datos de la preinscripción.
- Documentos.
- Convenios y declaraciones.

Cada tarjeta tiene un botón “Editar” que lleva a su sección. El envío final confirma que los documentos requeridos están cargados y muestra un estado de procesamiento claro. La pantalla de éxito presenta el código de seguimiento con acción de copiar y una explicación breve de los próximos pasos.

## Errores, conexión y privacidad

- La pérdida de foco, teclado o scroll no debe borrar datos ingresados.
- Los errores de validación no deben depender solo del color.
- Un error HTTP conserva los valores y archivos ya cargados, muestra el mensaje seguro y permite reintentar.
- No se agregará guardado silencioso de datos personales en `localStorage`.
- La recuperación automática de un formulario cerrado queda fuera de esta entrega, salvo aprobación posterior de un diseño específico de privacidad y persistencia.
- Se preservan los tokens temporales y los contratos actuales de carga/envío.

## Arquitectura frontend

- `PreinscriptionWizard` conservará el estado de valores, archivos y errores, pero delegará la navegación visual a componentes móviles enfocados.
- `WizardProgress` se convertirá en un indicador compacto de móvil y una navegación más amplia en escritorio.
- `FormStep` seguirá renderizando la definición canónica, pero la presentación diferenciará explícitamente “Trayectoria académica” de “Datos de esta preinscripción”.
- `DocumentUploadFields` se dividirá en tarjetas de documento y estados de carga reutilizables.
- Las funciones de agrupación, progreso documental y resumen de errores serán puras y tendrán pruebas unitarias.
- No se agregará una librería UI ni una dependencia de componentes móviles.

## Criterios de aceptación

1. En 360 px no hay scroll horizontal ni botones cortados.
2. La primera pantalla explica propuesta, tiempo y documentos antes de pedir datos.
3. La trayectoria académica no contiene orientación ni mención.
4. Orientación y mención aparecen en un bloque separado y desaparecen cuando no corresponden.
5. Todos los campos interactivos tienen un área táctil usable y foco visible.
6. Un error de una sección lleva al campo correcto y mantiene los demás valores.
7. Un usuario puede cargar, reemplazar y quitar documentos desde el celular sin perder otros archivos.
8. El resumen final distingue claramente datos personales, trayectoria y datos de la preinscripción.
9. Maestría conserva sus dos cartas obligatorias; los demás documentos y reglas no cambian.
10. Las pruebas existentes de validación, documentos y envío siguen pasando.

## Fuera de alcance

- Cambiar campos o reglas académicas.
- Crear guardado automático o reanudación entre dispositivos.
- Permitir documentos posteriores al envío.
- Cambiar API, base de datos, Google Drive o Google Sheets.
- Rediseñar el catálogo público o la administración.
