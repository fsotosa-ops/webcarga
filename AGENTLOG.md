# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54, 55-109, 112-120 y 138-146 archivadas en su momento; ver el archivo.)
> (**Rondas 147-148 archivadas al cerrar la Ronda 149**: el backlog y el roadmap, el click-through
> de la app desplegada, el contrato, el rol `writer` y el test rojo. Lo que seguía abierto se
> consolidó ABAJO antes de mover nada.)
> (**Rondas 152-157 archivadas al cerrar la sesión del 2026-09-14**: todo su trabajo está
> desplegado, y lo que seguía abierto se consolidó en el checklist de la Ronda 160.)
> (**Rondas 149-161 archivadas al cerrar la Ronda 162**: el único pendiente propio de la 161 era
> la historia de usuario de Operación/CD, que ES la Ronda 162; lo demás que seguía abierto está
> consolidado en el checklist de abajo antes de mover nada.)

### 2026-10-08 — HU-C1 vencimientos: entregas 2, 2b y 2c (tabla editable) desplegadas en dev

**Fuente:** `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx` (96 tipos). Diseño y estados de pantalla:
la HU `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`, secciones "Diseño de interfaz"
de HU-C1 (2b: panel; 2c: tabla). Spec 2b: `docs/superpowers/specs/2026-10-08-c1-entrega-2b-configuracion-exigibilidad-carga-design.md`.

**Decisiones del usuario (07-08/10):**
- La planilla es el **estándar WebCarga**; se cargan **los 96**; la exigibilidad ("cuándo se carga") entra.
- Un archivo por empresa y período, con el corte de cada cliente; la ficha muestra el peor estado.
- *"Nada de parches, sigue el patrón de la app."* La API de `main` no se usa (se ignora).
- Aviso y gracia **rigen de inmediato** para todas las versiones; los parámetros de "cuándo vence" se versionan.
- **Tabla editable en lugar del panel** ("tiene muchos clics"): borrador → Ver efecto → Publicar, y **Publicar
  guarda Y aplica** (siembra), solo después de ver el efecto del borrador tal como está.
- Las rutas fuera de estándar quedan como deuda (`TECH_DEBT.md`); las 2 nuevas de esta entrega se corrigieron.

**Commits:**
- Entrega 2 (F0-F2): `c81e86af..bdcba04a`, desplegada; 5 migraciones en prod (`20261008100000..140000`).
- Entrega 2b (F3 siembra/solicitar, F4 carga con emisión/período, F5 editor, F6 script del catálogo):
  `d98391f9..6e653623` + revisión final `633b3b38`. Migraciones `20261009100000` (mensual exige aviso) y
  `20261009110000` (siembra respeta `exigible_on`) aplicadas. **Desplegada en dev** (API y Frontend en verde).
- Entrega 2c: `08213a7f` (backend: `POST /compliance-requirements/batch-preview` y `/batch-update`; PATCH, recálculo
  y lote escriben con `services/edicion_catalogo.py`) y `8f51343f` (frontend: tabla editable, `borrador.ts`,
  `BarraDelBorrador`, `celdas-del-borrador.tsx`; se retiraron `CeldaVigencia`, `CeldaNivel`, `AplicarEnLaFila`;
  color crudo 1.685 → 1.672). Ajustes vistos en dev: `9d9d19c0` (**`RequirementOption` no declaraba `aliases`
  y FastAPI los descartaba: "Se reconoce como" mostraba "—" desde siempre**; test que pasa cada fila por el
  modelo), `91b4fa3e`, `2f087e2c`, `f698f8d0`, `55acef4b` (la tabla cabe: 943 de 943 px a 1.440 con un mensual
  abierto). **Desplegada en dev.**

**Verificado:**
- 2b: suite backend completa 1.213/1.213; frontend 1.449/1.449; dev desplegado; en el navegador se vio el editor
  "¿Cuándo vence?" (encontró el defecto de la vista previa con regla incompleta, ya corregido en 2c).
- 2c: tests afectados del backend 119/119 (incluye `test_catalogo_en_lote.py`, con mutación verificada);
  frontend 1.473/1.473, tsc y build limpios (mutación de "Publicar exige ver el efecto" verificada).
  Suite completa del backend de 2c: 1.219/1.219 (la primera corrida se colgó en una conexión muerta tras un
  corte de red: 0 % CPU y sin consulta en `pg_stat_activity`; se relanzó con un monitor de estancamiento).
  En dev con Playwright, sin publicar: editar celdas, mensual con "Falta el día tope.", Ver efecto (ensayo
  revertido; la base quedó intacta), Descartar, barra fija al desplazarse, selección.

**Decisiones de arquitectura (2c):**
- El lote es todo o nada, con un savepoint por documento para que el 422 nombre cuál falló.
- Solo se recalcula la siembra de los documentos cuyo cambio la afecta (`is_active`, `applies_to_*`,
  `exigible_on`); renombrar o cambiar el aviso no siembra.
- La diferencia se calcula dentro de la transacción que siembra (`diferencias_en`), así ve lo recién activado.
- Lo que cambia el estado de alguien va al borrador; nombre y alias se guardan al instante (son etiqueta).
- `faltaDeVigencia` (lib/vigencia.ts) es la única regla de "qué le falta" en la pantalla; espeja el trigger.

**Hecho al cerrar (09/10):**
- 2c desplegada y revisada en dev: tabla editable en borrador, Ver efecto, Publicar en lote. Cabe en 943 de 943 px
  con los 113 documentos (`d5080d3e`, `6e46e560`, `1f655ec5`). El primer Deploy Frontend de `1f655ec5` falló bajando
  Fira Code de Google Fonts (red del runner); `gh run rerun --failed` lo resolvió.
- Catálogo de la planilla cargado con visto bueno: 75 tipos nuevos **apagados** (113 en total), 0 sembrados, todos
  con alias.
- De los 19 que ya existían, 7 coincidían y se publicó **solo F30-1** (mensual, día 18, mes anterior, aviso 5;
  0 documentos cargados, 0 efecto).
- `has_expiration` retirada (`20261009120000`, `0a1591eb`), con 0 lectores verificados antes y la app en 200 después.

**PENDIENTE — de WebCarga** (en Configuración › Certificación de dev):
- [ ] **Cargar la fecha de emisión** de los ~100 documentos aprobados de estos 11 tipos. Sin esa fecha, pasarlos a
      la regla de la planilla los deja "vencidos, falta el dato" (ensayo del 09/10: vencidos 21 → 121, al día
      112 → 11). Los tipos y la regla que les toca:
      - → anual desde la emisión: Certificado Mutual, Reglamento Interno, PTS Contratista, Entrega EPP, PTS
        Conductor, Hoja de Vida, DAS ODI, Capacitación EPP, Plan de Emergencia;
      - → anual + "solo cuando se solicita": Política de Seguridad (quita 238 pendientes de empresas que no la
        subieron; las 13 que la tienen la conservan);
      - → fecha del documento: Contrato de Trabajo.
      Con las fechas cargadas: elegir la regla en la tabla, "Ver efecto" (los vencidos deberían quedar cerca de
      21) y "Publicar". El borrador del lote está en el scratchpad de la sesión (`lote19.json`), no en git: se
      rehace con las funciones `_vigencia` / `_exigible` de `scripts/cargar_catalogo_webcarga.py`.
- [ ] **Responder las 11 dudas** de la planilla:
      1. ¿"Contrato asociado al servicio" = "Contrato Webcarga"? (coincidencia dudosa, no se tocó)
      2. ¿F30 de la planilla = "F30 Multas"? (coincidencia dudosa, no se tocó)
      3-5. "Al término del trabajador" que parece "al ingreso": Registro de entrega de EPP, Capacitación Matriz
           IPER, Curso OS10. Los dos últimos se cargaron literal (apagados); a Entrega EPP NO se le cambiará el
           "cuándo se exige" sin la respuesta (literal, le quitaría el pendiente a todos los conductores).
      6-7. "No aplica" con "Vigencia: Sí": Resolución jornada excepcional, Inspección de equipos eléctricos
           (cargados con fecha del documento).
      8-9. "Anual" con "Vigencia: No": Capacitación PTS trabajo en caliente, Entrega EPP específicos (cargados anuales).
      10. Liquidación: "10 de cada es" (se leyó día 10).
      11. Cronograma de trabajos: mensual sin día tope (cargado al último día del mes en curso).
- [ ] **Activar** los 75 nuevos por grupos, mirando "Ver efecto" (activar siembra un pendiente por empresa o
      conductor; no activarlos todos juntos por el Disk IO del plan free).
- [ ] Probar la tabla en dev y decir si algo molesta.

**PENDIENTE — de desarrollo:**
- [ ] Guardar las 11 dudas como nota del documento y mostrar la marca "Duda" en la tabla (diferido de 2c).
- [ ] Volver a medir la velocidad de `/status`, `/pending` y la cola con reglas activas (la última medición fue
      con 0 reglas: 0,26 / 0,18 / 0,25 s).
- [ ] Menores diferidos de la revisión 2b: M1 versión redundante el mismo día; M2 500 con solicitud huérfana; M3 la
      carga acepta datos que el tipo no pide; M4 bulk-file sin emisión/período; M6 `vigenciaDeLaFila` usa hoy UTC;
      M8 solicitados como "bloqueados" en recalc-preview; M10 nombres fijos de grupos de radio; M11 log de vigencia
      sin cambio.
- [ ] Deuda registrada en `TECH_DEBT.md` (08/10): rutas de la API fuera del estándar de nombres (plan aparte, con
      ruta vieja y nueva conviviendo) y Configuración en teléfono, que no pliega el menú de secciones.
- [ ] Si Deploy Frontend vuelve a fallar seguido bajando Google Fonts: servir la fuente local (`next/font/local`).

<details><summary>Detalle de la entrega 2 (F0-F2), 08/10</summary>


**Fuente:** `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx`, con 96 tipos de documento. Es la "HU de
vencimientos actualizada".

**Decisiones del usuario (07-08/10):**
- La planilla es el **estándar WebCarga**.
- Se cargan **los 96**.
- **"Cuándo se carga" (exigibilidad) entra**.
- **Un archivo por empresa y período**, con el corte de cada cliente; la ficha muestra el peor estado.
- *"Nada de parches, sigue el patrón de la app."*
- Se aceptan los 11 registros NONE con fecha manual, que dejan de verse vencidos.
- Se pidió optimizar antes de publicar.

