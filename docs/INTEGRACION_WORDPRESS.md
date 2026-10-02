# Integración del plugin FLACSO con Preinscripciones

> [!IMPORTANT]
> **Actualización Arquitectónica (2026-10-02):**
> La titularidad de los inputs, pasos y documentos ha sido desacoplada de WordPress hacia **Perfiles de Formulario Versionados e Inmutables** gestionados en PostgreSQL de Preinscripciones (`apps/api`).
> WordPress es la fuente de verdad **académica** (`tipo de oferta`, `título`, `fechas/apertura`, `orientaciones`, `menciones` independientes).
> Las secciones históricas de este documento que describían la configuración de inputs por cohorte en WordPress quedan superadas por los perfiles versionados (`maestria`, `especializacion`, `diplomado`, `diploma`, `seminar`).

## 1. Objetivo

El plugin de FLACSO Uruguay debe exponer a la nueva plataforma de Preinscripciones toda la configuración académica necesaria para descubrir y construir formularios sin que Preinscripciones tenga que conocer de antemano qué ofertas académicas o seminarios existen.

La regla principal es:

> **WordPress decide qué ofertas existen, sus atributos académicos y si están abiertas. Preinscripciones define el perfil de formulario según el tipo de oferta, administra sus versiones e interpreta, muestra, valida y almacena los envíos.**

WordPress es la fuente de verdad para:

- ofertas académicas y su tipo (`maestria`, `especializacion`, `diplomado`, `diploma`);
- cohortes;
- seminarios;
- ediciones;
- apertura o cierre de preinscripciones;
- orientaciones (opciones independientes de texto);
- menciones (opciones independientes de texto).

Preinscripciones no debe mantener una lista autoritativa paralela de ofertas ni formularios.

---

# 2. Alcance del cambio en el plugin

El plugin debe incorporar tres capacidades:

1. **Configurar el formulario de preinscripción** en cohortes y ediciones.
2. **Mantener orientaciones y menciones** de forma estructurada cuando correspondan.
3. **Exponer un contrato REST estable** consumible por la nueva aplicación.

El plugin no debe implementar:

- renderizado de formularios públicos;
- validadores técnicos de la nueva app;
- reglas de escritura en Google Sheets;
- subida de archivos a Drive;
- lógica de sesiones temporales;
- tipos HTML concretos de los inputs.

---

# 3. Catálogo de claves de input conocidas por WordPress

La aplicación de Preinscripciones tendrá el catálogo técnico autoritativo de inputs en código.

Sin embargo, WordPress necesita conocer las **claves disponibles** para poder ofrecerlas en el editor administrativo.

El plugin debe tener un catálogo pequeño de claves y nombres administrativos, por ejemplo:

```php
function flacso_preinscripciones_available_fields(): array {
    return [
        'documento'        => 'Documento',
        'fechaNacimiento'  => 'Fecha de nacimiento',
        'titulo'           => 'Título',
        'escolaridad'      => 'Escolaridad',
        'orientacion'      => 'Orientación',
        'mencion'          => 'Mención',
        'institucion'      => 'Institución',
        'ocupacion'        => 'Ocupación',
    ];
}
```

Este catálogo sirve exclusivamente para:

- mostrar opciones en wp-admin;
- impedir guardar claves arbitrarias;
- serializar una configuración válida hacia la API REST.

WordPress **no** define para esas claves:

- tipo HTML;
- etiqueta pública definitiva;
- regex;
- normalización;
- nombre de columna de Sheets;
- comportamiento de validación.

Eso vive en el catálogo de inputs del código de Preinscripciones.

## 3.1. Inputs universales

Los inputs universales se agregan automáticamente desde Preinscripciones y no necesitan configurarse en cada oferta.

Ejemplo conceptual inicial:

```text
nombre
apellido
email
telefono
```

La lista definitiva pertenece al código de Preinscripciones.

Por tanto, wp-admin muestra únicamente los campos específicos seleccionables.

