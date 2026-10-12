# Auditoría del Directorio — Lente C (arquitectura de código: API y frontend)

Fecha: 12/10/2026. Solo lectura sobre `monitor-app/frontend` y `monitor-app/backend/api`. No se ejecutó nada
(sin build, sin servidor, sin base). Rutas relativas a `monitor-app/frontend` (F) o `monitor-app/backend/api/app` (B).

## 0. Resumen

- **Ninguna mutación del Directorio invalida algo fuera de su propia ficha.** Las siete mutaciones de
  `carriers/[id]/page.tsx` y de los paneles de conductor y equipo tocan solo `carrier-*`, `driver-detail`,
  `asset-detail` y `asset-driver-assignment`. Certificación, Cierre, Monitor y la vista rápida no se enteran.
- **La invalidación de Certificación es asimétrica.** `invalidarCertificacion` alcanza `entity-summary` y las
  claves de Certificación, pero no las del Directorio (`carrier-drivers`, `carrier-assets-roster`, `carriers`,
  `carriers-directorio`). Lo que se hace en una ficha de empresa no refresca la otra.
- **Hay dos obstáculos de servidor aunque el frontend invalidara bien:** (a) `app.carrier_driver_roster` es una
  vista materializada sin trigger de refresco sobre `public.drivers`, así que renombrar o dar de baja un conductor
  deja el roster viejo incluso tras el refetch; (b) las líneas del Cierre son una foto que recalcula Cloud
  Scheduler cada minuto.
- **Duplicación estructural:** dos fichas de empresa (más un panel lateral y una vista rápida), 5 buscadores, tres
  consultas "conductor + empresa + tracto" distintas, y el predicado "asignación activa" escrito ~55 veces.

## 1. Superficies

| Superficie | Ruta | Componentes principales | Endpoints que consume |
|---|---|---|---|
| Directorio, lista | `/dashboard/carriers` | `carriers/page.tsx` (362 l), `TransporterCard`, `ResultadosDelDirectorio`, `NewCarrierPanel`, `TransporterSlideOver` | `GET /carriers`, `GET /carriers/buscar`, `GET /carriers/{id}` (slide-over), `POST /carriers` |
| Directorio, ficha de empresa | `/dashboard/carriers/[id]` | `carriers/[id]/page.tsx` (972 l), `DriverRosterCard`, `VehicleRosterCard`, `DriverDetailPanel` (391), `VehicleDetailPanel` (466), `AltaDeFlota`, `TransferModal`, `BajaReasonModal`, `DeleteCarrierModal`, `InsurancePolicyModal` (878), `CarrierDocumentsTab` | `GET/PATCH/DELETE /carriers/{id}`, `GET /carriers/{id}/drivers|assets|policies|shippers`, `POST/DELETE /carriers/{id}/drivers|assets`, `GET/PATCH /drivers/{id}`, `GET/PATCH /assets/{id}`, `GET/POST/DELETE /assets/{id}/driver-assignment`, contactos, pólizas |
| Directorio, conductor y equipo | `/dashboard/drivers/[id]`, `/dashboard/assets/[id]` | `EntityRedirect` (sin pantalla propia) | `GET /drivers|assets/{id}/summary`, luego redirige a la ficha de la empresa con `?driver=` o `?asset=` |
| Certificación › Empresas, lista | `/dashboard/compliance` | `compliance/page.tsx` (329), `CertificationFunnel`, `CertificationStatusTable`, `DirectorioResumen`, `CarrierDrawer`, `NewCarrierPanel`, `TransferModal` | `GET /compliance-records/status`, `GET /carriers/directorio`, `POST /carriers`, `POST /carriers/{id}/drivers|assets` |
| Certificación › Empresas, ficha ("segunda ficha") | `/dashboard/compliance/[carrierId]` | `compliance/[carrierId]/page.tsx` (1.076 l), `TarjetaDeSujeto`, `AccionesDeSujeto`, `ConfirmarBaja`, `GestionDeclarada`, `AltaDeFlota`, `TransferModal`, `BajaReasonModal` | `GET /carriers/{id}`, `GET /compliance-records/summary`, `GET /compliance-records/pending`, `PATCH /carriers/{id}`, `POST/DELETE /carriers/{id}/drivers|assets`, `GET /trips/conteo-activos` |
| Certificación › Sin clasificar / Pendientes | `/dashboard/compliance/inbox`, `/pending` | `TriageWorkbench` (632), `CarrierSearchPicker`, `PendingHoldersPanel` | fuera del alcance de este lente salvo `CarrierSearchPicker` |
| Cierre | `/dashboard/operations/closures` | `closures/page.tsx` (604), `FlotaDelDiaSection` (950), `PasoViajesSection`, `PreCierrePendingSection`, `AltaConductorDesdeCierre`, `VincularConductorPropuesto`, `EntityQuickView` | `GET /daily-closures`, `GET /equipment-closures`, `PATCH /daily-closures|equipment-closures/reason`, `GET /trips/cierre-viajes`, `POST /closures/{f}/close|reopen`, `POST /drivers`, `POST /carriers/{id}/drivers`, `PATCH /carriers/{id}`, `GET /{carriers|drivers|assets}/{id}/summary` |
| Vista rápida | panel dentro del Cierre | `EntityQuickView` (292), `EntityCell`, `useQuickView` | `GET /{carriers|drivers|assets}/{id}/summary` (solo lectura). **Solo existe en el Cierre.** |
| Monitor, lista | `/dashboard/operations/monitor` | `monitor/page.tsx` (773), `TripTable` (603), `AsignarConductorPopover`, `FleetCenterDialog`, `TripAssignDialog` | `GET /trips`, `GET /trips/available-drivers|assets`, `GET /trips/driver-candidates`, `POST /trips/assign-driver`, `POST /drivers`, `POST /carriers/{id}/drivers` |
| Monitor, detalle del viaje | `/dashboard/operations/monitor/trips/[id]` y `@modal/(.)trips/[id]` | `TripDetailView`, `GestionPanel` (467) | `GET /trips/{id}`, `POST/DELETE /trips/{id}/fleet-link`, `GET /drivers/fuzzy-match`, enlaces a `/dashboard/carriers/...` escritos a mano |