**Planes:**
- alto nivel: `~/.claude/plans/swift-floating-pancake.md` (F0-F6);
- implementación de F0-F2: `docs/superpowers/plans/2026-10-07-c1-entrega-2-vigencia-y-exigibilidad.md`.

**Qué quedó (5 migraciones aplicadas a prod vía MCP, todas ensayadas con ROLLBACK):**

| Migración | Qué hace |
| :--- | :--- |
| `20261008100000` | `public.hoy_chile()`. La base corre en UTC y "vencido" se adelantaba desde las 21:00 de Chile. |
| `20261008110000` | Esquema expand: `ISSUE_PLUS_MONTHS`/`CALENDAR_PERIOD`, `exigible_on`, `issue_date`/`period_start`, `compliance_requirement_rules` (base `shipper_id` NULL + variante por cliente, versionada por `vigente_desde`, coherencia por CONSTRAINT TRIGGER diferido) y la fila `alert_thresholds.documento_por_vencer` (30). |
| `20261008120000` → `20261008130000` | Primero funciones `documento_*`. Medido: `/compliance/status` pasó de 0,28 a 0,76 s, porque Postgres no inlinea funciones con subconsultas. Se retiraron: el cálculo se arma en `app/services/vencimientos.py` (única definición) y viaja dentro de la consulta. En la base quedan solo `reglas_aplicables`, `clientes_de_entidad`, `corte_del_periodo` y `vence_segun_regla`. |
| `20261008140000` | Correcciones de la revisión final (opus): la fecha de referencia la dicta el tipo; gracia en todos los tipos; toda variante exige una base vigente desde `-infinity`; mover una regla valida también el requisito de origen. |

**Velocidad final** (endpoints reales, misma tanda; antes → ahora):

| Lectura | Antes | Ahora |
| :--- | ---: | ---: |
| `status` por empresa | 0,19 s | 0,26 s |
| `status` por conductor | 0,16 s | 0,18 s |
| Cola | 0,19 s | 0,25 s |

El tipo se pregunta como pertenencia sin correlación (hashed SubPlan), no con una búsqueda por registro.

**Verificado:**
- Suite completa: 1.147 en verde.
- Diferencia contra el cálculo viejo sobre los 5.691 registros vigentes: solo los 11 NONE con fecha (aceptados), y 0 NULL.
- Deploy Monitor API en verde sobre `bdcba04a`.
- Playwright en dev: Certificación, Monitor y la ficha (`/status`, `/trips`, `/summary` y `/pending`, todos 200, sin errores en consola).

**Compuertas antes de F3 en adelante** (hallazgos de la revisión, latentes porque hoy hay 0 reglas, 0 fechas nuevas y ningún tipo nuevo):
- **I5**: un documento "aún no exigible" (MONTH_AFTER_START / ON_ENTITY_END) sale como AL_DIA. Hay que resolverlo junto con la siembra de F3, con una de dos opciones:
  - no sembrar esos documentos hasta que sean exigibles;
  - crear un estado propio.
- **I6 en `main`**: la API de `main` solo conoce 3 tipos. No cargar ningún requisito con un tipo nuevo hasta desplegar `main` o retirarla. En dev, las respuestas ya aceptan los 5; la entrada se amplía en F5.
- Tipos mensuales: con el aviso general de 30 días quedan siempre "por vencer". Al cargarlos hay que fijar `warning_days` (~5); conviene exigirlo en el trigger (M6).

**Menores diferidos:**
- `test_hoy_chile` es tautológico.
- El frontend calcula su propio "hoy" (UTC) y muestra la fecha cruda. Hay que exponer `vence_el` en F3/F4.
- Volver a medir la velocidad en F5, con reglas cargadas.

**Siguiente paso exacto:**
- [ ] Escribir el plan de **F6.1**: el mapeo de los 96 en xlsx para que WebCarga lo apruebe, con sus preguntas:
  - combinaciones contradictorias;
  - "al término" en EPP, IPER y OS10;
  - vehículos;
  - cronograma sin corte;
  - "mes anterior";
  - fecha de ingreso;
  - erratas.

  Puede hacerse en paralelo con F3.
- [ ] Escribir el plan de **F3**: siembra según `exigible_on` (ON_REQUEST no se siembra) y "Solicitar documento". Resolver I5 dentro de F3.
- [ ] Después **F4** (carga y clasificación: fecha, emisión y período) y **F5** (selector de 4 tipos, ventanas por cliente y contract de las filas viejas de `alert_thresholds`).
- La Task 7b de la entrega 1 (`DROP has_expiration`) sigue esperando la confirmación del usuario.


</details>

### 2026-10-07 — Memoria técnica I+D para Corfo (entregable, sin cambios de código)

Pedido: `docs/reports/contexto-report.md`. Es una memoria de ~2 páginas que acredita I+D. Se hizo con la estrategia
de `one-pagers/proposals/santa-isabel`: HTML con estilos inline, pegado con Playwright en Google Docs, y figuras
en pptx nativo → Slides → PDF → PNG a 300 ppi.

**Entregables en Drive, carpeta `Webcarga` (`1rdqv1pwn0oW4ks9JP1dKVqEpR4bd4Cm5`):**
- `memoria-tecnica-id-webcarga` (Doc `11ZevqUpWMRMNvH0LjSWas7sUkLxKKUJogt433yxayd8`): 5 páginas,
  9 figuras y un glosario.
- `figuras-memoria-id-webcarga` (Slides `1_dLj9YWz1ufXLctQsoXyxdXbya8Rm375j9Gu0GYD9uE`): 9 láminas.
- `nota-interna-id-vs-rutinario` (Doc `1JUXh7kDMyDLoufjcisj5B3EosOIh22rB7NiI96ymPOk`): solo para
  WebCarga; separa I+D defendible, de apoyo, en curso y rutinario.
- Fuentes locales: `~/Desktop/projects/one-pagers/proposals/webcarga-corfo/` (`build_memoria.py`,
  `figuras/build_slides.py`, `figuras/export_pngs.py`, `check/revisar_pdf.sh`).

**Cifras contrastadas el 07/10 contra Supabase (solo lectura) y `origin/dev`:**
- 3.217 viajes.
- 19 de 3.101 traen RUT del TMS; 2.535 se resuelven por nombre.
- Cobertura de conductor: 94,6 / 95,7 / 94,3 % en ago/sep/oct.
- 43.436 versiones de 5.091 viajes; 5.270 archivos ingeridos.
- 22 días firmados con 2.682 líneas y 0 reaperturas.
- 88 viajes ausentes (61 ofertas retiradas + 27 eliminados).
- 149 endpoints en 23 routers (22 archivos).

**Lecciones:**
- El "141 endpoints" que venía del grep subestimaba la cifra: `requirements.py` usa `@requirements_router.`.
- El "93–100 %" del AGENTLOG ya no es cierto hoy (en las últimas 3 semanas la cobertura diaria va de 76 a 100 %).
- El clasificador documental tiene muy poco uso real: 152 archivos, 15/67 propuestos con confianza alta. Por eso quedó fuera
  de la memoria y en la nota interna como I+D en curso.

**Decisiones del usuario:**
- La memoria cuenta resultados medidos, no proceso.
- La API WebCarga aparece explícita en la figura de arquitectura.
- La concentración de la API (`trips.py`: 25 endpoints, 3.192 líneas, 20 % del backend) se declara como
  "endurecimiento planificado" en la memoria y se detalla en la nota interna.
- Los términos de negocio se definen en la primera aparición y hay un glosario al final.

**Estado:** entregable CERRADO (07/10). El usuario lo da por suficiente: es un reporte documental para la
postulación y Pablo no necesita más relato. No se agregan anexos ni secciones nuevas.

**Siguiente paso:**
- [x] Revisión de los 3 archivos: el usuario los da por suficientes.
- Anexos descartados por el usuario (07/10): ni las specs en PDF ni el commit de las specs al repo.
- [x] Deuda revisada el 07/10:
  - Los 9 endpoints del cierre (`daily-closures` 4, `equipment-closures` 3, `closures` 2) están **vivos**:
    los usan Cierre, Monitor e Historial, y ya leen y escriben `closure_lines` vía `services/cierre_lineas.py`.
  - Lo muerto son las 4 tablas viejas: `driver_day_status` (2.787 filas), `equipment_day_status` (4.356),
    `daily_closures` (22) y `equipment_closures` (21).
    - `cierre_lineas` las sigue escribiendo como "proyección" en la misma transacción.
    - Ningún código, vista ni función las lee.
    - Su último seq_scan del día-estado fue el 16/09.
  - Es la **ola 5** de `docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md`, junto con el `DROP` de
    `app.trips.comments`/`.notes`.
  - Memoria y nota corregidas: antes decían "retirar endpoints sin uso".
- [ ] Ola 5 del cierre:
  - quitar `_proyectar` y los INSERT a las cabeceras viejas;
  - después, `DROP` de las 4 tablas, que tienen FK a drivers, assets y status_taxonomies.
  - No es reversible: hacerlo entre corridas de ingesta.
  - Exploración del 07/10 (solo lectura, sin cambios; el usuario cortó: esa sesión era solo para el informe):
    - Puntos de escritura en `services/cierre_lineas.py`:
      - `_proyectar()` (líneas ~273-301, llamado en ~358 y ~456);
      - los INSERT a `daily_closures`/`equipment_closures` (~602/616);
      - los DELETE al reabrir (~655-656).
    - Tests que leen las tablas viejas: `test_cierre_lineas.py` (~508-544) y `test_modelo_de_cierre.py:102`.
    - **`app.trips.comments`/`.notes` NO van en esta ola:**
      - tienen 0 datos, pero los usan el modelo dbt `app/trips.sql` (`merge_exclude_columns`, `NULL AS notes`),
        `routers/trips.py` (SELECT y los campos válidos del PATCH), `schemas/trip.py` y `frontend/lib/types.ts`;
      - un DROP rompería la corrida de dbt. Requieren una tarea aparte que toque Mage.
    - Orden seguro:
      1. desplegar el código sin la doble escritura;
      2. verificar una firma y una reapertura reales;
      3. recién entonces, la migración DROP por `execute_sql`, entre corridas de ingesta.
    - Ojo: el 07/10 había otra sesión trabajando en C1 en `dev` (commits 12:04-12:21).

### 2026-10-06 — Ronda 166: minuta del 02/10 (Pablo) — HUs y fixes del Diario 2.0

