# Hallazgos — Reporte Detalle de IANSA (QAnalytics)

Investigación en vivo del 2026-08-07 vía `extraction_service/scripts/inspect_iansa_report.py`.
Insumo obligatorio para las Tasks 2, 4, 5 y 6 del plan
`2026-08-07-iansa-scraper-redesign.md`.

## Navegación — el `goto()` directo NO sirve

El plan original asumía navegación directa por URL. **Es incorrecto y flaky**:
el login dispara un redirect asíncrono, y un `goto()` lanzado antes de que
termine es bounceado a `inicioQMGPS.aspx` (reproducido). El post-login real
aterriza en `gestion_planificacion_programados_dist_transporte_iansa.aspx`
(Monitor de Viajes).

**La navegación correcta es por menú** — el mismo patrón que ya usan
`cumplimiento_sap.py` y `cumplimiento_citas.py`:

```python
await page.click('a.dropdown-toggle.NavQA >> text="Reportes"')
await page.click('a[href="gestion_reporte_detalle_cumplimiento_iansa_trans.aspx"]')
```

Estructura de menú confirmada para el tenant IANSA:

| Dropdown | Items |
|---|---|
| Módulo Distribución | Monitor de Viajes, Monitor Adicional |
| Modulo Tendering | Carga Excel Conductores, Conductores, Reporte Historial, Solicitudes |
| **Reportes** | **Reporte Detalle** ← el que queremos, Reporte Reportabilidad |

## Gotcha: `client_name` es el TENANT, no una etiqueta

En QAnalytics, `client_name` se escribe literalmente en el campo `ClienteT`
del formulario de login (`QAnalyticsExtractor._login`), o sea **identifica el
tenant**. No es una etiqueta libre como en Sodimac.

Un valor inválido no falla en el login: QAnalytics acepta la credencial y
aterriza en la home genérica (`inicioQMGPS.aspx`), que no tiene el menú
"Reportes" → el extractor muere recién al buscar el menú, con un
`Timeout 30000ms exceeded` que no dice nada del verdadero problema.
(Reproducido: un smoke test con `client_name="smoketest-iansa"` falló así.)

Para este extractor el único valor válido es **`iansa`**.

## Selectores confirmados

| Función | Selector | Nota |
|---|---|---|
| Fecha desde | `#txt_f1` | Distinto de las otras 3 páginas |
| Fecha hasta | `#txt_f2` | Distinto de las otras 3 páginas |
| Buscar | `#btnImg` | No existe `#btn_buscar` acá |
| Exportar | `#BtExportar` | Botón submit, no el link `onclick="exportar_tabla()"` |

**Los inputs de fecha fallan las comprobaciones de "actionability" de
Playwright** — `fill()` e `input_value()` cuelgan 30s y timeoutean, aunque un
`eval_on_selector_all` crudo los lee sin problema. Hay que leer y escribir
vía `page.evaluate`/jQuery, nunca por locator. (El resto de extractores
qanalytics ya escriben por jQuery por el datetimepicker, pero además
*verifican* con `locator(...).input_value()` — esa verificación hay que
hacerla por JS acá.)

## Mecanismo de búsqueda: partial postback, no navegación

`#btnImg` NO recarga la página. Dispara un **UpdatePanel AJAX** (POST a la
misma `.aspx`). Medido:

- `expect_navigation` → timeout a los 45s (nunca ocurre).
- `expect_response(POST .aspx == 200)` → resuelve en **0.4s**. ✓

Sirve el mismo patrón de la clase base (`_submit_search`), solo cambiando el
selector del botón. Hace falta un settle posterior (~3s): el evento de
response llega con los headers, no con el DOM ya re-renderizado.

## Exportación: descarga directa ✓

`#BtExportar` dispara una descarga real, capturable con `page.expect_download`.