El Monitor no tiene vista rápida: el nombre de la empresa o del conductor en una fila del Monitor no es un enlace
(`TripTable.tsx`, `TripDetailView.tsx` no importan `EntityCell` ni `lib/navegacion/directory`).

## 2. Duplicados

| # | Qué se duplica | Dónde (archivo:línea) | En qué difieren |
|---|---|---|---|
| D1 | **Ficha de empresa** (x2 más un panel y una vista rápida) | Directorio `F app/dashboard/carriers/[id]/page.tsx:134`; Certificación `F app/dashboard/compliance/[carrierId]/page.tsx:480`; panel `F components/dashboard/TransporterSlideOver.tsx:36`; vista rápida `F components/dashboard/EntityQuickView.tsx:42` | Directorio: renombrar (`NombreEditable`), contactos, pólizas, clientes, exportar zip, eliminar, editar conductor y equipo (origen habitual, tipo de operación). Certificación: documentos por sujeto, **tipo de gestión declarado** (`GestionDeclarada`, solo aquí: 0 usos en la ficha del Directorio), baja y transferencia por sujeto con conteo de documentos y viajes. Ninguna de las dos tiene todo. |
| D2 | **Dos claves de caché para el mismo `GET /carriers/{id}`** | `['carrier-detail', id]` en `carriers/[id]/page.tsx:192`, `compliance/[carrierId]/page.tsx:579`, `compliance/inbox/page.tsx:19`; `['carriers','detail',id]` en `TransporterSlideOver.tsx:42` | La clave del panel cuelga de `['carriers']` (la de la lista) y la de las fichas no; editar en la ficha no refresca el panel de la lista ni al revés. |
| D3 | **Etiquetas de estado** | `STATUS_LABELS` `F components/dashboard/TransporterCard.tsx:13` ("Inactiva"/"Onboarding") contra `OPERATIONAL_STATUS_LABELS` `F lib/types.ts:958` ("Dada de baja"/"En onboarding") | El mismo estado se llama distinto según la pantalla: lista, panel y ficha de Certificación dicen "Inactiva"; ficha del Directorio dice "Dada de baja" (`carriers/[id]/page.tsx:433`). Hay además `STATUS_CLS`, `ChipDeBaja`, `isActive` local en `EntityQuickView.tsx:123`. |
| D4 | **"¿Está activo?" en el frontend** | `operational_status !== 'ACTIVE'` en `carriers/[id]/page.tsx:454`, `DriverRosterCard.tsx:40`, `VehicleRosterCard.tsx:66`, `ResultadosDelDirectorio.tsx:43,56`, `CertificationStatusTable.tsx:129`; `=== 'ACTIVE'` en `compliance/[carrierId]/page.tsx:593`, `EntityQuickView.tsx:124` | Seis comparaciones literales sin función compartida. Ninguna calcula "puede operar" (documentos); ese cálculo vive solo en el servidor (`compliance_health`). |
| D5 | **Buscadores** | (1) `carriers/page.tsx:118` `GET /carriers/buscar`; (2) `compliance/page.tsx:101` `GET /compliance-records/status?q=`; (3) `CarrierSearchPicker.tsx:43` `GET /carriers?q=`; (4) `DriverSearchPicker.tsx:29` `GET /drivers?q=`; (5) `carriers/[id]/page.tsx:279` filtro local del roster | Cinco consultas con reglas distintas: (1) acepta RUT y patente canónicos y no filtra por estado; (3) y (4) no normalizan RUT/patente; (4) solo devuelve conductores activos con empresa activa. Escribir un RUT con puntos funciona en (1) y no en (3) ni en (4). |
| D6 | **Alta de empresa** | `NewCarrierPanel` usado en `carriers/page.tsx:178`, `compliance/page.tsx:211`, `PreCierrePendingSection.tsx:8`; destino post-alta distinto: `/dashboard/carriers/{id}` (`carriers/page.tsx:107`) contra `/dashboard/compliance/{id}` (`compliance/page.tsx:142`) | Componente compartido (bien), pero el alta no invalida nada y cada pantalla manda a una ficha distinta. |
| D7 | **Alta de conductor y equipo** | `AltaDeFlota` (Directorio `carriers/[id]/page.tsx:645,742`; Certificación `compliance/[carrierId]/page.tsx:1002`); `AltaConductorDesdeCierre.tsx:58`; `monitor/page.tsx:744` (`driversApi.create` + `assignDriver` inline) | Tres caminos de "crear conductor + asignarlo a empresa". Solo `AltaDeFlota` ofrece origen habitual; el del Cierre y el del Monitor crean sin él. Cada uno invalida lo suyo (§3). |
| D8 | **Editor de asignación (baja / transferencia)** | Directorio `carriers/[id]/page.tsx:251-280` (`handleRemove*`, `handleConfirmTransfer`); Certificación `compliance/[carrierId]/page.tsx:511,1062` (`ejecutarBaja`, `onTransfer`); `compliance/page.tsx:316` (asignar sin empresa); `VincularConductorPropuesto.tsx:47` | Mismos endpoints, cuatro orquestaciones. Directorio invalida el roster de la empresa de origen; Certificación invalida solo Certificación. |
| D9 | **Consulta "conductor + empresa + tracto habitual"** | `B routers/drivers.py:28-60` (búsqueda), `B routers/drivers.py:142-170` (`get_driver`), `B services/entity_summary.py:76-96` (resumen), `B routers/carriers.py:_SQL_BUSCAR_CONDUCTORES`, `B services/driver_roster.py:30` | La búsqueda hace `LEFT JOIN vehicle_driver_assignments` sin elegir uno: un conductor con dos tractos activos sale en dos filas (el propio `entity_summary.py` documenta "un conductor puede tener varios tractos activos" y usa `LATERAL ... LIMIT 1`). La búsqueda exige empresa `ACTIVE`; `get_driver` y el resumen no. |
| D10 | **Predicado de asignación activa** | `status = 'ACTIVE'` sobre `driver_assignments`/`asset_assignments`/`vehicle_driver_assignments` en 52 sitios de `B routers/` y `B services/` (`grep`) | Sin vista ni función. Variantes: `driver_roster.py:30` agrega `d.operational_status='ACTIVE'`; `/carriers/directorio` (`carriers.py:_SQL_DIRECTORIO`) cuenta conductores por asignación sin mirar el estado del conductor; `entity_summary.carrier_summary` hace lo mismo. "Cuántos conductores tiene la empresa" da número distinto según el endpoint (la medición real corresponde al Lente B). |
| D11 | **URLs del Directorio escritas a mano** | `/dashboard/carriers/...` literal en `GestionPanel.tsx:176,348,358,368`, `closures/page.tsx:274`, `PreCierrePendingSection.tsx:170,237,256`, `FlotaDelDiaSection.tsx:531,795`, `TransporterCard.tsx:57`, `TransporterSlideOver.tsx:128`, `carriers/page.tsx:322`, `TripAssignDialog.tsx:335`; existe `F lib/navegacion/directory.ts` | 14 sitios saltan el helper, y solo el helper conserva `?next=` para volver al Cierre. |
| D12 | **Nombre del módulo** | `Sidebar.tsx:65` "Empresas" (Certificación) y `:78` "Directorio"; título "Empresas de Transporte" (`carriers/page.tsx:190`); migas "Empresas" en ambas fichas (`carriers/[id]/page.tsx:404`, `compliance/[carrierId]/page.tsx:765`) | Dos entradas del menú llamadas "Empresas"/"Directorio" que apuntan a fichas distintas de la misma entidad. |
| D13 | **Taxonomías con dos prefijos** | `['taxonomias', ...]` en `AltaDeFlota.tsx:90`, `VehicleDetailPanel.tsx:78`; `['taxonomies', ...]` en `GestionPanel.tsx:61`, `closures/page.tsx:206`, `useMotivosDeAnulacion.ts:15` | Mismo endpoint, dos raíces de caché; una invalidación futura por prefijo no alcanzaría a la mitad. |

