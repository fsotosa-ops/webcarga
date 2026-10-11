# Reporte de estatus del día: un selector de tipo, secciones por pregunta y tablas plegables — diseño

Fecha: 2026-10-11 · Estado: diseño aprobado en conversación por partes (11/10), spec en revisión · Rama: `dev`
Minuta 09/10, ítems 8 (separar Tractoreo y Equipo Completo) y 14 (asignados por cliente y CD). Referencia de
contenido: `monitor-app/bugs/20261009/reporte_estatus_2026-10-07.csv`, la exportación anotada por Pablo.

## 1. Contexto

El reporte (Cierre › Reporte, `components/dashboard/sections/StatusReportSection.tsx`) tiene hoy 8 pestañas
numeradas, con tablas anchas y muchas columnas en 0. En "2. Asignado" del 09/10, 4 columnas de "trabajó sin
asignación" dan 0 en todas las filas; en "4. Sin trabajar" hay 16 columnas de motivo, casi todas en 0. Tractoreo y
Equipo Completo no se pueden comparar de la misma forma: el CSV de Pablo los pone en tablas paralelas, y el reporte
solo trae Equipo Completo en la utilización por empresa.

**Estándar que se sigue** (reportes operativos diarios de Power BI, Looker y las herramientas de flota como
Samsara):
1. Primero la respuesta (3–5 cifras) y después el detalle.
2. Un corte principal elegido una vez, arriba, en vez de repetir cada tabla.
3. Tablas agrupadas y plegables, como una tabla dinámica de Excel (el "cubo" que describió Pablo).
4. No mostrar columnas que no informan (todas en 0).
5. Pocas secciones, nombradas por la pregunta que responden.

**Decisiones del usuario (11/10):** selector arriba (no lado a lado ni uno debajo del otro); las 6 secciones de la
§2; nombres en inglés para lo nuevo de la API.

## 2. Cómo se ve

Encabezado, en una fila: selector `[ Tractoreo | Equipo Completo ]` (Tractoreo por defecto), filtro de cliente
(hoy "WebCarga consolidado") y acciones (Descargar PDF, Descargar Excel, Copiar estatus, Ver histórico).

Seis secciones como pestañas, todas del tipo elegido salvo Dotación:

| Hoy | Sección nueva | Responde |
|---|---|---|
| 1. Resumen, 7. General | **Resumen** | ¿Cómo nos fue? 4 cifras (equipos activos, asignados, no trabajaron, % utilización); asignados por cliente; enrolados vs asignados por origen habitual |
| 2. Asignado | **Asignados** | ¿Quién cargó y dónde? Árbol Cliente → Origen del viaje → Empresa con RM, Z0, Región, Sin clasificar y Total; subtotales y total al pie. Debajo: "Trabajaron sin asignación" (si hubo) y "Cargaron en otro origen" |
| 3. Vueltas | **Segundas vueltas** | Patente, empresa, conductor, origen, tipo de destino, vueltas |
| 4. Sin trabajar | **No trabajaron** | Resumen por motivo (solo los que ocurrieron) y detalle: por conductor en Tractoreo (con el faltante de dotación en "Sin conductor", como hoy), por equipo en Equipo Completo |
| 5. Tractoreo — Empresas, 6. Eq. Completos | **Empresas** | Utilización por empresa del tipo elegido |
| 8. Dotación | **Dotación** | Igual que hoy |

- **Árbol de Asignados:** cada cliente es una fila con su subtotal; se abre para ver sus orígenes y cada origen
  para ver sus empresas. Abiertos por defecto el primer nivel (clientes), cerrados los orígenes.
- **Columnas en 0:** no se dibujan las de "trabajó sin asignación" ni las de motivo que dan 0 en todas las filas.
- **Teléfono:** el selector y las pestañas se desplazan en horizontal; cada tabla tiene su scroll, como hoy.

### Estados

| Estado | Qué se ve |
|---|---|
| Cargando | El indicador de siempre |
| Sin datos del tipo elegido | Mensaje: "Hoy no hubo equipos de Equipo Completo asignados" (o el que corresponda a la sección), nunca una tabla vacía con encabezados |
| Formato viejo (despliegue a medias) | "Actualizando el reporte…" |
| Error al cargar | Mensaje con "Reintentar" |
| Sin permiso | No aplica: el reporte es de lectura con `operations.read`, igual que hoy |

## 3. Datos (API)

`GET /api/v1/status-report?fecha&client` devuelve los dos tipos en una sola respuesta, así el selector cambia sin
volver a pedir. Las claves nuevas van en inglés; reemplazan a las viejas (`section1_resumen`,
`section2_tractoreo_asignado`, `section3_vueltas`, `section4_tractoreo_no_trabajando`,
`section_tractoreo_por_empresa`, `section5_equipos_completos`, `section6_resumen_general`,
`section7_desvios_de_cd`), que se retiran en el mismo cambio.

