# Seguros por empresa: ¿cada transportista está al día con sus pólizas?

**Fecha:** 2026-10-17 · **Rama:** `dev` (nada a `main`) · **Construye sobre:**
`2026-10-15-seguros-polizas-y-cuotas-design.md` (modelo de hechos y estados calculados, en dev).

## Por qué

El spec del 15/10 trató Cuotas como "la cola de pagos". El usuario lo corrigió el 17/10: **WebCarga no paga las
cuotas; monitorea si cada empresa de transporte está al día con sus pólizas.** La pregunta de quien entra a Seguros
es "¿qué transportistas no están al día, y por qué?", y la unidad es la empresa, no la cuota.

Hoy eso no se puede leer de un vistazo:

- **Cuotas** es una lista plana de todas las cuotas: una póliza con 12 cuotas aparece 12 veces, sin subtotal, y el
  monto en UF (`amount_uf`) no se suma en ningún lado.
- **Pólizas** tiene un modo "por empresa", pero es otra lista paralela (otra consulta, otra tabla, otros filtros), y
  su estado principal es el de la **vigencia** de la peor póliza: una empresa con póliza vigente y 5 cuotas vencidas
  se lee "Vigente".
- El **veredicto** ya existe a medias en la base (`app.carrier_insurance_summary`: `worst_state`,
  `overdue_installments`, `insurance_alert`), pero cada pantalla combina esas piezas a su manera.

## Estándar de la industria

El seguimiento de seguros de terceros (proveedores, contratistas) sigue el mismo patrón: **la cuenta (la empresa) es
la unidad**, tiene **un solo veredicto** que combina vigencia y pagos, las cuentas con problemas van primero por
gravedad, y el detalle (póliza → cuotas) se abre dentro de la cuenta. En pantalla es **una lista con "Agrupar por"**
y subtotales por grupo (AG Grid, MUI X; TanStack Table, que ya usa el kit, lo trae como `getGroupedRowModel`), no
pantallas separadas por nivel.

## Objetivo

1. Ver en una pantalla **qué empresas no están al día y por qué**, ordenadas por gravedad.
2. Un **veredicto único por empresa**, calculado en un solo lugar y mostrado igual en Seguros, la ficha de empresa y
   el Monitor.
3. **Agrupar** Pólizas y Cuotas por empresa (por defecto), por póliza o sin agrupar, con subtotales.

**No es objetivo:** pagar, cobrar ni avisar a los transportistas; montos en pesos; un portal para que el transportista
suba sus comprobantes; cambiar las tablas del 15/10.

**Anti-objetivo (sería un fracaso aunque funcione):** que el veredicto de una empresa diga una cosa en Seguros y otra
en el Monitor o en su ficha; que una empresa sin póliza no aparezca (son 18 de 36 activas al 15/10); que una lista
agrupada esconda cuotas vencidas dentro de un grupo cerrado sin decirlo en su cabecera.

## El veredicto de una empresa

Se calcula en la base, en `app.carrier_insurance_summary` (columna nueva `insurance_verdict`), con "hoy" en hora de
Chile como el resto del módulo. Gana el primero que se cumple:

| Veredicto | Regla | Tono | Ejemplo de texto |
|---|---|---|---|
| `EXPIRED` | alguna póliza no renovada está vencida | urgente | Póliza vencida |
| `NO_POLICY` | no tiene pólizas (ninguna, o todas canceladas) | urgente | Sin póliza |
| `OVERDUE` | tiene cuotas vencidas | urgente si alguna póliza tiene 2 o más (la regla D2 del 15/10, por póliza como hoy), aviso si no | 3 cuotas vencidas |
| `NO_DATES` | alguna póliza sin fecha de término | aviso | Póliza sin fechas |
| `EXPIRING` | alguna póliza vence dentro de `poliza_por_vencer` (30 días) | aviso | Vence el 02/11 |
| `UP_TO_DATE` | ninguna de las anteriores | el de "Vigente" en el glosario | Al día |

- Veredicto y alerta viven **en la misma vista**: `insurance_alert` (Monitor) conserva su regla y sus valores de hoy
  (`EXPIRED`, `OVERDUE_INSTALLMENTS`, `EXPIRING`; los leen el filtro de `/trips`, `InsuranceAlertBadge` y
  `GestionPanel`). No se deriva del veredicto porque perdería casos: una empresa "Sin fechas" con 3 cuotas vencidas hoy
  tiene alerta. Así S6 del 15/10 sigue valiendo y ninguna pantalla recalcula nada.