## 3. Sincronía por React Query

### 3.1 Configuración global

`F app/dashboard/providers.tsx`: `staleTime: 60_000`, `refetchOnWindowFocus: false`, `retry: 1`. Consecuencia: una
consulta que **no** se invalida se considera fresca 60 s; si la pantalla está montada no se vuelve a pedir hasta que
se remonte pasado ese minuto o se recargue. Solo `daily-closure` tiene `refetchInterval` (15 s, y solo mientras hay
`pendiente_desde`, `closures/page.tsx:158`) y `useTrips` con `poll`.

### 3.2 Claves que lee cada pantalla

| Pantalla | Claves |
|---|---|
| Directorio, lista | `['carriers', params]` (`useTransporters.ts:13`), `['carriers-count', status, q]` (`carriers/page.tsx:137`), `['directorio-buscar', q]` (`:119`), `['carriers','detail',id]` (slide-over) |
| Directorio, ficha | `['carrier-detail', id]`, `['carrier-drivers', id]`, `['carrier-assets-roster', id]`, `['carrier-policies', id]`, `['carrier-shippers', id]`, `['driver-detail', id]`, `['asset-detail', id]`, `['driver-compliance-records', id]`, `['asset-compliance-records', id]`, `['asset-driver-assignment', id]` |
| Certificación › Empresas | `['certification-status', group, q]`, `['certification-status-catalog', q]`, `['carriers-directorio']` (`DirectorioResumen.tsx:26`, **no está en las raíces de Certificación**) |
| Certificación › ficha | `['carrier-detail', id]`, `['compliance-summary', id]`, `['compliance-pending', ...]`, `['trips-activos', ...]` |
| Cierre | `['daily-closure', f]`, `['equipment-closures', f]`, `['cierre-viajes', f]`, `['closure-signatures', f]`, `['status-report', f, client]`, `['fleet-driver-gap']`, `['origenes']` |
| Monitor | `['trips', params]`, `['trip', id]`, `['available-drivers', f]`, `['available-assets', f]`, `['driver-candidates', n]` |
| Vista rápida | `['entity-summary', kind, id]` (`entitySummary.ts:52`) |

### 3.3 Qué invalida cada mutación (con línea)