```
{
  business_date, client_filter, calculado_a, pendiente_desde,
  by_operation_type: {
    tractoreo:       <OperationTypeReport>,
    equipo_completo: <OperationTypeReport>
  }
}

OperationTypeReport = {
  summary: {
    total, assigned, not_working, utilization_pct,
    by_client:     [{ client_name, assigned }],
    by_home_origin:[{ origin, enrolled, assigned }]
  },
  assigned: {
    rows: [{ client_name, origin, carrier_name, rm, z0, region, unclassified, total }],
    other_origin: [{ tractor_plate, carrier_name, home_origin, origin, client_name }]
  },
  worked_without_assignment: {
    reasons: [string],                                  // solo los que ocurrieron, en el orden del catálogo
    rows: [{ origin, carrier_name, counts: { <reason>: n }, total }]
  },
  second_legs: [{ tractor_plate, carrier_name, driver_name, origin, destination_zone, legs }],
  not_working: {
    reasons: [string],                                  // solo los que ocurrieron, en el orden del catálogo
    by_reason: [{ origin, carrier_name, counts: { <reason>: n }, total }],
    detail: [{ name, carrier_name, home_origin, reason, tractor_plate }]
  },
  carriers: [{ carrier_name, enrolled, assigned, unassigned, utilization_pct }]
}
```

- **Sin consultas nuevas a la base, salvo una columna.** Todo sale de `_build_asset_rows` y `_build_driver_rows`
  (`routers/status_report.py`), que ya traen el tipo de cada equipo (`categories`), su cliente, su zona, su
  origen real y habitual, y su motivo. Se reorganiza en Python por tipo. Lo único que se agrega a
  `_TODAY_TRIPS_SQL` es el conductor resuelto del viaje (`v_trip_fleet_resolution.resolved_driver_id` → nombre),
  para `second_legs.driver_name`.
- **`not_working.detail`:** en Tractoreo, una fila por conductor (`name` = conductor, `tractor_plate` = su tracto
  habitual), más el faltante de dotación sumado en "Sin conductor" como hoy (`compute_fleet_driver_gap`). En Equipo
  Completo, una fila por equipo sin carga en el grupo "no trabajó" (`name` = patente, `reason` = motivo de su línea).
- **Motivos:** `reasons` trae solo los motivos con al menos un caso ese día, en el orden del catálogo de
  Configuración (`_columnas_de_motivo` deja de agregar los que no aparecen).
- **Filtro de cliente:** igual que hoy (`_filter_by_client`).
- **Dotación** sigue en su endpoint (`fleet-driver-gap`), sin tipo.

### Una sola definición del árbol

`lib/reporte/arbolDeAsignados.ts` arma, desde `assigned.rows`, el árbol Cliente → Origen → Empresa con subtotales
(reutiliza `sumar` de `lib/reporte/exportarReporte.ts`). Lo usan la pantalla, el Excel y "Copiar estatus", así los
tres dan los mismos números.

## 4. Excel, copiar y PDF

- **Excel:** trae los dos tipos aunque se esté viendo uno, porque Pablo lo cruza con su planilla. Una hoja por
  sección y tipo ("Asignados · Tractoreo", "Asignados · Eq. Completo", …) y una hoja de Dotación. La de Asignados
  sigue el CSV de Pablo: columnas Cliente, Origen, Empresa, RM, Z0, Región, Sin clasificar, Total; las filas de
  subtotal (cliente y origen) en negrita y el total general al pie.
- **Copiar estatus:** copia la sección y el tipo a la vista, con el encabezado "Estatus del día 09/10 · Tractoreo ·
  Asignados". Lo plegado se copia como se ve: con su subtotal, sin el detalle oculto.
- **PDF:** el resumen imprimible de una página muestra los dos tipos lado a lado (cifras clave y asignados por
  cliente).

## 5. Pruebas

- **Backend (integración con ROLLBACK, datos sintéticos):** los dos tipos traen sus seis claves; un equipo de
  Equipo Completo no aparece en Tractoreo y al revés; las filas de `assigned.rows` suman el `summary.assigned` del
  tipo; `reasons` solo trae motivos con casos; `second_legs` trae el conductor; `not_working.detail` de Equipo
  Completo lista equipos.
- **Frontend (vitest):** el selector cambia todas las secciones; el árbol abre y cierra y sus subtotales cuadran;
  no se dibujan columnas en 0; el Excel trae hojas de los dos tipos; copiar respeta lo plegado; los estados vacío,
  formato viejo y error se ven.
- **Dev (Playwright):** el 09/10 en la app; los totales de Asignados del 07/10 contra el CSV de Pablo (32 en
  Tractoreo, 8 en Equipo Completo), explicando cualquier diferencia.

## 6. Fuera de alcance

- Cambiar qué cuenta como asignado, la regla de las vueltas o el origen habitual (ya resueltos).
- Exportar a PDF por sección (sigue el resumen de una página).
- Los ítems 20, 21 y 23 de la minuta.
