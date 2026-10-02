# Formularios completos de preinscripción

## Objetivo

Adaptar la nueva aplicación de preinscripciones para cubrir los campos del
formulario público anterior, manteniendo la lógica dinámica por destino y
agregando carga temporal de archivos con transferencia final a Google Drive.

## Alcance funcional

### Campos universales

Todos los destinos podrán solicitar estos campos, con su etiqueta, tipo,
orden y obligatoriedad definidos por la aplicación:

- correo electrónico;
- primer nombre y segundo nombre;
- primer apellido y segundo apellido;
- fecha de nacimiento;
- tipo, número y país emisor del documento;
- identidad de género;
- raza/etnia;
- celular;
- domicilio;
- ocupación;
- país de nacimiento y país de residencia;
- convenio;
- cómo conoció la propuesta;
- autorización de difusión;
- estudios cursados;
- si cursó un posgrado en FLACSO;
- cuál posgrado.

Las preguntas dependientes se resuelven en la interfaz y se vuelven a
validar en el backend: convenio, detalle del posgrado e identidad de género.

### Configuración por destino

Las ofertas académicas pueden configurar independientemente:

- orientación;
- mención;
- documentos requeridos.

Orientación y mención son listas independientes. Ambas se obtienen de la
configuración de la oferta académica y no existe una relación de dependencia
entre ellas.

Los seminarios no exponen orientación ni mención. Sus ediciones solo exponen
los campos universales y los documentos configurados para esa edición.

Los documentos configurables son:

- documento de identidad;
- curriculum vitae;
- título;
- carta de motivación;
- primera carta de recomendación;
- segunda carta de recomendación.

Cada documento tendrá etiqueta, obligatoriedad, cantidad máxima, tamaño
máximo y tipos MIME permitidos. Las cartas podrán admitir la regla de
adjuntar después cuando el destino así lo defina.

## Flujo de archivos

1. Al seleccionar cada archivo, el navegador lo envía al endpoint de carga
   temporal.
2. El servidor lo guarda en almacenamiento privado y devuelve un token
   temporal asociado a la sesión, al destino y al campo.
3. La pantalla conserva ese token y permite reemplazar o quitar el archivo.
4. Al enviar la preinscripción, el backend revalida el destino, la revisión
   de configuración y todos los archivos.
5. El backend transfiere los archivos temporales a la carpeta de Google Drive
   correspondiente al destino y a la solicitud.
6. Solo después de confirmar la transferencia se elimina cada archivo
   temporal del servidor.
7. Si Drive falla, los temporales no se eliminan: la solicitud queda marcada
   para reintento y no se pierde documentación.
8. Un proceso de limpieza elimina temporales vencidos que nunca llegaron a
   una solicitud válida.

No se expondrán URLs públicas de archivos temporales ni se eliminará un
temporal antes de tener confirmación de Drive. La operación final debe ser
idempotente para no crear duplicados ante reintentos.

## Contrato WordPress–app

La extensión del REST v1 será aditiva. Se conservarán `inputs`,
`configRevision` y la revalidación durante el envío. El formulario podrá
recibir además una sección de documentos y dos colecciones independientes:

```json
{
  "form": {
    "valid": true,
    "inputs": [],
    "orientations": [],
    "mentions": [],
    "documents": []
  }
}
```

Para ofertas académicas, orientación y mención se resolverán desde la oferta
padre. Para seminarios esas colecciones estarán vacías.

## Persistencia y sincronización

La solicitud conservará los valores enviados, la revisión de configuración,
los metadatos de los archivos, el identificador de Drive y el estado de cada
operación de sincronización. La confirmación al postulante solo se emitirá
cuando la solicitud y la transferencia de archivos hayan quedado registradas
de forma consistente.

## Verificación

Se cubrirán con pruebas:

- composición y orden de todos los campos universales;
- reglas condicionales;
- orientación y mención independientes;
- ausencia de esos campos en seminarios;
- configuración de documentos por destino;
- rechazo de archivos inválidos;
- conservación temporal ante error de Drive;
- eliminación posterior a una transferencia confirmada;
- reintentos idempotentes;
- revalidación de `configRevision` y del estado abierto/cerrado.

La validación final incluirá el contrato del plugin, la app, una carga real de
prueba a Drive y una revisión visual del flujo público.