---

# 4. Dónde vive la configuración del formulario

La configuración concreta debe pertenecer al **destino de preinscripción**, no únicamente a la entidad académica general.

## 4.1. Ofertas académicas

```text
Oferta académica
└── Cohorte
    └── Configuración de preinscripción
```

La cohorte determina:

- si está abierta;
- qué inputs específicos usa;
- orden;
- obligatoriedad;
- orientaciones y menciones aplicables.

Esto permite que dos cohortes de la misma oferta tengan formularios diferentes.

Ejemplo:

```text
DAVIA
├── Cohorte 10
│   └── formulario anterior
└── Cohorte 11
    └── formulario con orientación + mención
```

## 4.2. Seminarios

```text
Seminario
└── Edición
    └── Configuración de preinscripción
```

La edición determina:

- si está abierta;
- qué inputs específicos usa;
- orden;
- obligatoriedad.

## 4.3. Herencia

La arquitectura puede soportar en el futuro valores por defecto en Oferta/Seminario heredados por Cohorte/Edición.

Sin embargo, para la primera versión se recomienda:

> **Guardar la configuración efectiva directamente en Cohorte o Edición.**

Esto evita ambigüedades durante la primera implementación.

La herencia puede añadirse después si existe una necesidad operativa real.

---

# 5. Interfaz administrativa en WordPress

Dentro del editor de Cohorte y Edición debe existir una sección dedicada:

```text
Preinscripciones

Estado
[✓] Preinscripciones abiertas

Campos específicos del formulario

≡ Documento                 Obligatorio ✓
≡ Fecha de nacimiento       Obligatorio ✓
≡ Orientación               Obligatorio ✓
≡ Mención                   Obligatorio ☐
≡ Título                    Obligatorio ✓
≡ Escolaridad               Obligatorio ✓

[+ Agregar campo]
```

La interfaz debe permitir:

- seleccionar claves del catálogo permitido;
- agregar o quitar campos;
- reordenarlos;
- definir obligatoriedad;
- impedir claves duplicadas;
- impedir claves inexistentes.

No debe permitir editar:

- tipo del input;
- nombre de columna de Sheets;
- validaciones técnicas;
- semántica.

---

# 6. Modelo de configuración

Ejemplo conceptual persistido en WordPress:

```json
[
  {
    "key": "documento",
    "position": 10,
    "required": true
  },
  {
    "key": "fechaNacimiento",
    "position": 20,
    "required": true
  },
  {
    "key": "orientacion",
    "position": 30,
    "required": true
  },
  {
    "key": "mencion",
    "position": 40,
    "required": false
  }
]
```

## 6.1. Overrides permitidos

Inicialmente:

- `position`;
- `required`;
- eventualmente `enabled`, si aparece una necesidad concreta.

No permitir:

- cambiar `key`;
- definir `type`;
- definir `spreadsheetColumn`;
- sobreescribir validaciones estructurales.

---

# 7. Orientaciones y menciones

Orientación y mención deben ser datos estructurados.

Si existe relación entre ambas, WordPress debe conservarla explícitamente.

Ejemplo:

```text
Orientación Educación
├── Mención Tecnología educativa
└── Mención Gestión educativa

Orientación Políticas públicas
└── Mención Gestión pública
```

La API no debe devolver únicamente dos listas desconectadas si una mención depende de una orientación.

Ejemplo REST:

```json
{
  "orientations": [
    {
      "id": "educacion",
      "name": "Educación",
      "mentions": [
        {
          "id": "tecnologia-educativa",
          "name": "Tecnología educativa"
        },
        {
          "id": "gestion-educativa",
          "name": "Gestión educativa"
        }
      ]
    }
  ]
}
```

Preinscripciones usa esos datos como opciones dinámicas y vuelve a validar la combinación al recibir el POST definitivo.

---

# 8. Contrato REST

