# Casuística de negocio — Monitor (Diario)

Este documento reúne, en lenguaje simple, los comportamientos reales del Monitor que en algún momento generaron una pregunta o parecieron un error, y cómo la aplicación los resuelve hoy. Es un documento vivo — crece a medida que se descubren nuevos casos — y su objetivo final es ser la base del manual de uso para el equipo de operaciones.

Cada caso sigue el mismo formato: **qué se observa** (lo que ve el usuario), **qué pasa en realidad** (la causa), **por qué opera así** (el objetivo de negocio detrás de esa lógica — no basta con explicar la causa técnica, hay que explicar para qué sirve que la app se comporte así), **cómo lo resuelve la app** (el comportamiento actual), y la fecha de confirmación.

> Este documento se actualiza con el comando `/log-casuistica`. No editar directamente salvo corrección de redacción — cada caso nuevo debe agregarse con ese flujo para mantener el formato y la trazabilidad.

---

## 1. Fechas GPS vacías en algunos destinos

**Qué se observa**: en el detalle de un viaje, algunos destinos no muestran GPS Llegada ni GPS Salida.

**Qué pasa en realidad**: el camión todavía no ha llegado físicamente a ese destino. El sistema de la TMS (QAnalytics, Wingsuite o Sodimac) genuinamente no tiene ese dato porque el evento aún no ocurrió.

**Por qué opera así**: la app prefiere mostrar "sin dato" antes que inventar o estimar una fecha. Mostrar un valor falso podría hacer que operaciones crea que el camión ya llegó a un destino cuando en realidad no es así, con consecuencias reales (por ejemplo, dar por hecha una entrega que no ocurrió, o no hacer seguimiento a un atraso real).

**Cómo lo resuelve la app**: no requiere ninguna acción — apenas el camión llegue y la TMS lo reporte, la fecha aparece sola en la siguiente sincronización del pipeline (corre varias veces al día).

**Confirmado**: 2026-08-01 (viajes 2021346, 30159682, 2021502, 2021621).

---

## 2. GPS Llegada/Salida vs. Llegada TR/Salida TR — cuál se puede editar

**Qué se observa**: hay dos pares de columnas de fecha muy parecidas en la tabla técnica del viaje.

**Qué pasa en realidad**: son dos datos distintos, con distinto dueño. **GPS Llegada/Salida** es la posición real del camión, reportada automáticamente por el sistema de rastreo. **Llegada TR/Salida TR** es lo que el operador de la TMS (o el equipo de WebCarga desde la Bitácora) registra manualmente para efectos de cumplimiento.

**Por qué opera así**: GPS es la única fuente que nadie puede modificar después de los hechos — por eso queda bloqueada para edición, es el dato que se usa si hay que demostrarle algo a un cliente o a una aseguradora frente a una disputa (por ejemplo, "el camión sí llegó a tiempo" o "la carga sí estuvo en rango de temperatura"). Llegada TR/Salida TR, en cambio, es información operativa que sí puede necesitar corrección humana: el operador se equivocó al tipear, o la TMS no capturó el dato pero operaciones sabe la hora real por otro medio.

**Cómo lo resuelve la app**: GPS Llegada/Salida siempre aparece de solo lectura, incluso si una TMS no lo reporta. Llegada TR/Salida TR es editable en los destinos.

**Confirmado**: 2026-07-31.

---

## 3. El orden de las paradas en el timeline del viaje

**Qué se observa**: a veces el orden de las paradas en pantalla no coincide con el orden numérico que reporta la TMS.

**Qué pasa en realidad**: la app ordena las paradas según la hora **real** de llegada (dato GPS, el más confiable), no según el orden crudo que entrega la TMS — que puede estar desactualizado o mal planificado si el conductor visitó los destinos en un orden distinto al planificado.

**Por qué opera así**: mostrar el orden real, no el planificado, evita que operaciones tome decisiones (o interprete el estado del viaje) basándose en un plan que ya no corresponde a lo que el camión efectivamente está haciendo en la calle.

