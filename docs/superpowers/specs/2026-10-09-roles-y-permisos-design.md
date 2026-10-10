# Roles y permisos (RBAC) — diseño

Fecha: 2026-10-09 · Estado: aprobada por el usuario (09/10) · Rama: `dev`

## 1. Contexto y objetivo

El 09/10 se cerró el acceso abierto (solo por invitación, sin permisos públicos en `public`, MFA para
administración; ver `AGENTLOG.md`, sección "Seguridad de acceso"). La autorización, en cambio, sigue siendo una
escalera de 5 roles globales (`viewer < writer < editor < admin < owner`, `app/routers/roles.py`) con guardias
`require_writer/require_editor/require_admin`:

- un `editor` escribe en todo (viajes, cierres, empresas, documentos, pólizas, tarifas): no hay mínimo privilegio
  por área;
- `writer` es una excepción escrita a mano por campo (`_exigir_campos_permitidos`, `CAMPOS_BASICOS_DEL_DIARIO`);
- los nombres y descripciones hablan del Diario, no de las áreas de WebCarga;
- el owner del sistema y el dueño funcional son la misma figura.

Pedido del usuario: un modelo de roles y permisos **de estándar de industria, sin parches, respetando el diseño
del backend, mantenible, robusto y escalable**.

### Lo que se decidió (usuario, 09/10)

- Estándar: **RBAC de NIST (ANSI/INCITS 359)** — permisos → roles → personas, como Auth0/Okta/AWS IAM/GitHub.
- Áreas de trabajo: **Operaciones, Certificación, Seguros, Comercial/Finanzas** (+ Directorio, ver §4).
- Dos niveles por área: **Operador** y **Supervisor**; más **Lectura**, **Administración**, **Propietario
  (Super admin)** y **Soporte técnico (proveedor)**.
- `closures.sign` (firmar y reabrir el cierre del día) en **Operador y Supervisor** de Operaciones (hoy `writer`
  ya firma). `trips.delete` también en el Operador: hoy `writer` elimina viajes manuales (el servicio sigue
  limitando cuáles); detectado al mapear las rutas para el plan.
- **WebCarga es Propietario; Sumadots es Soporte técnico.** La cuenta de Sumadots sigue como Propietario mientras
  dure la implementación, anotado como transitorio.

### Criterios de éxito

1. Toda ruta de la API declara el permiso que exige; un test falla si una no lo declara (salvo `/health` y
   `GET /me`).
2. El día de la migración **nadie pierde** un permiso respecto de lo que su rol actual le deja hacer, y toda
   ganancia está listada en §9 y aprobada.
3. El frontend no repite reglas: recibe los permisos efectivos de la API.
4. Quitarle un rol a alguien tiene efecto en menos de 1 minuto.
5. Agregar un perfil externo (transportista o cliente con alcance a lo suyo) no obliga a rehacer el modelo.

## 2. Modelo (NIST RBAC)

- **Permisos**: los define la aplicación, en código (cada uno corresponde a acciones que una ruta protege). Se
  sincronizan a la base para mostrarlos y asignarlos. No se crean desde una pantalla.
- **Roles y su composición**: datos. Los roles de sistema se siembran por migración y no se editan ni borran
  desde la pantalla. Un admin puede crear **roles personalizados** combinando permisos existentes.
- **Asignación persona ↔ rol**: datos, auditada. Una persona puede tener varios roles; sus permisos efectivos son
  la unión.

## 3. Modelo de datos

Esquema `app`, identificadores en inglés, RLS habilitada y **sin** permisos para `anon`/`authenticated` (la API se
conecta como `postgres`; ver `20261009170000_invitation_only_access.sql`).

| Tabla | Columnas | Notas |
|---|---|---|
| `app.permissions` | `code text PK` (`closures.sign`), `area text`, `description text`, `privileged boolean` | Espejo del catálogo del código. La API la sincroniza al arrancar (upsert). Un permiso retirado del código que siga asignado hace fallar un test (§8). |
| `app.roles` | `id uuid PK`, `code text UNIQUE` (`operations_supervisor`), `name text`, `description text`, `is_system boolean`, `grants_all boolean` (solo Propietario), `created_by`, `created_at` | `grants_all`: el Propietario tiene todo el catálogo, incluidos permisos futuros, sin lista. |
| `app.role_permissions` | `role_id → roles`, `permission_code → permissions`, PK compuesta | Vacía para el Propietario. |
| `app.user_roles` | `user_id → profiles`, `role_id → roles`, `granted_by`, `granted_at`, PK compuesta | Sin alcance hoy. Perfil externo futuro: columna `scope` (p. ej. empresa) — §10. |