| Mutación | Dónde | Invalida |
|---|---|---|
| Renombrar empresa, contactos | `carriers/[id]/page.tsx:224-239,303-314` | `carrier-detail` |
| Baja / reactivar empresa (Directorio) | `:228-235` | `carrier-detail` |
| Baja / reactivar empresa (Certificación) | `compliance/[carrierId]/page.tsx:546-547` | `carrier-detail` + raíces de Certificación (incluye `entity-summary`) |
| Baja / reactivar empresa (Cierre, pre-cierre) | `PreCierrePendingSection.tsx:48,69` | `daily-closure`, `equipment-closures` |
| Crear empresa | `NewCarrierPanel.tsx:45` | **nada** (navega a la ficha) |
| Editar conductor (nombre, origen habitual, baja/reactivar) | `carriers/[id]/page.tsx:246-249` | `driver-detail`, `carrier-drivers` |
| Editar equipo (tipo, año, tipo de operación, baja/reactivar) | `:257-260` | `asset-detail`, `carrier-assets-roster` |
| Asignar conductor habitual a un tracto | `VehicleDetailPanel.tsx:184,198` | `asset-driver-assignment` |
| Quitar conductor/equipo de la empresa (Directorio) | `carriers/[id]/page.tsx:251-265` | `carrier-drivers` o `carrier-assets-roster` **de la empresa de origen** |
| Transferir (Directorio) | `:267-279` | roster de la empresa de **origen**; el de la empresa destino no se invalida |
| Quitar o transferir (Certificación) | `compliance/[carrierId]/page.tsx:517,1070`; `compliance/page.tsx:322` | raíces de Certificación |
| Crear conductor/equipo (Directorio) | `carriers/[id]/page.tsx:651,749` | `carrier-drivers` / `carrier-assets-roster` |
| Crear conductor/equipo (Certificación) | `compliance/[carrierId]/page.tsx:1006,1012` | raíces de Certificación |
| Crear/vincular conductor (Cierre) | `PreCierrePendingSection.tsx:40-41` | `daily-closure`, `equipment-closures` |
| Crear conductor + asignar a viajes (Monitor) | `monitor/page.tsx:744-755` | `trips` |
| Asignar flota a un viaje (Monitor) | `GestionPanel.tsx:149`; `monitor/page.tsx:322-326` | `setQueryData` de `trip` y `trips` |
| Motivo por línea / lote (Cierre) | `FlotaDelDiaSection.tsx:176,212` | `daily-closure`, `equipment-closures` |
| Anular viajes | `useAnularViajes.ts:11` | `trips, trip, cierre-viajes, daily-closure, equipment-closures` |

### 3.4 Matriz mutación × pantalla

Leyenda: **OK** = se refresca al terminar la mutación. **60 s** = queda vieja hasta que la pantalla se remonte pasado
el minuto de `staleTime` (o se recargue). **n/a** = la pantalla no lee ese dato. **srv** = además hay rezago de
servidor (§3.5).

| Mutación | Dir. lista | Dir. ficha | Cert. lista (embudo + resumen) | Cert. ficha | Cierre | Monitor | Vista rápida |
|---|---|---|---|---|---|---|---|
| Crear empresa (cualquier origen) | 60 s | OK (navega) | 60 s (`certification-status`, `carriers-directorio`) | OK (navega) | 60 s (si la empresa aparece en pendientes) | n/a | n/a |
| Renombrar empresa (Dir.) | 60 s (`carriers`, `carriers/detail`) | OK | 60 s | 60 s (`carrier-detail` se invalida, pero `certification-status` guarda el nombre) | 60 s (nombre en filas) srv | 60 s (nombre en `trips`) | 60 s |
| Baja / reactivar empresa (Dir.) | 60 s (pestaña Activas/Inactivas y contadores) | OK (solo cabecera; roster y documentos no) | 60 s (embudo, `carriers-directorio`) | 60 s (cuerpo con requisitos viejos) | 60 s srv | 60 s (`available-*`) | 60 s |
| Baja / reactivar empresa (Cert.) | 60 s | 60 s (`carrier-detail` se refresca, el roster no) | OK, salvo `carriers-directorio` (60 s) | OK | 60 s srv | 60 s | OK (`entity-summary` es raíz de Cert.) |
| Editar conductor: nombre | n/a | OK (roster **viejo** por la vista materializada, srv) | 60 s | 60 s | 60 s srv | 60 s (`available-drivers`) | 60 s |
| Editar conductor: baja / reactivar | n/a | OK en el panel; roster **viejo** por la vista materializada, srv | 60 s | 60 s (los requisitos de un conductor de baja siguen contando) | 60 s srv | 60 s | 60 s |
| Editar conductor: origen habitual | n/a | OK | n/a | n/a | 60 s srv (la línea copia `home_location_id`) | n/a | 60 s |
| Editar equipo: tipo, año | n/a | OK | 60 s | 60 s | 60 s srv | 60 s (`available-assets`) | 60 s |
| Editar equipo: tipo de operación | n/a | OK | 60 s (encabezado de Cert. lo deriva) | 60 s (`compliance-summary` deriva el chip) | 60 s srv (decide si el tracto bloquea el cierre) | 60 s | 60 s |
| Editar equipo: baja / reactivar | n/a | OK | 60 s | 60 s | 60 s srv | 60 s | 60 s |
| Conductor habitual de un tracto | n/a | OK (solo el panel del tracto) | n/a | n/a | 60 s srv | 60 s | 60 s (`usual_driver`, `usual_tractor`) |
| Quitar de la empresa (Dir.) | 60 s (si hay conteos) | OK (origen) | 60 s | 60 s | 60 s srv | 60 s | 60 s |
| Quitar de la empresa (Cert.) | 60 s | 60 s (`carrier-drivers`/`assets-roster`) | OK | OK | 60 s srv | 60 s | OK |
| Transferir (Dir.) | n/a | origen OK, **destino 60 s** | 60 s | 60 s | 60 s srv | 60 s | 60 s |
| Transferir / asignar sin empresa (Cert.) | n/a | 60 s (origen y destino) | OK | OK | 60 s srv | 60 s | OK |
| Crear conductor / equipo (Dir.) | n/a | OK (lista), `carrier-detail` y documentos de la empresa 60 s | 60 s | 60 s | 60 s srv | 60 s | n/a |
| Crear conductor / equipo (Cert.) | n/a | 60 s | OK | OK | 60 s srv | 60 s | OK |
| Crear conductor + vincular (Cierre) | n/a | 60 s | 60 s | 60 s | OK (propio), srv | 60 s | 60 s |
| Crear conductor + asignar viaje (Monitor) | n/a | 60 s | 60 s | 60 s | 60 s srv | OK (`trips`) | 60 s |
| Asignar flota a un viaje (Monitor) | n/a | n/a | n/a | n/a | 60 s srv (`cierre-viajes`, líneas) | OK (`setQueryData`) | 60 s |

