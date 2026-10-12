# Auditoría del Directorio — Lente A: trabajos y clics (medido)

**Fecha:** 11/10/2026, de 21:45 a 22:20, hora de Chile. Plan: `2026-10-12-directory-audit.md`. Método: `2026-10-11-certification-audit.md`, §1 Lente A y §4-5.
**Entorno:** copia local (`.superpowers/local-sim/`), con datos 100 % ficticios.
- API en :8100, web en :3100.
- Usuarios: `ops@sim.local` (Supervisor de Operaciones) y `cert@sim.local` (Supervisor de Certificación). `owner@sim.local` exige MFA y no se usó.
- No se tocó el código, dev ni ninguna base remota.

**Datos que se agregaron a la copia local**, todos ficticios. Quedan en el volumen `webcarga-sim`:
- 2 orígenes: "CD Ficticio Norte" y "CD Ficticio Sur".
- 2 viajes de hoy: SIM-1001 (AAAA11, conductor de Cordillera) y SIM-1002 (BBBB11, conductor de Andes Ltda).
- El tipo de operación de los dos tractos.
- La fila `app.monitor_alert_rules` id=1. Faltaba, y sin ella el Monitor ocultaba todos los viajes.

**Cómo se reprodujo el ejecutor del Cierre.** En la copia local nadie lo llama, así que se simuló a mano. En producción es Cloud Scheduler cada minuto (`services/cola_del_cierre.py:3`). La simulación es un script que corre `procesar_cola`; está en el scratchpad, fuera del repo.

