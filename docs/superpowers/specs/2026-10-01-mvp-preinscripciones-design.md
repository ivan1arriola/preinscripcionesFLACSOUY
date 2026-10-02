# MVP de Preinscripciones: diseño técnico

## Estado

Diseño aprobado por la persona solicitante el 2026-10-01. La implementación queda pendiente de un plan técnico posterior.

## Objetivo

Construir un MVP local de la plataforma de preinscripciones que permita descubrir destinos académicos desde una fuente simulada de WordPress, generar formularios dinámicos y procesar envíos simulados mediante una interfaz web.

El MVP debe validar la arquitectura y el contrato de integración antes de conectar WordPress, Google Sheets y Google Drive reales.

## Alcance del MVP

El MVP incluirá:

- una interfaz web React visible;
- un backend HTTP Node.js;
- TypeScript en todo el código de aplicación, frontend, backend, contratos, fixtures, pruebas y scripts;
- ejecución reproducible mediante Docker Compose;
- fixtures locales que simulan el contrato REST de WordPress;
- descubrimiento de ofertas académicas, cohortes, seminarios y ediciones;
- estado abierto o cerrado de cada destino;
- composición dinámica de formularios a partir de inputs universales y específicos;
- orientaciones y menciones estructuradas, incluyendo su relación;
- validación cliente y servidor;
- registro simulado de envíos en PostgreSQL;
- diagnóstico básico de configuraciones incompatibles;
- pruebas automatizadas de dominio, API y frontend.

Queda fuera de este MVP:

- conexión real con WordPress;
- Google Sheets;
- Google Drive;
- carga real de documentos;
- autenticación administrativa;
- panel administrativo completo;
- workers de expiración de archivos;
- envío de correos;
- catálogo académico editable desde la aplicación.

## Restricciones técnicas

### Docker

La aplicación se ejecutará mediante Docker Compose. Como mínimo se contemplan:

- un contenedor para el frontend React;
- un contenedor para la API Node.js;
- un contenedor PostgreSQL;
- un volumen persistente para PostgreSQL.

Las fixtures de WordPress podrán ser leídas por la API desde un volumen o desde el código empaquetado. No se requiere un cuarto contenedor para WordPress simulado en esta etapa.

### TypeScript

No se escribirá JavaScript de aplicación separado. Frontend, backend, dominio, contratos, adaptadores, scripts que carguen fixtures, pruebas y herramientas del proyecto usarán TypeScript. Los datos de fixtures podrán estar representados en JSON.

Los archivos declarativos inevitables, como `package.json`, `tsconfig` y configuración de Docker, no constituyen lógica de aplicación.

### Arquitectura por capas

La solución tendrá las siguientes capas:

```text
Presentación
  React + TypeScript
  API HTTP + TypeScript

Aplicación
  Casos de uso y orquestación

Dominio
  Entidades, value objects y reglas de negocio
  Funciones puras

Puertos
  Contratos de catálogo y persistencia

Infraestructura
  Fixtures, PostgreSQL, repositorios y Docker
```

Las dependencias apuntarán hacia el dominio. La presentación no accederá directamente a fixtures ni a PostgreSQL. El dominio no dependerá de React, Express, PostgreSQL, Docker, filesystem ni variables de entorno.

### Funciones puras

La lógica de dominio se implementará como funciones puras siempre que sea posible. No tendrán efectos secundarios ni dependerán de reloj, red, filesystem, base de datos o variables de entorno.

Se contemplan como funciones puras:

- composición y ordenamiento de formularios;
- validación de claves soportadas;
- validación de obligatoriedad;
- validación de orientación y mención;
- normalización de valores;
- transformación de un envío en valores persistibles;
- cálculo del diagnóstico de un destino.

Los efectos secundarios quedarán en adaptadores y casos de uso.

### Base de datos y 3FN

PostgreSQL será la persistencia simulada de los envíos y del estado técnico mínimo. Todo modelo persistido deberá estar diseñado en tercera forma normal.

El modelo inicial separará, como mínimo, conceptos equivalentes a:

- `targets`;
- `input_definitions`;
- `target_inputs`;
- `orientations`;
- `mentions`;
- `orientation_mentions`;
- `submissions`;
- `submission_values`.

Las relaciones muchos-a-muchos tendrán tablas propias. No se almacenará como columnas repetidas una lista de inputs, orientaciones o menciones. Los datos derivados no se persistirán si pueden calcularse desde relaciones normalizadas.