### 3.5 Cachés y rezagos de servidor

1. **Vistas materializadas** `app.carrier_driver_roster` y `app.carrier_asset_roster`
   (`B routers/carriers.py:717,854`). Se refrescan por trigger de sentencia sobre `driver_assignments`,
   `asset_assignments`, `carriers`, `public.assets` y `compliance_records`
   (`supabase/migrations/20260716214630_h1_driver_asset_views_and_roster.sql:87-97`,
   `20260804010000_refresh_carrier_view_on_assets_update.sql`). **No hay trigger sobre `public.drivers`.** La vista
   guarda `d.full_name` y `d.operational_status` (`...h1_driver_asset_views_and_roster.sql:35-45`): renombrar o dar
   de baja a un conductor (`PATCH /drivers/{id}`, `B routers/drivers.py:320`) no refresca el roster, y el refetch
   que dispara el frontend lee el valor viejo. El roster de equipos lo resolvió leyendo `webcarga_operation_type_id`
   en vivo (`carriers.py:845-850`), y `/carriers/buscar` evita las vistas por esta razón (comentario en
   `carriers.py`); el roster de conductores no.
2. **El refresco de estas vistas corre por sentencia y refresca las cinco vistas**
   (`refresh_carrier_view()`), también en cada `UPDATE` sobre `public.assets`: editar un solo equipo paga cinco
   `REFRESH ... CONCURRENTLY`. Costo interno que crece con el padrón.
3. **Líneas del Cierre** (`app.closure_lines`) son una foto. Triggers `trg_enqueue_closure_recompute_*` sobre
   `drivers`, `assets`, `carriers`, las tres tablas de asignación, `trip_fleet_links`, `trips`, `trip_stops`
   (`migrations/20261010220000_marca_del_cierre_en_ingles.sql:56-73`) encolan el día; el ejecutor corre cada minuto
   (`B services/cola_del_cierre.py`). Un cambio del Directorio llega al Cierre en 1 minuto o más, y un refetch
   inmediato leería la foto vieja. El aviso "Actualizando…" (`AvisoDeActualizacion.tsx`) y el `refetchInterval` de
   15 s existen solo para `daily-closure`; `equipment-closures` y `cierre-viajes` no tienen ni uno ni otro.
4. **Redis/Upstash:** `B middleware/cache.py` tiene `_STATIC_ROUTES = {}`; hoy no cachea ninguna ruta. `cache.py`
   conserva `invalidate_trips_meta_cache()` para una ruta que ya no se cachea (código muerto).
5. **`GET /carriers/directorio`** (`carriers.py:_SQL_DIRECTORIO`) cuenta en vivo, sin caché de servidor; su único
   rezago es el del frontend (`['carriers-directorio']`).

## 4. Inventario de API

### 4.1 Por entidad

| Entidad | Endpoints | Forma | Observaciones |
|---|---|---|---|
| Empresa | `GET /carriers`, `GET /carriers/{id}`, `GET /carriers/{id}/summary`, `POST /carriers`, `PATCH /carriers/{id}`, `DELETE /carriers/{id}`, `GET /carriers/buscar`, `GET /carriers/directorio`, `GET /carriers/fleet-driver-gap`, `GET /carriers/insurance-overview`, `GET /carriers/{id}/documents/export` | REST + 3 verbos sueltos | `buscar` y `directorio` en español; `fleet-driver-gap`, `insurance-overview` en inglés. Hay que declararlos antes de `/{carrier_id}` (comentarios en `carriers.py` lo advierten). |
| Roster de empresa | `GET/POST /carriers/{id}/drivers`, `DELETE /carriers/{id}/drivers/{driver_id}`, ídem `/assets` | REST anidado | `POST` es "transferir" (desactiva la asignación anterior y crea la nueva, `_transferir`, `carriers.py:~740`), con nombre de asignar. `POST` exige `DIRECTORY_EDIT`; `DELETE` exige `DIRECTORY_DELETE`. |
| Conductor | `GET /drivers?q`, `GET /drivers/fuzzy-match`, `GET /drivers/{id}`, `GET /drivers/{id}/summary`, `POST`, `PATCH`, `GET /drivers/{id}/compliance-records`, `GET/POST /drivers/{id}/contacts` | REST | **No hay `GET /drivers` de listado**: `GET /drivers?q` busca activos y exige 2 letras. `PATCH` es la única vía de baja (no hay `DELETE` ni `/deactivate`). |
| Equipo | `GET /assets/{id}`, `GET /assets/{id}/summary`, `POST`, `PATCH`, `GET /assets/{id}/compliance-records`, `GET/POST/DELETE /assets/{id}/driver-assignment` | REST | No hay listado ni búsqueda de equipos propia: la patente se busca vía `/carriers/buscar`. `driver-assignment` (conductor habitual) es el único con `DELETE` de relación fuera de `/carriers/{id}/...`. |
| Origen habitual | campo `home_location_id` en `PATCH /drivers/{id}` (cadena vacía = quitar) | campo | Semántica "vacío vs omitido" distinta a la del resto de los `PATCH` (`COALESCE`). |
| Tipo de operación | campo `webcarga_operation_type_id` en `PATCH /assets/{id}` | campo | `undefined` no se puede volver a "sin clasificar" desde la UI (documentado a propósito). |
| Contactos y pólizas | `PATCH/DELETE /contacts/{id}`, `/policies/{id}/...` | REST | `GET /carriers/{id}/contacts` no tiene consumidor en el frontend. |
| Cierre | `GET /daily-closures`, `GET /equipment-closures`, `PATCH .../reason`, `PATCH .../{id}`, `POST /closures/{fecha}/close|reopen` | mixto | Dos routers casi gemelos (conductores y equipos). |
| Vista rápida | `GET /{carriers|drivers|assets}/{id}/summary` | REST | Nuevo (11/10), en inglés, sobre `services/entity_summary.py` (200 l). |

