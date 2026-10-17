# Seguros por empresa: ¿cada transportista está al día con sus pólizas?

**Fecha:** 2026-10-17 · **Rama:** `dev` (nada a `main`) · **Construye sobre:**
`2026-10-15-seguros-polizas-y-cuotas-design.md` (modelo de hechos y estados calculados, en dev) · **Maqueta aprobada:**
`.superpowers/brainstorm/78194-1792268599/content/seguros-opcion-c.html` (opción C, usuario 17/10).

## Por qué

El spec del 15/10 trató Cuotas como "la cola de pagos". El usuario lo corrigió el 17/10: **WebCarga no paga las
cuotas; monitorea si cada empresa de transporte está al día con sus pólizas.** La pregunta de quien entra a Seguros
es "¿qué transportistas no están al día, y por qué?", y la unidad es la empresa, no la cuota.

Hoy eso no se puede leer de un vistazo:

- **Cuotas** es una lista plana de todas las cuotas: una póliza con 12 cuotas aparece 12 veces, y el monto en UF
  (`amount_uf`) no se suma en ningún lado.
- **Pólizas** tiene un modo "por empresa", pero su estado principal es el de la **vigencia** de la peor póliza: una
  empresa con póliza vigente y 5 cuotas vencidas se lee "Vigente".
- El **veredicto** ya existe a medias en la base (`app.carrier_insurance_summary`: `worst_state`,
  `overdue_installments`, `insurance_alert`), pero cada pantalla combina esas piezas a su manera.

## Estándar de la industria, y por qué la opción C

Las plataformas de seguimiento de seguros de terceros (myCOI, TrustLayer, Billy; Avetta para contratistas) bajan la
carga cognitiva con cuatro reglas, y esta spec las sigue:

1. **Gestión por excepción:** la pantalla abre en lo que pide acción; lo que está bien se cuenta, no se lista.
2. **Una fila por cuenta, sin anidar:** veredicto, **una** razón y la próxima fecha. Nada de tablas de tres niveles
   (empresa › póliza › cuota), que obligan a leer tres tipos de fila con columnas distintas.
3. **Maestro-detalle:** el detalle (pólizas y sus cuotas) se abre en un panel al tocar la empresa.
4. **Un solo vocabulario:** los mismos veredictos, con un color por significado, en todas las pantallas.

Se compararon tres opciones (maquetas en la carpeta de arriba): A, dos listas agrupadas con subtotales; B, una lista
de tres niveles; **C, lista plana por empresa + panel, elegida por el usuario (17/10)**. C además no necesita agregar
agrupación a la tabla compartida del kit.

## Objetivo

1. Ver en una pantalla **qué empresas no están al día y por qué**, ordenadas por gravedad.
2. Un **veredicto único por empresa**, calculado en un solo lugar y mostrado igual en Seguros, la ficha de empresa y
   el Monitor.
3. El detalle de una empresa (sus pólizas, y en cada una sus cuotas impagas) en un panel, sin salir de la lista.

**No es objetivo:** pagar, cobrar ni avisar a los transportistas; montos en pesos; que el transportista suba
comprobantes; cambiar las tablas del 15/10; agrupar filas en la tabla del kit.

**Quién marca pagado (usuario, 17/10):** alguien de WebCarga, desde la app, como hoy (`POST /installments/pay`, con
`policies.edit`, sin adjunto). No cambia.

**Anti-objetivo (sería un fracaso aunque funcione):** que el veredicto de una empresa diga una cosa en Seguros y otra
en el Monitor o en su ficha; que una empresa sin póliza no aparezca (son 18 de 36 activas al 15/10); que la razón de
una fila no coincida con su veredicto.

## El veredicto de una empresa

Se calcula en la base, en `app.carrier_insurance_summary` (columna nueva `insurance_verdict`), con "hoy" en hora de
Chile como el resto del módulo. Gana el primero que se cumple:

| Veredicto | Regla | Tono | Texto |
|---|---|---|---|
| `EXPIRED` | alguna póliza no renovada está vencida | urgente | Póliza vencida |
| `NO_POLICY` | no tiene pólizas (ninguna, o todas canceladas) | urgente | Sin póliza |
| `OVERDUE` | tiene cuotas vencidas | urgente si alguna póliza tiene 2 o más (la regla D2 del 15/10, por póliza como hoy), aviso si no | 3 cuotas vencidas |
| `NO_DATES` | alguna póliza sin fecha de término | aviso | Póliza sin fechas |
| `EXPIRING` | alguna póliza vence dentro de `poliza_por_vencer` (30 días) | aviso | Por vencer |
| `UP_TO_DATE` | ninguna de las anteriores | el de "Vigente" en el glosario | Al día |

