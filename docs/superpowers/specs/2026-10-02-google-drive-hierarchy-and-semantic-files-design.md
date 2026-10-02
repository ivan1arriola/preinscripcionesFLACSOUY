# Jerarquía de Google Drive y nombres semánticos — Especificación de diseño

**Fecha:** 2026-10-02  
**Estado:** Diseño aprobado en conversación; pendiente de revisión del documento antes del plan de implementación.

## Objetivo

Implementar la estructura de Google Drive definida en `docs/ARQUITECTURA.md` y hacer que cada archivo de documentación pueda identificarse sin abrirlo. La carpeta raíz seguirá siendo configurable desde `/admin/perfiles` y no se moverán archivos históricos.

## Decisiones de diseño

### 1. Estructura de carpetas

La aplicación utilizará el identificador de la carpeta raíz guardado en `system_settings` y creará, bajo demanda, las carpetas que falten.

Para una oferta académica:

```text
<raíz>/Ofertas académicas/<nombre de la oferta>/<nombre de la cohorte>/
  ├── Preinscripciones/
  └── Documentación/
```

Para un seminario:

```text
<raíz>/Seminarios/<nombre del seminario>/<nombre de la edición>/
  ├── Preinscripciones/
  └── Documentación/
```

Los nombres de oferta, cohorte, seminario y edición provienen del catálogo de WordPress. Si el catálogo solamente proporciona un número, se usarán los prefijos `Cohorte <número>` o `Edición <número>`. Si falta una etiqueta de destino necesaria, el envío falla de forma explícita y el archivo temporal se conserva.

La carpeta `Documentación` es el destino de los archivos cargados. `Preinscripciones` se crea como parte de la estructura institucional, pero no recibe archivos de documentación.

La aplicación buscará primero una carpeta hija existente con el mismo nombre y tipo. Solo creará la carpeta cuando no exista. Los identificadores de Drive y el `targetId` se conservarán en metadatos técnicos del archivo; no se incorporarán a los nombres visibles de las carpetas.

### 2. Nombre semántico de los archivos

El nombre tendrá esta forma:

```text
apellidos-<apellidos disponibles>__nombres-<nombres disponibles>__<tipo-documento>__<id-solicitud>.<extensión>
```

Ejemplos:

```text
apellidos-perez-gomez__nombres-ana-maria__cv__8f31....pdf
apellidos-perez__nombres-ana__titulo__8f31....pdf
apellidos-perez__nombres-ana__carta-recomendacion-1__8f31....pdf
```

El primer apellido y el primer nombre son obligatorios en el formulario. El segundo apellido y el segundo nombre se agregan únicamente si tienen contenido; nunca se generan segmentos o separadores vacíos. Si por una carga antigua o una integración faltara el nombre, se utilizará `postulante` como respaldo.

La normalización de cada segmento será determinista: se eliminan acentos, se pasa a minúsculas, se reemplazan espacios y caracteres no alfanuméricos por guiones, se colapsan guiones repetidos y se limita la longitud razonable del segmento. El tipo de documento se deriva de la clave estable del perfil, no de una etiqueta editable por el administrador. La extensión se conserva desde el nombre original y, si no existe, se infiere del MIME permitido.

El identificador de la solicitud garantiza que dos personas con el mismo nombre no colisionen. El nombre original se conservará en `appProperties` junto con:

- `flacsoSubmissionId`;
- `flacsoFileToken`;
- `flacsoTargetId`;
- `flacsoTargetKind`;
- `flacsoDocumentKey`;
- `flacsoOriginalName`.

### 3. Flujo de envío y errores

1. Al seleccionar un archivo, se guarda temporalmente en el servidor.
2. Al enviar la solicitud, se revalida el destino académico.
3. Se resuelve o crea la jerarquía de carpetas.
4. Se sube cada archivo renombrado a `Documentación`.
5. Solo después de completar correctamente la subida se elimina el archivo temporal.

Si falla la creación de carpetas o la subida, la solicitud responde con error y los archivos temporales se conservan. Las carpetas creadas parcialmente no se eliminan automáticamente: son estructura válida y pueden reutilizarse en un reintento.

Los archivos que ya se encuentran directamente en la carpeta raíz no se migran ni se renombran en este cambio. La nueva jerarquía aplica a nuevos envíos.

## Interfaces afectadas

- El comando del puerto de Google Drive deberá recibir el contexto de destino y el campo documental, además del contenido del archivo.
- La implementación de Google Drive deberá resolver carpetas mediante consultas `files.list` y creación `files.create`, usando la cuenta de servicio configurada.
- La ruta de envío deberá pasar el destino revalidado y los valores necesarios para construir el nombre semántico.
- La generación del nombre y la normalización de segmentos serán funciones puras y testeables sin red.

## Seguridad y privacidad

- Nunca se expondrán credenciales ni valores de `.env`.
- La cuenta de servicio seguirá siendo la única identidad usada para Drive.
- Los archivos permanecerán privados según los permisos de la carpeta configurada.
- Los nombres contienen datos personales porque la carpeta es institucional y privada; el identificador técnico adicional permite trazabilidad sin depender únicamente del nombre.
- Se mantendrán los límites actuales de tamaño y tipos MIME.

## Criterios de aceptación

- Un envío académico termina en `Ofertas académicas/<oferta>/<cohorte>/Documentación`.
- Un envío de seminario termina en `Seminarios/<seminario>/<edición>/Documentación`.
- La estructura incluye las carpetas `Preinscripciones` y `Documentación`.
- Los nombres omiten correctamente segundo apellido y segundo nombre cuando están vacíos.
- Dos envíos con el mismo nombre generan archivos diferentes.
- Se conservan `flacsoOriginalName` y los identificadores técnicos en metadatos.
- El archivo temporal se elimina solamente después de una subida exitosa.
- Los archivos históricos no se modifican.
- Los tests, el typecheck y el build pasan.
