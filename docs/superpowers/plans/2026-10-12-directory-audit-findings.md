# Auditoría del Directorio y su sincronía con Certificación, Cierre y Monitor — síntesis

**Fecha:** 12/10/2026. **Plan:** `2026-10-12-directory-audit.md`. **Insumos:** Lente A (trabajos y clics, copia
local ficticia, `2026-10-12-directory-audit-lens-a.md`), Lente B (dominio y datos, base real, solo `SELECT`,
`2026-10-12-directory-audit-lens-b.md`), Lente C (código, `2026-10-12-directory-audit-lens-c.md`), la auditoría de
Sin clasificar (`2026-10-11-sin-clasificar-ux-audit.md`), el método de `2026-10-11-certification-audit.md` y la spec
de Pendientes (`specs/2026-10-11-pending-documents-design.md`, el estándar de "una sola definición":
`document_state_sql`, `in_scope_sql`, `ultima_empresa_sql`).

**Reglas que se respetaron:** solo lectura de punta a punta; Mage sin tocar; dev sin modificar; sin datos personales
(de la base real, solo conteos; los nombres de la copia local son ficticios y aquí tampoco se usan). Las cifras de
la base real son del **11/10/2026, 21:47-21:52, hora de Chile** (domingo, 23 viajes del día). Universo: 251 empresas
(36 activas), 101 conductores (93 activos), 139 equipos (136 activos).

**Cómo citar:** A-n, B-n, C-n son los hallazgos de cada lente; Dn son las divergencias medidas del Lente B (§2);
#NN son capturas del Lente A (`.playwright-mcp/directorio-*.png`); H-n son hallazgos de Sin clasificar.

---

## 1. Resumen ejecutivo

1. Las cuatro pantallas que muestran empresas, conductores y equipos (Directorio, Certificación, Cierre, Monitor) responden distinto a "¿está activo?", "¿de qué empresa es?", "¿puede operar?" y "¿está en el Cierre?", porque cada una calcula la respuesta por su cuenta.
2. Ejemplos medidos: el Directorio dice "Al día" de una empresa a la que Certificación le cuenta 7 documentos faltantes; marca en rojo 215 empresas que no operan, y cuenta 84 conductores donde operan 78.
3. Transferir un conductor reescribe el pasado: ninguna asignación (0 de 326) tiene fecha de término. Por un traslado posterior, 6 días abiertos del Cierre pasaron a "Por regularizar". La fecha nueva queda en hora UTC, un día corrida.
4. El Cierre tiene 28 líneas que no se ven en la tabla y que igual impiden firmar 4 días. Hoy la única salida es forzar la firma.
5. Lo que se edita en el Directorio no llega a las otras pantallas sin recargar, y la lista de conductores de la empresa sigue vieja incluso después de recargar.
6. Faltan trabajos básicos: un equipo o conductor que se quita de su empresa ya no se puede volver a asignar; no se puede corregir un RUT ni una patente; los clientes de una empresa no se editan, aunque se pidió el 02/10 y el 09/10.
7. El recálculo del Cierre reescribe el maestro sin avisar: renombra conductores con el nombre que trae el TMS y reasigna la empresa de un tracto.
8. Operaciones ve botones que la API le rechaza, y no ve la baja que la minuta le encarga. Además hay dos fichas de empresa, y ninguna tiene todo.
9. **Recomendación:** dominio "directorio" con definiciones únicas en la base, asignaciones con vigencia y una ficha por entidad (alternativa B), precedido de 8 arreglos baratos e independientes.

---

## 2. Hallazgos consolidados

**Severidad** (se unifica la de las tres lentes):
- **Bloquea:** el usuario no puede terminar el trabajo, o ve un dato falso sin forma de notarlo.
- **Confunde:** dos pantallas dan respuestas distintas, o el estado no se ve.
- **Costo interno:** deuda que encarece cada cambio, o un defecto latente que hoy no se manifiesta.

**Conteo:** 36 hallazgos consolidados (8 bloquean, 17 confunden, 11 son costo interno), que vienen de 20 hallazgos de A, 12 de B y 19 de C. Se agrupan en ocho causas raíz. Dentro de cada grupo van ordenados por severidad.

### R1 — No hay una sola definición de "activo", "asignado", "empresa de" ni "puede operar"

El estándar ya existe para los documentos (`document_state_sql` + `in_scope_sql`), pero solo lo usa Pendientes. Para las entidades no hay nada equivalente: el predicado "asignación activa" está escrito unas 52 veces (C-12), y cada lector decide si mira además el estado de la entidad y el de la empresa.

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-01 | **Líneas del Cierre ocultas que bloquean la firma.** La tabla filtra por el roster vivo; la firma cuenta todas las líneas del día. | B-4 | D15: 29 líneas de 14 conductores fuera del roster, **28 bloquean** en **4 días** abiertos. `daily_closures.py:75,170` (`JOIN active_roster`) frente a `cierre_lineas.py:603`; el recálculo hace upsert y nunca borra | Al firmar aparece "N conductores sin resolver" que la tabla no muestra. La única salida es `closures.override` | Dos universos para "¿está en el Cierre del día X?": el roster de hoy (pantalla) y las líneas del día (firma) | Bloquea |
| F-02 | **"¿Puede operar?" tiene cinco respuestas.** El Directorio cuenta solo los documentos propios obligatorios, sin alcance. Certificación suma los de la flota, incluida la de baja. Pendientes aplica el alcance | A-4, A-10, B-5 | #30 frente a #32. D8: **215 de 215** empresas no activas en rojo en el Directorio. D9: **23 conductores y 17 equipos** marcados PENDING fuera de alcance. D10: **6 de 36** empresas activas con otra cifra en el embudo (2.306 frente a 2.226; 80 de flota de baja). `carriers.py:61,76-78`, `compliance.py:400` | Se aprueba o se asigna una empresa que no está en regla, o se persigue a quien ya no opera. "Por cubrir" vale 3, 9 o 16 según la vista | `in_scope_sql` solo se adoptó en `/pending`; el resto comparte el vocabulario (`pendiente_predicate`), pero no el universo | Confunde |
| F-03 | **La flota de una empresa cuenta a conductores y equipos de baja.** | B-1, C-12 | D1: 84 frente a 78 conductores. D2: 86 frente a 84 tractos. D3: 4 empresas con otro conteo de conductores y 3 de equipos en la vista rápida. `_SQL_DIRECTORIO` (`carriers.py:359`), `entity_summary.py:155`, `carrier_driver_roster` | La tira del Directorio y la vista rápida dicen N conductores; el Cierre ve N-6 | Dar de baja (`PATCH operational_status`) no toca la asignación. "Pertenece a" y "opera" son dos conceptos sin nombre propio | Confunde |
| F-04 | **Dar de baja una empresa deja su flota colgada, y la baja no se ve.** | A-9, B-2 | D4: **7 conductores activos y 9 equipos** asignados a empresas INACTIVE. #51, #52, #93. `/drivers/{id}/summary` responde "Activo" y la empresa, sin decir que la empresa está de baja. `GET /drivers` (`drivers.py:29`) los devuelve **sin empresa** | La tarjeta del conductor de baja no lleva marca. Se asigna o se carga documentación de alguien que ya no opera; en el Monitor aparece sin empresa | No hay regla para la flota cuando cae la empresa, y el estado de la empresa no se propaga al leer | Confunde |
| F-05 | **Un conductor aparece dos veces en el Cierre:** en la fila del tracto y en "Otros conductores del día", con "Sin tracto habitual" aunque manejó el tracto | A-19 | #11 | Doble conteo aparente | Los ejes del conductor y del tracto se unen sin deduplicar | Confunde |
| F-06 | **El tipo de operación se define en el equipo y se deriva tres veces** para la empresa y el conductor | B-9 | `carrier_management_types()`, `carrier_operation_types` (`compliance.py:580`), `TRACTOREO_ROSTER_CTE`. D6: 2 conductores del roster vienen de 1 empresa mixta | Un conductor de una empresa mixta entra al Cierre de Tractoreo aunque maneje Equipo Completo. La etiqueta de la empresa sale distinta en Certificación y en Pendientes | No existe el tipo de operación del conductor; se hereda de la empresa | Confunde |
| F-07 | **Cinco buscadores con reglas distintas**, y la búsqueda de conductores puede devolver uno dos veces | C-10, C-11 | `carriers.py` (`/buscar` normaliza RUT y patente), `CarrierSearchPicker.tsx:43`, `DriverSearchPicker.tsx:29`; `drivers.py:58-61` (`LEFT JOIN` sin `LATERAL`) | Un RUT con puntos funciona en el Directorio y falla en los selectores. Un conductor con dos tractos sale repetido al asignar un viaje | `canonical_rut`/`canonical_plate` y "un tracto por conductor" se aplicaron solo en la consulta más nueva | Confunde |
| F-08 | **Seis cálculos del estado documental fuera del canon.** Hoy coinciden: 0 diferencias | B-7, B-8, C (D4) | D11 y D12 = 0. `carriers/[id]/page.tsx:375`, `TransporterAlertBanner.tsx:25`, `DocumentChecklist.tsx:70`, `entity_summary.py:24`, `trips.py:620`, `carriers.py:61`. `exigible_sql` usa `driver_assignments` para cualquier `ON_ENTITY_END` (`vencimientos.py:177-185`) | Ninguno todavía. El primer REJECTED, el primer documento de empresa por vencer o el primer requisito `MONTH_AFTER_START` con registros hará que las pantallas difieran | No se migraron los lectores (quedó para el bloque 3 de Certificación) | Costo interno |

