# Producción y deploy de Preinscripciones FLACSO UY — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instalar `preinscripcionesFLACSOUY` en `servidor-flacso`, conservar la plataforma legacy `InscripcionesFLACSOUruguay` intacta y hacer que `preinscripciones.flacso.edu.uy` publique la nueva aplicación mediante un deploy reproducible desde esta PC.

**Architecture:** La plataforma legacy seguirá ejecutándose con su servicio, código, base de datos y archivos actuales, sin borrado ni migración destructiva. La nueva app se instalará en un directorio independiente, con sus propios servicios, puerto interno, variables y datos; Apache conservará TLS y cambiará únicamente el backend detrás del vhost de `preinscripciones.flacso.edu.uy`. El deploy local publicará un SHA concreto y ejecutará en el servidor una secuencia respaldada, migrable y reversible.

**Tech Stack:** Git/GitHub, SSH alias `servidor-flacso`, Docker Compose para la nueva app, Apache/ISPConfig como reverse proxy y TLS, PostgreSQL, scripts Bash con `set -Eeuo pipefail`.

**Spec:** Esta solicitud del usuario y la evidencia operativa relevada el 2026-10-02.

## Global Constraints

- No eliminar, renombrar ni modificar destructivamente `/srv/apps/InscripcionesFLACSOUruguay`.
- No detener `inscripciones-flacso.service` hasta tener backup, acceso alternativo y rollback probado.
- No copiar `.env`, credenciales OAuth, cuenta de servicio, claves privadas ni secretos al repositorio.
- `preinscripciones.flacso.edu.uy` debe apuntar a la nueva app solamente después de verificar salud local y smoke test.
- El cambio de Apache debe conservar el certificado TLS y permitir rollback exacto al vhost anterior.
- Cada deploy debe asociarse a un SHA de Git y guardar evidencia de migraciones, health check y respuesta pública.
- Las operaciones de producción requieren backup recuperable antes de migraciones o cambio de tráfico.

## Review Focus

- La plataforma legacy sigue respondiendo en su puerto interno y sus datos permanecen intactos; el deploy debe comprobarlo antes y después del cambio de vhost.
- El nuevo contenedor no expone PostgreSQL, API ni archivos privados a Internet; solamente Apache publica el frontend y las rutas necesarias.
- Un deploy fallido antes o después del cambio de tráfico puede volver al vhost legacy sin perder datos ni configuración.
- El dominio, OAuth de Google, WordPress, Drive y Sheets usan las URLs y secretos de producción, no valores locales.
- Un segundo deploy no duplica servicios, migraciones, uploads ni tareas de integración.

### Task 1: Especificar el contrato de instalación en el servidor

**Files:**
- Create: `docs/PRODUCCION.md`
- Modify: `README.md`
- Test: checklist manual de inspección en `servidor-flacso`

**Interfaces:**
- Consume: estado existente de `/srv/apps/InscripcionesFLACSOUruguay`, Apache, systemd y PostgreSQL.
- Produce: nombres definitivos de directorios, servicios, puertos, volúmenes, variables y procedimiento de rollback.

- [ ] Documentar la legacy como instalación preservada y la nueva app en una ruta independiente, por ejemplo `/opt/flacso/preinscripcionesFLACSOUY`.
- [ ] Definir un puerto interno libre para la nueva web/API y comprobar que no colisione con `3200`, `8000` ni `3000`.
- [ ] Definir el volumen y base de datos de la nueva app sin reutilizar automáticamente la base de datos legacy.
- [ ] Definir los nombres de servicio nuevos y su política de reinicio.
- [ ] Documentar los secretos que se cargan únicamente en el servidor y sus permisos.
- [ ] Documentar el rollback: detener nueva app, restaurar vhost legacy, validar Apache y comprobar `inscripciones-flacso.service`.

### Task 2: Preparar el runtime productivo de la nueva aplicación

**Files:**
- Create: `deploy/docker-compose.production.yml`
- Create: `.env.production.example`
- Modify: `docker-compose.yml`
- Test: `docker compose config` y smoke test local con variables no secretas

**Interfaces:**
- Consume: imágenes/builds de `apps/web` y `apps/api`, migraciones existentes y contratos de integración.
- Produce: stack reproducible con frontend, API y PostgreSQL aislados, health checks y almacenamiento persistente.

- [ ] Separar valores locales de producción y eliminar defaults inseguros para PostgreSQL en el camino productivo.
- [ ] Configurar `WORDPRESS_URL`, Google OAuth, cuenta de servicio, Drive, Sheets, `ADMIN_ALLOWED_EMAILS`, cookies seguras y dominio público.
- [ ] Montar secretos como archivos o variables del servidor sin incluirlos en Git.
- [ ] Agregar health checks de API, web y base de datos y una red interna explícita.
- [ ] Definir persistencia para la base nueva y para temporales/uploads, con permisos mínimos.
- [ ] Verificar que Apache sea el único componente accesible desde Internet.

