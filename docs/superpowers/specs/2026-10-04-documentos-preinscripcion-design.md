# Documentos de la preinscripción

## Objetivo

Completar el flujo documental de `preinscripcionesFLACSOUY` con las reglas
vigentes del formulario público. La aplicación recibirá archivos durante el
asistente, los conservará en almacenamiento temporal y los enviará a Google
Drive cuando la persona confirme la preinscripción.

El desarrollo reutilizará los puertos y adaptadores TypeScript existentes. El
proyecto Django en `Migrar/preinscripcionesFLACSO` sirve como referencia
funcional, pero su código y sus modelos no se trasladarán al proyecto nuevo.

## Alcance

El cambio comprende:

- la definición canónica de documentos por tipo de propuesta;
- la interfaz de carga y sus alternativas;
- las validaciones del navegador y del servidor;
- el almacenamiento temporal;
- la persistencia final en Drive y Sheets;
- el registro de estados de procesamiento y archivos;
- las pruebas de dominio, API e interfaz.

El cambio no incorporará una pantalla para completar documentos después del
envío. El equipo recibirá por correo las recomendaciones que la persona haya
marcado para entrega posterior.

## Matriz documental

| Requisito | Ofertas no maestría | Maestrías | Seminarios |
| --- | --- | --- | --- |
| Documento de identidad | Obligatorio | Obligatorio | Obligatorio |
| Curriculum Vitae | Obligatorio | Obligatorio | Obligatorio |
| Título de grado o terciario | Obligatorio o declaración de ausencia | Obligatorio o declaración de ausencia | Obligatorio o declaración de ausencia |
| Carta de motivación | Obligatoria | Obligatoria | No corresponde |
| Carta de recomendación 1 | No corresponde | Archivo o entrega posterior | No corresponde |
| Carta de recomendación 2 | No corresponde | Archivo o entrega posterior | No corresponde |

`Escolaridad` no forma parte del formulario. El título consta de una
denominación y un archivo. Ambos campos representan un solo requisito.

## Interfaz del título

La etapa de documentación mostrará un bloque llamado “Título de grado o
terciario”. El bloque contendrá:

- `tituloDenominacion`, con la etiqueta “Denominación del título”;
- el selector de archivo `titulo`;
- el control “No poseo actualmente título”.

El control podrá marcarse y desmarcarse. La interfaz ocultará la denominación y
el archivo mientras permanezca marcado. Si la persona ya había seleccionado un
archivo, el navegador quitará su token de la solicitud y pedirá al servidor que
elimine el temporal. Al desmarcar el control, la interfaz mostrará de nuevo los
dos campos vacíos y obligatorios.

La solicitud guardará `sinTituloActual=Si` cuando la persona use la alternativa.
En el caso normal guardará `sinTituloActual=No`, la denominación y el archivo.

## Interfaz de las recomendaciones

Las maestrías mostrarán dos bloques independientes, uno por carta. Cada bloque
permitirá elegir entre “Adjuntar ahora” y “Adjuntar posteriormente”. La persona
podrá cambiar la elección antes de enviar.

“Adjuntar ahora” mostrará el selector y exigirá un archivo. “Adjuntar
posteriormente” ocultará el selector, eliminará cualquier temporal seleccionado
y guardará el estado pendiente. Las claves serán
`cartaRecomendacion1Pendiente` y `cartaRecomendacion2Pendiente`.

El sistema no generará enlaces de carga ni accesos posteriores. Sheets deberá
mostrar qué cartas quedaron pendientes para que el equipo gestione su recepción
por correo.

## Contrato canónico

La definición canónica dejará de publicar el input `escolaridad`. El input de
texto `titulo` pasará a llamarse `tituloDenominacion`, con una columna de Sheets
propia. El documento conservará la clave `titulo`.

`DocumentDefinition` agregará estos campos opcionales:

```ts
interface DocumentAlternative {
  kind: 'absence' | 'defer';
  valueKey: string;
  activeValue: 'Si';
  label: string;
}

interface DocumentDefinition {
  companionInputKey?: string;
  alternative?: DocumentAlternative;
}
```

El título usará `companionInputKey: 'tituloDenominacion'` y una alternativa
`absence` con `valueKey: 'sinTituloActual'`. Las recomendaciones usarán una
alternativa `defer` con las claves `cartaRecomendacion1Pendiente` y
`cartaRecomendacion2Pendiente`.

Estas alternativas afectan la obligatoriedad de este modo:

- una declaración de ausencia para el título;
- una entrega posterior para cada recomendación.

La capa web no decidirá por su cuenta qué documentos corresponden a cada
propuesta. Las funciones puras del dominio compondrán la matriz y validarán las
combinaciones.

Los valores enviados incluirán las declaraciones aunque su valor sea `No`. El
snapshot canónico conservará la versión de estas reglas junto con la
preinscripción.

## Validaciones

El navegador dará respuesta inmediata, pero la API repetirá todas las
validaciones a partir del formulario canónico revalidado.

Reglas por archivo:

- límite de 10 MiB;
- identidad y título: PDF, JPEG, PNG o WebP;
- CV, motivación y recomendaciones: PDF;
- identidad: uno o dos archivos;
- los demás documentos: un archivo por requisito.