**Cómo lo resuelve la app**: el timeline y la tabla técnica siempre muestran las paradas en el orden real en que el camión las visitó (o va a visitarlas, para las que aún están pendientes).

**Confirmado**: 2026-08-01 (viajes 2021621, 2021643, 2020594).

---

## 4. "¿Dónde está el camión ahora?" (parada activa)

**Qué se observa**: un punto animado en el timeline marca una parada como la actual.

**Qué pasa en realidad**: la app calcula automáticamente en qué parada está el camión, combinando llegada y salida real (GPS como señal principal, dato manual como respaldo) — no depende de que un operador lo actualice a mano.

**Por qué opera así**: automatizarlo evita que cada operador tenga que ir marcando manualmente "el camión está aquí ahora" en cada viaje activo — reduce el trabajo operativo y elimina el riesgo de que la posición quede desactualizada porque alguien se olvidó de moverla.

**Cómo lo resuelve la app**: la parada activa avanza sola a medida que el camión reporta nuevas llegadas o salidas, sin intervención manual.

**Confirmado**: 2026-08-01.

---

## 5. Estado del viaje (RUTA / EN LOCAL / RETORNANDO / CERRADO)

**Qué se observa**: el estado general del viaje, visible en el encabezado del detalle.

**Qué pasa en realidad**: viene directamente del sistema SAP de la TMS y puede cambiar varias veces durante el día. Hasta el 2026-08-01 existía un problema real: dos paradas de un mismo viaje podían quedar mostrando, al mismo tiempo, dos Estados distintos, por un desajuste en cómo se sincronizaba internamente la información.

**Por qué opera así**: si dos paradas del mismo viaje pueden mostrar Estados distintos, operaciones no puede confiar en ningún reporte, alerta o cierre que dependa de ese Estado — la sincronización es la base para que cualquier lógica que lo use (alertas, cierres de viaje, reportería) sea confiable y no contradiga lo que el operador ve en pantalla.

**Cómo lo resuelve la app**: corregido — el Estado del viaje ya queda sincronizado entre todas las paradas del mismo viaje en cada actualización del pipeline.

**Confirmado**: 2026-08-01.

---

## 6. La temperatura reportada no siempre es "la de esa parada"

**Qué se observa**: la temperatura que se ve en distintas paradas de un mismo viaje a veces parece ser siempre la misma, incluso en destinos distintos ya entregados.

**Qué pasa en realidad**: QAnalytics reporta la temperatura como la lectura **en vivo** del vehículo en el momento de la consulta — no guarda una foto histórica de cuál era la temperatura al momento exacto de cada entrega. Por eso, mientras el camión sigue circulando, todas las paradas (visitadas o no) muestran el mismo número: el actual.

**Por qué opera así**: el negocio necesita dos cosas distintas al mismo tiempo, y la app las resuelve con la misma lectura sin pedir un dato nuevo: (a) **monitoreo en vivo** mientras el camión tiene carga fría a bordo, para poder reaccionar a tiempo si algo se sale de rango, y (b) **evidencia histórica por entrega**, para poder auditar después si se cumplió la cadena de frío en cada destino específico — algo clave si un cliente reclama por mercadería que llegó fuera de temperatura. "Congelar" la lectura al momento de la salida logra lo segundo sin sacrificar lo primero.

**Cómo lo resuelve la app**:
- Una vez que el camión **sale** de un destino, la temperatura de esa parada queda "congelada" — deja de actualizarse y refleja la lectura real más cercana al momento de esa entrega, para poder auditarla después.
- Mientras el camión sigue circulando con carga a bordo (parada activa o pendiente), la temperatura sigue actualizándose en vivo — útil para monitoreo en tiempo real.
- Cada parada ya visitada se compara contra el rango configurado para el tipo de carga (por ejemplo, Frío 2-5°C, Congelado -22 a -18°C) y se colorea en rojo si está fuera de rango, en verde si cumple.
- A nivel de todo el viaje, una vez que el camión ya entregó **toda** su carga, deja de marcarse como incumplimiento — un vehículo vacío sube naturalmente de temperatura y eso no es una falla de cadena de frío. Pero cada parada individual conserva su propio color para efectos de auditoría, sin importar si el viaje ya terminó.