### 4.2 Español contra inglés

- Rutas en español: `/carriers/buscar`, `/carriers/directorio`, `/trips/conteo-activos`, `/trips/cierre-viajes`,
  `/closures/{fecha}/...`. Claves JSON en español: `buscar` devuelve `empresas`, `conductores`, `vehiculos`;
  `directorio` devuelve `empresas.{total,activas,inactivas,onboarding}` y `flota.{tractos,ramplas,conductores}`.
- El resumen nuevo (`entity_summary`, `entitySummary.ts`) y los tipos de `lib/api/*` siguen el estándar en inglés:
  es el camino a seguir.
- Mezcla en una misma respuesta: `driver_name` / `tractor_plate` (inglés) junto con `vehiculos` (español).

### 4.3 Huérfanos y acoplamientos

- **`GET /trips/fleet-daily-overview`** (`B routers/trips.py:1459-~1656`, ~200 líneas) y
  `tripsApi.fleetDailyOverview` (`F lib/api/trips.ts:227`): ningún componente los llama (`grep` en `app`,
  `components`, `hooks`); quedó tras la Tarea 15 (`monitor/page.tsx:345`). Solo lo ejercitan tests
  (`tests/test_config_monitor.py:356-383`).
- **`carriersApi.listContacts`** / `GET /carriers/{id}/contacts`: sin consumidor.
- **Consultas copiadas entre routers:** el roster activo (`services/driver_roster.py`) lo importan
  `daily_closures.py` y `status_report.py` (bien), pero `routers/equipment_closures.py:108-118`, `routers/trips.py:1240-1358`,
  `services/pre_cierre.py:232-403`, `services/fleet_driver_gap.py` y `services/entity_summary.py` reescriben el join
  de asignaciones por su cuenta (D10).
- **Acoplamiento Directorio ↔ Cierre:** `carriers.py` importa `services/fleet_driver_gap.py`; `PATCH /carriers/{id}`
  y los `PATCH` de conductor y equipo disparan, vía triggers de base, el recálculo del Cierre sin que el cliente lo
  sepa (no hay señal en la respuesta del `PATCH`).
- **Permiso asimétrico:** `POST .../drivers` (asignar/transferir) exige `DIRECTORY_EDIT` y `DELETE .../drivers/{id}`
  exige `DIRECTORY_DELETE`; el frontend ya lo corrigió una vez (`carriers/[id]/page.test.tsx:347`).

## 5. Tamaño de archivos, tests, identificadores

### 5.1 Archivos de más de 400 líneas (zona auditada)

Frontend: `lib/types.ts` 2.136; `compliance/[carrierId]/page.tsx` 1.076; `carriers/[id]/page.tsx` 972;
`FlotaDelDiaSection.tsx` 950; `InsurancePolicyModal.tsx` 878; `monitor/page.tsx` 773; `TriageWorkbench.tsx` 632;
`closures/page.tsx` 604; `TripTable.tsx` 603; `TripBulkUpload.tsx` 472; `GestionPanel.tsx` 467;
`VehicleDetailPanel.tsx` 466; `PasoViajesSection.tsx` 432.
Backend: `routers/trips.py` 3.287; `routers/compliance.py` 2.099; `routers/carriers.py` 997; `services/cierre_lineas.py`
752; `routers/document_ingest.py` 673; `routers/status_report.py` 603; `routers/policies.py` 457; `routers/drivers.py` 444.

Las dos fichas y `carriers.py` concentran lectura, escritura, asignación, seguros y exportación en un solo archivo;
la ficha de Certificación define tres componentes y once consultas dentro del mismo archivo.

### 5.2 Tests

- **Ningún test cubre la invalidación de las mutaciones del Directorio.** `carriers/[id]/page.test.tsx`,
  `DriverDetailPanel.test.tsx`, `VehicleDetailPanel.test.tsx` y `NewCarrierPanel.test.tsx` crean un `QueryClient`
  nuevo y no consultan qué claves quedaron inválidas (`grep invalidate` solo aparece en `useSubirDocumento.test.tsx`,
  `MoveToCarrierBar.test.tsx`, `PendingHoldersPanel.test.tsx`, `TriageWorkbench.undo.test.tsx`).