### Task 3: Crear el deploy reproducible desde esta PC

**Files:**
- Create: `scripts/deploy-production.sh`
- Create: `scripts/production-ssh.sh`
- Create: `docs/DEPLOY.md`
- Test: ejecución en modo inspección y validación de shell

**Interfaces:**
- Consume: `git`, SSH alias `servidor-flacso`, Compose productivo y health endpoints.
- Produces: deploy de un SHA explícito, backup previo, migración, restart controlado, smoke tests y salida no exitosa ante cualquier error.

- [ ] Exigir working tree limpio o permitir únicamente cambios explícitamente excluidos; nunca desplegar cambios no identificados.
- [ ] Resolver el SHA a desplegar y mostrarlo antes de modificar el servidor.
- [ ] Ejecutar validaciones locales mínimas antes de subir: tests, typecheck, build y `git diff --check`.
- [ ] En servidor, crear backup con timestamp de base, `.env` y configuración Apache antes de cambiar servicios.
- [ ] Sincronizar solamente el SHA y archivos de runtime requeridos, sin secretos ni directorios generados.
- [ ] Ejecutar migraciones de la nueva app y levantar el stack sin tocar la legacy.
- [ ] Validar health interno, configuración de integración y contenido básico de la web.
- [ ] Cambiar Apache de forma atómica hacia la nueva app, hacer `apachectl configtest` y recargar, no reiniciar a ciegas.
- [ ] Validar HTTPS público, dominio, rutas, login y una ruta de formulario.
- [ ] Emitir un resumen con SHA, timestamps, backup, URL, health y rollback disponible.
- [ ] Añadir modo `--check`/`--dry-run` para inspección sin mutaciones y una opción separada de rollback explícito.

### Task 4: Conservar y exponer la plataforma legacy sin mezclarla con la nueva

**Responsable del cambio de Apache:** Iván lo ejecutará manualmente. El script de deploy no edita vhosts, certificados, DNS ni reglas `ProxyPass`.

**Files:**
- Modify: configuración de Apache/ISPConfig en el servidor, respaldada y documentada.
- Create: vhost o alias legacy únicamente si se aprueba un hostname de acceso.
- Test: smoke test legacy antes y después del cutover.

**Interfaces:**
- Consume: `inscripciones-flacso.service` en `127.0.0.1:3200` y su configuración actual.
- Produce: acceso preservado a la instalación vieja y dominio principal servido por la nueva app.

- [ ] Respaldar el vhost actual de `preinscripciones.flacso.edu.uy` y registrar su SHA/hash.
- [ ] Mantener activo el servicio legacy y verificar que responda localmente con el `Host` esperado.
- [ ] Definir con FLACSO el hostname de consulta de la plataforma vieja, por ejemplo `legacy-preinscripciones.flacso.edu.uy`; no inventarlo ni publicar DNS sin aprobación.
- [ ] Si se crea ese hostname, emitir/instalar certificado TLS y limitarlo según la necesidad de acceso.
- [ ] Cambiar únicamente `ProxyPass`/`ProxyPassReverse` del dominio principal al puerto de la nueva web/API.
- [ ] Verificar que enlaces históricos o documentos de la plataforma vieja no se rompan; si deben seguir públicos, agregar reglas de compatibilidad explícitas.

### Task 5: Ensayo controlado y cutover

**Files:**
- Modify: documentación operativa, no código de negocio salvo hallazgos del ensayo.
- Test: prueba end-to-end controlada.

**Interfaces:**
- Consume: deploy script, nueva app, WordPress, OAuth, Drive y Sheets.
- Produce: evidencia de aceptación o una lista concreta de bloqueos.

- [ ] Ejecutar deploy a un puerto/hostname de staging o prueba interna antes de cambiar el dominio.
- [ ] Probar login Google con `web@flacso.edu.uy` y callback productivo exacto.
- [ ] Leer ofertas desde WordPress y comprobar separación entre ofertas académicas y seminarios.
- [ ] Crear una preinscripción de prueba, cargar documentos y comprobar Sheets/Drive y limpieza temporal.
- [ ] Confirmar que la solicitud de prueba esté identificada y pueda eliminarse o marcarse como prueba sin tocar información histórica.
- [ ] Hacer el cutover en una ventana acordada y observar logs/health durante el primer ciclo.
- [ ] Registrar el resultado y decidir GO/NO-GO.

## Go/No-Go

El cambio de dominio no debe ejecutarse hasta que estén disponibles: backup recuperable, runtime nuevo levantado, rollback probado, secrets productivos cargados, OAuth/WordPress/Drive/Sheets verificados y smoke test end-to-end aprobado. La primera implementación debe detenerse después de preparar el script y la instalación aislada; el cutover de Apache es una acción posterior y explícita.