`admin_whitelist` (invitaciones) pasa de `role text` a `role_codes text[]`. `handle_new_user` crea las filas de
`user_roles` al aceptarse la invitación.

`profiles.role` se mantiene durante la transición (expand/contract) y se retira en la etapa 3 (§9).

## 4. Catálogo de permisos

Fuente única: `backend/api/app/authz/permissions.py` (`Enum` con código, área, descripción en español y si es
privilegiado). Cubre las ~110 rutas de escritura actuales.

| Área | Permiso | Rutas que cubre |
|---|---|---|
| Operaciones | `operations.read` | lecturas de viajes, cierres, reportes de estado |
| | `trips.edit_basic` | campos básicos del viaje (toggles, observaciones, teléfono), notas, paradas básicas |
| | `trips.edit_sensitive` | patente, conductor, empresa, vínculo de flota, revertir overrides, asignar conductor |
| | `trips.create` | alta manual y carga masiva |
| | `trips.delete` | eliminar viajes manuales |
| | `closures.declare` | motivos del cierre (`bulk-close/reopen`, `daily-closures`, `equipment-closures`) |
| | `closures.sign` | firmar y reabrir el día (`/closures/{fecha}/close|reopen`) |
| | `operations.configure` | estados, umbrales, temperaturas, reglas de alerta, motivos (taxonomías) |
| Directorio | `directory.read` | empresas, conductores, flota, contactos |
| | `directory.edit` | altas, ediciones, traspasos, contactos |
| | `directory.delete` | bajas |
| Certificación | `certification.read` | registros y catálogo |
| | `documents.upload` | cargar, clasificar, mover, deshacer clasificación (`document-ingest`, archivos) |
| | `documents.review` | aprobar, rechazar, reasignar, solicitar documentos |
| | `certification.configure` | requisitos, reglas de vencimiento, cambios en lote |
| Seguros | `insurance.read` | pólizas, coberturas, cuotas |
| | `policies.edit` | pólizas, coberturas, vehículos asegurados, cuotas, archivo |
| | `policies.delete` | eliminar pólizas |
| | `insurance.configure` | tipos de cobertura |
| Referencia | `reference.read` | datos que usan todas las pantallas: estados, umbrales, temperaturas, taxonomías, búsqueda de ajustes (en todos los roles) |
| Comercial | `commercial.read` | tarifario, clientes, reportes |
| | `commercial.edit` | tarifas, ubicaciones, clientes |
| Administración | `users.manage` 🔒 | personas, invitaciones, asignación de roles |
| | `roles.manage` 🔒 | roles personalizados |
| | `settings.manage` 🔒 | revisiones de configuración |

🔒 = `privileged`: exige sesión `aal2` (verificación en dos pasos). Los filtros guardados (`filter-groups`) son
personales: no llevan permiso, se validan por dueño (excepción explícita en la guarda, §8).

Mapeo ruta → permiso: lo fija el plan de implementación, ruta por ruta, con la tabla de §8 como verificación.

## 5. Roles de sistema

Todos los roles de sistema (salvo Propietario, que tiene todo) incluyen **los permisos `*.read` de todas las
áreas**: el Monitor muestra el estado de Certificación y la ficha de empresa las pólizas. Un rol personalizado
puede restringir la lectura a su área.

| Rol (`code`) | Además de leer |
|---|---|
| Propietario / Super admin (`owner`) | todo (`grants_all`) |
| Administración (`admin`) | `users.manage`, `roles.manage`, `settings.manage` |
| Soporte técnico, proveedor (`support`) | nada (solo lectura) |
| Lectura (`reader`) | nada |
| Operador de Operaciones (`operations_operator`) | `trips.edit_basic`, `trips.delete`, `closures.declare`, `closures.sign` |
| Supervisor de Operaciones (`operations_supervisor`) | Operador + `trips.edit_sensitive`, `trips.create`, `operations.configure`, `directory.edit` |
| Operador de Certificación (`certification_operator`) | `documents.upload` |
| Supervisor de Certificación (`certification_supervisor`) | Operador + `documents.review`, `certification.configure`, `directory.edit`, `directory.delete` |
| Operador de Seguros (`insurance_operator`) | `policies.edit` |
| Supervisor de Seguros (`insurance_supervisor`) | Operador + `policies.delete`, `insurance.configure` |
| Operador Comercial (`commercial_operator`) | nada (lectura de tarifario y reportes) |
| Supervisor Comercial (`commercial_supervisor`) | `commercial.edit` |

