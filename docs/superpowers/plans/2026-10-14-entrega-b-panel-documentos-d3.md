# Entrega B: Cert 3 "Un panel de documentos + Pedir a Certificación" + D3 "Correcciones del maestro"

Plan madre: `2026-10-14-cerrar-directorio-y-certificacion.md`. Mismo método que la A: ejecución inline, un test por criterio
de aceptación (CA), un despliegue y una revisión. Las decisiones de la sesión del 14/10 no se reabren.

## Verificado el 14/10 (código y base real, solo lectura)

- **Ya no queda escritor automático del maestro.** Mage no escribe desde el 12/10 y el pre-cierre desde la Entrega A. La marca
  `is_manual_override` está en 56 conductores, 32 equipos y 14 empresas, pero ningún proceso la consulta para decidir si
  pisa un campo de `drivers`, `assets` o `carriers` (en `pre_cierre.py` se lee y no se usa).
  → **El "override por campo" de D3 sale del alcance**: protegería contra un escritor que ya no existe. Si mañana vuelve una
  ingesta del maestro, se diseña ahí.
- **El maestro está limpio:** 0 RUT de conductor duplicados o mal escritos, 0 patentes duplicadas o no canónicas, 1 conductor
  y 1 empresa sin RUT, 4 tractos activos sin tipo de operación.
- **Cuatro listas de documentos y tres fuentes:**
  - `DocumentChecklist` (fichas de conductor y equipo del Directorio) lee `GET /drivers|assets/{id}/compliance-records`.
  - `TransporterDocumentsPanel` (pestaña Documentos de la empresa) lee los registros anidados en `GET /carriers/{id}`.
  - Las filas `RenglonPendiente` de la ficha de Certificación leen `/pending?estado=todos`.
  - Las filas del cajón de Certificación leen `/pending`.
  - La subida ya es una sola (`hooks/useSubirDocumento.ts`).
- **Hay dos definiciones del estado del documento:** la canónica es `document_state_sql` (`vencimientos.py:403`). La otra es
  `entity_summary._DOCUMENTS_SQL`, que arma su propio CASE y alimenta la vista rápida del Cierre.
- **Correcciones imposibles hoy:** el PATCH de conductor no acepta `tax_id`, el de equipo no acepta `license_plate`, y el tipo
  de operación de un tracto no se puede quitar (`COALESCE` en `assets.py:104`; "Sin clasificar" manda `undefined`). La
  empresa sí cambia su `tax_id`, pero el chequeo de duplicado compara el texto tal cual, sin pasarlo a la forma canónica.
- **"Solicitar documento" ya existe** y es otra cosa: Certificación activa un requisito (`POST /compliance-records/requests`).
  **No existe ninguna cola de pedidos de Operaciones.**
- **Chip "Tractoreo" doble** en la ficha de Certificación (`compliance/[carrierId]/page.tsx:785` el derivado de los tractos y
  `:813` el declarado de `GestionDeclarada`): está así a propósito, pero dice lo mismo dos veces.

## Parte 1: Cert 3, un panel de documentos por entidad

### Diseño

- **Una fuente:** `GET /{carriers|drivers|assets}/{id}/documents`. Devuelve las filas de `compliance_record_columns_sql`
  (`document_state` canónico, `due_on`, fechas, archivo, requisito) **más** el resumen de esa misma consulta. La empresa deja de
  anidar sus registros en `GET /carriers/{id}`; los dos endpoints `…/compliance-records` quedan como alias durante esta
  entrega y se retiran en C.
- **`entity_summary` usa `document_state_sql`:** se borra el CASE propio de `_DOCUMENTS_SQL`. La vista rápida, el Directorio
  y Certificación dan las mismas cifras por construcción.
- **Un componente, `EntityDocumentsPanel`**, que sale de `DocumentChecklist` (es el más completo: ver, subir, reemplazar,
  corregir el vencimiento, borrar, reasignar). Las variantes son props, no componentes hermanos:
  - `mode="manage"` (con `documents.upload` y `documents.review`): lo de hoy.
  - `mode="read"` (Operaciones): ver y descargar, sin acciones de escritura, y el botón **"Pedir a Certificación"**.
  - Filtro por estado con los nombres de `lib/states.ts`.