Fuentes:
- Minuta de Pablo: `monitor-app/bugs/20261006/Minuta_Revision_01_02oct2026.docx`.
- Llamada del 02/10 "Webcarga 2.0" en Granola.
- Plan: `~/.claude/plans/starry-percolating-marble.md`.
- **HUs**: `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md` (fuera de git
  por diseño). Incluye D1-D5 para el Diario y C1-C4 y O1 solo como HU, para la reunión con Pablo.

## Hecho (D1-D3, sin migraciones)

1. **D1 — Cierre fusionado por tracto.** Se retira la tarjeta Conductores. Tractoreo queda con una fila
   por patente y el conductor habitual al lado.
   - Si conductor y tracto están los dos sin carga, la fila ES el conductor: el motivo va a la línea
     DRIVER y el tracto lo hereda con `_SQL_SINCRONIZAR_TRACTOS`.
   - Si el tracto tiene un motivo propio distinto del conductor, aparece un segundo selector, "Tracto".
   - "Otros conductores del día" agrupa a los que no tienen tracto habitual, a los que su tracto lo
     manejó otro ese día y a los que están por regularizar.
   - La fusión se hace en el frontend: los dos endpoints ya se pedían. Las dos familias de
     `closure_lines` siguen intactas, igual que `cerrar`.
   - Medido el 02/10: 47 tractos (7 sin habitual) y 1 conductor sin tracto, sin casos raros.
   - `vehicle_driver_assignments` tiene un índice único sobre el ACTIVE por tracto, así que el `LIMIT 1`
     ya era determinista.
2. **D2 — Viajes del cierre con contexto del Monitor.** `SQL_BASE` en `cierre_viajes.py` agrega
   TMS, patente, conductor y empresa, con las mismas expresiones de `_TRIP_SELECT`. El endpoint suma
   origen y destinos vía `_load_trip_stops`.
3. **D3 — Guardar y deshacer.**
   - En la fila, elegir un motivo deja un borrador; el viaje se cierra recién con "Guardar".
   - Grupo nuevo `con_motivo`: viajes declarados desde el cierre de D en adelante, según `audit_log`
     en hora de Chile.
   - `PATCH /trips/bulk-reopen` deshace la declaración:
     - restaura `is_active`/`is_working` desde la traza que ahora deja `bulk-close` (`field='is_active'`);
     - va en **dos UPDATE**, porque el trigger `protect_manual_overrides` revierte `is_active` mientras
       OLD lo marque como manual;
     - devuelve 409 si el viaje volvería a contar en un día firmado. El chequeo se hace DESPUÉS de
       deshacer, dentro de la transacción, porque `trips_del_dia` excluye los viajes con motivo.
   - En la Flota, "Sin especificar" en un tracto vuelve a heredar, **solo si su conductor tiene motivo**.
     Si no, la vigencia del propio tracto volvería a llenar lo que la persona borró a propósito.
- Verificado:
  - backend: cierre 61/61 y suite completa (ver checklist);
  - frontend: 1.405 tests, `tsc` y build en verde, trinquete en verde (atajó dos `text-[10px]`);
  - SQL nuevo probado con parámetros contra producción;
  - 4 mutaciones atrapadas: herencia, 409 y dos del ruteo de la fusión.

## Hallazgo que cambia D4/D5 (medido 06/10)

- El grupo "Abandonados por el TMS" del cierre tenía 52 viajes. Los 40 de Walmart, bajados del portal
  con una ventana 01/07–13/10 (en local, sin GCS):
  - **17 RETORNANDO figuran CERRADO FINALIZADO** en el TMS;
  - 2 figuran CERRADO INCOMPLETO;
  - **21 no están** en el TMS: son eliminados.
- **Causa raíz**: el scraper baja una ventana por fecha de planificación de hoy-7 a hoy+7. Un viaje
  que sale de la ventana no vuelve a actualizarse nunca, y su cierre no llega. Es la queja de Pablo:
  *"cuando el TMS se lo cambia a cerrado finalizado… no nos está generando ese cambio"*.
- La señal "Ya no está en el TMS" (`_tms_dropped`) **confunde salir de la ventana con ser eliminado**.
- El portal acepta 3,5 meses: 75 s y 1,3 MB, 5.083 filas.
- **Pablo no quiere eliminar ni que el sistema decida**: *"que se replique lo que dice el TMS"*. Los
  que sigan abiertos en el TMS sirven en el cierre para gestionar el cobro.

## Checklist — siguiente paso exacto

0. ~~HUs de Certificación~~ **REVISADAS (07/10, Ronda 167)**. La sección de Certificación de
   `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md` se reescribió contra
   la minuta, la transcripción de Granola del 02/10 y el código; los datos se verificaron con psql.
   - **C4 queda fuera de esta fase** (decisión del usuario): es un rediseño y va con plan aparte.
   - **Hallazgos**:
     - el F30-1 se creó el 01/10 con `expiration_policy=NONE`, porque `NuevoDocumentoPanel` no envía
       la política;
     - `has_expiration` sigue con lectores vivos (Sin clasificar, triage, planilla) aunque la fuente
       de verdad es `expiration_policy`;
     - "opcional" se siembra como pendiente (38 y 39 registros "falta");
     - no hay exención por empresa;
     - la póliza no se vincula a Seguros.
   - **HUs nuevas**: C5 (opcionales) y C6 (póliza, remite a HU-06).
   - **Decisión del usuario (07/10)**: *"no hagas parches, sigue el diseño de arquitectura de la
     app"*. Por eso C1 retira `has_expiration` en vez de sincronizarlo, y la recurrencia va como dato
     del catálogo.
   - **HU-C1 con patrón de vigencia** (pedido del usuario): 4 tipos cerrados (no vence, fecha del
     documento, plazo desde emisión, período de calendario), con días de aviso y de gracia.
     - El documento guarda el período que cubre, y el estado se calcula al leer.
     - La regla por cliente es una variante de parámetros del mismo requisito, **no** un requisito
       con `shipper_id`, que sembraría un registro duplicado.
     - Cambiar la política no reescribe documentos aprobados.
   - **Plan de la entrega 1 de C1 escrito (07/10)**, sin ejecutar:
     `docs/superpowers/plans/2026-10-07-c1-una-sola-politica-de-vencimiento.md`.
     - Contenido: todos los lectores pasan a `expiration_policy`, un selector compartido para crear y
       editar, Sin clasificar muestra la fecha si es OPTIONAL, y `DROP COLUMN has_expiration`.
     - El DROP tiene compuerta: `webcarga-monitor-api` (rama `main`, 01/08) usa la misma base y lee la
       columna.
   - **Entrega 1 de C1: Tasks 1-5 HECHAS y pusheadas a `dev` (07/10)**, commits `adc0977a..5ae76d43`
     más la corrección del plan `721ee5c2`.
     - Suites: backend 1.089 en verde (19 min, con integración); frontend 1.412 en verde, `tsc` y
       build en verde.
     - Revisión final (opus): 0 hallazgos críticos o importantes.
     - Ledger: `.superpowers/sdd/2026-10-07-c1-una-sola-politica-de-vencimiento/progress.md`.
   - **Task 6 HECHA (07/10)**: Deploy Monitor API y Deploy Frontend en verde sobre `721ee5c2`.
     Click-through con Playwright en dev: "Nuevo documento" muestra "Fecha de vencimiento" con las 3
     opciones (por defecto "No aplica"). No se creó nada.
     - De paso se vio en vivo el rótulo engañoso de "Opcional" ("No se le pide a nadie por defecto"),
       que es la HU-C5.
   - **Task 7a HECHA (07/10, a pedido del usuario: expand/contract)**: `has_expiration` es ahora una
     columna GENERADA (`expiration_policy <> 'NONE'`), con la migración `20261007120000` aplicada vía MCP.
     - Datos iguales: 21 true y 17 false.
     - Test de integración en verde; 0 errores 5xx en la API.
     - Un rollback de la API anterior a `5ae76d43` ya no da 500.
   - **PENDIENTE Task 7b (DROP has_expiration)**: solo limpieza, sin fecha. Va cuando el usuario
     confirme que la entrega 1 está estable. El ledger del plan sigue vivo hasta entonces.
   - **Menores diferidos**:
     - classify-batch guarda una fecha en un documento NONE (preexistente);
     - el test guardián solo cubre `app/*.py`.
   - **CIERRE 07/10 — EN ESPERA**: WebCarga va a compartir la **HU de vencimientos actualizada** para
     implementarla. Al recibirla:
     - contrastarla con el diseño de HU-C1 en el archivo de HU (4 tipos, período cubierto, aviso y
       gracia, regla por cliente) y marcar qué coincide, qué cambia y qué sigue abierto;
     - recién después, armar el plan de la entrega 2.
     - Lo que dijeron el 02/10 sobre el corte por cliente (transcripción):
       - ventanas configurables por cliente: Pronexo/IANSA corta el F30 el día 5 y el F30-1 el 18;
       - un estándar de WebCarga más variantes por cliente;
       - granularidad "específico documento";
       - una frase cortada: *"nos acostumbraremos a la plataforma de Pronexo, que es el 18"*.
     - **No se respondió** si un mismo archivo le sirve a dos clientes.
     - Propuesta (no aplicada en el archivo de HU): preguntar con 3 opciones: un archivo evaluado contra
       el corte de cada cliente / un solo corte, el más estricto / un registro por cliente.
   - Resto de Certificación sin implementar:
     - C2 se puede hacer ya;
     - C5 espera qué significa "opcional";
     - C3 espera lo que tenga Enrique;
     - C6 espera una auditoría de Seguros;
     - C4 va con plan aparte.
   - **Siguiente paso**: bilateral con Pablo con la agenda al final del archivo de HU. Orden
     propuesto: C1 base (HECHA) → C5 → C3 → C2 → C1 recurrente → C6.
   - `tms_daily_reconciliation`: el usuario lo habilitó el 07/10. La API de mage-agent no muestra la
     hora del trigger. Al 07/10 hay 1 fila del día por stream (qanalytics, sodimac, wingsuite).
     **El 08/10**, revisar que `bronze.tms_reconciliations` tenga filas
     nuevas del 08/10 para qanalytics, sodimac y wingsuite. Si están, el trigger corrió.
   - `tms_daily_tests`: **no crear el trigger.** Queda registrado como deuda técnica en `TECH_DEBT.md`
     (07/10). No avisa ante una falla, no hay Slack ni casilla en esta fase, y no incluye
     `stg_tms_presence`.