### Reglas de los roles especiales

- **Propietario**: solo un Propietario da o quita el rol; nunca puede quedar **cero** (se recomienda **dos**:
  la organización no debe depender de una persona); un Administración no puede modificar ni borrar a un
  Propietario; `aal2` siempre.
- **Soporte técnico**: es el acceso del proveedor dentro de la app. No gestiona personas ni ejecuta acciones de
  negocio. Si necesita más, un Propietario le asigna un rol adicional y queda en `audit_log`. El acceso técnico
  del proveedor (Google Cloud IAM, Supabase, GitHub, Mage) se gestiona en esas plataformas, fuera de la app, con
  WebCarga como dueño de las cuentas.
- **Contra la escalada**: nadie asigna un rol (ni crea o edita uno personalizado) que tenga permisos que él no
  tiene. El Propietario no tiene esa restricción.
- **Roles de sistema**: no se editan ni borran por API; solo por migración.

## 6. Aplicación en el backend

Módulo nuevo `backend/api/app/authz/`:

- `permissions.py`: el catálogo (§4) y `ROLES_DE_SISTEMA` (§5) como datos de la migración y de los tests.
- `deps.py`: `require(*permisos)` — dependencia de FastAPI, mismo patrón que hoy (`Depends`). Devuelve el usuario.
  Si algún permiso pedido es `privileged`, exige `aal2`.
- `get_current_user` (`app/auth.py`) devuelve `permissions: frozenset[str]` además de `sub/email/aal`. Una sola
  consulta (unión de `role_permissions` de los roles de la persona; `grants_all` → todo el catálogo), con el caché
  de 60 s actual; el caché de la persona se borra al cambiar sus roles. Sin perfil o inactivo: 403, como hoy.
- **Se eliminan** `require_writer`, `require_editor`, `require_admin`, `EDITOR_ROLES`, `ADMIN_ROLES`,
  `WRITER_ROLES` y `ROLE_ORDER`: sin alias ni convivencia.

Permisos por campo (reemplaza la excepción de `writer`):

- El mapa campo → permiso vive junto a la definición de los campos (`schemas/trip.py`): básicos →
  `trips.edit_basic`, sensibles → `trips.edit_sensitive`.
- Helper genérico `require_fields(user, enviados, mapa)` en `authz/`: un campo sin permiso invalida el cuerpo
  completo (403 con los campos), igual que hoy. Reemplaza a `_exigir_campos_permitidos`.
- La regla del 09/10 se mantiene: en viajes del TMS, `is_active`/`is_working` no se editan (422).

Administración de acceso:

- Rutas: `GET /me`, `GET /permissions`, `GET/POST/PATCH/DELETE /roles`, `PUT /users/{id}/roles`; `POST /users`
  recibe `roles: list[str]` en vez de `role`.
- Reglas en `services/access_admin.py` (escalada, último Propietario, solo Propietario nombra Propietario, roles de
  sistema inmutables), cada cambio en una transacción y con su fila en `audit_log` (`entity_type = 'USER_ROLE'` /
  `'ROLE'`).
- Borrar un rol personalizado con personas asignadas: 409 (hay que reasignarlas primero).

## 7. Frontend

- `GET /me` → perfil, roles, permisos efectivos, `aal`. El layout del dashboard lo obtiene una vez (hoy lee
  `profiles` directo; pasa a la API) y lo expone con un contexto `PermisosProvider` + `can(permiso)`.
- Las ~14 verificaciones `hasRole(..., 'admin' | 'editor')` pasan a `can(...)`. `hasRole` y la jerarquía del
  frontend se eliminan.
- Los códigos de permiso para TypeScript se **generan** desde el catálogo del backend
  (`frontend/lib/authz/permisos.generated.ts`); un test del backend falla si el archivo está desfasado.
- Configuración › Personas y accesos:
  - **Personas**: la lista actual (último ingreso, método, MFA) + roles de cada persona como chips editables; al
    invitar se eligen roles; el Propietario se distingue.
  - **Roles**: cada rol con sus permisos agrupados por área; los de sistema, de solo lectura; crear/editar roles
    personalizados marcando permisos (solo los que tiene quien edita).
  - Maquetas antes de escribir la interfaz (skill `mockups`), contrastadas con productos SaaS reales.