**Confirmado**: 2026-08-01 (viaje 1953284, entre otros).

---

## 7. Viajes sin parada de "Origen"

**Qué se observa**: en algunos viajes, el timeline no muestra ninguna fila de Origen — solo aparecen los destinos.

**Qué pasa en realidad**: para QAnalytics, el nombre del local de origen viene del sistema SAP de cumplimiento, no del sistema de viajes en tiempo real. Si SAP todavía no ha reportado ese viaje (porque es muy reciente, o porque nunca lo llegó a procesar), no hay dato de origen disponible en ningún lado — no es que la app lo pierda, es que nunca llegó.

**Por qué opera así**: mismo principio que el caso 1 — es mejor no mostrar un origen que no mostrar el real, en vez de asumir uno genérico o inferido que podría ser incorrecto y confundir a operaciones sobre desde dónde salió realmente la carga.

**Cómo lo resuelve la app**: para viajes recién asignados, esto normalmente se resuelve solo en una corrida posterior del pipeline, apenas SAP reporta el viaje. Para viajes antiguos o ya cerrados sin ese dato, es probable que quede así de forma permanente — no es un error de la app, es información que la TMS nunca llegó a entregar.

**Alcance conocido**: ~1.3% de los viajes de QAnalytics (38 de 2.888 al 2026-08-01).

**Confirmado**: 2026-08-01 (viajes 1953284 y 2021343).

---

## 8. Locales duplicados en el detalle de un viaje *(histórico, corregido)*

**Qué se observa**: un mismo destino podía aparecer 2 o 3 veces en el timeline de un viaje.

**Qué pasa en realidad**: la identidad interna de cada parada se calculaba con una fórmula que podía cambiar si la TMS corregía el nombre del local entre dos consultas — eso generaba una fila nueva en vez de actualizar la existente.

**Por qué opera así**: cada parada necesita una identidad estable en el tiempo para que el sistema pueda reconocer "esta parada de hoy es la misma que vimos ayer" y así acumular su historial correctamente (llegada, salida, temperatura, notas de la Bitácora). Si esa identidad cambia sola, se pierde la trazabilidad de esa parada específica y aparece duplicada.

**Cómo lo resuelve la app**: corregido — la identidad de la parada ya no depende del orden en que aparece, solo del nombre del local.

**Confirmado**: 2026-07-28.

---

## 9. Viajes que dejan de reportar y quedan "activos" para siempre

**Qué se observa**: algunos viajes muestran una parada "en curso" con cientos o miles de horas (por ejemplo, más de 1000 horas detenido en un mismo local), o siguen apareciendo como "En Curso" en el Monitor semanas o meses después de su fecha planificada.

**Qué pasa en realidad**: a veces la TMS (observado en QAnalytics) deja de reportar un viaje sin nunca avisar que terminó — el viaje simplemente desaparece del propio sistema en vivo de la TMS antes de llegar a reportar su cierre. La app se queda con el último estado real que sí conoció (por ejemplo "En Local") y, sin ninguna regla de "hace cuánto no sabemos nada de este viaje", lo seguía considerando activo para siempre. No es un dato que la app pierda ni que se pueda recuperar después — nunca llegó a existir de este lado.

**Por qué opera así**: el Monitor necesita alguna definición de "todavía en curso" para que operaciones pueda confiar en esa vista como "lo que necesita atención ahora mismo", en vez de ir acumulando, para siempre, viajes que en la vida real ya terminaron hace tiempo pero de los que nunca llegó una confirmación formal de cierre. Sin este límite, la lista de "En Curso" se iba llenando de viajes fantasma y perdía utilidad operativa.