## Modelo de integración simulado

La aplicación definirá el puerto `AcademicCatalog`, que representa el catálogo académico sin conocer su origen.

La implementación del MVP será `FixtureAcademicCatalog`, que leerá respuestas JSON locales con un contrato equivalente al endpoint agregado de WordPress:

```http
GET /wp-json/flacso/v1/preinscripciones
```

Las fixtures deberán incluir al menos:

- una oferta académica abierta;
- una oferta cerrada;
- un seminario abierto;
- inputs universales y específicos;
- una orientación con menciones relacionadas;
- un caso incompatible con una clave de input desconocida.

La futura implementación `WordPressAcademicCatalog` reemplazará al adaptador de fixtures sin modificar el dominio, los casos de uso ni el frontend.

## API del MVP

La API propia de la aplicación expondrá, como mínimo:

```http
GET /api/targets
GET /api/targets/:id
POST /api/targets/:id/submissions
GET /api/health
```

`GET /api/targets` devolverá destinos descubiertos y su estado resumido.

`GET /api/targets/:id` devolverá la definición completa del formulario, incluyendo inputs, obligatoriedad, orientaciones y menciones.

`POST /api/targets/:id/submissions` volverá a consultar el catálogo, comprobará que el destino siga abierto, validará el payload y almacenará un envío simulado en PostgreSQL.

El frontend no confiará únicamente en la validación cliente.

## Interfaz React

La interfaz tendrá como mínimo:

- listado de destinos disponibles;
- identificación visual de destinos abiertos y cerrados;
- vista de formulario dinámico;
- controles para inputs universales y específicos;
- selección de orientación y mención dependiente;
- mensajes de validación;
- confirmación de envío simulado;
- mensaje de incompatibilidad cuando el destino contenga un input desconocido.

React consumirá la API propia y no conocerá fixtures, tablas ni adaptadores.

## Flujo principal

```text
Fixture de WordPress
        ↓
FixtureAcademicCatalog
        ↓
Caso de uso de descubrimiento
        ↓
API de targets
        ↓
React renderiza el formulario
        ↓
Usuario envía datos
        ↓
API vuelve a consultar y validar el catálogo
        ↓
Caso de uso de envío
        ↓
SubmissionRepository
        ↓
PostgreSQL 3FN
```

Un destino cerrado o incompatible no podrá aceptar envíos.

## Manejo de errores

Los errores de contrato se tratarán de forma explícita:

- clave de input desconocida: destino incompatible y respuesta de error segura;
- destino inexistente: HTTP 404;
- destino cerrado: respuesta de conflicto o validación de negocio;
- payload inválido: HTTP 400 con errores por campo;
- falla de persistencia: error técnico sin exponer detalles internos.

No se devolverán secretos, credenciales ni información sensible innecesaria.

## Verificación y criterios de aceptación

El MVP se considerará implementado cuando:

1. `docker compose up` levante frontend, API y PostgreSQL.
2. La interfaz React liste los destinos provenientes de fixtures.
3. Un destino abierto muestre un formulario generado dinámicamente.
4. Un destino cerrado no permita enviar.
5. Orientaciones y menciones respeten su relación.
6. Las claves desconocidas produzcan un diagnóstico de incompatibilidad.
7. El backend valide nuevamente el catálogo durante el envío.
8. Un envío válido quede registrado en PostgreSQL.
9. El modelo de PostgreSQL cumpla 3FN y tenga restricciones de integridad.
10. La lógica de dominio tenga pruebas unitarias como funciones puras.
11. La API tenga pruebas de contrato y casos de error.
12. El frontend tenga pruebas del listado, formulario, validación y confirmación.
13. La aplicación no dependa de una conexión real a WordPress, Sheets o Drive.

## Evolución posterior

Después de validar este MVP se podrá sustituir, de forma incremental:

- `FixtureAcademicCatalog` por `WordPressAcademicCatalog`;
- `SubmissionRepository` simulado por repositorios de Google Sheets y Google Drive;
- la persistencia de documentos simulados por almacenamiento temporal y Drive;
- el diagnóstico básico por el panel administrativo completo.

Estas sustituciones no deben exigir trasladar reglas de negocio al frontend ni duplicar el catálogo académico en PostgreSQL.