- **Dónde se usa en B:** fichas de conductor y equipo del Directorio, pestaña Documentos de la empresa, y la vista rápida del
  Cierre (que hoy solo muestra conteos; pasa a mostrar la lista en modo lectura). La ficha de Certificación y el cajón se
  migran en C (Cert 2b), cuando se retira la segunda ficha. Así B no toca dos veces las mismas pantallas.

### "Pedir a Certificación" (mínimo; Pablo lo valida en dev)

- Tabla `app.certification_requests`: `id`, `entity_type`, `entity_id`, `requirement_id` (opcional), `note`, `trip_id`
  (opcional), `closure_date` (opcional), `status` (`OPEN` | `RESOLVED`), `created_by`, `created_at`, `resolved_by`,
  `resolved_at`, `resolution_note`.
- **Un solo pedido abierto por (entidad, requisito):** índice único parcial. Pedir dos veces lo mismo no duplica: devuelve el
  que ya existe.
- API:
  - `POST /certification-requests`, con el permiso `certification.request` (nuevo; lo tienen los roles de Operaciones).
  - `GET /certification-requests?status=OPEN`, con `certification.read`.
  - `POST /certification-requests/{id}/resolve`, con `documents.review`.
- **Dónde lo ve Certificación:** un bloque **"Pedidos de Operaciones (N)"** arriba de Pendientes, con quién lo pidió, cuándo,
  para qué viaje o día del Cierre, y "Resolver". El mismo número sale como contador en el menú de Pendientes.
- **Se resuelve solo** cuando el requisito pedido queda Al día (se revisa al leer; sin trigger). Si no traía requisito, lo
  resuelve una persona.

### Criterios de aceptación

| # | Criterio | Nivel |
|---|---|---|
| P1 | `GET …/documents` de conductor, equipo y empresa devuelven el mismo `document_state` que `/pending` para el mismo registro | base real |
| P2 | La vista rápida (`entity_summary`) da las mismas cifras que el panel para 2 entidades de prueba | base real |
| P3 | Pedir dos veces lo mismo deja un solo pedido abierto | API |
| P4 | Sin `certification.request` el POST da 403; sin `documents.review` resolver da 403 | API |
| P5 | Un pedido con requisito sale de la lista de abiertos cuando el documento queda Al día | base real |
| P6 | `mode="read"` no ofrece subir, reemplazar, corregir ni borrar; ofrece "Pedir a Certificación" | vitest |
| P7 | El panel deshabilita las acciones mientras carga y no muestra "0" antes de tener el dato | vitest |

## Parte 2: D3, correcciones del maestro (sin override por campo)

### Diseño

- **Corregir el RUT de un conductor y la patente de un equipo:** `POST /drivers/{id}/identity` y `POST /assets/{id}/identity`,
  con el permiso `directory.identity` (nuevo; lo tienen los roles de Certificación) y **motivo obligatorio**.
  - Se escribe la forma canónica (los triggers de normalización ya existen).
  - Un duplicado (comparado por la forma canónica) da 409 con el nombre de quien ya lo tiene.
  - Queda en `audit_log` (`action = 'identity_correction'`, valor viejo y nuevo, motivo).
- **Patente nueva = mismo equipo (P12):** tabla `app.asset_plate_aliases (asset_id, plate, valid_until, created_by)`. Al
  corregir, la patente vieja queda como alias. La resolución de flota de los viajes (`app.resolve_trip_fleet()`) busca
  también en los alias, y así los viajes viejos del TMS siguen encontrando al equipo.
- **RUT de la empresa:** el chequeo de duplicado del PATCH pasa a comparar por `canonical_rut` (hoy compara el texto tal cual).
- **Quitar el tipo de operación de un tracto:** el PATCH distingue "no enviado" de "null" (`sent_fields()`, igual que
  `CarrierPatchBody`), y "Sin clasificar" manda `null`.
- **Un solo chip de tipo en la ficha de Certificación:** se muestra el derivado de los tractos. El declarado aparece solo si
  no coincide, como "Declarado: …". Es la regla del 12/10: lo observado manda, lo declarado cubre el hueco y la ficha marca la
  diferencia.