El plugin debe exponer una API específica para Preinscripciones en vez de obligar a la app a conocer Custom Post Types, nombres de metadatos o estructura interna del plugin.

## 8.1. Endpoint agregado recomendado

```http
GET /wp-json/flacso/v1/preinscripciones
```

Debe devolver todos los destinos de preinscripción relevantes.

Ejemplo conceptual:

```json
{
  "targets": [
    {
      "id": "davia-c11",
      "kind": "academic_offer",
      "offer": {
        "id": 12295,
        "slug": "davia",
        "name": "Diploma ..."
      },
      "cohort": {
        "id": 1234,
        "number": 11
      },
      "registrationOpen": true,
      "form": {
        "inputs": [
          {
            "key": "documento",
            "position": 10,
            "required": true
          },
          {
            "key": "orientacion",
            "position": 20,
            "required": true
          },
          {
            "key": "mencion",
            "position": 30,
            "required": false
          }
        ]
      },
      "orientations": [
        {
          "id": "educacion",
          "name": "Educación",
          "mentions": [
            {
              "id": "tecnologia-educativa",
              "name": "Tecnología educativa"
            }
          ]
        }
      ],
      "urls": {
        "public": "https://flacso.edu.uy/...",
        "wordpress": "https://flacso.edu.uy/...",
        "edit": "https://flacso.edu.uy/wp-admin/..."
      }
    }
  ]
}
```

## 8.2. Seminarios

Ejemplo:

```json
{
  "id": "seminario-44-edicion-3",
  "kind": "seminar",
  "seminar": {
    "id": 44,
    "slug": "seminario-ejemplo",
    "name": "Seminario ejemplo"
  },
  "edition": {
    "id": 3,
    "name": "Edición 2027-01"
  },
  "registrationOpen": true,
  "form": {
    "inputs": [
      {
        "key": "institucion",
        "position": 10,
        "required": false
      }
    ]
  },
  "urls": {
    "public": "https://flacso.edu.uy/...",
    "wordpress": "https://flacso.edu.uy/...",
    "edit": "https://flacso.edu.uy/wp-admin/..."
  }
}
```

## 8.3. Endpoints específicos opcionales

Además del endpoint agregado se pueden exponer:

```http
GET /wp-json/flacso/v1/preinscripciones/ofertas
GET /wp-json/flacso/v1/preinscripciones/ofertas/{id}
GET /wp-json/flacso/v1/preinscripciones/cohortes/{id}

GET /wp-json/flacso/v1/preinscripciones/seminarios
GET /wp-json/flacso/v1/preinscripciones/seminarios/{id}
GET /wp-json/flacso/v1/preinscripciones/ediciones/{id}
```

La aplicación puede usar el agregado para descubrimiento y los específicos para revalidaciones puntuales.

---

# 9. Identificadores

Cada destino debe tener un ID estable que no dependa del nombre visible.

Ejemplos conceptuales:

```text
davia-c11
seminario-44-edicion-3
```

El contrato debe incluir además IDs nativos de WordPress para permitir enlaces, diagnóstico y consultas específicas.

Renombrar una oferta, cohorte o edición no debe cambiar la identidad lógica del destino.

---

# 10. URLs operativas

La API debe devolver cuando sea posible:

- URL pública de la oferta/seminario;
- URL de edición en wp-admin;
- URL canónica de WordPress.

La app de Preinscripciones agregará sus propios enlaces:

- formulario público de Preinscripciones;
- Spreadsheet;
- carpeta Drive;
- carpeta de documentación.

Así el panel admin de Preinscripciones puede funcionar como punto central de navegación.

---

# 11. Compatibilidad y validación

## 11.1. Defensa en WordPress

El plugin debe impedir guardar una clave que no pertenezca al catálogo permitido.

## 11.2. Defensa en Preinscripciones

Preinscripciones también debe validar todas las claves recibidas.

Si WordPress devuelve:

```text
experiencia_profesional
```