- **Qué empresas tienen veredicto** *(llamada mía, igual que hoy)*: las activas, más las inactivas que aún tienen
  pólizas no canceladas. La vista se arma desde `public.carriers` (hoy esa unión vive en `_CARRIERS_CTE` de
  `insurance.py` y la vista solo tiene empresas con póliza); el `LEFT JOIN` de `insurance.py` se retira.
- *Llamada mía:* "Sin póliza" es no tener pólizas; si las tiene y vencieron, es "Póliza vencida" (así el Monitor sigue
  alertando a esas empresas, como hoy). El Monitor no gana una alerta nueva para "Sin póliza".
- Las cuotas impagas de una póliza renovada **siguen contando** (son deudas, decisión del 15/10).
- El texto y el tono viven en `lib/states.ts` (`insuranceVerdictStyle`), como el resto del glosario.

*Llamada mía:* el orden conserva el de `_CARRIER_ORDER` (Vencida, Sin póliza, Sin fechas, Por vencer) y suma las
cuotas vencidas en tercer lugar: una póliza vencida o inexistente deja al transportista sin cobertura; una cuota
vencida, todavía no.

## Pantallas

### Seguros › Pólizas y Seguros › Cuotas: una lista con "Agrupar por"

Las dos pasan a la tabla del kit (`components/ui/tabla/data`, la del Cierre), con un control **Agrupar por** en la
barra:

| Lista | Agrupar por (el primero es el de entrada) | Fila |
|---|---|---|
| Pólizas | **Empresa** · Ninguno | una póliza |
| Cuotas | **Empresa** · Póliza · Ninguno | una cuota |

- **Cabecera de grupo por empresa:** nombre y RUT, el **veredicto**, y los subtotales de lo que el grupo contiene
  (Pólizas: N vigentes, N vencidas; Cuotas: N vencidas · N por pagar · total impago en UF, próxima fecha). Se pliega y
  se despliega; **abierta por defecto si su veredicto no es "Al día"**, cerrada si lo es.
- **Cabecera de grupo por póliza** (Cuotas): aseguradora · N°, estado de la póliza, N vencidas, total impago en UF y
  enlace a la ficha de la póliza.
- **Orden de los grupos:** por gravedad del veredicto (tabla de arriba), y dentro de cada uno, por más cuotas
  vencidas y luego por nombre.
- **Las empresas sin póliza** aparecen agrupando Pólizas por empresa, como cabecera "Sin póliza" sin filas (hoy ya
  aparecen en el modo "por empresa").
- **Recuadros-atajo** arriba (`ShortcutTiles` del kit): uno por veredicto con su cifra de empresas, como en el Cierre.
  Son filtros de la columna Veredicto: tocar "Cuotas vencidas" deja solo esas empresas.
- **Filtros, columnas, búsqueda y vista en la URL**: los del kit. **La agrupación es una pieza nueva del kit**
  (`components/ui/tabla/data`, compartido con el Cierre): hoy `useDataTable` no tiene `getGroupedRowModel` ni filas
  expandibles, ni cabeceras de grupo, ni grupos vacíos, y `viewExport` exporta una tabla plana. Se agrega como opción
  del kit (`group` en la vista de la URL, cabecera de grupo con un render por pantalla, grupos sin filas permitidos,
  la descarga con una columna del grupo), sin cambiar lo que ya ve el Cierre. Toca código compartido: suite completa.
- **Paginación:** agrupando, el kit pagina por grupos (empresas), no por filas, para no partir un grupo entre dos
  páginas. *Llamada mía.*
- **Qué carga Cuotas** *(llamada mía)*: abre con las **impagas** (vencidas y por pagar), con "Pagadas" y "Todas" en el
  filtro de estado, como hoy. Los subtotales de un grupo cuentan lo que se ve con los filtros puestos; el veredicto de
  la empresa no cambia con los filtros (viene de la base). Una empresa sin cuotas no aparece en Cuotas (sí en Pólizas
  agrupada por empresa).
- Se retiran: la lista paralela `CarriersInsuranceTable`, el `SegmentedControl` "Póliza / Empresa" de Pólizas y la
  paginación por servidor de estas dos listas (ver Datos).

### Ficha de empresa y Monitor

- **Ficha de empresa:** el encabezado muestra el veredicto de Seguros (el mismo chip); su pestaña Seguros es la lista
  de Pólizas filtrada por la empresa (ya decidido el 15/10), agrupada por póliza en vez de por empresa.