- **`lib/queries/certificacion.ts` no tiene test** que compare `RAICES_DE_CERTIFICACION` con las claves que las
  pantallas leen. Su propio docstring cuenta que la lista "ya perdió una raíz dos veces"; `carriers-directorio` y
  `compliance-record-file` siguen fuera.
- **Prueba candidata a fijar un defecto:** `carriers/page.test.tsx:147` ("un conductor sin empresa se muestra igual,
  y no finge un destino") asegura que un conductor sin empresa no tiene enlace; es coherente con `EntityRedirect`,
  pero consagra que desde la búsqueda del Directorio no se puede asignar empresa (la acción existe solo en
  Certificación, `compliance/page.tsx:316`). Se marca como a revisar, no como defecto confirmado.
- No se encontró un test que afirme el comportamiento obsoleto (ninguno verifica que algo "no" se invalide).

### 5.3 Identificadores en español en código nuevo (10-11/10)

Frontend: `lib/navegacion/` (carpeta; archivos en inglés), `lib/cierre/gruposDeViajes.ts`,
`lib/monitor/clientesDelFiltro.ts`, `lib/reporte/{arbolDeAsignados,sumar,tiposDeOperacion,exportarReporte}.ts`,
`components/dashboard/{AjustesPosterioresAlCierre,IndicadorDeAjustes,AvisoFueraDeEnCurso,AvisoDeActualizacion,
ResultadosDelDirectorio,AltaDeFlota,AltaConductorDesdeCierre,VincularConductorPropuesto}.tsx`,
`hooks/useMotivosDeAnulacion.ts`, claves de caché `'directorio-buscar'`, `'carriers-directorio'`, `'origenes'`,
`'taxonomias'`. Backend: `services/{reglas_del_monitor,ventana_en_curso,cliente_del_viaje,cola_del_cierre,
cierre_lineas}.py`, rutas `/buscar`, `/directorio`. El código del 11/10 más cercano al Directorio
(`entity_summary.py`, `entitySummary.ts`, `EntityQuickView.tsx`, `EntityRedirect.tsx`) sí está en inglés.

## 6. Hallazgos

Severidad: **bloquea** = el usuario no puede completar su trabajo o ve un dato falso; **confunde** = ve dos
respuestas distintas; **costo interno** = deuda que encarece cambios.

| ID | Hallazgo | Evidencia | Efecto para el usuario | Causa raíz | Severidad |
|---|---|---|---|---|---|
| C-1 | Ninguna mutación del Directorio invalida Certificación, Cierre, Monitor ni la vista rápida | `F carriers/[id]/page.tsx:220-223,226-314`; `DriverDetailPanel.tsx:112`; `VehicleDetailPanel.tsx:184,198`; `NewCarrierPanel.tsx:45` | Se da de baja a una empresa o se cambia el tipo de operación de un tracto y el embudo, el Cierre y la vista rápida siguen mostrando lo anterior hasta 60 s (o hasta recargar si la pantalla quedó montada) | Las claves se declaran dentro de cada pantalla; no hay lista de "qué depende de un cambio del Directorio" como la que sí existe para Certificación | bloquea |
| C-2 | La invalidación de Certificación no alcanza el Directorio | `F lib/queries/certificacion.ts` (`RAICES_DE_CERTIFICACION` sin `carrier-drivers`, `carrier-assets-roster`, `carriers`, `carriers-directorio`, `carrier-detail`); `compliance/[carrierId]/page.tsx:517,1070`, `compliance/page.tsx:322` | Dar de baja o transferir un conductor desde Certificación deja el roster de la ficha del Directorio con el conductor; el resumen "Directorio" de Certificación no cambia | Las dos mitades del sistema tienen listas de invalidación disjuntas | bloquea |
| C-3 | El roster de conductores sale de una vista materializada que no se refresca al editar `drivers` | `B routers/carriers.py:717`; `migrations/20260716214630_...sql:35-45,87-97`; `B routers/drivers.py:320` | Renombrar o dar de baja a un conductor: el panel lo muestra bien y la lista de la ficha sigue con el nombre y el estado anteriores, incluso tras recargar, hasta que otro evento refresque las vistas | Trigger de refresco puesto en `assets` (04/08) pero no en `drivers`; el roster de equipos se parchó leyendo en vivo, el de conductores no | bloquea |
| C-4 | Un cambio del Directorio llega al Cierre con rezago de servidor y solo `daily-closure` avisa | `B services/cola_del_cierre.py`; `migrations/20261010220000_...sql:56-73`; `F closures/page.tsx:158` (único `refetchInterval`); `equipment-closures` sin él | Se corrige el origen habitual o el tipo de operación, se abre el Cierre y la fila de tractos sigue vieja sin aviso; la de conductores dice "Actualizando…" | El patrón de frescura se aplicó a una de las dos consultas del Cierre; el `PATCH` no informa que dejó un recálculo pendiente | confunde |
| C-5 | Dos claves de caché para la misma empresa y raíz mal elegida para el panel de la lista | `F TransporterSlideOver.tsx:42` (`['carriers','detail',id]`) contra `carriers/[id]/page.tsx:192` (`['carrier-detail',id]`) | Se edita en la ficha, se vuelve a la lista y el panel lateral muestra datos viejos; si se invalidara `['carriers']` para refrescar la lista, se tiraría también el detalle | La lista y la ficha nacieron en momentos distintos; no hay fábrica de claves como `clavesCertificacion` para el Directorio | confunde |
| C-6 | `['carriers-directorio']` no pertenece a ninguna lista de invalidación | `F DirectorioResumen.tsx:26`; `lib/queries/certificacion.ts` | Tras crear empresas, dar de baja o transferir, las cifras de "Directorio" en Certificación (activas, tractos, conductores) no cambian | Raíz olvidada en la lista; el docstring de `certificacion.ts` ya documenta este modo de falla | confunde |
| C-7 | Transferir en el Directorio solo invalida el roster de origen | `F carriers/[id]/page.tsx:267-279` (`invalidateDrivers/Assets` usan `id` de la ficha) | Si se abre la ficha de la empresa destino dentro del minuto, no aparece el conductor transferido | `invalidate*` está atado a `id` de la ficha, no a la empresa que cambió | confunde |
| C-8 | Dos fichas de empresa con capacidades repartidas | D1, `compliance/[carrierId]/page.tsx` (`GestionDeclarada`: 2 usos; `carriers/[id]/page.tsx`: 0), contactos/pólizas/renombrar/eliminar/exportar solo en el Directorio | Para corregir el tipo de gestión hay que ir a Certificación; para renombrar o cargar contactos, al Directorio; el usuario no sabe cuál es "la" ficha | Certificación construyó su ficha en lugar de reutilizar el Directorio (el propio código lo dice: "en la ficha vieja ... fuera del menú") | confunde |
| C-9 | El mismo estado con dos nombres | D3: `TransporterCard.tsx:13` contra `types.ts:958` | "Inactiva" en la lista y el panel, "Dada de baja" en la ficha del Directorio, "Inactiva" otra vez en la ficha de Certificación | Dos diccionarios; el segundo se creó para corregir al primero y no lo reemplazó | confunde |
| C-10 | Cinco buscadores con reglas distintas | D5 | Un RUT con puntos funciona en el Directorio y no en los selectores de empresa y conductor; el selector de conductores oculta inactivos y empresas inactivas | `canonical_rut`/`canonical_plate` solo se aplicaron a `/carriers/buscar` (`carriers.py`) | confunde |
| C-11 | La búsqueda de conductores puede devolver un conductor dos veces | `B routers/drivers.py:58-61` (`LEFT JOIN vda` sin `LATERAL`), contra `B services/entity_summary.py:88-96` | En `DriverSearchPicker` y `TripAssignDialog` un conductor con dos tractos activos aparece duplicado | Tercera copia de la consulta "conductor + empresa + tracto" sin el cuidado de la más nueva | confunde |
| C-12 | Predicado de asignación activa escrito ~52 veces y sin definición única de "activo" | D10 | "Cuántos conductores tiene la empresa" difiere entre `/carriers/directorio`, `entity_summary`, el roster y el cierre, según incluyan o no el estado del conductor | Sin vista ni función SQL compartida (el Lente B mide la divergencia real) | costo interno |
| C-13 | Monitor no enlaza a la empresa ni al conductor | `F TripTable.tsx`, `TripDetailView.tsx` (sin `EntityCell` ni `navegacion/directory`) | Desde una fila del Monitor no se llega a la ficha ni a la vista rápida; el Cierre sí lo permite | La vista rápida se construyó solo para el Cierre | confunde |
| C-14 | URLs de fichas escritas a mano en 14 sitios | D11 | Los enlaces literales no llevan `?next=`, así que al volver desde la ficha se pierde el Cierre | `lib/navegacion/directory.ts` apareció después de los enlaces | costo interno |
| C-15 | Endpoint y cliente huérfanos | `B routers/trips.py:1459-~1656`, `F lib/api/trips.ts:227`, `carriersApi.listContacts`, `B cache.py:invalidate_trips_meta_cache` | Ninguno directo; ~200 líneas mantenidas sin uso | Reemplazo parcial (Tarea 15, caché público retirado el 09/10) sin borrar lo viejo | costo interno |
| C-16 | Cada `UPDATE` sobre `public.assets` dispara cinco `REFRESH MATERIALIZED VIEW CONCURRENTLY` | `migrations/20260804010000_...sql`, `refresh_carrier_view()` | Editar un equipo es más lento cuanto más crece el padrón; cargas masivas pagan una vez por sentencia | Un trigger genérico refresca todas las vistas aunque el cambio afecte a una | costo interno |
| C-17 | Archivos monolíticos | §5.1 | Cada arreglo en una ficha exige leer ~1.000 líneas y arriesga tocar otra función | Las fichas acumularon alta, baja, transferencia, seguros y exportación | costo interno |
| C-18 | Sin tests de sincronía | §5.2 | Los C-1, C-2 y C-6 llegaron a dev sin que ninguna prueba fallara | Los tests montan `QueryClient` nuevo y no afirman sobre `invalidateQueries` | costo interno |
| C-19 | Nomenclatura mezclada | §4.2, §5.3, D13 | n/a para el usuario; el equipo escribe y busca con dos vocabularios | Estándar en inglés adoptado el 10/10 y aplicado solo al código más nuevo | costo interno |

## 7. Orden sugerido para la síntesis (no es spec)

1. Una sola fábrica de claves y una función `invalidarDirectorio(qc)` que cubra las claves de §3.2, usada por **todas**
   las mutaciones de §3.3 (incluidas las de Certificación, Cierre y Monitor). Cierra C-1, C-2, C-5, C-6, C-7 y C-18.
2. Trigger de refresco (o lectura en vivo) para `public.drivers`. Cierra C-3 y conviene resolverlo junto con C-16.
3. Decisión de producto sobre una ficha por entidad (C-8, C-9, C-13): condiciona el resto.
4. `refetchInterval` / aviso de frescura para `equipment-closures` y `cierre-viajes` (C-4).
5. Limpieza: huérfanos (C-15), predicado único (C-12), nomenclatura (C-19), archivos (C-17).