y ese input no está soportado por el código de la app:

1. no se genera un control genérico;
2. el formulario queda marcado como incompatible;
3. el panel admin muestra el input desconocido;
4. se registra un error técnico;
5. el formulario no acepta preinscripciones hasta corregir la incompatibilidad.

Esto protege frente a versiones desalineadas del plugin y de la app.

---

# 12. Descubrimiento automático

No existe un alta manual de ofertas en PostgreSQL.

El flujo esperado es:

```text
Se crea una nueva oferta/cohorte o seminario/edición en WordPress
        ↓
Se configura su formulario con claves soportadas
        ↓
La API comienza a devolver el nuevo target
        ↓
Preinscripciones lo descubre
        ↓
Resuelve catálogo de inputs
        ↓
Diagnostica estructura Sheets/Drive
        ↓
Formulario operativo
```

PostgreSQL puede cachear el payload de WordPress, pero no decide si el target existe ni qué inputs utiliza.

---

# 13. Sincronización entre plugin y app

El catálogo de claves existe en dos lugares con responsabilidades diferentes:

### Plugin

Conoce las claves que puede ofrecer en wp-admin.

### Preinscripciones

Conoce la implementación técnica completa de cada clave.

Por eso ambos proyectos deben considerar las claves de input como un **contrato versionado**.

Una nueva clave requiere:

1. implementar el input en Preinscripciones;
2. agregar la clave al catálogo del plugin;
3. desplegar ambas versiones de forma compatible;
4. recién entonces utilizarla en una Cohorte o Edición.

No se debe habilitar desde WordPress una clave que la app desplegada todavía no soporte.

---

# 14. Diagnóstico esperado en Preinscripciones

Para cada target recibido de WordPress:

```text
DAVIA · Cohorte 11

WordPress
✓ Target encontrado
✓ Preinscripción abierta
✓ Inputs reconocidos: 6/6
✓ Orientaciones válidas
✓ Menciones válidas

Google Drive
✓ Estructura disponible

Google Sheets
✓ Spreadsheet disponible
✓ Headers requeridos presentes

Enlaces
→ Formulario
→ WordPress
→ Editar en WordPress
→ Spreadsheet
→ Drive

Resultado
✓ Operativo
```

Si existe una incompatibilidad:

```text
MG · Cohorte 9

ERROR
Input no soportado:
experiencia_profesional
```

---

# 15. Criterios de aceptación del cambio en el plugin

La integración del plugin se considera suficiente cuando:

1. una Cohorte puede activar/desactivar preinscripciones;
2. una Edición puede activar/desactivar preinscripciones;
3. una Cohorte puede seleccionar y ordenar inputs específicos;
4. una Edición puede seleccionar y ordenar inputs específicos;
5. cada input puede marcarse obligatorio cuando el contrato lo permite;
6. solo se pueden elegir claves registradas;
7. no se pueden duplicar claves;
8. orientaciones y menciones se exponen estructuradamente;
9. se conserva la relación orientación → menciones cuando exista;
10. el endpoint REST agregado devuelve ofertas/cohortes y seminarios/ediciones;
11. cada target contiene configuración de formulario;
12. cada target contiene su estado abierto/cerrado;
13. cada target expone URLs operativas;
14. una nueva Cohorte/Edición puede ser descubierta por Preinscripciones sin alta manual;
15. el contrato REST no obliga a Preinscripciones a conocer internamente los CPT o metadatos del plugin.

---

# 16. Regla final de responsabilidad

```text
PLUGIN FLACSO / WORDPRESS
─────────────────────────
Qué existe
Qué está abierto
Qué inputs pide cada target
En qué orden
Qué orientación/mención es válida

PREINSCRIPCIONES
────────────────
Qué significa cada input
Cómo se muestra
Cómo se valida
Cómo se normaliza
Cómo se escribe en Sheets/Drive
```

El plugin publica configuración académica. La aplicación ejecuta esa configuración.