1. ~~Commit + push~~ HECHO: `b1f30296` en `dev`; Deploy Monitor API y Deploy Frontend en verde.
2. **D4/D5 aprobado (06/10) con reconciliación diaria. Orden decidido por el usuario: Ronda 164 primero y
   D4/D5 después.**
   - **Migración 20260924100000 APLICADA** el 06/10 a las 18:27 CL. Registro sembrado: 5 streams, últimos
     archivos de las 18:15-18:18. Mientras no se sincronice la 164 es inocua, porque el código viejo no lee
     la tabla.
   - **RONDA 164 DESPLEGADA (06/10, 18:40 CL).** `sync_local_to_remote` subió 20 archivos: la 164, la
     guarda de la 165 y el pipeline `tms_daily_tests`. **Sin crear el trigger diario**, que lo crea el
     usuario. El conflicto de `metadata.yaml` queda sin subir porque el sync salta los conflictos.
     - Conclusión al leer `mage_agent/tools/sync.py`: compara mtimes por IGUALDAD exacta. El usuario
       corrió en su terminal un comando que fijaba la marca remota en "ahora" y no sirvió.
     - **Falta** que el usuario ponga a mano el `concurrency_config` en la UI de Mage: límite 1, skip.
     - Primera corrida (18:45-19:01): los 5 streams cerraron sus archivos en el registro.
       **Wingsuite recuperó 22 archivos con datos y 992 vacíos posteriores al 25/09**, que la marca de
       agua vieja nunca tomó.
     - `app.trips` se actualizó a las 19:01 tocando solo 7 viajes.
     - El clasificador bloqueó leer `n_tup_upd` con psql, así que no hay medición de antes/después.
   - Bloqueo anterior: `sync_status` marca conflicto en `pipelines/batch_tms_monitor_trips/metadata.yaml`
     (remoto modificado el 24/09 23:44). Contra `pipeline_get`, el remoto tiene los mismos 34 bloques y
     el mismo grafo; solo le falta el `concurrency_config` (run_limit 1, skip).
     `pipeline_update` da 405. Marcar el remoto como revisado en `.mage-agent-sync-state.json` lo bloqueó
     el clasificador: **lo decide el usuario**.
   - Los 5 upserts ya tienen la guarda "file_ts nuevo > vigente", así que reprocesar archivos viejos
     en la primera corrida no hace retroceder datos.
   - `status_reported_at` viene del snapshot, que solo versiona cuando el payload cambia: ya significa
     "último cambio" y la 164 no lo altera. Por eso **la presencia en el TMS no se puede leer de ahí**:
     hay que sacarla de los archivos.
   - Confirmado en dbt: `trip_status` prioriza el SAP CERRADO, y el OR 3 del incremental vuelve a
     procesar los qanalytics cuyo milestone pasa a CERRADO. **Ampliar la ventana del SAP basta para que
     los 19 cerrados se cierren solos.**
   - Para marcar eliminados (los 21 que no están): un bloque lee los Nro SAP del archivo ancho y marca
     los viajes abiertos de Walmart con planificación dentro de la ventana que no aparecen. Va en una
     tabla aparte que dbt no toca (`app.trip_source_presence`).
   - **Wingsuite no trae archivos desde el 25/09** (último archivo en el registro). Hay que revisarlo aparte.
   - **D4/D5 DESPLEGADO (06/10, noche), según el patrón Mage → bronze → dbt → app.** La primera
     versión creaba una tabla `app.trip_source_absences` que escribía directamente el bloque de Mage.
     El usuario la objetó por salirse del patrón y **se retiró ese mismo día** con un DROP aplicado;
     estaba vacía y nada la leía.
     - Migraciones:
       - `20261006120000`: solo `monitor_alert_rules.stale_trip_days`, que puede quedar vacío. El
         archivo explica la historia.
       - `20261006130000`: `bronze.tms_reconciliations`, con una fila por reconciliación y `trip_ids`
         crudos.
     - Mage, pipeline `tms_daily_reconciliation`:
       - El bloque `reconciliacion_qanalytics_sap` baja el reporte SAP desde el viaje abierto más
         antiguo (tope de 120 días) y escribe la fila cruda en bronze. No compara nada.
       - El bloque dbt `stg_tms_presence` es una **TABLA**, no una vista. Las vistas de silver se
         recrean en cada corrida de 15 min con `DROP CASCADE`. La primera versión, como vista, falló
         al crearse; el log de Mage se corta antes del error.
       - Macro `trip_planning_date` compartida con `app/trips.sql`.
       - `app.trips.tms_missing_since` se agrega con OR 5 en el incremental. Ese OR tiene una guarda
         `adapter.get_columns_in_relation` para la primera corrida, cuando la columna todavía no
         existe.
       - Despliegue en 2 fases: primero la vista, luego `trips.sql`, para no romper la corrida de 15 min.
     - extraction_service `11f9a906`: el clic de exportar usa `min(timeout_ms, 60 s)` en vez de 10 s.
       Con el reporte ancho, Cloud Run daba "Timeout 10000ms".
     - **Resultado medido (20:50 CL):**
       - la reconciliación trajo **2.774 viajes** (02/07 → 13/10);
       - `stg_tms_presence` marcó **22 ausentes** (los 21 esperados más 2064048) y ningún falso positivo;
       - `app.trips` tiene las 22 marcas;
       - **los 17 RETORNANDO viejos pasaron a CERRADO solos** cuando entró el reporte ancho.
     - Efecto colateral: al redesplegar extraction se reinicia su cola en memoria. La corrida de
       las 20:00 perdió el archivo de Walmart y su transformador cayó con un error de pod (transitorio);
       `app.trips` quedó sin actualizarse de 19:40 a 20:28.
     - API: el cierre excluye `tms_missing_since` de todos los grupos y "abandonado" excluye los
       entregados hace más de `stale_trip_days`; "En curso" excluye `tms_missing_since`.
     - UI: "Eliminado en el TMS" en TripTable, y el umbral en Configuración › Umbrales.
     - Tests: backend con 1.079 en verde y los 3 rojos preexistentes de eliminar; frontend con 1.408.
       Las mutaciones de las guardas se detectaron.
     - **Verificado en vivo** (21:00 CL, despliegue `56dca9cc`):
       - 2064048 no aparece en "En curso" y sí en el historial, con `tms_missing_since`;
       - "Abandonados" del cierre del 06/10 bajó **de 52 a 12** y ya no queda ninguno de Walmart.
         Quedan Sodimac 9, Wingsuite 2 y manual 1: las fuentes que todavía no tienen reconciliación.
     - **Wingsuite agregado (06-07/10, noche).** Utilidad compartida `utils/reconciliacion.py` y bloques
       `reconciliacion_qanalytics_sap` y `reconciliacion_wingsuite`.
       - Medido antes de construir: IANSA no necesita reconciliación (172/172 coinciden). Wingsuite: los 2
         en RUTA estaban Terminado en el TMS; su id es `ID_VIAJE`.
       - **Resultado**: 439974 y 444473 → CERRADO FINALIZADO. "Abandonados" bajó a 10: 9 ofertas de
         Sodimac y 1 manual.
     - **`stg_tms_presence` ahora es una VISTA dentro de `batch_tms_monitor_trips`**, entre
       `int_tms_trips_conformed` y `app_trips_update`.
       - Construirla en el pipeline diario falló dos veces: chocaba con el `DROP CASCADE` de
         `int_tms_trips_conformed` (cotejado con los tiempos de los bloques: 22:38 y 00:28 UTC).
       - El pipeline diario ahora solo escribe en bronze.
     - **INCIDENTE (mío): ingesta detenida de 21:30 a ~00:20 CL.**
       - Subí el grafo nuevo de batch con una corrida en vuelo (14266). Su `app_trips_update` quedó
         esperando un bloque que esa corrida no tenía, y el mismo sync activó el límite de concurrencia
         (`skip`), así que las corridas siguientes se saltaban.
       - Quité el límite para destrabar. Mage lanzó corridas en paralelo, chocaron en las tablas
         `tmp_raw_*` y saturaron extraction.
       - El usuario canceló la 14266 en la UI. Límite restaurado (1, skip) y verificado:
         `app.trips` actualizado a las 00:24.
       - **Regla: nunca subir un cambio de GRAFO de `batch_tms_monitor_trips` con una corrida en vuelo.
         Esperar a que termine y subir antes de la siguiente.**
     - **Sodimac (07/10, 00:46–01:50 CL), resuelto por el catálogo y sin reglas por fuente:**
       - Medido en el historial: Sodimac nunca dijo "ASIGNADO".
         - `Publicada` es una oferta. Después pasa a Aceptada, Removida o Declinada, o desaparece.
         - `Presentada` significa que el camión está en origen.
         - El tooltip "· Sodimac" del 25/08 corregía en pantalla la traducción nuestra.
       - Migración `20261007100000`: `Publicada` en el grupo `otro` con `counts_as_load=false`, y
         `Presentada` en `en_ruta`. `int_tms_trips_conformed` ya no los traduce; `is_assigned` excluye
         `Publicada`.
       - `stg_tms_presence.tms_absence_kind` sale del CATÁLOGO: un estado no terminal que no cuenta como
         carga y desaparece es una `oferta_retirada`; si no, es un `eliminado`. El freno del 50 % no
         cuenta las ofertas. Fuente dbt nueva: `app.trip_statuses`.
       - Migración `20261007110000`: pasada única que lleva los 64 viajes ASIGNADO de Sodimac a
         `Publicada`, copiando lo que da la homologación.
       - El bloque `reconciliacion_sodimac` volvió al pipeline diario. La reconciliación 14286 trajo
         Walmart 2.799, Sodimac 357 y Wingsuite 0 (vacío, contenido por el freno).
       - **Resultado (01:47):**
         - Sodimac: 61 ofertas retiradas, 12 sin declarar y 49 declaradas; 5 eliminados, ya declarados.
         - Walmart: 22 eliminados.
         - Coincide exactamente con la simulación previa contra la lista real.
       - API: grupo nuevo `oferta_sin_declarar` en el cierre (se puede seleccionar y no bloquea); el
         Monitor expone `tms_absence_kind`. UI: "Oferta retirada por el TMS" frente a "Eliminado en el
         TMS", y **se retiró el parche `origenExterno`/`origen` del StatusBadge**.
       - **Incidente 2:** la corrida 14279 (00:45) quedó en "0/0" porque subí los cambios de dbt a las
         00:46, mientras arrancaba. Por el límite (1, skip), las siguientes se saltaron. El usuario la
         canceló. **Regla: no subir nada a Mage en las ventanas :58–:02, :13–:17, :28–:32 ni :43–:47.**
       - mage-agent dio "[404] Email/username and/or password invalid" un rato y después se recuperó
         solo.
       - **Desplegado y verificado en vivo (07/10, 02:05, Playwright en dev):** `c73d7127`, con API y
         Frontend en verde. Cierre del 07/10: Hoy 2, Rezago 13, **Ofertas sin declarar 12**, En curso 10
         y Abandonados 1 (es el viaje manual de prueba HBC(test) 100). Historial: el 881457 dice
         "PUBLICADA · Oferta retirada por el TMS" y el 2000691 (Walmart) dice "Eliminado en el TMS". Ya
         no aparece la marca "· Sodimac".
       - Detalle visual menor: una oferta retirada muestra "115h desde despacho" aunque nunca se
         despachó. Lo hereda el reloj genérico; no se toca sin hablarlo.
     - Sodimac, versión anterior (descartada): Su lista retira las ofertas (crudo `Publicada`) que WebCarga no tomó.
       No son viajes eliminados.
       - Hoy la homologación traduce `Publicada`/`Presentada` → `ASIGNADO` (grupo `en_ruta`,
         `counts_as_load` true). El usuario rechazó resolverlo con una regla escrita a mano por fuente.
       - Propuesta acordada: dejar de traducir y mostrar `Publicada` tal como lo dice el TMS, como ya pasa
         con Aceptada, Creada y Control de salida. `Publicada` se agrega al catálogo con un grupo de
         oferta, y la presencia lee de ahí el tipo de ausencia.
       - ~~Pendiente: medir el impacto~~ HECHO y desplegado (ver arriba).
       - Datos: 64 ofertas, 51 ya declaradas con motivo; 0 a 1 por día cuentan en `trips_del_dia`.
       - El bloque está guardado fuera del mirror (scratchpad: `reconciliacion_sodimac.py.pendiente`).
     - **Pendiente del usuario**: crear el trigger diario de `tms_daily_reconciliation` (~06:30 CL) y
       definir `stale_trip_days` con Pablo.
     - **Alcance final**: Walmart (SAP), Sodimac y Wingsuite. IANSA no lo necesita (172/172 coinciden).
     - **Sigue abierto**:
       - ~~3 tests de `test_eliminar_viajes_integracion.py`~~ RESUELTO en `e733f97a`: usaban el 23/09, que se
         firmó en producción; ahora usan el 01/01/2099;
       - la cola en memoria del extraction_service, frágil ante un redeploy;
       - estados crudos de Sodimac fuera del catálogo: Carga finalizada, Salida rechazada y
         Presentada en origen;
       - con Pablo: `stale_trip_days`, la vista fusionada, la cifra en vivo de un día firmado y las HUs
         de Certificación.
   Diseño original, antes de medir:
   - corrida diaria de **reconciliación** con la ventana desde el viaje abierto más antiguo, con tope;
     las de 15 min quedan como están (el disco de Supabase es el cuello, Ronda 164);
   - eliminado = ausente dentro de la ventana cubierta por la reconciliación, marcado y no borrado;
   - pegados de verdad: siguen en el cierre para gestionar el cobro y salen del Diario a los X días
     de la entrega.
   - Precondición: el mirror de Mage tiene las Rondas 164 y 165 sin sincronizar.