Las capturas están en `.playwright-mcp/directorio-*.png`. Los números se citan como (#NN).

**Ya auditado y no repetido:** Sin clasificar (`2026-10-11-sin-clasificar-ux-audit.md`). Se cita cuando corresponde.

---

## 1. Trabajos, desde la voz del cliente

| # | Trabajo | Fuente (cita) |
|---|---|---|
| T1 | Crear empresa, conductor y equipo | Minuta 02/10, §1: *"crear empresa → agregar conductor/equipo → subir documentos → clasificar. Funciona sin problemas."* Repetido en la minuta 09/10, §3.3 |
| T2 | Editar los clientes de una empresa ya creada | Minuta 02/10, pendiente A6: *"agregar opción de editar el cliente/generador de carga asignado post-creación. Hoy solo se puede asignar al crear la empresa."* Minuta 09/10: *"no disponible. Pendiente Felipe."* |
| T3 | Dar de baja una empresa, un conductor o un equipo, y verlo reflejado en el Cierre | Minuta 02/10, B2: *"Dar de baja empresa Fortaleza desde el directorio — … sigue apareciendo en el cierre"* (responsable: Fabián, de WebCarga). Minuta 09/10: *"Dar de baja conductores/equipos que ya no operan"* y *"Verificar que empresa Fortaleza ya no aparece en el cierre"* |
| T4 | Reactivar | AGENTLOG 11/10 (L6): *"reactivar a alguien la dejaría sin pendientes"*. Certificación ofrece "Reactivar" |
| T5 | Asignar y desasignar conductor o equipo; mover un conductor de empresa | Backlog, "HU-04 y HU-07: … transferencia entre empresas" (`entregables-backlog-roadmap/datos.py:422`). Minuta 02/10, §2.3: patentes de otras empresas *"puede ser un equipo nuevo que aún no fue ingresado al directorio, o … una empresa que se cambió a la competencia"* |
| T6 | Corregir el RUT o la patente | Minuta 02/10, §2.3, patente GPR Z30 mal atribuida. Backlog MAE-03 (empresas con nombre parecido) |
| T7 | Buscar | Minuta 09/10: *"accesos directos desde el cierre hacia la ficha del conductor/empresa/equipo"* |
| T8 | Saber si puede operar | Backlog CER-03: *"Impedir asignar un conductor o un tracto con documentos vencidos"*. Certificación se define como *"Qué le falta a cada empresa para estar en condiciones de operar"* |
| T9 | Ver sus documentos | Minutas 02/10 §3.3 y 09/10 §2.6 ("sábana"/"cubo") |
| T10 | Ver sus viajes | Backlog OPS-07: *"El estado operacional solo se ve en la ficha de la empresa"*. Minuta 09/10: el coordinador identifica viaje y conductor desde el Cierre |
| T11 | Fijar el origen habitual del conductor | HU-28 (AGENTLOG, Ronda 162): *"Lo único que falta es de negocio: cargar el origen habitual de los 41 conductores."* Minuta 09/10: *"Cargar orígenes reales en todos los conductores activos"* |
| T12 | Fijar el tipo de operación del equipo (Tractoreo / Equipo Completo) | Memoria del proyecto: `assets.webcarga_operation_type_id` (Ronda 85). La alta lo explica: *"La gestión decide si el equipo entra al cierre de Tractoreo"* |

---

## 2. Matriz trabajo × camino (escritorio, 1440 px)

Cómo leer las celdas:
- **Formato:** clics / capas (modales o cajones apilados) / campos.
- **Punto de partida:** la portada de cada módulo.
- **"Dup":** hay más de un camino para el mismo acto.
- **"—":** ese camino no existe.

| Trabajo | Directorio | Certificación › Empresas | Cierre | Monitor | Vista rápida |
|---|---|---|---|---|---|
| T1 Crear empresa | 2 / 0 / 2 (+2 casillas). Formulario en línea; **no pide clientes** (#90) | **Dup.** El mismo formulario, 2 / 0 / 2 (#91) | — | — | — |
| T1 Crear conductor | 4 / 0 / 3: ficha → pestaña → "+ Conductor" → Guardar (#62) | **Dup.** "Agregar conductor" en la ficha (no medido) | — | — | — |
| T1 Crear equipo | 4 / 0 / 4 (#60) | **Dup.** "Agregar equipo" (no medido) | — | — | — |
| T2 Editar clientes | **No existe.** Solo se muestran como etiquetas (#03) | No existe | — | — | — |
| T3 Baja de conductor | 5 / 2 / 0: ficha → pestaña → conductor (modal) → "Dar de baja" (modal) → Confirmar (#50). **Operaciones no ve el botón** | — | — | — | — |
| T3 Baja de empresa | 3 / 1 / 0. Sin vista previa del impacto (#92) | — | — | — | — |
| T4 Reactivar empresa | 3: "Inactivas" → ficha → Reactivar | **Dup.** 3: "No activas" → fila → Reactivar (#97) | — | — | — |
| T5 Mover conductor de empresa | 6 / 2 / 1: ficha → pestaña → conductor → "Transferir" (modal sobre modal) → escribir ≥2 letras → elegir → Confirmar (#20-#23). **Sin aviso de éxito** | — | — | — | — |
| T5 Desasignar equipo | 4 / 1 / 0. **Sin confirmación** (#53). A Operaciones le responde 403 (#42) | — | — | — | — |
| T5 Asignar un equipo o conductor sin empresa | **Imposible.** El alta por patente o RUT dice "Ya existe un activo…" o "…ya está registrado"; el resultado de búsqueda no se puede abrir (#58, #59, #61, #64) | Imposible | Vista rápida: "Sin empresa asignada: no tiene ficha propia" (#57) | — | — |
| T6 Corregir RUT de conductor o patente | **No existe** (ni en la API) | No existe | — | — | — |
| T6 Corregir RUT de empresa | **No existe en la pantalla.** La API lo acepta | — | — | — | — |
| T7 Buscar | 0 clics, buscador único (empresa, conductor o patente). Muestra "0 empresas · Sin resultados" **junto** al resultado (#58) | Buscador solo de empresas | Buscador de la tabla del día | Buscador de viajes | — |
| T8 ¿Puede operar? | Tarjeta "Al día" o "N pendiente", que **solo cuenta los documentos de la empresa**; el panel muestra % | "Incompleta 1 de 9" | Ícono de documentos críticos | Badge con número | Barra "1 por vencer · 1 falta" |
| T9 Ver documentos | 3 / 1: ficha → pestaña → entidad (modal) (#04) | **Dup.** 2 / 0, en el lugar (#31) | **Dup.** 1 / 1 (vista rápida) | Badge numérico; el detalle del viaje lista conteos (#71) | 1 / 1 (#12) |
| T10 Ver sus viajes | **No existe** en ninguna ficha | Solo un conteo, "1 viajes · 30 días" (#30) | Fila del día con "Ver viaje" | Buscar por nombre | — |
| T11 Origen habitual | 6 / 1 / 1: ficha → pestaña → conductor → elegir → Guardar | — | **Dup.** 4 / 1 / 1 + volver: nombre → "Abrir ficha completa" (salta al Directorio con "Volver al Cierre") → elegir → Guardar → Esc → Volver (#13, #14). "Asignar desde el Directorio" lleva a la lista general | — | Solo lectura |
| T12 Tipo de operación | 5 / 1 / 1: ficha → Equipos → equipo → elegir → Guardar (#41). El panel tiene un segundo botón de guardar para el conductor habitual | — | — | — | Solo lectura |

**A 390 px** (#80-#85):
- Las mismas rutas, más el desplazamiento.
- El panel del conductor ocupa la pantalla entera y los documentos quedan bajo el pliegue (#82).
- La barra inferior tiene 10 ítems con los rótulos pegados ("MONITEMPRESAS", "SEGUROSTARIFARIOADMINSALIR"), y en ella conviven "Empresas" (de Certificación) y "Directorio" (#82, #83).

---

## 3. Sincronía: edición en el Directorio → qué muestra cada pantalla

**Cómo se probó "sin recargar":**
- se navegó dentro de la aplicación (barra lateral, "Volver al Cierre", botón "Cerrar el día"), con los datos ya en caché;
- después se recargó con F5;
- el ejecutor del Cierre se simuló a mano para separar los dos efectos.

| Edición | Directorio | Cierre, sin recargar | Cierre, recargado | Cierre, después del ejecutor | Monitor | Certificación | Vista rápida |
|---|---|---|---|---|---|---|---|
| **E1. Origen habitual Sur → Norte** (Díaz Lagos) | Guardado; sin aviso | Valor viejo ("CD Ficticio Sur"), con "Actualizando con los últimos cambios…" (#16) | Valor viejo | Se corrige solo en ≤15 s, sin recargar | No muestra el origen | No muestra el origen | **Valor nuevo, en la misma pantalla en que la fila del Cierre muestra el viejo** (#17) |
| **E2. Transferir conductor** Cordillera → Andes Ltda (Rojas, con viaje hoy) | Desaparece de la empresa de origen sin aviso de éxito (#23) | Fila con "Transportes Cordillera SpA" (#25) | Igual | **Igual.** La fila es la del tracto AAAA11 y toma la empresa del tracto. La línea propia del conductor desaparece, porque la empresa destino es Equipo Completo (#27) | El viaje sigue en Cordillera **sin alerta en la tabla** (#24). El detalle del viaje sí avisa: "El conductor pertenece a Transportes Andes Ltda… revisar en Empresas" (#72) | La ficha de Andes pasa a 3 conductores (#31) | **"Transportes Andes Ltda"**, mientras la fila de al lado dice Cordillera (#26) |
| **E3. Dar de baja conductor** (Díaz Lagos) | Tarjeta **sin marca de inactivo**; el panel solo cambia el botón a "Reactivar" (#51, #52) | **Sigue en la tabla y sin aviso.** La caché de 5 min no trae el estado pendiente (#55) | Desaparece; aviso "Actualizando…" | Desaparece; la línea sigue en la base | — | La vista "por conductor" lo sigue listando con 1 pendiente (#96) | El buscador del Directorio dice "Dado de baja" |
| **E4. Quitar equipo del roster** (AAAA11, con viaje hoy) | Desaparece **sin confirmación** (#53) | Empresa "Cordillera" (caché) | Empresa "—" | Sigue "Asignado", empresa "—" | Sin cambio ni alerta. El detalle del viaje **no** avisa por el tracto, aunque sí lo hace por el conductor (#72) | Sale de los conteos | "Sin empresa asignada: no tiene ficha propia" y ninguna acción (#57). **Callejón sin salida** (#58-#61) |
| **E5. Dar de baja empresa** (Andes Ltda: 3 conductores, 2 equipos, 1 viaje hoy) | "Dada de baja"; sus conductores siguen con "2 pendientes" y sin marca (#93) | Sin cambio (#95) | BBBB11 sigue asignado, correcto por el viaje de hoy | Igual | Sin marca de empresa de baja (#94) | La portada la pasa a "No activas" y cae a 3 documentos por cubrir. **"Por conductor" sigue listando sus 3 conductores (9 documentos)**, aunque la ficha dice "Deja de contar en los pendientes del módulo" (#96, #97) | `/drivers/{id}/summary` responde "Activo" y la empresa, sin decir que la empresa está de baja |
| **E6. Corregir RUT o patente** | No es posible (§2) | — | — | — | — | — | — |
| **Efecto lateral:** el ejecutor del Cierre renombra al conductor | "Rojas Pérez, Andrés" pasa a **"ANDRES ROJAS"** sin aviso ni registro visible (#20) | "ANDRES ROJAS" | — | — | "Andres Rojas" | "ANDRES ROJAS" | "ANDRES ROJAS" |

### La misma entidad, pantalla por pantalla (después de E2 y E5)

| Pregunta | Directorio | Certificación | Cierre | Monitor | Vista rápida |
|---|---|---|---|---|---|
| ¿Empresa de Rojas? | Andes Ltda | Andes Ltda | Cordillera (la del tracto) | Cordillera (la del vínculo del viaje) | Andes Ltda |
| ¿Andes Ltda está al día? | **"Al día · 100 % · Sin pendientes obligatorios"** (#32) | **"Incompleta · 1 de 9"** (#30) | — | Sin badge de empresa | — |
| Documentos de Rojas | Tarjeta: "2 pendientes"; panel: "1 de 2 al día", con la Licencia en verde porque "vence en 9 días" | "0 de 2" en la vista por conductor | Ícono | "2" | "1 por vencer · 1 falta" |
| ¿Andes Ltda está activa? | "Dada de baja" | "Inactiva" | — | Sin dato | Sus conductores, "Activo" |
| Documentos por cubrir (total) | — | Portada: 3 · Por conductor: 9 · Barra lateral: 16 (son de Sin clasificar) | — | — | — |

---

## 4. Hallazgos

Severidades: **B** = bloquea, **C** = confunde, **$** = costo interno.

| Id | Hallazgo | Evidencia | Efecto para el usuario | Causa raíz visible | Sev. |
|---|---|---|---|---|---|
| A-1 | Un equipo o conductor que se quita del roster queda **huérfano e irrecuperable** desde la pantalla | #57-#61, #64; `routers/assets.py:74` (409 "Ya existe un activo"); `drivers.py:278`; `EntityQuickView.tsx:77` | Un tracto que vuelve a operar, o que cambia de empresa, no se puede volver a asignar | No hay lista de conductores ni de equipos: `/dashboard/drivers/[id]` y `/assets/[id]` solo redirigen a la ficha de su empresa (`EntityRedirect`). El alta no ofrece "traer el existente" | B |
| A-2 | **No se puede corregir el RUT de un conductor ni la patente** de un equipo. El RUT de la empresa la API lo acepta, pero la pantalla no lo ofrece | `schemas/driver.py:35`, `schemas/asset.py:49` (sin esos campos); `schemas/carrier.py:83` (sí `tax_id`); `carriers/[id]/page.tsx:425` (solo lectura) | Un error de tipeo obliga a crear otra entidad, que choca con la misma validación de A-1 | Esos campos no se pensaron como editables | B |
| A-3 | **Los clientes de una empresa no se pueden editar** (pedido el 02/10 y el 09/10), y el alta tampoco los pide | `routers/carriers.py:985` (solo GET); #90 | Operaciones depende de que el recálculo los infiera | Las escrituras de `carrier_shippers` solo las hace `pre_cierre.py` | B |
| A-4 | **"¿Puede operar?" tiene cinco respuestas**, y la lista del Directorio dice "Al día" de una empresa con 7 documentos faltantes | #30 frente a #32; `routers/carriers.py:76-78` (cuenta solo `entity_type='CARRIER'`); tarjeta frente a panel (#04) | Se aprueba o asigna una empresa que no está en regla | Cada pantalla define su propio alcance (empresa sola o empresa + flota) y su propio vocabulario (por vencer cuenta como "al día", "pendiente" o "por vencer") | C |
| A-5 | Después de editar en el Directorio, **el Cierre muestra datos viejos sin ningún aviso** durante la misma sesión | #55; `closures/page.tsx:209` (`staleTime` de 5 min); `:158` (sondea solo si la caché ya trae `pendiente_desde`); las mutaciones del Directorio invalidan solo claves de la propia ficha (`carriers/[id]/page.tsx:220-259`) | Se firma el día con un conductor dado de baja a la vista, o se duda de si la baja funcionó | Nadie invalida `['daily-closure']` ni `['equipment-closures']`; el aviso depende de un dato que la caché no tiene | C |
| A-6 | En la misma pantalla del Cierre, **la fila y la vista rápida se contradicen** (origen, empresa) | #17, #26 | No se sabe a cuál creerle | La fila lee la línea congelada (o la empresa del tracto); la vista rápida lee el maestro en vivo. Nada dice cuál es cuál | C |
| A-7 | **El recálculo del Cierre reescribe el maestro sin avisar**: renombra conductores con el nombre del TMS, reasigna la empresa de un tracto y agrega clientes. Además, editar cualquier campo congela la fila entera | `services/pre_cierre.py:304-352` y siguientes; `services/audit.py:101` (`is_manual_override` por fila) | El Directorio cambia solo ("ANDRES ROJAS" en lugar de "Rojas Pérez, Andrés"). Fijar el origen deja también el nombre fuera de las correcciones del TMS | La protección contra el TMS es por fila, no por campo (memoria "la fuente de verdad se decide por campo") | C |
| A-8 | **Los permisos de los botones no calzan con los de la API.** Operaciones ve "Quitar del roster" y recibe 403; no ve "Dar de baja", aunque las minutas le encargan a Operaciones dar de baja a Fortaleza | #42; `DriverDetailPanel.tsx:287,296,315` (`canEdit` frente a `canAdmin`); `routers/carriers.py:812` (`DIRECTORY_DELETE`) | El botón destructivo falla; la baja que corresponde no se puede hacer | La misma clase de error que L5 (auditoría de Certificación) | C |
| A-9 | **La baja es invisible.** La tarjeta del conductor inactivo no tiene marca; el panel no muestra el estado; los conductores de una empresa dada de baja aparecen sin marca; la vista rápida dice "Activo" | #51, #52, #93; respuesta de `/drivers/{id}/summary` | Se asigna o se carga documentación de alguien que ya no opera | El estado de la empresa no se propaga a sus conductores en la lectura | C |
| A-10 | **Certificación se contradice a sí misma con las empresas de baja**: la ficha dice "deja de contar en los pendientes"; la portada cuenta 3 y la vista por conductor, 9 | #96, #97 | El número de "por cubrir" depende de la vista | Es L6 sin cerrar: falta una sola definición de alcance | C |
| A-11 | **La transferencia fecha la nueva asignación con la fecha UTC** (12/10 para un traslado del 11/10 a las 21:55, hora de Chile), y la asignación anterior queda INACTIVE sin `end_date` | Consulta a la base local; `routers/carriers.py:789` (sin `start_date` → `CURRENT_DATE`); `:819` (desasignar no cierra la fecha) | El historial "¿con quién estaba tal día?" queda corrido un día o sin cierre | La misma clase de error del huso horario (memoria asyncpg) | $ |
| A-12 | **El Monitor no refleja cambios del Directorio.** La tabla no alerta un conductor ni un tracto que ya no son de la empresa del viaje; el detalle avisa por el conductor y no por el tracto, y remite a "Empresas" | #24, #72, #94 | Un viaje en curso con flota fuera de regla pasa desapercibido | La EETT del viaje sale del vínculo del viaje; la alerta solo existe en el detalle y solo para el conductor | C |
| A-13 | **No hay lista de conductores ni de equipos.** Se busca desde la lista de empresas, que muestra "0 empresas · Sin resultados" sobre el resultado; un resultado sin empresa no se puede abrir | #58, #59 | Para encontrar a alguien hay que saber su empresa, o usar un buscador que se contradice | La empresa es la única unidad de navegación | $ |
| A-14 | **Ninguna ficha muestra los viajes** de la entidad | Matriz, T10 | Para saber dónde anduvo un conductor hay que buscarlo en el Monitor o en el Historial | No hay un panel de actividad por entidad | $ |
| A-15 | **Vocabulario dispar:** | #03, #20, #60, #72, #93, #97 | Más carga cognitiva. Los nombres internos se filtran a la pantalla | Falta un glosario único | C |
| | — "Tax ID" y el placeholder "Filtrar por nombre o tax_id…" | `carriers/[id]/page.tsx:425,631` | | | |
| | — "Quitar del roster" | | | | |
| | — "Ya existe un **activo**…", donde "activo" quiere decir *asset* | | | | |
| | — "Tipo de gestión", "Gestión" y "Tipo de operación" para la misma cosa | | | | |
| | — "Dada de baja" y "Inactiva" para el mismo estado | | | | |
| | — tres grafías del mismo nombre | | | | |
| A-16 | **Acciones de impacto sin red:** | #53, #92, #23 | Errores silenciosos y costosos de revertir | — | $ |
| | — "Quitar del roster" actúa con un clic, sin confirmación ni deshacer | | | | |
| | — la baja de una empresa no dice qué arrastra (3 conductores, 2 equipos, 1 viaje hoy) | | | | |
| | — transferir no confirma a dónde fue la entidad | | | | |
| A-17 | **"Asignar desde el Directorio" del Cierre lleva a la lista general**, no a los conductores sin origen | `FlotaDelDiaSection.tsx:530` | Para cargar 41 orígenes (HU-28) hay que recorrer empresa por empresa | El enlace no lleva filtro | $ |
| A-18 | **Dos fichas de empresa con acciones duplicadas** ("Nueva empresa", "Reactivar"), con distinto layout y distintos números; en el móvil conviven "Empresas" y "Directorio" | #30-#32, #91, #97, #82 | No hay un "lugar de la empresa" | Ya señalado en la auditoría de Certificación (§0.1) | $ |
| A-19 | **Un mismo conductor aparece dos veces en el Cierre:** en la fila del tracto y en "Otros conductores del día", con "Sin tracto habitual" aunque manejó el tracto | #11 | Doble conteo aparente | Los ejes del conductor y del tracto se unen sin deduplicar | C |
| A-20 | **Capas y guardados:** | #20, #41, #82 | Más clics; en el móvil, lo importante (los documentos) queda fuera de la vista | — | $ |
| | — transferir abre un modal sobre otro modal | | | | |
| | — el panel del equipo tiene dos botones de guardar | | | | |
| | — a 390 px el panel del conductor es un modal de pantalla completa | | | | |

**Lo que funciona y hay que conservar:**
- El Cierre se corrige solo en ≤15 s cuando el aviso "Actualizando…" está presente.
- La dirección canónica `/dashboard/drivers/{id}` abre la ficha correcta, con "Volver al Cierre".
- El alta de empresa es un solo componente en los dos módulos.
- El detalle del viaje detecta al conductor de otra empresa.
- El buscador único del Directorio encuentra conductores y patentes.

---

## 5. Estándar de la industria

| Producto | Unidad de navegación | Asignaciones | Documentos |
|---|---|---|---|
| **Samsara** | Listas propias de **Drivers** y **Vehicles** (más Assets), cada una con su ficha. El conductor tiene un *home terminal* (equivale al origen habitual) como atributo propio | En la ficha del conductor: vehículo y terminal, con fecha e historial; el conductor desactivado queda en la lista con un filtro "Deactivated" y puede reactivarse | Documentos y vencimientos dentro de la ficha de cada conductor o vehículo |
| **Fleetio** | **Vehicles** y **Contacts/Operators** como listas de primer nivel, con buscador global | *Vehicle Assignments* con fecha de inicio y de fin (un historial, no un estado), visibles desde la ficha del vehículo y la del operador | *Documents* y *Renewal Reminders* por vehículo y por operador, con estado en texto ("Overdue", "Due soon") |
| **Avetta** | **Supplier** (la empresa contratista), con sus *employees* adentro | El trabajador se mueve entre contratistas conservando su historial; la empresa cliente ve el estado | Un solo indicador de cumplimiento por proveedor (cumple / no cumple / en riesgo), con la misma regla en todas las vistas |

**La diferencia con WebCarga:**
- **Unidad de navegación.** Allá cada entidad tiene lista y ficha propias, y la empresa es un atributo. Aquí la empresa es la puerta única, y la entidad sin empresa no tiene casa (A-1, A-13).
- **Asignaciones.** Allá son un historial con fechas (A-11).
- **Estado de cumplimiento.** Allá es uno y se repite igual en todas partes (A-4, A-10).

## 6. Heurísticas de Nielsen

| Heurística | Dónde se incumple |
|---|---|
| 1. Visibilidad del estado del sistema | A-5, A-6, A-9, A-12. Además, el éxito de una transferencia no se anuncia (A-16) |
| 2. Coincidencia con el mundo real | A-15 ("Tax ID", "roster", "activo", tres nombres para el tipo de operación) |
| 3. Control y libertad | A-16 (sin deshacer, sin confirmar), A-1 (no hay vuelta atrás tras quitar) |
| 4. Consistencia y estándares | A-4, A-10, A-18, A-19; "Dada de baja" frente a "Inactiva" |
| 5. Prevención de errores | A-8 (botones que la API rechaza), A-16 (baja de empresa sin vista previa del impacto), A-2 |
| 6. Reconocer antes que recordar | A-13 y A-14: hay que saber la empresa para encontrar a alguien, y recordar en qué viaje anduvo |
| 8. Diseño minimalista | Dos fichas de empresa; dos botones de guardar en un panel (A-18, A-20) |
| 9. Ayudar a reconocer y recuperarse de errores | "…ya está registrado con el RUT…" y "Ya existe un activo…" no ofrecen ir a la ficha ni traer la entidad (A-1) |