- "**No al día**" = `EXPIRED`, `NO_POLICY`, `OVERDUE`, `NO_DATES`. "Por vencer" y "Al día" están al día.
- Veredicto y alerta viven **en la misma vista**: `insurance_alert` (Monitor) conserva su regla y sus valores de hoy
  (`EXPIRED`, `OVERDUE_INSTALLMENTS`, `EXPIRING`; los leen el filtro de `/trips`, `InsuranceAlertBadge` y
  `GestionPanel`). No se deriva del veredicto porque perdería casos: una empresa "Sin fechas" con 3 cuotas vencidas hoy
  tiene alerta. Así S6 del 15/10 sigue valiendo y ninguna pantalla recalcula nada.
- **Qué empresas tienen veredicto** *(llamada mía, igual que hoy)*: las activas, más las inactivas que aún tienen
  pólizas no canceladas. La vista se arma desde `public.carriers` (hoy esa unión vive en `_CARRIERS_CTE` de
  `insurance.py` y la vista solo tiene empresas con póliza); el `LEFT JOIN` de `insurance.py` se retira.
- *Llamada mía:* "Sin póliza" es no tener pólizas; si las tiene y vencieron, es "Póliza vencida" (así el Monitor sigue
  alertando a esas empresas, como hoy). El Monitor no gana una alerta nueva para "Sin póliza".
- *Llamada mía:* el orden conserva el de `_CARRIER_ORDER` (Vencida, Sin póliza, Sin fechas, Por vencer) y suma las
  cuotas vencidas en tercer lugar: una póliza vencida o inexistente deja al transportista sin cobertura; una cuota
  vencida, todavía no.
- Las cuotas impagas de una póliza renovada **siguen contando** (son deudas, decisión del 15/10).
- Texto y tono en `lib/states.ts` (`insuranceVerdictStyle`), como el resto del glosario.

### La razón de cada fila

La vista entrega, junto al veredicto, los datos que lo explican; la pantalla solo los redacta con el glosario
(`insuranceVerdictReason` en `lib/states.ts`), sin recalcular:

| Veredicto | Datos (columnas de la vista) | Texto |
|---|---|---|
| `EXPIRED` | aseguradora y `valid_to` de la póliza vencida más reciente; cuotas vencidas | "HDI venció el 23/09 · 2 cuotas vencidas" |
| `NO_POLICY` | — | "Activa sin pólizas registradas" (o "Dada de baja" si es inactiva) |
| `OVERDUE` | `oldest_overdue_date`, `unpaid_uf` | "La más antigua venció el 25/08 · 18,4 UF impagas" |
| `NO_DATES` | aseguradora de la póliza sin fechas | "Mapfre sin fecha de término" |
| `EXPIRING` | aseguradora y `valid_to` | "Mapfre vence el 02/11" |
| `UP_TO_DATE` | `next_due_date` | "Próxima cuota el 15/11" |

## Pantallas

### Seguros › Empresas (nueva, la entrada de Seguros)

- **Lista plana**, una fila por empresa, con la tabla del kit (`components/ui/tabla/data`, la del Cierre): columnas
  Empresa (nombre y RUT), Veredicto (chip), Por qué, Próxima fecha. Todas filtrables y ordenables como en el Cierre;
  la vista vive en la URL; "Descargar Excel" es la vista.
- **Abre en "No al día"**: recuadros-atajo (`ShortcutTiles`) **No al día · Por vencer · Al día**, con la cifra de
  empresas; "No al día" marcado al entrar. Son atajos del filtro de la columna Veredicto (el mismo que el embudo).
- **Orden por defecto:** por gravedad del veredicto, luego por más cuotas vencidas, luego por nombre.
- **Tocar una fila abre el panel de la empresa** (`PanelLateral`, sin fondo, como la vista rápida del Directorio):
  - Encabezado: nombre, RUT y el veredicto.
  - Una tarjeta por póliza no cancelada (las renovadas, solo si tienen cuotas impagas): aseguradora · N°, estado y
    vigencia, coberturas; adentro, **sus cuotas impagas** (N de M, UF, chip "Venció el / Vence el") y "N pagadas · ver
    todas"; enlace "Abrir la póliza" a la ficha de la póliza.
  - Sin pólizas: "Sin pólizas registradas" y, con `policies.edit`, "Registrar póliza".
  - Marcar cuotas como pagadas se hace en la ficha de la póliza o en Cuotas, como hoy (el panel no escribe).