**Cómo lo resuelve la app**: un viaje deja de considerarse activo si no recibió ningún reporte de la TMS en los últimos 7 días, sin importar cuál sea su último estado conocido. La alerta "Sin actualización del TMS" ya avisa mucho antes de eso (a las pocas horas sin reporte, umbral configurable), así que operaciones tiene tiempo de notar y actuar sobre un viaje que empieza a quedarse sin reportar, antes de que la app lo dé de baja sola.

**Excepción importante — Sodimac**: esta regla de "7 días sin reporte" **no aplica a los viajes de Sodimac**. A diferencia de QAnalytics/Wingsuite (que reportan en vivo vía GPS/polling frecuente), el seguimiento de Sodimac pasa a gestión **manual** interna de WebCarga apenas el viaje se acepta: Sodimac da de alta el viaje como "ASIGNADO" para que WebCarga lo pueda operar, y "Aceptada" es el momento en que el equipo de operaciones ya validó un conductor disponible — desde ahí, el estado crudo que reporta Sodimac puede dejar de actualizarse durante semanas aunque el viaje siga completamente vigente, porque el seguimiento real ya no pasa por ese campo. Aplicarle la misma regla de 7 días habría dado de baja viajes de Sodimac que en realidad seguían en curso (confirmado con casos reales: viajes "ASIGNADO"/"Aceptada" con más de 30 días sin actualización, que no son abandono). Para Sodimac, un viaje solo se considera cerrado cuando su estado es explícitamente uno de los estados terminales (cerrado, cancelado, declinado, removido) — sin importar cuánto tiempo haya pasado.

**Mapeo de estados de Sodimac (borrador, pendiente confirmación final de Fabián)**: hoy la app ya reconoce y clasifica los siguientes estados crudos que reporta Sodimac, aunque el detalle fino puede ajustarse cuando Fabián confirme el criterio operativo real: "Creada", "Aceptada" y "Control de salida" se agrupan como gestión interna previa a que el viaje esté realmente en curso; "Despachada" se trata igual que "en ruta"; "Declinada" y "Removida" se tratan como cierre (igual que "Cerrado Finalizado" y "Cancelado"). Mientras no llegue esa confirmación, ningún viaje de Sodimac queda "huérfano" sin badge o sin poder editarse manualmente por tener un estado no reconocido por la app.

**Pendiente relacionado**: (1) hoy no queda registrado si un viaje se cerró de verdad o si el sistema lo dio de baja por inactividad — esa distinción depende de que se defina un protocolo de cierre de viajes manuales (responsabilidad de WebCarga, todavía pendiente); (2) el mapeo de estados de Sodimac de arriba sigue siendo un borrador pendiente de confirmación de Fabián (HU Cierre del Día §8) — se implementó con el criterio más razonable disponible hoy, no un dato confirmado de negocio.

**Alcance conocido**: 751 viajes marcados como activos antes de esta corrección; 698 de ellos (93%) sin ningún reporte hace más de 30 días.

**Gap encontrado y corregido el mismo día — viajes sin ningún reporte jamás**: 7 viajes de Wingsuite (planificados entre abril y junio) seguían apareciendo en "En Curso" incluso después de la corrección de arriba. Causa: a diferencia de los ~698 viajes que sí tenían una fecha de último reporte (vieja, pero una fecha), estos 7 nunca tuvieron ningún reporte de recencia en absoluto — y la corrección original solo sabía re-revisar viajes con una fecha vieja, no viajes sin fecha. Quedaron "invisibles" para la corrección, congelados en su estado de antes del fix. Se ajustó para que la revisión también alcance a los viajes sin ninguna fecha de reporte.

**Confirmado**: 2026-08-02 (viaje 1968333, entre otros; excepción Sodimac aclarada el mismo día; mapeo de estados Sodimac + estados faltantes de QAnalytics — CERRADO POR INTERFAZ, Sin Registros — completados el mismo día; gap de los 7 viajes de Wingsuite sin fecha de reporte encontrado y corregido el mismo día, tras verificación del usuario en vivo).