La suma de archivos de una preinscripción no podrá superar 25 MiB. La API
rechazará tokens repetidos, campos desconocidos, archivos que pertenezcan a otra
sesión y cantidades que excedan `maxFiles`. La API leerá el nombre, MIME y
tamaño desde el temporal; no confiará en esos datos cuando el navegador los
repita en la solicitud final.

La API aceptará la ausencia del título sólo con `sinTituloActual=Si`. En ese
caso rechazará una combinación que también incluya denominación o archivo. Para
cada recomendación exigirá un archivo o su marca de entrega posterior.

## Ciclo de los archivos temporales

`POST /api/uploads` recibirá `targetId`, `fieldKey` y el archivo. La ruta
revalidará el destino, obtendrá su definición canónica y comprobará que el campo
documental existe para esa propuesta antes de guardar el binario.

La aplicación agregará una operación autenticada por la sesión temporal para
quitar un token. Los controles del título y las recomendaciones usarán esa
operación cuando oculten un archivo ya seleccionado.

El volumen temporal seguirá fuera del directorio público. La aplicación
registrará en PostgreSQL la sesión, los metadatos y su vencimiento. Una limpieza
periódica eliminará sesiones abandonadas después de 30 minutos sin actividad.
Una carga válida renovará la actividad de la sesión.

## Envío final e idempotencia

El navegador generará un identificador estable para cada intento de
preinscripción. La API impondrá su unicidad para que un reintento recupere el
mismo envío en vez de crear otra fila.

La API ejecutará esta secuencia:

1. revalidar apertura, revisión del formulario, datos y tokens;
2. crear o recuperar la preinscripción con estado `pending`;
3. crear la jerarquía de Drive;
4. subir los archivos disponibles y registrar sus identificadores;
5. agregar la fila de Sheets con datos y estados documentales;
6. marcar el procesamiento y los archivos como `success`;
7. eliminar binarios y metadatos temporales;
8. devolver la confirmación.

Sheets tendrá columnas explícitas para `Denominación del título`, `No posee
actualmente título`, `Carta de recomendación 1 pendiente` y `Carta de
recomendación 2 pendiente`. Las columnas de recomendaciones quedarán vacías en
propuestas donde no correspondan.

La jerarquía utilizará la carpeta `Preinscripciones` como padre de
`Documentación`:

```text
Ofertas académicas/<oferta>/<cohorte>/Preinscripciones/Documentación/
Seminarios/<seminario>/<edición>/Preinscripciones/Documentación/
```

Los nombres semánticos existentes conservarán nombre, apellido, tipo documental
e identificador de envío. Las propiedades de Drive permitirán buscar un archivo
ya creado por identificador de envío y token antes de intentar una nueva carga.

## Errores y recuperación

La API mantendrá los temporales si Drive o Sheets falla. También marcará
`submission_processing` y los registros afectados de `submission_files` como
`failed`, con un mensaje técnico acotado. La respuesta pública explicará que el
envío no pudo completarse y permitirá reintentar sin volver a seleccionar los
archivos mientras la sesión no haya vencido.

Un reintento consultará primero PostgreSQL y Drive. La aplicación omitirá los
archivos que ya tengan un `drive_file_id` confirmado y completará las operaciones
pendientes. La API mostrará éxito sólo cuando Drive y Sheets hayan terminado.

La limpieza de temporales ocurrirá después de confirmar ambos destinos. Un
fallo de limpieza posterior no convertirá una preinscripción completada en
fallida; la aplicación registrará el problema para la limpieza periódica.

## Pruebas

Las pruebas de dominio cubrirán la matriz de ofertas, maestrías y seminarios,
incluidas las combinaciones válidas e inválidas del título y las
recomendaciones.

Las pruebas de la interfaz comprobarán:

- ausencia de `Escolaridad`;
- denominación y archivo dentro del bloque del título;
- marcado, ocultamiento, limpieza y desmarcado de “No poseo actualmente título”;
- cambio reversible entre carga inmediata y posterior de cada recomendación;
- documentos visibles para cada tipo de propuesta;
- bloqueo del avance cuando falta un requisito obligatorio.

Las pruebas de API comprobarán formatos, tamaños, totales, pertenencia de
sesión, cantidades y campos admitidos. Las pruebas de integración simularán
éxito y fallos de Drive y Sheets, reintentos idempotentes, actualización de
estados y limpieza de temporales.

La verificación final incluirá pruebas, comprobación de tipos, compilación,
configuración de Docker y un recorrido del formulario en navegador para una
oferta, una maestría y un seminario.

## Criterios de aceptación

El cambio quedará aceptado cuando:

1. ningún formulario muestre `Escolaridad`;
2. todas las propuestas exijan identidad, CV y título o declaración de ausencia;
3. todas las ofertas exijan motivación y los seminarios no la muestren;
4. sólo las maestrías pidan dos recomendaciones y permitan postergarlas;
5. los controles reversibles limpien los temporales ocultos;
6. Drive reciba los archivos al confirmar la preinscripción;
7. Sheets registre la denominación, la ausencia de título y las cartas pendientes;
8. un fallo no borre temporales ni produzca duplicados;
9. la aplicación no ofrezca un flujo posterior de carga documental.