### R2 — Asignaciones sin vigencia y con cuatro escritores

Hay una sola fila por par (sujeto, empresa): `ON CONFLICT (driver_id, carrier_id) DO UPDATE SET status='ACTIVE'`, lo mismo en `_transferir` (`carriers.py:742`) que en Mage (`load_driver_assignments_06.sql:60`). Volver a una empresa anterior reutiliza la fila vieja. `start_date` tiene `DEFAULT CURRENT_DATE` en UTC (`20260715204925_init_compliance_engine.sql:60,70`), y nadie salvo el padrón escribe `end_date`.

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-09 | **Transferir reescribe el pasado.** El Cierre juzga los días abiertos con la asignación de hoy | B-3, A-11 | D19: **100 %** de las filas sin `end_date` (105 + 137 + 84, también las INACTIVE). D20: hasta **5** conductores y **16** equipos con `start_date` anterior a su última decisión manual. D14: **6 líneas MISMATCH en 6 días** abiertos, 1 conductor, todas con una transferencia posterior a la fecha. `SQL_ESTADO_CONDUCTORES` (`cierre_lineas.py:86`) | Días que estaban bien pasan a "Por regularizar". "Ingresó hace N días", `MONTH_AFTER_START` y "la última empresa" (finiquito) leen un `start_date` que no corresponde | El modelo guarda el presente, no el intervalo, y tres consumidores necesitan el intervalo | Bloquea |
| F-10 | **La transferencia fecha en UTC** (un traslado del 11/10 a las 21:55 de Chile queda con fecha 12/10), y la asignación anterior queda INACTIVE sin fecha de término | A-11 | `carriers.py:789` (sin `start_date`, cae al `DEFAULT CURRENT_DATE` de la tabla); `:819` | El historial "¿con quién estaba tal día?" queda corrido un día, o sin cierre | Misma clase de error de huso horario que la de asyncpg: el default de la columna usa la fecha del servidor | Costo interno |
| F-11 | **La empresa del viaje se fija al resolver y no sigue al Directorio.** El Monitor no alerta en la tabla; el detalle avisa por el conductor y no por el tracto | A-12, B-10 | D17: 3 vínculos automáticos con empresa distinta a la del conductor y 16 sin empresa, en 14 días (de 523). D18: 3 MISMATCH y 16 UNMATCHED de 576. #24, #72, #94. `assign_driver_bulk` (`trips.py:2119`) conserva la empresa del tracto | Un viaje en curso con flota fuera de regla pasa desapercibido. Corregir la empresa del tracto no corrige el viaje hasta la siguiente actualización del TMS | `resolve_trip_fleet` solo corre cuando cambia `app.trips`; un cambio de asignación no la vuelve a disparar | Confunde |
| F-12 | **Cuatro escritores de asignaciones con reglas distintas** | B-12, C (D8) | Directorio, Certificación y Monitor (mismo endpoint, cuatro orquestaciones: `carriers/[id]/page.tsx:251-280`, `compliance/[carrierId]/page.tsx:511,1062`, `compliance/page.tsx:316`, `VincularConductorPropuesto.tsx:47`); el pre-cierre (`pre_cierre.py:296`); Mage 06 y 07; `sync_habitual_drivers()`. Solo el padrón escribe `end_date` | Una corrección automática cambia el Directorio sin que se vea allí | No hay un servicio de asignaciones; cada camino escribe la tabla | Costo interno |