3. ~~Click-through en dev~~ HECHO 06/10 con Playwright:
   - **05/10 (firmado)**: 47 filas = 46 tractos + 1 conductor en "Otros conductores del día".
     Cuadra con la base. La tabla está en solo lectura.
   - **Viajes 06/10**: se ven las columnas de contexto. Elegir un motivo no escribe nada.
     "Guardar" escribe y el viaje pasa a "Con motivo".
   - **Bug real atrapado ahí**: "Deshacer" dio 409 sobre el 881496, un rezago planificado el 02/10,
     día firmado CON el viaje adentro. Corregido en `30c839ad`: solo bloquea un día firmado DESPUÉS
     de la declaración. Tras desplegar, el viaje volvió idéntico (`is_active=t`, sin motivo, `{}`).
   - **GPRZ30** sigue en ámbar en Pendientes y no bloquea.
   - Queda anotado, sin resolver, el caso inverso: `bulk-close` sobre un viaje de un día firmado
     también le cambia el `trips_del_dia` en vivo. Los `frozen_totals` no cambian.
4. Avisar a Pablo que "Conductores" y "Tractos" quedaron en una sola vista.

### 2026-10-01 — Ronda 165: Diario 2.0, puntos 5 y 12 (bugs del 01/10)

Fuentes: `monitor-app/bugs/20261001/` (docx + `requirements-bug-12.md`, que ES el punto 12) y la
llamada con Fabián del 01/10 (Granola). Plan: `~/.claude/plans/mossy-enchanting-cupcake.md`
(la parte de GPRZ30 del plan quedó SUPERADA, ver abajo).

## Causas raíz (medidas contra producción)

- **Doble carga de motivos (punto 5)**: `_propagar_al_tracto_habitual` solo propagaba "no trabajó",
  escribía "Sin conductor" y no seguía cambios ni vigencias. 18/09–01/10: Operaciones escribió
  a mano en el tracto **el mismo motivo** del conductor 108 veces (87 + 21).
- **Rafael / BDLC92 (RF-02)**: `POST /carriers/{id}/assets` nunca marcaba `is_manual_override`
  (el arreglo del 16/09 llegó solo a conductores) y el loader `load_asset_asignments_07` lo
  revertía: BDLC92 se transfirió 6 veces en un mes. 18 tractos transferidos en la app; 3 revertidos.
- **Brian Celis**: ficha duplicada (18659820-2 ACTIVA, 19003069-5 INACTIVA, con 12 documentos);
  el matcher exigía un único candidato → 27 vínculos a mano en 30 días. FCCP42 colgaba del
  inactivo en `vehicle_driver_assignments` (padrón legacy con el RUT viejo).
- **GPRZ30 (RF-01)**: fue de Transportes Miraflores hasta 2024; el TMS la informa en Moneda (jul)
  y Bugarin (desde 09/09), ninguna en el directorio. `PATENTE_NO_REGISTRADA` bloqueaba el día.

## Hecho (LOCAL, sin comitear; suites corriendo/verdes salvo lo anotado)

1. **Herencia del motivo** — `cierre_lineas.py`: `_SQL_SINCRONIZAR_TRACTOS` (por conjuntos, todo
   el día) reemplaza a `_propagar_al_tracto_habitual`; corre en `poner_motivo` (conductor) y en
   `recalcular` tras la vigencia. Columna `closure_lines.reason_from_driver_id` = procedencia
   (no nulo = heredado, sigue al conductor; nulo = lo escribió una persona, nunca se pisa).
   Elegir/borrar motivo en el tracto corta la herencia; un comentario no. UI: "Heredado de X".
   Migración `20261001120000` — **la columna YA ESTÁ APLICADA en producción** (sin backfill, a
   propósito: no adivinar los "Sin conductor" viejos).
2. **Traspaso único** — `carriers.py::_transferir` sirve a conductores y tractos (eran dos copias).
   Migración de reparación `20261001100000` (18 tractos, sin revivir filas INACTIVE marcadas a mano:
   HYXB37/JDYY73). Guarda por equipo en el mirror de Mage `custom/load_asset_asignments_07.sql`.
3. **Matcher** — migración `20261001110000`: con varios candidatos por nombre gana la ÚNICA ficha
   activa; `sync_habitual_drivers` ya no cuelga tractos de fichas inactivas; repunta los vínculos
   habituales a la ficha activa homónima (FCCP42; FLPY18 queda para Operaciones); re-resuelve
   45 días de viajes auto sin conductor.
4. **GPRZ30 — decisión del usuario (opción A, 01/10)**: `PATENTE_NO_REGISTRADA` sale de
   `ESCALACIONES_QUE_BLOQUEAN` (RF-01/CA-01 literal: ninguna patente sin empresa bloquea). Sigue en
   Pendientes, en ámbar, con la empresa que informa el TMS (`tms_carrier_name`) y "Crear empresa
   nueva" prellenado. **Revierte la regla de Pablo del 21/08**. Se descartaron "flota de
   terceros" y la auto-asignación (nadie las pidió).

## Checklist — siguiente paso exacto

1. ~~Suites~~ HECHO: backend 1.069 verdes + 3 rojos preexistentes (`test_eliminar_viajes_integracion.py`
   falla igual en el código comiteado: elige viajes reales que hoy son de días firmados — arreglar
   aparte, el sujeto lo tiene que crear el test). Frontend: secciones 68 verdes, `tsc` limpio,
   trinquete de escala en verde (la suite completa dio 1.397/1.398 antes de corregir el trinquete).