- Rutas en inglés (`/dashboard/admin/settings/people`, `.../roles`), etiquetas en español.

## 8. Pruebas

| Prueba | Qué protege |
|---|---|
| Integridad del catálogo | todo permiso de `ROLES_DE_SISTEMA` existe; ningún permiso asignado en la base falta del código |
| Guarda de rutas | toda ruta depende de `require(...)` (excepciones: `/health`, `GET /me`, `filter-groups` por dueño) — evoluciona `test_toda_ruta_exige_sesion.py` |
| Matriz rol × ruta | por cada rol de sistema, rutas representativas aceptadas/rechazadas, generada desde el catálogo |
| Reglas de administración | escalada, último Propietario, solo Propietario nombra Propietario, roles de sistema inmutables, 409 al borrar rol en uso |
| Permisos por campo | `trips.edit_basic` vs `trips.edit_sensitive` en `PATCH /trips/{id}` y paradas |
| Integración (`conexion_revertida`) | consulta de permisos efectivos; `grants_all`; caché invalidado al reasignar |
| Migración sin pérdida | ensayo con ROLLBACK: para cada persona, permisos nuevos ⊇ lo que su rol actual permitía (mapa guardia → permisos); las ganancias, exactamente las listadas en §9 |
| Frontend | `can()`, archivo generado en sincronía, Playwright por rol en dev |

## 9. Migración y despliegue (expand/contract)

1. **Expand** (migración aditiva, ensayada con ROLLBACK): tablas de §3, permisos de §4, roles y composición de §5,
   copia de las 12 cuentas:

   | Rol actual | Roles nuevos |
   |---|---|
   | `owner` (2: una de WebCarga, una de Sumadots) | Propietario (la de Sumadots, transitoria hasta que WebCarga tenga dos) |
   | `admin` | Administración + los 4 Supervisores |
   | `editor` | los 4 Supervisores |
   | `writer` | Operador de Operaciones |
   | `viewer` | Lectura |

   `admin_whitelist.role_codes` sembrado con el mismo mapeo.

   **Ganancia aprobada (usuario, 09/10): el Supervisor configura su área.** Hoy la configuración de cada área
   (estados, umbrales, temperaturas, reglas de alerta, taxonomías, catálogo de requisitos, tipos de cobertura) es
   solo de `admin`; con `*.configure` en los Supervisores, los 4 `editor` actuales ganan configurar sus áreas.
   Es la única ganancia de la migración.

   **Ajustes posteriores, decididos por el usuario o en la revisión final (09/10):**
   - Las 3 cuentas `viewer` (Lectura) reciben además Operador de Operaciones: *"los usuarios que ya existen
     deberían tener acceso para hacer cierre de los viajes"*. Con eso las 12 firman el cierre.
   - "Alertas de vencimiento" (`PATCH /config/alert-thresholds`) pasa de `operations.configure` a
     `certification.configure`: son reglas de vencimiento de documentos (§4). Nadie pierde acceso hoy, porque
     los `editor` y `admin` migrados tienen ambos Supervisores.
   - Corregir la fecha de un documento ya aprobado exige `documents.review`; sobre uno por revisar sigue siendo
     `documents.upload`.
   - Confirmar "está bien así" en Configuración exige el permiso que edita esa sección, no `settings.manage`.
2. **API + frontend** leyendo solo permisos (un despliegue). Sin guardias viejos.
3. **Contract**: `DROP` de `profiles.role` y `admin_whitelist.role`. **Compuerta**: la API de `main`
   (`webcarga-monitor-api`, 01/08) usa la misma base y lee `profiles.role`; no se retira hasta desplegar `main`
   o apagar esa API (mismo criterio que `has_expiration`).

Después de la etapa 2, WebCarga ajusta a cada persona a su área real y nombra a su segundo Propietario; la cuenta
de Sumadots pasa a Soporte técnico.

## 10. Escalabilidad: perfiles externos (fuera del MVP)

El contrato dejó fuera los perfiles externos. El modelo los admite sin rehacerse: `user_roles.scope` (p. ej.
`carrier_id`) y roles externos (`carrier_viewer`) cuyas rutas filtran por alcance en el servicio. No se construye
ahora.

## 11. Fuera de alcance

- Edición de la composición de roles de sistema desde la pantalla (solo por migración).
- Acceso temporal con vencimiento automático (just-in-time) para Soporte: hoy se asigna y quita a mano, con
  auditoría.
- Impersonación ("ver como").
- Restricción de lectura por área en los roles de sistema (posible con roles personalizados).