- **Fuera de B:** P11 ya quedó resuelta en la Entrega A (la empresa del TMS se ignora). El tipo por defecto del cliente
  (Sodimac) espera la respuesta del equipo (Google Sheet del 14/10).

### Criterios de aceptación

| # | Criterio | Nivel |
|---|---|---|
| D1 | Corregir un RUT o una patente exige motivo y el permiso, y deja el valor viejo y el nuevo en `audit_log` | API |
| D2 | Un RUT o una patente que ya tiene otra entidad (comparado en forma canónica) da 409 con su nombre | base real |
| D3 | Tras corregir una patente, un viaje que llega con la patente vieja resuelve al mismo equipo | base real |
| D4 | El PATCH de empresa rechaza un `tax_id` que es el mismo RUT con otro formato (con puntos, sin guion) | base real |
| D5 | Mandar `webcarga_operation_type_id: null` quita el tipo; no mandarlo no lo toca | API |
| D6 | La ficha de Certificación muestra un solo chip cuando el declarado y el derivado coinciden | vitest |

## Humo E2E que se agrega

- Operaciones abre la vista rápida desde el Cierre, ve la lista de documentos sin acciones y pide uno a Certificación.
- Certificación ve el pedido arriba de Pendientes y lo resuelve.
- Corregir la patente de un equipo, con motivo.

## Orden de trabajo

1. Base: `certification_requests`, `asset_plate_aliases`, los permisos nuevos con sus roles, y alias en
   `resolve_trip_fleet()`. Ensayo con ROLLBACK en la base real y aplicación.
2. Backend del panel (`…/documents`, `entity_summary` sobre `document_state_sql`) → P1 y P2.
3. Backend de pedidos → P3 a P5.
4. Backend de D3 → D1 a D5.
5. Frontend: `EntityDocumentsPanel` en sus tres lugares, el bloque de pedidos en Pendientes, la corrección de identidad en
   las fichas, el tipo que se puede quitar y el chip único → P6, P7 y D6.
6. Humo, una revisión, suite completa del backend una vez (se tocó la base compartida), despliegue y recorrido en dev.

## Preguntas para el usuario antes de ejecutar

1. ¿Qué roles crean pedidos (`certification.request`)? Propuesta: Operador y Supervisor de Operaciones.
2. ¿Quién corrige RUT y patente (`directory.identity`)? Propuesta (P12, 14/10): Supervisor de Certificación.

## Tangentes (no se tocan en B)

- Retirar `…/compliance-records`, `TransporterDocumentsPanel` y el cajón: C.
- Avisar por correo de los pedidos: fuera de alcance (la cola alcanza para validar con Pablo).

## Ejecución (14/10 noche) — lo que cambió respecto del diseño

- **Una sola definición, sin componente nuevo:** el panel único es `DocumentChecklist` con la prop `onRequest` (una
  variante es una prop). Se usa en las fichas de conductor y equipo y en la vista rápida del Cierre (sección "Documentos",
  que se despliega a pedido). La pestaña Documentos de la empresa (`TransporterDocumentsPanel`, con versiones) pasa a C,
  junto con la ficha de Certificación y el cajón.
- `GET /{carriers|drivers|assets}/{id}/documents` (`services/entity_documents.py`); los `…/compliance-records` devuelven
  las mismas filas. `entity_summary` usa `document_state_sql`.
- La migración `20261018090000_requests_and_plate_aliases.sql` (APLICADA, ensayo de 90 días: 2.961 viajes, 0 cambios)
  también hace que `app.resolve_trip_fleet` tome la empresa del tracto, y la del conductor en un vínculo manual, **del día
  del viaje** (D2): un viaje viejo que se vuelve a resolver no cambia de empresa por una transferencia posterior.
- Permisos en código (`app/authz/permissions.py`, se sincronizan al arrancar): `certification.request` (Operador y
  Supervisor de Operaciones) y `directory.identity` (Supervisor de Certificación). Pasan a las fichas como props.
- Tangente anotada: la pestaña "Conductores 0" / "Equipos 0" de la ficha de empresa muestra 0 antes de tener el dato
  (anterior a B).