- Nombre sugerido: `Reporte Detalle.xls`
- **Formato real: HTML disfrazado de `.xls`** (Excel-compatible HTML, tabla
  `<table>` plana). Es exactamente lo que `processor_qanalytics_iansa_files.py`
  ya maneja hoy con `pd.read_html()` — no requiere cambiar el parseo.
- **El export NO está paginado**: la tabla en pantalla muestra ~7 filas por
  página (hay un input `TXT_Pagina`), pero el archivo exportado trae el set
  completo filtrado (151 filas en la corrida de prueba). No hay que iterar
  páginas.
- El export respeta el filtro de fechas seteado (verificado: con rango
  01-06-2026→07-08-2026 trajo filas de 02/06 y 04/08, ambas fuera del rango
  por defecto de la página).

## Columnas reales (27)

Corrida de prueba: rango 01-06-2026 → 07-08-2026, 151 filas de datos,
127 viajes únicos.

| # | Columna | Nivel | Nota |
|---|---|---|---|
| 1 | `Viaje` | viaje | **ID del viaje** (formato `IA153325`). 0 celdas vacías |
| 2 | `N° Transporte` | viaje | 20 vacías |
| 3 | `Origen` | viaje | Ej. `CD Noviciado`, `Sitrans` |
| 4 | `FH Carga` | viaje | `04/08/2026 0:00:00` |
| 5 | `FH llegada Ori.` | viaje | 45 vacías |
| 6 | `FH Salida Ori` | viaje | 41 vacías. Sin punto final (inconsistente con las demás) |
| 7 | `Estadia Ori.` | viaje | `01:29` (duración, no timestamp). Sin tilde |
| 8 | `Cumplimiento Ori.` | viaje | `CUMPLE` / `NO CUMPLE` |
| 9 | `Tracto` | viaje | Patente. Columna propia, no embebida como en Walmart |
| 10 | `Transporte` | viaje | Siempre `T. WEBCARGA` (ya viene scoped al carrier) |
| 11 | `Trailer` | viaje | Patente. 81 vacías |
| 12 | `Destino` | **parada** | Ej. `Z1428 - CD NOVICIADO` |
| 13 | `FH Planificada` | **parada** | Fecha de planificación del destino |
| 14 | `FH Llegada Des.` | **parada** | 46 vacías |
| 15 | `FH Salida Des.` | **parada** | 47 vacías |
| 16 | `Estadía Des.` | **parada** | Con tilde (a diferencia de `Estadia Ori.`) |
| 17 | `Cumplimiento Des.` | **parada** | |
| 18 | `Conductor` | viaje | Ej. `CARLOS PEREZ /` (barra al final) |
| 19 | `Tipo` | viaje | Siempre `Bodega` en la muestra |
| 20 | **`Est. Viaje`** | viaje | **EL ESTADO DEL VIAJE** — ver abajo |
| 21 | `Estado Arribo` | viaje | Vacía en las 151 filas |
| 22 | `FH Rendición` | viaje | Vacía en las 151 filas |
| 23 | `Estado Rendición` | viaje | Ej. `PENDIENTE` |
| 24 | `Fecha Cancela` | **parada** | 127 vacías. Varía dentro del viaje en 2 casos |
| 25 | `User Cancela` | viaje | 127 vacías |
| 26 | `Obs Cancela` | viaje | Vacía en las 151 filas. **Tiene espacio final en el HTML** (`Obs Cancela `) |
| 27 | `N° Entrega` | **parada** | **Principal causa de filas múltiples**. Espacio final en el HTML |

**Ojo con los nombres**: `Obs Cancela ` y `N° Entrega ` traen un espacio al
final en el HTML crudo. `processor_qanalytics_iansa_files.py` ya hace
`.str.strip()` sobre las cabeceras, así que en el DataFrame llegan limpias —
el mapeo de columnas debe usar los nombres **sin** espacio final.

## `Est. Viaje` — resuelve el bug de `raw_estado` NULL

Esta es la columna que hoy falta y por la que `stg_qanalytics_trips.sql` tiene
el fix de Fase 0 (2026-07-18) documentando que "el payload de IANSA no trae
'Estado'". Valores en la muestra:

| Valor | Filas |
|---|---|
| `CERRADO FINALIZADO` | 101 |
| `CERRADO INCOMPLETO` | 24 |
| `CANCELADO` | 24 |
| `ASIGNADO` | 1 |
| `EN LOCAL` | 1 |

**Compatible con la taxonomía qanalytics existente**: `CERRADO%` y `CANCELADO`
son exactamente los estados terminales que ya contempla el guard de
terminalidad agregado en la Ronda 93 (bug 2.2), y `EN LOCAL`/`ASIGNADO` ya
existen en el vocabulario de Walmart. No hace falta taxonomía nueva.

## Estructura de filas — NO es "una fila = una parada"

Hallazgo material, distinto del Monitor de Viajes de Walmart.

De 127 viajes, 13 tienen más de una fila (37 filas en total). Qué varía
dentro de un mismo viaje:

| Columna | Viajes donde varía (de 13 multi-fila) |
|---|---|
| `N° Entrega` | **11** |
| `Destino` + `FH Planificada` + `FH * Des.` + `Cumplimiento Des.` | **1** |
| `Fecha Cancela` | 2 |
| todas las demás | 0 |

**La causa dominante de filas múltiples son entregas distintas al MISMO
destino, no paradas distintas.** Ejemplo real (`IA148262`, 4 filas): las 27
columnas son idénticas salvo `N° Entrega` (`5240205397`, `...396`, `...395`,
`...398`).

Multi-destino real existe pero es raro — 1 viaje de 127 (`IA153036`, 2
destinos: `5108556 - Family Market...` y `5108405 - Family Market...`, con 3
filas porque uno de los destinos tiene 2 entregas).

### Implicancia para el transformer

Emitir una parada por fila crearía **paradas DESTINATION duplicadas** aguas
abajo — exactamente la clase de bug de duplicación de `trip_stops` que ya
tenemos abierta. El transformer debe **deduplicar las paradas por
`(Destino, FH Planificada)`** dentro de cada viaje, agregando los `N° Entrega`
como lista.

Colapso esperado: **151 filas → 128 paradas únicas** para 127 viajes (o sea,
126 viajes con 1 destino + 1 viaje con 2).

### `ffill` no hace falta

A diferencia del reporte de Walmart (donde la metadata del viaje viene en
blanco en las filas de continuación), **acá todas las filas están completas**:
`Viaje` tiene 0 celdas vacías y las columnas de nivel viaje se repiten
íntegras en cada fila. La lógica de `ffill` del transformer actual es
innecesaria para este reporte (inofensiva, pero no aporta).

## Mapeo propuesto para `TENANT_COLUMN_MAPS["iansa"]`

```python
"trip_id_column": "Viaje",
"cols_viaje": [
    "Viaje", "N° Transporte", "Origen", "FH Carga", "FH llegada Ori.",
    "FH Salida Ori", "Estadia Ori.", "Cumplimiento Ori.", "Tracto",
    "Transporte", "Trailer", "Conductor", "Tipo", "Est. Viaje",
    "Estado Arribo", "FH Rendición", "Estado Rendición", "User Cancela",
    "Obs Cancela",
],
"cols_parada": [
    "Destino", "FH Planificada", "FH Llegada Des.", "FH Salida Des.",
    "Estadía Des.", "Cumplimiento Des.", "Fecha Cancela", "N° Entrega",
],
"stop_identity_cols": ["Destino", "FH Planificada"],
```

## Formato de fecha/hora

`DD/MM/YYYY H:MM:SS` con hora sin cero a la izquierda (`04/08/2026 8:39:35`,
`03/06/2026 2:26:32`). Distinto del `DD-MM-YYYY` que usan los inputs de
filtro. Las duraciones (`Estadia Ori.`, `Estadía Des.`) son `HH:MM`, no
timestamps — no parsearlas como fecha.