- **Monitor:** sigue mostrando `insurance_alert`, ahora derivada del veredicto. Sin cambio visible.
- **Menú:** el contador pasa de **cuotas vencidas** (151 al 17/10) a **empresas que no están al día**, porque esa es
  la unidad de trabajo, y se queda en la entrada Cuotas, donde está hoy (`Sidebar.tsx`, `badge: 'installments'`).
  *Llamada mía; depende de la pregunta abierta 1.*

## Datos

- **Volumen (base real, 15/10):** 36 empresas activas, 33 pólizas, 294 cuotas. Las dos listas se cargan **enteras** y
  se agrupan y filtran en el cliente con el kit, como el Cierre. **Cambio de API:** hoy `limit` llega a 200 en
  `/policies` (`routers/policies.py`) y a 500 en `/installments` (`routers/installments.py`); los dos suben a 2.000, y
  cada fila trae el veredicto de su empresa (`insurance_verdict`). Si alguna lista pasa de 2.000 filas, la
  agrupación pasa al servidor; hasta entonces, no.
- **Migración:** solo reemplaza la vista `app.carrier_insurance_summary` (agrega `insurance_verdict` y deriva
  `insurance_alert`). No toca tablas ni datos. Se ensaya en la copia local y con `ROLLBACK` en la base real, y se
  aplica solo con autorización del usuario.

## Estados de cada pantalla

- **Cargando:** sin cifras en recuadros ni cabeceras hasta tener el dato.
- **Vacío:** "No hay pólizas registradas" / "No hay cuotas"; con un filtro que no deja nada, el mensaje del kit.
- **Sin permiso:** sin `policies.edit` se ve todo y no se ven las acciones de escritura.
- **Teléfono:** las cabeceras de grupo se apilan (nombre y veredicto arriba, subtotales abajo); la tabla se desplaza
  dentro de su tarjeta.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Nivel |
|---|---|---|
| E1 | El veredicto sigue la tabla y su orden: con una póliza vencida y cuotas vencidas es `EXPIRED`; sin pólizas (o todas canceladas) es `NO_POLICY`; con solo una póliza vencida es `EXPIRED`, no `NO_POLICY` | base local (pytest) |
| E2 | Veredicto y `insurance_alert` salen de la misma vista y valen lo mismo en `/policies`, `/installments`, la ficha de empresa y `/trips`; la alerta conserva sus valores de hoy | pytest |
| E3 | Cuotas agrupada por empresa: una cabecera por empresa con veredicto y subtotales (vencidas, por pagar, UF impagas) | vitest |
| E4 | Los grupos que no están "Al día" abren desplegados y van primero, por gravedad | vitest |
| E5 | "Agrupar por" vive en la URL y la descarga a Excel respeta la vista agrupada | vitest |
| E6 | Agrupar Pólizas por empresa incluye las empresas sin póliza | vitest |
| E7 | Tocar un recuadro de veredicto filtra la columna Veredicto (el mismo filtro que el embudo) | vitest |
| E8 | El contador del menú cuenta empresas que no están al día | vitest |
| E9 | Ninguna pantalla recalcula el veredicto (guardia como S11) | vitest |
| E10 | Humo: Seguros › Cuotas agrupada → abrir una empresa → abrir una póliza, en la copia local, a 1440 y 390 | Playwright |

## Preguntas abiertas (del usuario)

1. **¿Se unen Pólizas y Cuotas?** Si las dos responden "¿la empresa está al día?", podría bastar una sola lista
   "Seguros" agrupada por empresa, con pólizas y cuotas adentro. Este spec las deja como dos listas (el objeto de
   cada fila es distinto) con el mismo "Agrupar por" y el mismo veredicto. Cambia el menú y las pantallas.
2. **¿Quién marca una cuota como pagada y con qué respaldo?** Hoy lo hace alguien de WebCarga con `policies.edit`,
   sin adjuntar nada (`POST /installments/pay`). Si el transportista acredita el pago (comprobante), Cuotas necesita un
   adjunto o una solicitud, y el veredicto podría distinguir "pagada" de "pagada y acreditada". Cambia el alcance.

## Fuera de alcance

- Avisos por correo o WhatsApp al transportista.
- Un portal o carga de comprobantes por el transportista (salvo que la pregunta 2 lo traiga).
- Unir "Póliza de Seguro Vigente" de Certificación con Seguros (decisión del 11/10).
- Montos en pesos o reajuste de la UF.