2. ~~Migraciones~~ HECHO 01/10 ~21:05 UTC, con la base quieta:
   - `20261001100000`: 16 tractos reparados y marcados (BDLC92 → Villegom, DTBY52 → La Fortaleza;
     HYXB37/JDYY73 sin tocar, a propósito).
   - `20261001110000`: aplicada en 3 partes por el MCP (la llamada entera dio "Invalid or expired
     requestState" y no aplicó nada). FCCP42 → 18659820-2. **32 viajes re-resueltos**: 2 de Brian y
     30 de conductores cuya ficha se creó DESPUÉS del viaje (Paredes, Navarro, Suárez, Toro, Mejías);
     9 caen en días firmados — sus `closure_lines` NO cambiaron (0 tocadas), pero una pantalla que
     lea los vínculos en vivo de esos días ahora muestra conductor donde antes había vacío.
   - `20261001120000`: la columna ya estaba aplicada desde antes.
3. ~~Commit + push~~ HECHO: `f947c419` en `dev`; Deploy Monitor API y Deploy Frontend en verde.
4. Mage: sincronizar `load_asset_asignments_07.sql` — el mirror tiene la Ronda 164 SIN sincronizar;
   decidir con el usuario si va todo junto.
5. Click-through en dev: motivo al conductor → tracto con "Heredado de"; GPRZ30 en ámbar y
   "Confirmar cierre" sin bloqueo. Avisar a Fabián (y a Pablo por el cambio de regla del 21/08).
6. Pendiente de la llamada, fuera de alcance: "Eliminar viaje" no aparece en manuales previos al 30/09.

### 2026-09-24 — Ronda 164: caída de la tarde (Disk IO agotado) y recorte del IO de la ingesta

Plan aprobado: `~/.claude/plans/purring-hugging-meteor.md`.

## Diagnóstico (medido)

- **16:45 CL**: la base (org `webcarga`, **plan free**, confirmado con `get_organization`) agotó
  el Disk IO. Hubo `statement timeout` a razón de 140/h, checkpoints de 4 páginas/s y el MCP no
  podía conectarse. Supabase Auth comparte esa base, así que `/token` daba 10 s de timeout y el
  login devolvía **504 "Gateway Timeout"**. El "304" que vio el usuario es caché del navegador,
  no un error.
- **No fue la concurrencia** (el tráfico web es de decenas de requests cada 15 min) **ni el
  tamaño** (239 MB contra 500). Esto corrige la hipótesis "Micro/CPU" de la Ronda 163: el cuello
  es el disco.
- **La ingesta corre cada 15 min las 24 h**, no cada 30. Cada corrida dura 7-8 min, así que la
  base pasa la mitad del día bajo carga. El usuario decidió **mantener 15 min**.
- **Causa principal**: los 5 `insert_raw_*.sql` reescribían TODAS las filas de cada archivo
  (payload jsonb, índices, WAL) aunque nada cambiara. Dos cosas dependían de esa reescritura:
  - La marca de agua de los 5 processors: `SELECT file_name ... ORDER BY last_updated_at DESC`.
  - La alarma de SAP caído: `stg_qanalytics_trips.sap_block_liveness`.
  Según la macro `is_stale`, el 98 % de las filas SAP no cambia en 24 h.
- Otras fuentes de carga:
  - `slv_milestone_trips` se reconstruye con `--full-refresh` en cada corrida.
  - `+trips` vuelve a correr todo el upstream.
  - `dbt test` corre cada 15 min.
  - 5 CREATE y 5 DROP de `tmp_raw_*` generan unas 400 líneas de recarga de esquema de
    PostgREST por hora.
- La API `pipeline_list` de mage-agent devuelve un DAG desactualizado (del 19/08, sin
  `app_trips_tests`). **La verdad es el `metadata.yaml`**, que coincide con los logs.

## Hecho (LOCAL, sin desplegar; el mirror de Mage no está en git)

1. **Registro de archivos**, en reemplazo de la marca de agua. El usuario pidió la versión robusta,
   no un parche:
   - Migración `monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`.
     Crea `bronze.ingested_files` y la siembra desde `bronze.tms_trips`. **No aplicada.**
   - `utils/ingested_files.py`: `select_new_files` elige los archivos que no están cerrados, con
     una ventana de gracia de 6 h para los atrasados. `register` los marca `pending` o `empty`.
     Probado en local con una conexión falsa.
   - Los 5 processors usan el registro. Wingsuite marca `empty` los archivos vacíos.
   - Los 5 `insert_raw_*.sql` agregan `AND payload IS DISTINCT FROM EXCLUDED.payload`, cierran los
     archivos que aterrizaron como `loaded` y los `pending` sin filas como `empty`.
   - `stg_qanalytics_trips.sap_block_liveness` lee `MAX(loaded_at)` del stream SAP.
     `sources.yml` declara `ingested_files`.
   - `status_reported_at` / "Ya no está en el TMS" no cambia: sale del snapshot, que ya solo
     versionaba cuando cambiaba el payload.
2. `dbts/app_trips_update.yaml` pasa de `+trips` a `trips trip_stops`. El DAG ya ordena
   `slv_milestone_trips → stg_qanalytics_trips → int → app_trips_update`. Se quitó el
   `--full-refresh` de los 3 yaml de vistas.
3. `app_trips_tests` sale de `batch_tms_monitor_trips` y pasa al pipeline nuevo
   `pipelines/tms_daily_tests/`. `batch_tms_monitor_trips` queda con
   `concurrency_config: pipeline_run_limit 1, skip`.

## Estado al cerrar la sesión (24/09, ~21:10 CL)

- **El trigger de `batch_tms_monitor_trips` está PAUSADO** (lo pausó el usuario; la última
  actividad de Mage fue a las 23:38 UTC). **Nada de Mage está desplegado todavía.** El pipeline
  en vivo es el de siempre: al reactivarlo sin sincronizar vuelve la carga vieja.
- **La migración 20260924100000 NO está aplicada** (commiteada, sin aplicar). Hubo tres intentos
  y ninguno terminó:
  - `execute_sql` del MCP: timeout.
  - SQL Editor del Studio: "failed fetch api.supabase.com". El Studio corta a 58 s
    (`statement_timeout='58s'`) y además tiene timeout HTTP.
  - `psql` por el pooler: `ECHECKOUTTIMEOUT`, el pool estaba agotado.
  El `CREATE`/`INSERT` es idempotente, así que se puede reintentar tal cual. Antes hay que mirar
  `pg_stat_activity` por si un intento anterior quedó colgado.
- **La base seguía estrangulada con Mage quieto.** Los checkpoints escribían 124 buffers en 33 s,
  y el catálogo del Studio, las recargas de PostgREST y `pgbouncer.get_auth` tardaban 11-21 s.
  El presupuesto de IO del plan free solo se recarga con uso bajo el nivel base: **no conviene
  consultar la base mientras tanto**, porque cada intento lo gasta. Además aparece
  `archive command failed` en los logs.
- La línea base medida antes del bloqueo (`pg_stat_statements` acumula desde el 17/04, 47 GB
  de WAL en total):
  - **Una sola sentencia de dbt = 21 GB de WAL y 2,87 millones de bloques escritos**, en 7.354
    llamadas. No alcancé a ver qué nodo es: la consulta excedió el timeout.
    **Es lo primero que hay que identificar**; sospechosos: el `create table` con
    `--full-refresh` de `slv_milestone_trips` o el merge de `app.trips`.
  - `bronze.tms_trips`: **2,5 millones de updates sobre 8.889 filas**, 0 HOT.
  - Los `COPY` a `tmp_raw_*` suman 2,7 GB (SAP), 1 GB (Sodimac) y 0,8 GB (Wingsuite).
  - `bronze.raw_bd_ot` pesa 80 MB, la tabla más grande (pipeline `legacy_drivers_transporters`).
- Conexión por `psql` desde este equipo: el host directo `db.<ref>` es solo IPv6 y no resuelve.
  Hay que usar `aws-1-us-east-1.pooler.supabase.com:5432` con el usuario
  `postgres.viclzoftiudkepqnhekv` y la clave de `monitor-app/backend/api/.env`.

## Checklist — siguiente paso exacto

1. **Revisar solo los logs** (`query_logs`): que no haya `statement timeout` y que los
   checkpoints escriban a ritmo normal (menos de 5 s por cada ~300 buffers). Si pasada ~1 h
   sigue igual o el pool sigue agotado, **el usuario reinicia el proyecto** (Settings → General →
   Restart). El reinicio no recarga el IO, pero libera las sesiones colgadas.
2. Con la base respondiendo:
   - aplicar la migración con
     `psql <pooler> -f monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`,
     sin pasar por el Studio;
   - verificar con `select stream, count(*), to_timestamp(max(file_ts)) from bronze.ingested_files group by 1`.
     Deben aparecer 5 streams, con el último cerca de las 23:30 UTC del 24/09.
3. `sync_status`, luego `sync_local_to_remote`. Confirmar en `metadata.yaml` remoto que ya no
   está `app_trips_tests` y que `concurrency_config` quedó en `pipeline_run_limit 1, skip`.
   El usuario confirmó `skip`: `wait` tampoco recupera el estado del turno saltado, porque el
   scraper baja el estado actual.
4. **Usuario**: reactivar el trigger. Crear el trigger diario de `tms_daily_tests` a las ~07:30 CL.
5. Verificar la primera corrida:
   - verde;
   - `ingested_files` con `loaded` por stream;
   - `last_sap_ingest_at` avanza;
   - `n_tup_upd` de `bronze.tms_trips` cae;
   - sin `CREATE ... tms_milestone_trips` duplicado.
6. Identificar el nodo dbt de 21 GB de WAL:
   `select calls, wal_bytes, left(query,700) from extensions.pg_stat_statements order by wal_bytes desc limit 3`,
   con la base sana y `statement_timeout` holgado.
   Medir las filas de `silver.tms_milestone_trips` que ya no están vigentes en `tms_sap_snapshot`.
   Si son ~0, quitar `--full-refresh` de `dbts/slv_milestone_trips.yaml`.
   Después, `select extensions.pg_stat_statements_reset()` para medir el antes/después por corrida.
7. Paso 5 del plan: staging `tmp_raw_*` permanente con TRUNCATE, para cortar la recarga de
   PostgREST. Va en un despliegue separado, después de medir el 5.

### 2026-09-23 — Ronda 163: bugs del 23/09 (alta manual 500, cierre del 22/09) + eliminar viajes

Reportados en `monitor-app/bugs/20260923/` (dos screenshots). Plan aprobado en
`~/.claude/plans/necesito-que-revises-los-fluffy-quilt.md`.

## Causa raíz, medida (no supuesta)

- **Bug 1, alta manual "Error 500"**: 8 POST /trips con `UniqueViolationError uq_trip_fleet_link`
  en Cloud Run. El INSERT en `app.trips` dispara `trg_trips_resolve_fleet_ins`, que ya escribe el
  vínculo `auto`, y `_insert_trip` insertaba el `manual` sin ON CONFLICT. **Nunca funcionó desde el
  17/08**: hay 1 viaje manual con link manual en toda la historia (07/07). Sin transacción, cada
  reintento dejó un viaje a medias: **9 viajes huérfanos** (7 copias de SAN BERNARDO→IANSA del 23/09,
  1 HBC del 23/09 y 1 del 21/09). La rama CSV por patente chocaba igual.
- **Bug 2, cierre del 22/09**: **el POST de cierre nunca llegó a la API**. La base de Supabase se
  saturó de 22:30 a 02:00 UTC (142 statement timeouts, un `SELECT` de catálogo de 11 s, checkpoints
  de 127 s, con pocas conexiones activas: es hambre de CPU/IO, no locks ni conexiones). Supabase Auth
  usa esa base, así que cayó con ella (85/93 `/token` con 504). La app llamaba a Auth por HTTP en
  CADA request (middleware, layout, API síncrona que bloqueaba el event loop): cada página tardó
  ~35 s → `307 /login` → el login de Microsoft dio el Gateway Timeout del screenshot.
- **El 23/09 se REPITIÓ** desde las 21:00 UTC (18:00 CL): 140 statement timeouts y 169 errores 5xx
  de Auth hasta las 00:00 UTC; el JWKS de Auth tampoco respondía. La noche del 21/09: cero.
  **Es recurrente, no un evento aislado.**

## Decisiones de arquitectura

1. **Un solo dueño por escritura del vínculo manual**: `_escribir_link_manual` es un upsert que
   CONVIERTE el `auto` del trigger en `manual` (terminal). Lo usan el alta y `assign_fleet_link`, que
   esquivaba el mismo choque con SELECT+DELETE+INSERT. La resolución automática es sólo del trigger:
   se retiró `_auto_resolve_fleet_link`.
2. **`create_trip` en transacción**, como `/bulk`. **Manejador global** en `main.py`: un 500
   imprevisto responde JSON `detail` con `ref.` que también queda en el log.
3. **Eliminar viajes**: sólo `source_system='manual'`; admin/owner o el creador
   (`trips_manual.created_by`); nunca si `app.trips_del_dia(D)` lo incluye con D CLOSED. La regla vive en
   `services/eliminar_viajes.py` y decide también `can_delete` en el listado (la UI nunca ofrece lo
   que el backend rechaza). **No hay FK hacia `app.trips` en producción** (dbt las borra): el servicio
   borra a mano `closure_lines`, `trip_notes` (adjuntos por cascada, Storage después del commit),
   `trip_fleet_links`, `trip_stops`, `trips` y **`trips_manual`** (si no, dbt lo resucita). Deja una
   fila `delete` en `audit_log`.
4. **La barra de selección de Certificación se volvió `components/ui/BarraDeSeleccion`**, y
   `TriageBulkBar` la compone. No se creó una barra hermana.
5. **Sesión verificada localmente** (patrón oficial de Supabase para llaves asimétricas, ES256):
   PyJWT en la API y `getClaims` en Next, a través de `leerSesion()` (lib/supabase/sesion.ts), la
   única lectura de sesión del servidor. **Auth caído ≠ sin sesión**: lleva a `/auth/no-disponible`,
   no a `/login`. JWKS inalcanzable = 503, no 401.
6. **La llave PÚBLICA va versionada** (`backend/api/app/supabase_jwks.json` y
   `frontend/lib/supabase/jwks.json`), porque el JWKS de Auth tampoco respondía y Cloud Run arranca
   en frío (min-instances=0). Un kid desconocido se busca en vivo. **Revocar una llave exige sacarla
   de los dos archivos.**

## Estado: DESPLEGADO en dev (24/09, ~01:50 UTC)

- Commits en `dev`: `91b69bc0` (alta + eliminar), `72bcccda` (auth), `73db5e1e` (fix de la regla de
  día firmado). Workflows API y Frontend en verde; `/health` 200; sin token → 401; cero errores en
  Cloud Run; el middleware nuevo reconoce la sesión (Playwright entró directo al Monitor).
- Verde con la base sana: integración de alta manual 4/4, eliminación 6/6 (con mutación comprobada
  sobre el borrado de `trips_manual`), backend unit 804, frontend 1395 + tsc + build. Listado del
  Monitor: 213 ms antes y después del JOIN nuevo.
- **Error mío atrapado en vivo**: la regla de "día firmado" miraba `closure_lines` TRIP, que en
  producción NO existen (sólo ASSET/DRIVER; la ola 4.4 sigue pendiente). El test pasaba porque
  fabricaba una. Ahora usa `app.trips_del_dia(D)`, la misma definición con que el cierre cuenta los
  viajes, y el test firma un día real.
- **El 23/09 lo firmó Operaciones a las 22:51 CL con `viajes: 38`, que INCLUYE las 6 copias
  sobrantes de IANSA.** Por la regla nueva, hoy los 9 viajes huérfanos están bloqueados para
  eliminar (21/09 y 23/09 cerrados). No se reabrió nada: es decisión de Operaciones.

## Causa de la saturación (investigada 24/09, parcial)

- Ocurre casi todos los días HÁBILES (15, 16, 17, 18, 21, 22, 23/09), y ninguno el sábado ni el
  domingo. Normalmente entre 03:00 y 08:00 CL, sin que nadie la vea; el 22 y el 23 se corrió a la tarde.
- Instancia muy chica: base de 239 MB, `shared_buffers` de 224 MB, `max_connections` 60 → Micro
  (CPU compartida con créditos). La transición es brusca: la recarga del esquema pasa de ~1 s a más
  de 10 s de golpe. Encaja con créditos de CPU agotados. **Sin confirmar**: el endpoint de métricas
  daba 504 y el MCP no tiene historial.
- Carga de fondo propia: ~5-6 mil sentencias dbt/día (incluye `dbt test` desde al menos el 14/09) y
  **~116 recargas por hora del caché de esquema de PostgREST, las 24 horas**, disparadas por el DDL
  de la ingesta. Cada una cuesta ~2 s de catálogo más una reconexión.

## Checklist — siguiente paso exacto

1. **Decisión de Operaciones sobre el 23/09**: reabrir el día → eliminar desde el Monitor 6 de las
   7 copias de IANSA (conservar `747ebcec…`, la primera) → volver a firmar. La herramienta ya existe
   y lo permite a admin/owner/creador. El 21/09 (`554a1c7a…`) cuenta en los cierres del 21 y del 22:
   misma decisión.
2. Click-through del usuario: crear un viaje manual con conductor, patente y empresa (ya no da 500);
   eliminar en lote.
3. **Infraestructura (el usuario)**: dashboard → Settings → Compute (confirmar Micro) y Reports →
   Database (CPU / Disk IO) del 22/09 19-23 CL. Si se confirma → subir la instancia (Small/Medium).
4. Después, con OK del usuario (toca Mage): cortar la tormenta de recargas de PostgREST (tablas
   temporales de la ingesta, o que PostgREST no mire `bronze`/`silver`). Medir antes cuál funciona.

### 2026-09-17/18 — Ronda 162: HU-28, asistencia y cierre por ORIGEN y por operación

Operaciones respondió las cuatro preguntas abiertas de la Ronda 161
(`monitor-app/bugs/20260916/levantamiento-user-story.md`) y con eso se diseñó y se implementó la
dimensión que al cierre le faltaba. **HU escrita en
`monitor-app/docs/user-stories/20260917/01-hu-asistencia-y-cierre-por-origen.md`** (es la fuente: el
mockup manda). Plan aprobado en `~/.claude/plans/jiggly-rolling-blum.md`.

## La objeción del usuario, y cómo se resolvió

El usuario frenó el diseño dos veces con la misma idea: *"nada de lo que viene desde la TMS es
editable"*. Cruzado el documento de Operaciones con el levantamiento, **ninguna de las 24 líneas pide
editar un dato que el TMS reportó**: todo es agrupar, filtrar y contar. Y las dos frases ambiguas se
desambiguan solas con las respuestas —"dejar abierto el filtro de CD Origen" significa que el filtro
liste **todos** los CD y no sólo Peñón/QL/LOA (respuesta 3), y "modificar el campo en los no
asignados" es fijar a qué operación se ofrece un camión **sin viaje**, del que el TMS no dice nada
(respuesta 1). Operaciones escribió el mismo criterio del usuario en su línea 21: *"se puede
modificar con la asignación de TMS"*.

Después pidió el estándar de la industria. Es **home terminal / domicile**: dato maestro declarado
del conductor (Samsara, Motive, McLeod LoadMaster, Trimble/TMW; en EE.UU. lo exige la FMCSA). De ahí
salieron las tres reglas que se adoptaron, y **una de ellas descartó mi propia propuesta anterior**
de derivar el CD del historial.

## Decisiones de arquitectura

1. **Un atributo maestro no se deriva de transacciones.** Calcular el CD desde "dónde cargó más
   veces" lo haría cambiar solo, y con él la asistencia de meses ya firmados.
2. **Asistencia y volumen son dos dimensiones distintas**: la asistencia agrupa por el **CD base
   declarado**; el volumen, por el **origen real del viaje**. Dos columnas, nunca un `COALESCE`.
3. **Un maestro de ubicaciones con roles, no una tabla por rol.** `is_origin_cd` es un **booleano**
   y no un `kind` de valor único porque **14 de los 24 orígenes observados YA existían como local de
   entrega**: un valor único obligaba a duplicar esas filas.
4. **La línea del cierre guarda su propia dimensión** (Kimball). El congelamiento sale gratis:
   `recalcular` ya es no-op con el día CLOSED.
5. **Descartado a propósito**: tabla de alias (el dato no está sucio), vigencia SCD2 del CD
   (`end_date` está en **0 de 402 filas** en las 4 tablas de asignación del repo — una quinta
   vigencia que nadie puebla es el frankenstein), y un maestro de "operación" por equipo
   (`carrier_shippers` ya existe y el filtro del cierre ya lo usa).
6. **Nomenclatura**: ninguna columna nueva se llama `operation_*` — el nombre ya está tomado dos
   veces (`assets.webcarga_operation_type_id` = Tractoreo/Equipo Completo; `locations.operation_type`
   = zona RM/Z0/Región).

## Lo medido contra producción, que corrigió dos supuestos del plan

- **Los nombres de CD NO vienen sucios.** 18 orígenes distintos en 47 días, escritos canónicos por el
  TMS; no existe ninguna fila "LOA" ni "QL" — eso es cómo habla Operaciones. La mitad del trabajo que
  el plan proponía (normalizar) no hacía falta.
- **Origen poblado en 1.571 de 1.572 viajes (99,94%)**, sólo en `app.trip_stops.local`.
  `trips.origin_tms`/`origin_city`/`origin_region` son columnas muertas (100% NULL).
- **El CD no es fijo y por eso se declara**: 35% de los conductores de Walmart cargan en más de un
  CD, pero el dominante concentra el **90,5%** de sus viajes.
- **Roster de Tractoreo: 41 conductores**; 35 tienen un CD dominante ≥80%, 3 entre 60-80%, 2 bajo 60%
  y 1 sin historial. Por eso la carga inicial es una **sugerencia de un clic**, no 41 campos vacíos.
- **Siembra del catálogo**: 12 CD (8 marcas sobre filas existentes + 4 nuevas de Walmart), **99,26%
  de los viajes cubiertos**, 0 ambigüedades. Los 12 pares que quedan fuera son tiendas con 1-2 viajes
  de logística inversa, no CD.

## Aplicado a producción (3 migraciones, todas ensayadas con ROLLBACK antes)

| Qué | Dónde |
|---|---|
| `locations.is_origin_cd` + índice parcial + 12 CD sembrados | `20260917020000`, aplicada |
| `drivers.home_location_id` + trigger `drivers_home_location_es_un_cd()` | `20260917030000`, aplicada |
| `closure_lines.home_location_id` + índice `(business_date, home_location_id)` | `20260917040000`, aplicada |

Estado verificado en producción: 12 CD en catálogo, columna e índice de la línea creados, trigger
activo, **0 conductores con CD base** — que es la carga de negocio, no un pendiente de desarrollo.

## Lo construido, por ola

- **Ola 1**: `GET /locations?origin_cd=true`; `is_origin_cd` en el alta y el PATCH.
- **Ola 2**: el CD base entra y sale por el detalle y el alta de conductor; **sugerencia que propone
  y nunca escribe** (umbral 80%, ventana 90 días), campo en `DriverDetailPanel` y en `AltaDeFlota`, y
  sección **Configuración › Operaciones › Centros de distribución**.
- **Ola 3**: la línea del cierre guarda el CD (el tracto lo hereda de su conductor habitual);
  `home_cd_id`/`home_cd_name` y `carrier_shipper_names` en los dos ejes y en el pivot de Reportería;
  columna **"CD"** al lado de "Local de origen"; **el desplegable de CD se alimenta del catálogo y no
  de las filas presentes** (única excepción al criterio de la tabla, comentada en el código); las
  filas sin carga muestran las operaciones habilitadas de su empresa en cursiva; **los tiles pasan a
  contar sobre las filas filtradas**; y el aviso de "nadie tiene CD base" con enlace al Directorio.

## Tres hallazgos que valen más que el código

1. **El `UNIQUE` que la migración de julio declara sobre `public.locations` no existe en
   producción**: lo que hay es un índice único *case-insensitive* con otro nombre
   (`locations_entity_name_site_number_ci_key`). Un `ON CONFLICT ON CONSTRAINT` habría reventado en
   el deploy. Lo atrapó el ensayo contra la base, no los tests.
2. **`routers/locations.py` no tenía NINGÚN test de integración**: sus tests mockeados pasaban con
   una columna inexistente en el `SELECT`. Ahora tiene 4.
3. **Inferí tres firmas en vez de abrirlas** (`shippersApi`, `useRowFeedback`, `useConfigList`) y las
   tres estaban mal; `useConfigList` además habría recargado en bucle con un arrow inline.

## Lo medido

Frontend **1.375 en verde**, `tsc` limpio, `npm run build` OK, trinquete visual **1.685** sin
moverse. **Backend 1.037 en verde, cero fallas** (venía de 1.017): **16 tests nuevos de integración**
en 3 archivos, todos contra Postgres real en transacción revertida. Frontend final: **1.379**.
Los trinquetes atajaron tres veces (1.687 de color, y tamaño bajo 11px); las tres se corrigieron con
tokens y ninguno subió.

**Mutaciones verificadas, 15 en total**: el trigger del CD (probado sacándolo dentro de una
transacción revertida), el borrado con cadena vacía, el campo en la lista `touched`, la sugerencia
que no se ofrece con dato puesto, el filtro alimentado por catálogo, el borrador que se resincroniza,
el error de catálogo que no dibuja un desplegable vacío, el upsert que guarda el CD, la herencia del
tracto, las operaciones habilitadas, los tiles que siguen al filtro, y las dos columnas que no se
funden. **Ojo con una**: sacar la primera guarda del congelamiento NO pone nada en rojo — hay dos, y
hay que sacar las dos para que el test lo note. Defensa en profundidad, no test flojo.

## Dos correcciones del usuario que cambiaron el modelo y el nombre

**1. No hay umbral: si el TMS lo reporta como origen, lo es.** *"si aparecen dentro de la
trazabilidad de origen es porque lo son"*. Mi siembra usaba un umbral de 5 viajes en 90 días —una
heurística mía que separaba "CD de verdad" de "ruido" sin tener con qué decidirlo— y dejaba 12
lugares afuera. El catálogo pasó de 12 a **24**. Y se retiró la exclusión del trigger
`app.reconcile_new_trip_stop_location()`, que sólo sembraba DESTINATION con este argumento: *"el
ORIGIN casi siempre es un CD del transportista, no un local de cliente"*. Era cierto cuando una fila
de `locations` sólo podía significar "local de entrega"; con el rol aparte deja de serlo, y sin el
trigger el catálogo se quedaba viejo en silencio.

**2. No todos los orígenes son CD.** *"no todos se llaman CD porque no lo son... pero sí son un
origen"*. Medido sobre los 24: **sólo 7 se llaman "CD"**. Los otros 17 son bodegas
(`Bod La Farfana 1`), operadores logísticos (`SITRANS`, `Saam Renca`), una devolución
(`Logistica Inversa`) y tiendas despachando (`Express Maipú`, `VIÑA DEL MAR`, `HIPER SANTA CRUZ`).
Estaba nombrando la categoría por su caso más frecuente, que es justo lo que este proyecto prohíbe.

`is_origin_cd` → **`is_origin`**; en pantalla, **"Origen habitual"**. El primer intento fue *"Origen
base"* y el usuario lo frenó — *"¿qué es eso? no se entiende"*—: era una traducción literal de *home
terminal*. El nombre bueno estaba **a una columna de distancia**: la tabla ya dice "Tracto habitual".
La lección: cuando hace falta un término nuevo, mirar primero el vocabulario que la propia pantalla
ya usa.

## Un test mío que cambiaba de color solo, y cómo se cerró

La suite completa falló 1 de 1.037 — y dos veces, en tests DISTINTOS del mismo archivo. No era flake
ni presión de conexiones: `_conductor()` de `test_cd_base_conductor_integracion.py` sorteaba un RUT
completo confiando en que `public.canonical_rut()` lo aceptara, pero esa función **valida el dígito
verificador**. Un número al azar sirve 1 de cada 11 veces; con 40 reintentos cada llamada fallaba el
~2%, y el archivo la llama 7 veces → **~14% de que la corrida se cayera**.

Sólo apareció corriendo la suite ENTERA: el archivo solo pasaba, y los tres archivos nuevos juntos
(16 tests) también.

Arreglado sin reimplementar la regla en Python —lo que el propio docstring del test prohibía—: se le
preguntan a la base los 11 dígitos posibles y se toma el que califica. Evidencia en dos formas: **5
corridas seguidas en verde** (con el helper viejo, ~53% de que al menos una fallara) y la propiedad
directa medida contra producción — sobre **500 cuerpos al azar, exactamente 1 dígito válido cada
uno**, sin excepción.

## Ola 4: DESPLEGADA (decisión del usuario, 18/09)

Retira las dos adivinanzas —`_LAST_KNOWN_ORIGIN_SQL` y su gemela por conductor en
`status_report.py`, y el LATERAL `last_origin` de `equipment_closures.py`— y hace que las
**Secciones 2, 4 y 7 agrupen por el origen habitual declarado**. La **Sección 3 (vueltas) se queda con el
origen real**: es volumen, no asistencia. La Sección 2 tiene que ir por el declarado para que cuadre
con la 7, donde "enrolados" incluye a quien no salió y ése no tiene origen.

**Sección 7 nueva — "Cargaron en otro origen"** (ola 4.1). Es la mitad del valor del estándar:
declarar el origen habitual no sirve para que todos calcen, sino para poder VER cuándo no calzan. Sale de datos que
ya están en la fila, sin una consulta más.

### El antes/después que la condicionaba

| 16/09 | |
|---|---|
| Conductores en el cierre | 41 |
| **Antes** (adivinanza) | 40 con CD |
| **Después** (declarado) | **0 con origen habitual** |

Se retuvo un día por eso. El usuario decidió desplegarla igual el 18/09: **"Sin origen" es la verdad
y se llena solo** a medida que Operaciones carga los 41, mientras que lo anterior dejaba en pantalla
un número que ya sabíamos mal.

Y de paso quedó medido el defecto que la ola retira: la adivinanza atribuía al 16/09 orígenes de
viajes **desde el 23/07** y hasta el **17/09** — o sea le ponía a un día el CD de un viaje
*posterior*. Eso es reescribir el pasado, literal.

**Impacto proyectado** si los CD se cargan con la sugerencia (dominante ≥80%): en los últimos 15
días, **4 desvíos de 354 viajes (1,1%)**, en 2 conductores. La Sección 7 va a ser corta y legible,
no ruido.

## Checklist — siguiente paso exacto

1. **TODO DESPLEGADO Y VERIFICADO.** Las cuatro olas están en `dev`, en cinco commits: `2f96a519`
   (backend), `bedc48b4` (frontend), `d0987812` (ola 4), `ada0a0b4` (fix del test) y `bc05dd33`
   (rename a origen). Deploys en verde, `/health` 200, `/locations?origin=true` responde 401 sin
   credenciales, el filtro muestra **los 24 orígenes** en la app, cero errores en consola y en los
   logs. **Árbol limpio.**
   - **La HU no está en git**: `monitor-app/docs/` está en `.gitignore` por diseño.
   - **Ojo con el orden**: renombrar `is_origin_cd` dejó `/locations` en 500 hasta desplegar el
     backend. Fue asumido y duró minutos, pero un rename de columna viva no tiene orden sin hueco.
2. **Lo único que falta es de negocio: cargar el origen habitual de los 41 conductores.** Para 35 es
   un botón que ya dice el origen concreto; 3 tienen dominante entre 60-80% (se muestra el reparto y
   elige la persona), 2 bajo 60% y 1 sin historial. Mientras tanto el Cierre y el Reporte dicen
   "Sin origen", que es correcto. **No es criterio de completitud de desarrollo.**
3. **Las cuatro preguntas para Operaciones están escritas** en
   `monitor-app/bugs/20260916/preguntas-abiertas-a-operaciones.md` (sí está en git, junto al
   documento original y al levantamiento). Las dos que pesan:
   - **La cara**: si *"dejar abierto el filtro de CD Origen para modificación"* quiso decir el
     **valor** y no el filtro, hay que **rediseñar**, no ajustar.
   - Qué hacer con los desvíos de la Sección 7. Proyectado con la sugerencia puesta: **4 sobre 354
     viajes (1,1%)** en 15 días, 2 conductores. ¿Información para mirar, o alerta?
4. **El cambio de conducta de los tiles** (ahora siguen al filtro) necesita su visto bueno.
5. **UAT del usuario**: el click-through lo hice yo sobre un conductor elegido por SQL y lo revertí al
   terminar. Falta el de Operaciones con datos que se queden.
6. Sigue de la Ronda 161: la UAT del cierre unificado, el congelamiento con tráfico real, la matriz de
   grupos de motivos, y la ola 4.4 (líneas TRIP) y ola 5 (retirar tablas viejas).