### R3 — Sin invalidación entre módulos y con rezago de servidor

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-13 | **Ninguna mutación del Directorio refresca Certificación, Cierre, Monitor ni la vista rápida**, y las de Certificación no refrescan el Directorio | A-5, C-1, C-2, C-6, C-7 | Matriz C §3.4. `carriers/[id]/page.tsx:220-314`; `RAICES_DE_CERTIFICACION` sin `carrier-drivers`, `carrier-assets-roster`, `carriers` ni `carriers-directorio`; la transferencia invalida solo la empresa de origen. #55 | Se firma el día con un conductor dado de baja a la vista, o se duda de si la baja funcionó. La empresa destino no muestra al conductor transferido | Las claves se declaran pantalla por pantalla; no hay una fábrica de claves del Directorio | Bloquea |
| F-14 | **La lista de conductores de la empresa lee una vista materializada que no se refresca al editar un conductor** | C-3, B-6 | D7: 1 fila con el nombre viejo hoy. `carriers.py:717`; `20260716214630_h1_...sql:35-45,87-97`, sin trigger en `public.drivers` | El panel ya dice "de baja", pero la lista sigue igual, **incluso después de recargar** | El refresco se puso en `assets` (04/08) y no en `drivers`. El roster de equipos se resolvió leyendo en vivo; el de conductores no | Bloquea |
| F-15 | **El Cierre llega con rezago y solo una de sus tres consultas avisa** | A-5, C-4 | `cola_del_cierre.py` (cada minuto); `closures/page.tsx:158` (único `refetchInterval`, y solo si la caché ya trae `pendiente_desde`); `:209` (`staleTime` de 5 min); `equipment-closures` y `cierre-viajes` sin aviso | Se corrige el origen o el tipo de operación y la fila del tracto sigue vieja, sin aviso | El patrón de frescura se aplicó a `daily-closure` y no a las otras dos; el `PATCH` no informa que dejó un recálculo pendiente | Confunde |
| F-16 | **En la misma pantalla del Cierre, la fila y la vista rápida se contradicen** (origen, empresa) | A-6 | #17, #26 | No se sabe a cuál creerle | La fila lee la línea congelada; la vista rápida lee el maestro en vivo. Ninguna de las dos dice cuál es cuál | Confunde |
| F-17 | **Dos claves de caché para la misma empresa** | C-5 | `TransporterSlideOver.tsx:42` (`['carriers','detail',id]`) frente a `['carrier-detail',id]` | El panel lateral de la lista queda viejo después de editar en la ficha | Lista y ficha nacieron en momentos distintos | Confunde |
| F-18 | **Cada `UPDATE` de un equipo refresca cinco vistas materializadas** | C-16 | `20260804010000_...sql`, `refresh_carrier_view()` | Editar un equipo se vuelve más lento a medida que crece el padrón, y suma Disk IO (memoria: saturación de Supabase) | Un trigger genérico refresca todo | Costo interno |
| F-19 | **No hay tests de sincronía** | C-18 | `grep invalidate` en los tests del Directorio: 0 | F-13 llegó a dev sin que fallara ninguna prueba | Los tests montan un `QueryClient` nuevo y no revisan qué se invalida | Costo interno |

### R4 — Dos fichas de empresa, flujos duplicados y entidades sin casa

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-20 | **Dos fichas de empresa con capacidades repartidas**, más un panel y una vista rápida. En el menú conviven "Empresas" y "Directorio" | A-18, C-8 | `carriers/[id]/page.tsx` (972 líneas): renombrar, contactos, pólizas, exportar, origen, tipo de operación. `compliance/[carrierId]/page.tsx` (1.076 líneas): `GestionDeclarada` (0 usos en el Directorio), baja y transferencia con conteo de documentos y viajes. `Sidebar.tsx:65,78`. #82 | No hay un "lugar de la empresa". Para corregir el tipo de gestión hay que ir a Certificación; para renombrarla, al Directorio | Certificación construyó su propia ficha en vez de reutilizar la del Directorio | Confunde |
| F-21 | **No hay lista ni ficha de conductores ni de equipos.** La empresa es la única puerta de entrada | A-13 | `EntityRedirect` en `/drivers/[id]` y `/assets/[id]`. #58, #59: "0 empresas · Sin resultados" junto al resultado. No existe `GET /drivers` de listado | Para encontrar a alguien hay que saber de qué empresa es | La empresa se diseñó como la única unidad de navegación (Samsara y Fleetio hacen lo contrario) | Confunde |
| F-22 | **El Monitor no enlaza a las fichas**, la vista rápida solo existe en el Cierre y hay 14 URLs escritas a mano que pierden la vuelta | C-13, C-14 | `TripTable.tsx`, `TripDetailView.tsx` sin `EntityCell`; D11 de C | Desde el Monitor no se llega a la ficha; desde algunos enlaces del Cierre se pierde "Volver al Cierre" | La vista rápida se construyó solo para el Cierre, y el helper de navegación llegó después de los enlaces | Confunde |
| F-23 | **Tres altas de conductor y cuatro orquestaciones de transferencia.** Solo `AltaDeFlota` pide el origen habitual | C (D6, D7, D8) | `AltaDeFlota`, `AltaConductorDesdeCierre.tsx:58`, `monitor/page.tsx:744` | Los conductores creados desde el Cierre o el Monitor quedan sin origen; cada alta refresca solo lo suyo | Cada módulo armó su alta | Costo interno |
| F-24 | **Ninguna ficha muestra los viajes** de la entidad | A-14 | Matriz A, T10 (Certificación muestra solo "1 viajes · 30 días") | Para saber dónde anduvo un conductor hay que buscarlo en el Monitor o en el Historial | No existe un panel de actividad por entidad | Costo interno |
| F-25 | **Archivos monolíticos, código huérfano y nombres mezclados** | C-15, C-17, C-19 | Dos fichas de unas 1.000 líneas; `carriers.py` 997; `/trips/fleet-daily-overview` (~200 líneas sin consumidor); `/buscar`, `/directorio` y claves en español | Ninguno directo | Las fichas fueron acumulando funciones; el estándar en inglés es del 10/10 | Costo interno |