- **El contador del menú** se mueve a **Empresas** y cuenta las empresas **No al día** (hoy, en Cuotas, cuenta cuotas
  vencidas: 151 al 17/10).

### Seguros › Pólizas y Seguros › Cuotas: listas de trabajo, planas

- Quedan como listas para tareas puntuales (renovar, extender, marcar pagadas en lote). **Pólizas pierde el modo
  "por empresa"** (`SegmentedControl` Póliza/Empresa y `CarriersInsuranceTable` se retiran): eso es Seguros › Empresas.
- En las dos, el nombre de la empresa abre el mismo panel de la empresa.
- Su paginación y filtros no cambian en esta entrega.

### Ficha de empresa y Monitor

- **Ficha de empresa:** el encabezado muestra el veredicto de Seguros (el mismo chip); su pestaña Seguros muestra el
  mismo contenido que el panel (las pólizas con sus cuotas impagas), con una sola pieza para los dos.
- **Monitor:** sigue mostrando `insurance_alert`. Sin cambio visible.

## Datos y API

- **Volumen (base real, 15/10):** 36 empresas activas, 33 pólizas, 294 cuotas. Seguros › Empresas carga la lista
  entera (36-60 filas) y filtra y ordena en el cliente con el kit, como el Cierre.
- `GET /insurance/carriers` (reemplaza a `GET /policies?group_by=carrier`): una fila por empresa con veredicto,
  `insurance_alert`, los datos de la razón, cuotas vencidas e impagas, `unpaid_uf` y `next_due_date`; `facets` por
  veredicto. Pide `insurance.read`.
- `GET /insurance/carriers/{id}` (nuevo): el veredicto y sus pólizas no canceladas, cada una con sus cuotas (una
  consulta, sin pedir póliza por póliza). Lo usan el panel y la pestaña Seguros de la ficha de empresa.
- **Migración:** solo reemplaza la vista `app.carrier_insurance_summary` (agrega `insurance_verdict`, los datos de la
  razón y `unpaid_uf`, y se arma desde `public.carriers`). No toca tablas ni datos. Se ensaya en la copia local y con
  `ROLLBACK` en la base real, y se aplica solo con autorización del usuario.

## Estados de cada pantalla

- **Cargando:** sin cifras en recuadros ni filas hasta tener el dato.
- **Vacío:** con "No al día" marcado y ninguna empresa: "Todas las empresas están al día" (no una tabla vacía).
- **Sin permiso:** sin `policies.edit` se ve todo y no se ven "Registrar póliza" ni acciones de escritura.
- **Teléfono:** la lista muestra Empresa y Veredicto (Por qué debajo del nombre); el panel ocupa la pantalla.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Nivel |
|---|---|---|
| E1 | El veredicto sigue la tabla y su orden: póliza vencida y cuotas vencidas es `EXPIRED`; sin pólizas (o todas canceladas) es `NO_POLICY`; solo una póliza vencida es `EXPIRED`, no `NO_POLICY` | base local (pytest) |
| E2 | Veredicto e `insurance_alert` salen de la misma vista y valen lo mismo en `/insurance/carriers`, la ficha de empresa y `/trips`; la alerta conserva sus valores de hoy | pytest |
| E3 | `GET /insurance/carriers/{id}` trae las pólizas no canceladas con sus cuotas en una consulta, y las renovadas solo si tienen cuotas impagas | pytest |
| E4 | Seguros › Empresas abre con "No al día" marcado y solo esas filas; los recuadros cuentan No al día, Por vencer y Al día | vitest |
| E5 | La razón de cada fila corresponde a su veredicto (una por veredicto, con los datos de la vista) | vitest |
| E6 | Tocar una fila abre el panel con sus pólizas y las cuotas impagas de cada una; "Abrir la póliza" lleva a su ficha | vitest |
| E7 | Pólizas ya no tiene el modo "por empresa"; el nombre de la empresa en Pólizas y en Cuotas abre el mismo panel | vitest |
| E8 | El contador del menú está en Empresas y cuenta las empresas No al día | vitest |
| E9 | Ninguna pantalla recalcula el veredicto ni la razón (guardia como S11) | vitest |
| E10 | Humo: Seguros › Empresas → tocar una empresa → abrir su póliza, en la copia local, a 1440 y 390 | Playwright |

## Fuera de alcance

- Avisos por correo o WhatsApp al transportista, y comprobantes de pago del transportista.
- Agrupar filas en la tabla del kit (no hace falta con la opción C).
- Unir "Póliza de Seguro Vigente" de Certificación con Seguros (decisión del 11/10).
- Montos en pesos o reajuste de la UF.