### R5 — El recálculo del Cierre escribe en el maestro sin protección por campo

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-26 | **El recálculo del Cierre renombra conductores, reasigna la empresa de un tracto y agrega clientes, sin avisar.** Editar cualquier campo congela la fila entera | A-7, B-12 | `pre_cierre.py:296` (reasigna tractos según el nombre de empresa del TMS), `:304-352` y `:344` (renombra sin override). `audit.py:101` (`is_manual_override` por fila). El nombre "Apellido, Nombre" pasa a "NOMBRE APELLIDO" (#20). Es el origen de D7 | El Directorio cambia solo. Si se fija el origen habitual, el nombre también deja de recibir las correcciones del TMS | La protección es por fila, no por campo (memoria: "la fuente de verdad se decide por campo") | Confunde |
| F-27 | **La ingesta puede reescribir el tipo de operación de 103 equipos** que no tienen override | B-9 | `load_assets_04` (Mage), 103 equipos sin override | Un tracto puede cambiar de Tractoreo a Equipo Completo en silencio y salir del Cierre | Igual que F-26, del lado de Mage. **No se toca sin preguntar** | Costo interno |

### R6 — Trabajos que no existen

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-28 | **Un equipo o conductor que se quita de su empresa queda huérfano y no se puede recuperar** desde la pantalla | A-1 | #57-#61, #64. `assets.py:74` (409 "Ya existe un activo"), `drivers.py:278`, `EntityQuickView.tsx:77`. Test que fija el defecto: `carriers/page.test.tsx:147` | Un tracto que vuelve a operar, o que cambia de empresa, no se puede volver a asignar. En la base real hay **8 conductores activos sin empresa** (D5) | La entidad sin empresa no tiene pantalla (F-21), y el alta no ofrece "traer el existente". Asignar sin empresa existe solo en Certificación (`compliance/page.tsx:316`) | Bloquea |
| F-29 | **No se puede corregir el RUT de un conductor ni la patente de un equipo.** El RUT de la empresa lo acepta la API, pero la pantalla no lo ofrece | A-2 | `schemas/driver.py:35`, `schemas/asset.py:49` (sin esos campos); `schemas/carrier.py:83` (`tax_id` sí); `carriers/[id]/page.tsx:425` (solo lectura) | Un error de tipeo obliga a crear otra entidad, que choca con F-28 | Esos campos no se pensaron como editables | Bloquea |
| F-30 | **Los clientes de una empresa no se pueden editar**, y el alta no los pide | A-3 | `carriers.py:985` (solo GET). Lo pidió el cliente el 02/10 (A6) y lo repitió el 09/10 (quedó pendiente de desarrollo) | Operaciones depende de que el recálculo los infiera (F-26) | Las escrituras de `carrier_shippers` solo las hace `pre_cierre.py` | Bloquea |
| F-31 | **El origen habitual del tracto se hereda de dos datos que suelen faltar**, y el enlace del Cierre no lleva a quienes faltan | A-17, B-11 | D22: **45 de 84** líneas de tracto de hoy sin origen; 28 de 68 pares habituales con conductor sin origen; 3 de 41 conductores del roster sin origen. `FlotaDelDiaSection.tsx:530` | La mitad de los tractos del Cierre no tienen con qué medir la asistencia. El arreglo va en el conductor, la pantalla del tracto no lo dice y "Asignar desde el Directorio" abre la lista general | La herencia no se muestra como herencia, y no hay lista filtrable de conductores (F-21) | Confunde |
| F-32 | **El tipo de operación no se puede quitar** (`COALESCE` en `PATCH /assets`) | B-9, C §4.1 | `assets.py:103` | Un equipo mal clasificado solo se puede pasar al otro tipo, no a "sin clasificar" | Es la semántica de `PATCH` con `COALESCE` | Costo interno |

### R7 — Los permisos de los botones no coinciden con los de la API (Operaciones)

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-33 | **Operaciones ve "Quitar del roster" y recibe 403; no ve "Dar de baja"**, aunque la minuta del 02/10 (B2) le encarga dar de baja una empresa | A-8, C §4.3 | #42. `DriverDetailPanel.tsx:287,296,315` (`canEdit` frente a `canAdmin`); `carriers.py:812` (`DIRECTORY_DELETE`). Asignar exige `DIRECTORY_EDIT` y desasignar `DIRECTORY_DELETE`. Misma clase que L5 (Certificación) y H10 (Sin clasificar: Operaciones ve una cola en la que no puede actuar) | El botón destructivo falla, y la baja que le corresponde no se puede hacer | Cada botón decide su visibilidad con un permiso distinto del que exige el endpoint | Bloquea |

### R8 — Interacción y vocabulario (heurísticas de Nielsen 1-5)

| Id | Hallazgo | Lentes | Evidencia | Efecto para el usuario | Causa raíz | Sev. |
|---|---|---|---|---|---|---|
| F-34 | **Acciones de impacto sin red.** "Quitar del roster" actúa con un clic, sin confirmar ni deshacer. La baja de una empresa no dice qué arrastra (3 conductores, 2 equipos, 1 viaje hoy). Transferir no confirma a dónde fue la entidad | A-16 | #53, #92, #23 | Errores silenciosos que, sumados a F-28, no se pueden revertir | — | Confunde |
| F-35 | **Vocabulario dispar.** "Dada de baja" e "Inactiva" para el mismo estado; "Tax ID"; "roster"; "Ya existe un activo…", donde "activo" quiere decir *asset*; "Tipo de gestión", "Gestión" y "Tipo de operación" para lo mismo; "Sin clasificar" y "Bandeja" (H15) | A-15, C-9 | `TransporterCard.tsx:13` frente a `types.ts:958`; `carriers/[id]/page.tsx:425,631` | Más carga cognitiva, y los nombres internos llegan a la pantalla | Dos diccionarios de estado y ningún glosario | Confunde |
| F-36 | **Capas y guardados de más.** Transferir abre un modal sobre otro modal; el panel del equipo tiene dos botones de guardar; a 390 px el panel del conductor ocupa la pantalla y deja los documentos bajo el pliegue; la barra inferior tiene 10 ítems con los rótulos pegados | A-20 | #20, #41, #82, #83 | Más clics. En el teléfono, lo importante queda fuera de la vista | — | Costo interno |

**Lo que funciona y hay que conservar** (A §4):
- el Cierre se corrige solo en 15 s o menos cuando muestra el aviso "Actualizando…";
- la dirección canónica `/dashboard/drivers/{id}` con "Volver al Cierre";
- un solo componente de alta de empresa;
- el detalle del viaje detecta al conductor de otra empresa;
- el buscador único del Directorio, que encuentra conductores y patentes;
- `home_location_id` como única fuente del origen habitual;
- `app.is_trip_open` / `app.is_trip_assigned` como funciones únicas en la base. **Son el modelo a copiar.**

---

## 3. Mapa de fuente de verdad por campo

Parte del mapa del Lente B (§5) y le agrega quién escribe hoy y quién debería escribir.

| Campo o pregunta | Dueño y escritores de hoy | Escritor objetivo | Definición canónica (objetivo) | Lectores (dejan de derivarlo) |
|---|---|---|---|---|
| ¿La empresa está activa? | `PATCH /carriers` desde el Directorio y desde Certificación; Mage `load_carriers_02` (fuerza ACTIVE salvo override) y `09` | Una sola acción "Dar de baja / Reactivar", con vista previa del impacto (F-34) y una regla explícita para la flota (pregunta P1) | `carriers.operational_status` | Todos |
| ¿El conductor o el equipo está activo? | `PATCH /drivers|assets`; Mage 03 y 04 (salvo override) | Directorio | `drivers/assets.operational_status` | Todos |
| ¿A qué empresa pertenece **hoy**? | `_transferir` (Directorio, Certificación, Monitor), `DELETE`, pre-cierre (tractos), Mage 06 y 07 | Un servicio de asignaciones (assign / transfer / end / reattach). El pre-cierre y Mage escriben solo donde no hay override | Asignación ACTIVE (el índice único ya garantiza una por sujeto), expuesta como `app.carrier_of(entity_type, id)` | Directorio, vista rápida, Certificación, Monitor (búsqueda) |
| ¿A qué empresa pertenecía **el día X**? | Nadie: `end_date` siempre NULL; la fila por par se reutiliza | Un trigger sobre las tablas de asignación que registra cada cambio de estado como intervalo, con `hoy_chile()`. Cubre a **todos** los escritores, incluido Mage, sin tocar Mage | `app.carrier_of(entity_type, id, on_date)` leída desde el historial de intervalos | Cierre (MISMATCH y roster de días pasados), `ultima_empresa_sql`, "Ingresó hace N días", `MONTH_AFTER_START` |
| ¿Opera (cuenta en la flota)? | ~52 predicados sueltos | Derivado | `app.is_operating(entity_type, id)`: entidad ACTIVE + asignación ACTIVE + empresa ACTIVE, lo mismo que hoy hace `in_scope_sql` para documentos | Tira del Directorio, vista rápida, roster de la empresa, Cierre, Pendientes, búsqueda del Monitor |
| ¿Está habilitado (documentos)? | Seis cálculos | Derivado | `document_state_sql` + `in_scope_sql` (ya existen). Una sola regla de agregación por empresa: ella sola, o ella más su flota activa (pregunta P13) | Directorio (lista, pestañas, ficha), embudo de Certificación, vista rápida, Monitor, sugerencia de motivo del Cierre. El frontend no recalcula |
| ¿Está en el Cierre del día X? | `closure_lines` (firma) frente al roster vivo (pantalla) | Recálculo del Cierre | `closure_lines` del día. La pantalla muestra las líneas de quienes salieron del roster, con su marca | Tabla del Cierre y firma, con el **mismo** universo |
| Nombre del conductor | Directorio, pre-cierre (`pre_cierre.py:344`, sin override), Mage 03 | Directorio. El TMS **propone**, y el cambio se aplica solo si el campo no tiene override (override por campo) | `drivers.full_name` | Todos; en vivo, no desde la vista materializada |
| RUT del conductor, patente del equipo, RUT de la empresa | Solo al crear; el RUT de la empresa, por API | Directorio, con auditoría del valor anterior y verificación de choque | `drivers.rut`, `assets.plate`, `carriers.tax_id`, normalizados con `canonical_rut` / `canonical_plate` | Todos los buscadores (una sola normalización) |
| Clientes de la empresa | Solo `pre_cierre.py` (inferidos) | Directorio (declarados). El recálculo propone y marca la procedencia ("declarado" frente a "visto en viajes"), sin pisar lo declarado | `carrier_shippers` con origen por fila | Filtro de cliente del Cierre, reporte de estatus, ficha |
| Origen habitual del conductor | `PATCH /drivers` (Directorio) | Sin cambio | `drivers.home_location_id` | Cierre (copia en la línea mientras el día está abierto), vista rápida |
| Origen habitual del tracto | Heredado del conductor habitual (`SQL_ESTADO_TRACTOS`) | Sin cambio en el dato; la pantalla lo muestra **como heredado** | Origen del conductor habitual vigente | Cierre de equipos |
| Conductor habitual del tracto | `POST/DELETE /assets/{id}/driver-assignment`; `sync_habitual_drivers()` (padrón) | Directorio; el padrón, salvo override | `vehicle_driver_assignments` ACTIVE (el único que hoy escribe `end_date`) | Ficha del equipo, `resolve_trip_fleet` capa 5, Cierre, vista rápida |
| Tipo de operación del equipo | `PATCH /assets` (no permite quitarlo), Mage `load_assets_04` | Directorio, con "sin clasificar" como valor posible; Mage solo sin override | `assets.webcarga_operation_type_id` | Cierre, Certificación, Pendientes |
| Tipo de operación de la empresa y del conductor | Tres derivaciones | Derivado | Una función, `app.carrier_operation_types(carrier_id)`; el del conductor según la respuesta a P8 | Cierre (roster), Certificación, Pendientes |
| Tipo de gestión declarado de la empresa | Solo en la ficha de Certificación (`GestionDeclarada`) | La ficha única | La columna actual (sin cambio de modelo) | Certificación, Pendientes |
| Empresa del viaje | `resolve_trip_fleet` al cambiar `app.trips`; vínculo manual (terminal) | Igual. Además, un cambio de asignación del **tracto** vuelve a resolver los vínculos **automáticos** de los días abiertos (ver el riesgo en §4) | `trip_fleet_links.carrier_id`, leída por `v_trip_fleet_resolution` | Monitor, Cierre |
| Viaje abierto o asignado | `app.is_trip_open` / `app.is_trip_assigned` | Sin cambio | Ya únicos | Sin cambio |

---

## 4. Arquitectura objetivo

### Alternativa A — Arreglar la sincronía y la invalidación, sin tocar el modelo

**Qué es:**
- `invalidateDirectory(qc)` y una fábrica de claves compartida con Certificación;
- lectura en vivo del roster de conductores;
- aviso de frescura en las tres consultas del Cierre;
- fecha de Chile en las asignaciones;
- la pantalla del Cierre con el mismo universo que la firma;
- botones alineados con los permisos.

Es la sección "Arreglar ya" de §5, sin los bloques.

- **Costo:** 1 o 2 bloques chicos, casi todo frontend.
- **Cierra:** F-01, F-10, F-13 a F-17, F-33.
- **Deja abiertos:** las cinco respuestas a "¿puede operar?" (F-02, F-03), la historia reescrita (F-09), las dos fichas (F-20), los trabajos que faltan (F-28 a F-30) y el maestro reescrito por el recálculo (F-26).
- **Riesgo:** cada pantalla nueva vuelve a escribir su propio predicado; la próxima auditoría encuentra lo mismo con otros números.
- **Cierre, Monitor, Certificación:** dejan de mostrar datos viejos, pero siguen calculando cada uno lo suyo.
- **Mage:** no se toca.

### Alternativa B — Dominio "directorio": definiciones únicas, asignaciones con vigencia y una ficha por entidad (**recomendada**)

1. **Definiciones canónicas en la base**, como `app.is_trip_open`: `app.is_operating(entity_type, id)`, `app.carrier_of(entity_type, id, on_date default hoy_chile())` y `app.carrier_operation_types(carrier_id)`.
   - Van en la base y no en Python porque las necesitan también los triggers, el recálculo del Cierre y, a futuro, dbt.
   - Los lectores de §3 migran a estas funciones y a `document_state_sql` + `in_scope_sql`.
   - El frontend deja de recalcular estados y usa un solo diccionario de etiquetas.
2. **Asignaciones con vigencia**, sin cambiar la tabla que escribe Mage.
   - El problema: la fila única por par (`ON CONFLICT (driver_id, carrier_id)`), que usan la app y Mage por igual, impide guardar dos intervalos del mismo par en la misma tabla.
   - La solución: un **historial de intervalos** (`app.fleet_assignment_periods`: sujeto, empresa, `valid_from`, `valid_to`, fuente). Lo alimenta un trigger `AFTER INSERT OR UPDATE OF status` sobre `driver_assignments` y `asset_assignments`, con `hoy_chile()`.
   - Captura a todos los escritores (Directorio, pre-cierre, Mage, padrón) sin tocar sus `INSERT`.
   - Se cambia el `DEFAULT CURRENT_DATE` por `public.hoy_chile()`, también sin tocar Mage.
   - La tabla actual sigue siendo "el presente". El historial es la única fuente de "el día X".
   - **Esto no reabre la decisión 5 de HU-28.** Esa decisión descartó "una quinta vigencia que nadie puebla". Esta la puebla un trigger, a partir de las escrituras que ya existen.
3. **Un servicio de asignaciones** (`services/fleet_assignments.py`): asignar, transferir (con fecha efectiva opcional), terminar y **traer el existente**, que resuelve F-28.
   - Lo usan los cuatro caminos de la interfaz.
   - La baja de una empresa pasa por él, con una vista previa del impacto.
4. **Una ficha por entidad:**
   - listas propias de **Conductores** y **Equipos**, con filtros: sin empresa, de baja, sin origen;
   - fichas propias de conductor y de equipo, que reemplazan `EntityRedirect`;
   - **una** ficha de empresa, que absorbe `GestionDeclarada` y las acciones por sujeto de Certificación;
   - el panel de documentos del bloque 3 de Certificación;
   - los viajes de la entidad.

   Certificación enlaza a esa ficha y conserva sus tres tareas (Pendientes, Sin clasificar, crear empresa).
5. **Override por campo** para los campos que el recálculo y la ingesta pueden escribir: nombre, empresa del tracto, clientes y tipo de operación. El recálculo **propone**, y la propuesta se ve en la ficha con su procedencia.
6. **Invalidación por dominio:**
   - `invalidateDirectory(qc)` cubre todas las claves que dependen de una entidad (Directorio, Certificación, Cierre, Monitor y la vista rápida);
   - un test compara las raíces declaradas con las claves que leen las pantallas;
   - la frescura del Cierre sigue a cargo de su cola actual, con aviso en las tres consultas.

**Costo:** de 5 a 6 bloques (§5). **Riesgos y mitigación:**
- **Volver a resolver la empresa del viaje** cuando cambia la asignación del tracto exige llamar a `resolve_trip_fleet` desde fuera de `app.trips`. Los triggers de `app.trips` son del `post_hook` de dbt (memoria). Hay que confirmar quién es el dueño de `resolve_trip_fleet` antes de tocarla y, si es dbt, **preguntar**: es Mage.
  - Mientras tanto, una alternativa sin Mage: que el trigger del historial encole el día en la cola del Cierre (ya existe), y que el Monitor muestre el desajuste en la tabla en vez de corregirlo.
- **Historial sin pasado:** los intervalos empiezan el día del despliegue. Reconstruirlos desde `audit_log` es posible solo para las decisiones manuales (P7).
- **Disk IO:** el trigger agrega una fila por cambio de estado (volumen bajo). Se aprovecha para sacar los `REFRESH` innecesarios (F-18).

**Efecto en cada módulo:**
- **Cierre:** juzga cada día con la empresa de ese día, y la firma y la pantalla comparten universo.
- **Monitor:** busca y alerta con las mismas reglas.
- **Certificación:** el embudo coincide con Pendientes, y se retira la segunda ficha (bloque 2).
- **Mage:** no se toca. Los cambios de default y los triggers viven en migraciones de `public.*`.

### Alternativa C — B, más recálculo por eventos (outbox)

**Qué agrega:** una tabla de eventos de dominio (`directory_events`) que consumen el recálculo del Cierre, la re-resolución de viajes y un canal en tiempo real (Supabase Realtime) que invalida la caché del navegador sin esperar.

- **Costo:** B más 2 o 3 bloques de infraestructura (consumidor, idempotencia, reintentos, monitoreo).
- **Riesgo:**
  - suma IO y conexiones sobre un plan Micro que ya se saturó;
  - agrega otra pieza que hay que operar;
  - la cola del Cierre (triggers que encolan días y un ejecutor por minuto) **ya es** un outbox acotado y funciona.
- **Cuándo tendría sentido:** si, después de B, el rezago de un minuto del Cierre o la necesidad de ver en vivo entre usuarios distintos aparece como una queja real. Hoy no hay evidencia de eso: lo que se observó es caché del propio navegador.
- **Mage:** igual que en B.

### Recomendación

**Alternativa B**, precedida de los arreglos de A como bloque 0. A sola deja intactas las causas R1, R2, R4, R5 y R6: el próximo módulo vuelve a escribir su propio "activo". C resuelve un problema que no se midió y paga con IO, que es el recurso escaso. La pieza de "eventos" que B necesita ya existe: es la cola del Cierre.

---

## 5. Hoja de ruta

Cada bloque se despliega solo. Para los cambios de base se sigue el orden expand → deploy → contract: se agrega lo nuevo, se migran los lectores con las rutas viejas conviviendo, y recién después se retira lo viejo. Cada bloque lleva sus tests, vistos fallar antes de implementar, y la verificación contra la base real.

### Bloque 0 — Arreglar ya

Defectos baratos e independientes entre sí. Se pueden repartir en uno o dos despliegues.

| # | Arreglo | Cierra | Toca | Nota |
|---|---|---|---|---|
| 0.1 | **Fecha de Chile en las asignaciones.** Cambiar el `DEFAULT CURRENT_DATE` por `public.hoy_chile()` en `driver_assignments`, `asset_assignments`, `vehicle_driver_assignments` y `carrier_shippers` | F-10 | Migración (solo el default) | Corrige también lo que inserta Mage, sin tocar Mage |
| 0.2 | **Roster de conductores en vivo:** `list_carrier_drivers` lee el nombre y el estado desde `public.drivers`, como ya hace `list_carrier_assets` | F-14 | `carriers.py:710-717` | Mejor que un trigger nuevo: no suma otro `REFRESH` (F-18) |
| 0.3 | **Botones alineados con la API:** "Quitar" visible solo con `directory.delete`. La baja para Operaciones queda **a decisión** (P2): mientras tanto, ningún botón responde 403 | F-33 | `DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx`, fichas | Test por botón contra el permiso del endpoint |
| 0.4 | **El Cierre con un solo universo:** la tabla muestra también las líneas del día de quienes salieron del roster, en un grupo "Ya no están en el roster", con su motivo y su acción. La firma ya las cuenta | F-01 | `daily_closures.py:75,170` | Hoy hay 28 líneas bloqueando 4 días. Antes, preguntar si esas líneas deben quedar o borrarse en el recálculo (P5) |
| 0.5 | **`invalidateDirectory(qc)` y una fábrica de claves:** une las raíces del Directorio y de Certificación, agrega `carriers-directorio`, invalida la empresa destino de la transferencia y unifica `carrier-detail` | F-13, F-17, F-19 | `lib/queries/` y las mutaciones de §3.3 de C | Lleva un test que compara las raíces con las claves que leen las pantallas |
| 0.6 | **Aviso de frescura en `equipment-closures` y `cierre-viajes`**, y `PATCH` del Directorio que avisan que hay un recálculo pendiente | F-15 | `closures/page.tsx`, respuesta de los `PATCH` | Reutiliza `AvisoDeActualizacion` |
| 0.7 | **Red mínima:** confirmar "Quitar", avisar el éxito de una transferencia, marca de baja en la tarjeta del conductor y del equipo, y un solo diccionario de estado ("Dada de baja") | F-34 (parcial), F-35 (parcial), F-04 (parcial) | Componentes del Directorio | La vista previa del impacto de la baja va en D2 |
| 0.8 | **Sin clasificar H2 y H4** (error y carga mostrados como vacío) | Auditoría de Sin clasificar §5 | `TriageWorkbench`, `TriageClassifyForm` | Ya estaba recomendado; es independiente |

### Bloques del rediseño, por efecto para el usuario

| Bloque | Qué entrega | Cierra | Expand / contract | Depende de |
|---|---|---|---|---|
| **D1. Una sola respuesta** | Funciones `app.is_operating`, `app.carrier_of` (hoy) y `app.carrier_operation_types`. Migran a ellas y a `document_state_sql` + `in_scope_sql` los lectores del Directorio (`_SQL_DIRECTORIO`, `_CARRIER_LIST_AGG`, `_pending_mandatory_join`), `entity_summary`, el embudo (`attributed`), la búsqueda de conductores del Monitor y el lateral de `trips.py`. El frontend deja de recalcular (`mandatoryProblems`, `DocumentChecklist`). Se arregla `exigible_sql` por tipo de entidad (B-8). Una sola normalización de RUT y patente en los buscadores | F-02, F-03, F-06, F-07, F-08 | Expand: funciones nuevas. Contract: borrar los predicados viejos. Sin cambios de tabla | Bloque 0 |
| **D2. Asignaciones con vigencia** | `app.fleet_assignment_periods` alimentada por trigger; `carrier_of(…, on_date)` lee el historial; el Cierre juzga MISMATCH con la empresa del día; `ultima_empresa_sql` y "Ingresó hace N días" pasan al historial; servicio único de asignaciones (asignar, transferir con fecha, terminar, **traer el existente**); baja de empresa con vista previa del impacto y la regla que se decida para la flota (P1); el Monitor marca en la tabla la flota que no es de la empresa del viaje (conductor **y** tracto) | F-09, F-11 (parcial), F-12, F-28, F-04, F-34 | Expand: tabla y trigger (el historial empieza a llenarse el día del despliegue). Migrar los lectores. Contract: retirar las cuatro orquestaciones | D1 |
| **D3. Maestro protegido por campo, y los trabajos que faltan** | Override por campo para nombre, empresa del tracto, clientes y tipo de operación; el recálculo propone y la ficha muestra la propuesta y su procedencia; corregir RUT y patente con auditoría; editar clientes; quitar el tipo de operación | F-26, F-29, F-30, F-32 (F-27 solo si se aprueba tocar Mage) | Expand: columna o tabla de overrides por campo. El pre-cierre lee las dos marcas. Contract: el override por fila queda solo para las asignaciones | D1. Requiere P9 a P12 |
| **D4. Una ficha por entidad** | Listas de Conductores y Equipos (filtros: sin empresa, de baja, sin origen); fichas propias de conductor y equipo; **una** ficha de empresa (absorbe `GestionDeclarada` y las acciones por sujeto, y retira `compliance/[carrierId]`, con la ruta vieja redirigiendo); panel de viajes de la entidad; la vista rápida también en el Monitor; enlaces por el helper de navegación; el origen del tracto mostrado como heredado y "Asignar origen" con filtro | F-20, F-21, F-22, F-24, F-31, F-36, F-05 | Las rutas viejas redirigen durante la convivencia | D1, D2. **Es el mismo trabajo que la parte "retirar la segunda ficha" del bloque 2 de Certificación** |
| **D5. Limpieza** | Retirar huérfanos (`fleet-daily-overview`, `listContacts`, `invalidate_trips_meta_cache`); partir las fichas y `carriers.py`; rutas `/buscar` y `/directorio` en inglés con alias; `REFRESH` selectivo (F-18); unificar los prefijos `taxonomias` / `taxonomies`; un alta de conductor (F-23) | F-18, F-23, F-25 | Contract | D4 |

**Primer bloque del rediseño: D1 ("Una sola respuesta").**
- Es el de mayor efecto por costo: cambia lo que muestran cinco pantallas sin tocar tablas ni Mage.
- Es la base que usan D2 a D4.
- Absorbe la mitad de backend del bloque 3 de Certificación (migrar lectores a `document_state_sql`), que se iba a hacer igual.

**Cómo se intercala con los bloques 2 a 4 de Certificación:**
1. **Bloque 0** (incluye H2 y H4 de Sin clasificar).
2. **Certificación 2a — Sin clasificar** (opción B de su auditoría), **en paralelo con D1.** No comparten código: Sin clasificar es el staging de documentos, y D1 son lectores de entidades.
3. **D1.** Desde aquí, Certificación 3 queda reducido a la interfaz: el panel único de documentos y "Pedir a Certificación".
4. **D2.**
5. **Certificación 3 — panel único de documentos.** Se construye antes de D4 porque D4 lo inserta en la ficha única. Antes hay que validar "Pedir a Certificación" con el cliente (D7 de la spec de Pendientes).
6. **D3.**
7. **D4 + Certificación 2b (retirar la segunda ficha).** Se hacen juntos: la ficha de Certificación no se retira hasta que la única tenga todo lo que hoy solo vive en ella.
8. **Certificación 4 — Configuración.** Puede ir en cualquier momento después de D1: adopta `in_scope_sql` y `is_operating` para "Alcanzaría a N de N" (L6).
9. **D5.**

---

## 6. Preguntas para el cliente y el usuario

Están agrupadas y sin repetir. Las que vienen de la auditoría de Sin clasificar llevan su número.

**Baja y reactivación**
- P1. Cuando se da de baja una empresa, ¿qué pasa con sus conductores y equipos? ¿Se desvinculan solos, quedan sin empresa o se elige en el momento? Hoy quedan colgados: 7 conductores y 9 equipos.
- P2. ¿Quién da de baja: Operaciones, Certificación o los dos? La minuta del 02/10 se lo encarga a WebCarga, y hoy Operaciones no tiene el permiso.
- P3. Un conductor dado de baja, ¿sigue figurando en su empresa (como historial) o sale de ella? Al reactivarlo, ¿vuelve a la misma empresa?
- P4. ¿La baja de una empresa debe avisar cuántos viajes de hoy y cuántos días abiertos del Cierre toca, antes de confirmar?
- P5. Las líneas del Cierre de alguien que salió del roster en un día abierto: ¿se muestran para darles motivo, o el recálculo las elimina? Hoy bloquean la firma sin verse.

**Asignaciones e historia**
- P6. Al transferir un conductor, ¿los días anteriores se juzgan con la empresa que tenía ese día (propuesta) o con la de hoy? ¿La transferencia puede tener una fecha efectiva retroactiva?
- P7. (Interna) ¿Vale la pena reconstruir el historial pasado desde `audit_log`, solo para las decisiones manuales, o el historial parte el día del despliegue?
- P8. El conductor de una empresa mixta, ¿es de Tractoreo, de Equipo Completo o depende del tracto que maneja ese día? ¿O se declara en el conductor?

**Quién manda en el maestro**
- P9. El nombre del conductor: ¿manda el Directorio o el TMS? Hoy el recálculo lo reemplaza por el del TMS.
- P10. Los clientes de una empresa: ¿los declara Operaciones, se infieren de los viajes, o ambas cosas, con una marca de procedencia? (Pedido A6 de la minuta del 02/10.)
- P11. Si el TMS informa otra empresa para un tracto, ¿se corrige solo o queda como propuesta para que alguien la acepte?
- P12. Corregir un RUT o una patente: ¿quién puede hacerlo y con qué respaldo? Un equipo que cambia de patente, ¿es el mismo equipo?
- (Pregunta para el usuario, no para el cliente) ¿Se autoriza revisar `load_assets_04` (Mage) para que no pise el tipo de operación? Sin esa autorización, F-27 queda fuera de la hoja de ruta.

**Habilitación**
- P13. Una empresa "al día": ¿es la empresa sola, o la empresa más su flota activa? ¿"Por vencer" cuenta como al día?
- P14. ¿Se debe impedir asignar a un viaje un conductor o un tracto con documentos vencidos (backlog CER-03), o basta con avisar?
- P15. "Pedir a Certificación" para Operaciones (D7 de la spec de Pendientes): validar antes del bloque 3.

**Navegación y nombres**
- P16. ¿Un solo lugar para la empresa? ¿El menú dice "Directorio" o "Empresas"? Y entre "Dada de baja" e "Inactiva", ¿cuál?
- P17. ¿Quieren listas propias de conductores y de equipos, al estilo de Samsara o Fleetio, además de entrar por la empresa?
- P18. ¿Quieren ver en la ficha los viajes de un conductor o de un equipo? ¿De qué período?

**De la auditoría de Sin clasificar que tocan aquí**
- P19 (su 5). ¿Operaciones debe ver Sin clasificar? Hoy la ve con un contador rojo y sin poder actuar. Es la misma clase de problema que P2.
- P20 (su 7). ¿Un solo nombre: "Sin clasificar" o "Bandeja"? Va junto con P16, en un glosario único.
- P21 (su 1). ¿Qué tan frecuente es la tanda de documentos de varias empresas? Define si "de qué empresa es" es el primer paso de la subida, y por lo tanto cómo se enlaza la ficha única con la carga.

## 7. Decisión del usuario (12/10)

- **Alternativa B** aprobada.
- **Mage ya no escribe empresas, conductores, equipos ni asignaciones:** todo está migrado a la base y se gestiona desde la
  app. En consecuencia:
  - F-27 (`load_assets_04` reescribiendo el tipo de operación) sale de la hoja de ruta;
  - los bloques `load_carriers_02/09`, `load_drivers_03`, `load_assets_04`, `load_driver_assignments_06/07` dejan de contarse
    como escritores en el mapa de fuente de verdad (§3);
  - el historial de asignaciones y el override por campo se diseñan para los escritores de la app (Directorio, Certificación,
    Monitor, pre-cierre del Cierre, padrón), sin la restricción de "cubrir a Mage sin tocarlo". El trigger sigue siendo la
    forma de capturar a todos los escritores de la app.

### Preguntas resueltas (12/10)

- **P1 — resuelta por una decisión previa:** dar de baja archiva, no oculta (Ronda 135; Avetta/ISNetworld/Ariba). La flota
  queda vinculada a la empresa como historial, sale de las colas de trabajo (Pendientes ya lo aplica con `in_scope_sql`) y se
  bloquea la escritura, no la lectura. Lo que falta es mostrarlo: marcar en Directorio, vista rápida y Monitor que la flota es
  de una empresa dada de baja (A-9) → bloque 0.
- **P9 — resuelta por la regla "fuente de verdad por campo":** el nombre del conductor es del maestro y lo gestiona el
  Directorio; el TMS solo dice quién manejó cada viaje. Con Mage fuera del maestro, el pre-cierre deja de renombrar
  conductores (A-7) → bloque 0.
- **P6 — sí:** cada día se juzga con la empresa que el conductor o el equipo tenía ESE día. Las asignaciones pasan a tener
  vigencia (D2) y una transferencia no reescribe días anteriores a su fecha efectiva.
- **P5 — estándar de trazabilidad:** el recálculo nunca borra hechos del viaje (empresa, conductor, equipo, eventos). Con la
  vigencia de P6, las líneas de un día anterior a la salida son normales (esa persona estaba en el roster ese día). Las líneas
  de un día posterior a la salida (el TMS dice que manejó) son una excepción: se muestran en un grupo propio con su motivo y su
  acción, y la tabla y la firma cuentan el mismo universo. Nada se elimina en silencio; un día firmado no se reabre.
- **P13 — empresa + flota (12/10, sesión de la tarde):** una empresa está "al día" cuando lo están sus documentos y los de
  su flota activa en alcance (`in_scope_sql`). "Por vencer" cuenta como al día. Es la regla de `app.is_operating` (D1).
- **Sin clasificar = opción B** de su auditoría (cola de excepciones con revisión agrupada, reusa `BulkUploadReview`);
  va en paralelo con D1.
- **P8 — depende del tracto del día (12/10), y ya está resuelto así:** el tipo de operación sale del tracto
  (`assets.webcarga_operation_type_id`). Medido 13/08-12/10 (1.989 viajes): agrupar por empresa, empresa×cliente o
  empresa×cliente×origen da 0 grupos mezclados; 0 conductores manejaron los dos tipos. Cliente×origen NO decide (los 3 CD
  principales de Walmart tienen ambos tipos). Bordes: 28 viajes del tracto GPRZ30 sin tipo y sin empresa (fuera de todo el
  Cierre), 80 viajes sin tracto (72 Sodimac), 1 empresa mixta cuyo tracto de Equipo Completo no tuvo viajes (si empieza a
  operar, su conductor queda en el roster de Tractoreo por la regla por empresa), y la firma no congela el desglose por tipo.
- **Modelo de estados en tres capas (12/10, tras `2026-10-12-states-audit.md`):** ciclo de vida (dato), estado del
  documento (`document_state`, único, gobernado por las reglas de Configuración) y resumen de quien lo debe (el peor estado
  de sus obligatorios, con las cifras de Pendientes, misma consulta). Tener vencidos NO da de baja: la empresa sigue activa
  y queda **"No habilitada"** (calculado) hasta regularizar.
- **P16 y P20 resueltas:** "Habilitada / No habilitada"; la cola se llama **"Sin clasificar"** en todos lados ("Bandeja" se
  retira); el módulo se llama **"Directorio"**. Ciclo de vida en pantalla: Activa · En onboarding · Dada de baja.
- **Avisos (12/10):** "crítico" es un aviso calculado (días que faltan + umbral), no un estado del documento; lo calcula el
  backend y lo leen banners y Pendientes. Se retiran las filas de umbral por documento de Alertas (duplican los días de aviso
  por regla de Condiciones): global en Alertas, excepción en la condición.
- **Reactivar = recalificar (12/10):** la empresa vuelve con sus pendientes y queda No habilitada hasta regularizar.
  **P3 resuelta:** al reactivar se elige qué conductores y equipos vuelven (cada uno se recalifica) → flujo de escritura, D2.
- **Tipo de operación declarado (12/10):** un solo lugar de edición, la ficha de empresa del Directorio, con permiso para
  Certificación; Certificación lo ve y enlaza. Lo observado (tractos) manda, lo declarado cubre el hueco; la ficha marca la
  diferencia. Mover `GestionDeclarada` es parte de D4.
- **P10 resuelta (12/10):** los clientes de una empresa se declaran (Operaciones/Certificación, en la ficha del Directorio);
  los viajes proponen, y el recálculo deja de escribir `carrier_shippers` solo (hoy: 48 vínculos, 0 con término, único
  escritor `pre_cierre.py:327`, que agrega y nunca quita). Mismo patrón que el origen habitual (HU-28).
- **Hoja de ruta (12/10):** "editar clientes" (F-30) pasa de D3 a **D2**: un solo servicio de relaciones con vigencia
  (conductor–empresa, equipo–empresa, empresa–cliente): agregar, quitar con fecha, reincorporar, historia.
