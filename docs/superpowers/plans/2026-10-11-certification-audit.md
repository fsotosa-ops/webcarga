# Auditoría del módulo de Certificación — plan

> Pedido del usuario (11/10): "toca varias cosas, partiendo por los varios clicks que se tiene por conductor,
> vehículo, empresa. Hay hartos gaps a nivel de UX/UI y desalineados con el estándar de la industria. […] que
> sea readible, robusto, escalable, mantenible, sin parches y basado en la arquitectura de la app backend y
> frontend. Intuyo que tenemos un frankenstein."

**Qué produce esta auditoría:** un diagnóstico medido y una arquitectura objetivo con su hoja de ruta de
migración. **No produce código.** La implementación sale después, por el ciclo habitual: brainstorming → spec →
plan, uno por cada bloque de la hoja de ruta.

**Entregable:** `docs/superpowers/specs/2026-10-XX-certification-audit.md`, con estas secciones: diagnóstico,
arquitectura objetivo, decisiones, hoja de ruta y preguntas para el cliente.

## 0. Punto de partida (relevado el 11/10, sin medir todavía)

**La voz del cliente.** Fuentes: minutas del 14/08, 21/08, 25/08, 04/09, 02/10 y 09/10, y las HU 20260814 y 20261006.
Quejas que se repiten (dos o más veces):
1. Demasiados clics para saber qué venció o dónde cargar (14/08, 04/09, 02/10, 09/10). Cita de la llamada del
   02/10: *"me tira toda la empresa… tengo que entrar a la empresa… al conductor… no te muestra al tiro que es la
   licencia"*.
2. Empresas inactivas o dadas de baja que no aparecen donde se espera (5 veces).
3. Preferencia por cargar en lote desde Excel (3 veces).
4. La póliza se carga dos veces (en Certificación y en Seguros) y Seguros no da confianza (3 veces).
5. "Opcional" frente a "crítico" sin definir (3 veces).
6. Vencimiento al crear un documento (2 veces). Ya está hecho en HU-C1.

Pedido abierto más concreto: el ítem 20 / C3. Elegir un tipo de documento, ver quién lo tiene vencido o por
vencer y cargarlo ahí mismo. Pablo lo llamó "cubo"; dijo que la función "existe pero no es práctica".

**El mapa técnico: indicios del Frankenstein.**
1. **Dos fichas de empresa** con documentos:
   - `compliance/[carrierId]`, 1.076 líneas;
   - `carriers/[id]`, 964 líneas.
   Usan listas, vocabularios y caminos de carga distintos, y no se enlazan entre sí.
2. **Seis o más definiciones del estado de un documento.**
   - En el backend:
     - los predicados de `services/vencimientos.py`;
     - el CASE de `/pending`;
     - `entity_summary`;
     - el alcance LEGAL_MANDATORY de `carriers.py` y de `trips.py`/`daily_closures.py`;
     - las vistas materializadas por `status`.
   - En el frontend, otras 6 más.
   Consecuencia: el badge del viaje puede contar como pendiente un documento que Certificación considera NO_EXIGIBLE.
3. **La pestaña Documentos del Directorio** pone primero el triage de "subir y clasificar después", el
   antipatrón que el drawer ya había retirado.
4. **"Por requisito" no lleva a ningún lado**, aunque `/pending?requirement_code=` ya lo soporta.
5. **Cada escritura sobre empresas, equipos o asignaciones refresca 5 vistas materializadas.** Ese refresco
   alimenta 2 columnas y una tabla que la app no lee.
6. ~~La póliza vive dos veces~~ **Corregido por el usuario (11/10): no es un duplicado.** El seguro que se carga
   en Certificación (requisitos SEGURO_*) es documentación de la empresa para certificarla; Seguros
   (`insurance_policies`) gestiona las pólizas. La separación es intencional. Lo que sí queda abierto es la pregunta
   de Pablo del 09/10 (si cargar la póliza en Certificación "habla" con Seguros): la respuesta es que no, a
   propósito, porque son propósitos distintos.
7. **Cinco componentes que listan documentos** y dos vocabularios (`urgencia` contra `status`+`is_expired`).
   Cuatro zonas de arrastre independientes.
8. **Una URL firmada por documento**, con llamadas síncronas a Supabase dentro de handlers async (N+1 HTTP), y
   tres consultas de documentos casi copiadas (empresa, conductor, equipo).
9. **La API mezcla español e inglés.** Hay además un endpoint huérfano (`bulk-file`), un router que importa
   helpers privados de otro, y los requisitos se piden desde dos módulos del frontend.
10. **Residuos:** las redirecciones `/certification` y `?vista=documentos`, `carrier_compliance_status` (solo lo
    usa Mage) y los componentes `Transporter*`, con nombres del modelo viejo.

## 1. Método: cuatro lentes y una síntesis

Cada lente termina en una tabla de hallazgos con la misma forma:

| campo | contenido |
|---|---|
| id | identificador del hallazgo |
| lente | cuál de las cuatro |
| evidencia | archivo:línea, consulta o captura |
| efecto para el usuario | qué ve o qué le pasa |
| causa raíz | por qué ocurre |
| severidad | en una de tres categorías: bloquea / confunde / costo interno |

Un hallazgo sin evidencia no entra.

### Lente A — Tareas y clics (UX medido, no opinado)
1. **Lista cerrada de los trabajos del cliente**, sacada de la voz del cliente:
   - J1: cargar un documento a un conductor, a un equipo o a una empresa;
   - J2: reemplazar uno vencido;
   - J3: ver qué está por vencer;
   - J4: cubrir un requisito en todas las empresas (el "cubo");
   - J5: clasificar archivos sueltos;
   - J6: pedir un documento a pedido;
   - J7: ver el historial de un documento;
   - J8: saber si una empresa, un conductor o un equipo está habilitado para operar;
   - J9: corregir una fecha;
   - J10: cargar fechas en lote.
2. **Medir cada trabajo en dev con Playwright**, partiendo desde el sidebar y por cada camino que hoy existe
   (Certificación, Directorio, Cierre). Se registran clics, pantallas o capas y campos a llenar. Las capturas
   se toman a 1440 px y a 390 px.
3. **Una matriz trabajo × camino** que marca los duplicados: el mismo trabajo hecho en dos lugares de dos formas.

### Lente B — Estándar de la industria
1. **Comparar cada trabajo con productos reales del rubro**, nombrados:
   - gestión de contratistas: Avetta, ISNetworld, Pronexo (la plataforma que usa el cliente);
   - documentos de flota: Samsara, Fleetio;
   - evidencias por control: Vanta, Drata, como modelo de "requisito → quién cumple".
   Para cada producto: ¿cuál es la unidad de navegación (la entidad o el requisito)? ¿Dónde se carga el archivo?
   ¿Cómo se muestra el vencimiento?
2. **Evaluar las pantallas** con las heurísticas de Nielsen, el checklist de `ui-ux-pro-max` y los trinquetes
   del sistema visual (colores crudos y texto bajo 11 px por archivo).
3. **Concluir con una propuesta de modelo de navegación**, mostrada en una maqueta del visual companion para
   que el usuario la vea y elija.

### Lente C — Dominio y datos (backend)
1. **Una sola definición del estado.** Inventariar cada definición del estado de un documento (backend y
   frontend) y **medir con SQL contra la base real** cuántos documentos o entidades clasifica distinto cada una
   frente a `vencimientos.py`. Las consultas van parametrizadas, son de solo lectura y ninguna recorre el padrón.
2. **El modelo:**
   - las solicitudes, que hoy son filas de `compliance_records` con ON_REQUEST;
   - ~~la superposición de la póliza~~ (no aplica: separación intencional, ver el punto 6);
   - las vistas materializadas y sus triggers: quién las lee, cuánto cuesta cada refresco (pg_stat_statements)
     y el lock de `trg_refresh_compliance_on_carriers_update`.
3. **El rendimiento:** medir el tiempo de p50/p95 de los endpoints de cada trabajo (`/status`, `/pending`, la
   ficha, `/summary`, la cola), con reglas activas. La última medición fue con 0 reglas.

### Lente D — Arquitectura de código (API y frontend)
1. **La API:** inventario de unos 40 endpoints, con columnas consumidor, nombre (estándar en inglés), forma
   REST, huérfanos, acoplamiento entre routers, N+1 de URLs firmadas y consultas copiadas.
2. **El frontend:**
   - las superficies y sus componentes;
   - los duplicados (5 renderers, 6 cálculos de estado, 4 zonas de arrastre, 5 inputs de archivo);
   - las claves de React Query y qué invalida cada mutación, incluida la sincronía con el Directorio, el Cierre,
     la vista rápida y los badges del viaje;
   - los archivos de más de 400 líneas;
   - los nombres en español en el código nuevo.
3. **Los tests:** qué protege cada definición y qué test fija un defecto en vez de protegerlo.

### Síntesis — arquitectura objetivo y hoja de ruta
1. **La arquitectura objetivo:**
   - **Un dominio `documents` en el backend:** un servicio de estado (la única definición), un read model y una
     API con nombres estándar.
   - **Un solo componente de documentos de una entidad en el frontend**, usado por Certificación, el Directorio
     y la vista rápida.
   - **Una vista por requisito**, para el "cubo".
   - **Una sola ficha por entidad**, o un criterio explícito de qué vive en cada una.
   Se comparan 2 o 3 alternativas, cada una con sus costos, y se recomienda una.
2. **La hoja de ruta:**
   - en bloques que se pueden desplegar solos, con expand → deploy → contract en la base, rutas viejas y nuevas
     conviviendo, y cada bloque con sus tests;
   - ordenados por efecto para el usuario.
   Candidato a primer bloque: el estado único más el "cubo", porque resuelve la queja más repetida y el pedido
   abierto.
3. **Las preguntas para el cliente**, juntas y no una por una:
   - ¿qué significa "opcional"?
   - ¿un mismo F30 le sirve a dos clientes?
   - ~~¿la póliza va en Certificación o en Seguros?~~ (resuelto: las dos, con propósitos distintos);
   - las 11 dudas de la planilla;
   - historial o pisar el archivo anterior.

## 2. Ejecución

| Paso | Quién | Toca la base | Duración estimada |
|---|---|---|---|
| A. Clics y capturas en dev | yo, con Playwright | no (solo lectura de UI) | 1 sesión corta |
| B. Comparación con la industria | yo, con un agente de investigación web para los productos nombrados | no | en paralelo con A |
| C. Dominio y datos | agente de solo lectura + mis consultas SQL parametrizadas | solo SELECT, sin padrón | en paralelo |
| D. API y frontend | agente Explore de solo lectura | no | en paralelo |
| Síntesis | yo; la maqueta de navegación va en el visual companion | no | después de A-D |

**Reglas:**
- solo lectura de punta a punta;
- Mage no se toca;
- nombres nuevos en inglés y la UI en español neutral;
- toda afirmación lleva evidencia;
- las cifras se dan vivas (las del 11/10 son las de este documento, no las del AGENTLOG).

**Cierre:** el documento de auditoría queda commiteado, con la arquitectura objetivo y la hoja de ruta, y la
decisión del usuario sobre la alternativa queda registrada. Recién entonces se escribe la spec del primer bloque.

## 3. Fuera de alcance de la auditoría
- La auditoría no corrige bugs. Los menores M1-M11 de la entrega 2b se verifican dentro de la lente C/D y entran
  a la hoja de ruta con su severidad.
- No toca Seguros más allá de la superposición con Certificación (su auditoría propia es C6).
- No define el rediseño del detalle del viaje, que es otra sesión. Solo registra qué del badge de documentos
  depende de esto.

## 4. Primera corrida de la lente A (11/10, Playwright en dev, sin guardar nada)

Las tareas se simularon partiendo desde el Monitor, el Cierre y Certificación. En cada recorrido la simulación se
detuvo antes de guardar, porque dev y prod comparten la base.

| Tarea | Hoy | Prototipo objetivo |
|---|---|---|
| S1. Desde el Monitor, resolver los documentos pendientes del conductor de un viaje | Hay 5 o más acciones antes de elegir el archivo y se pasa por 3 pantallas (fila → detalle → "revisar en Empresas" → ficha del Directorio → panel del conductor). Se pierde el viaje. El badge "12" tiene cursor de mano pero no responde al clic. | 4 acciones. No se sale del Monitor. |
| S2. Lo mismo desde el Cierre | 5 acciones y 2 pantallas (vista rápida → "Abrir ficha completa" → Directorio). La vista rápida muestra los documentos pero no deja cargarlos. | 4 acciones. Es el mismo panel que en el Monitor. |
| S3. Ver quién tiene vencida la Licencia y subirla | **No se puede.** "Por requisito → Licencia de Conducir: 72" no se abre, así que hay que revisar empresa por empresa. | 4 acciones, con filtro vencidos / por vencer / faltan. |
| S4. Mismo conductor, entrando por Certificación | 3 clics hasta la fila, y se carga en el lugar arrastrando el archivo. Es el mejor patrón de hoy, pero con otro componente y otros textos que el Directorio ("Arrastra aquí" contra "Subir documento"). | Es el mismo panel en todas las pantallas. |

Hallazgos de la corrida:
- **Al hacer clic en la fila del Monitor**, si cae sobre el conductor, se abre la reasignación aunque el conductor
  ya esté identificado. El popover muestra "Aplicar a los 0 viajes de esta persona" y el botón "Asignar a 0 viajes".
- **Los conteos cambian de forma según la pantalla**:
  - el Monitor dice "N pendientes";
  - la portada de Certificación dice "X de Y" (cubiertos de exigidos);
  - la vista rápida dice "N faltan".
  Además, el total cambia según la vista: 2.319 en la portada y 2.306 por requisito.
- **En ninguna pantalla se distingue "vencido" de "falta"**: el Monitor, la vista rápida y el panel del Directorio
  los muestran juntos.
- **El panel del conductor en el Directorio** abre con el formulario de nombre y origen habitual, y deja los
  documentos más abajo.
- **El aviso del detalle del viaje** solo dice "Falta Licencia o Carnet" y lleva a la pestaña Conductores, no al
  documento.
- **En las listas productivas aparecen datos de prueba** ("Diego Prueba / Test Empresa Webcarga").
- **La portada muestra "Al día: 0"**, así que no da ninguna señal de quién está habilitado para operar.

Prototipo: `.superpowers/brainstorm/84727-1791741985/content/certificacion-ux-objetivo.html`. Usa datos ficticios
y se recorrió con Playwright. Capturas en `.playwright-mcp/sim-*.png`.

## 5. Simulación del ciclo completo en una copia local (11/10)

**El entorno.** Supabase local (Postgres 17) con el esquema de producción, solo estructura y sin datos.
- Datos 100 % ficticios: 3 empresas (una inactiva), 5 conductores (uno inactivo), 4 equipos.
- La API y el frontend locales corren sobre ese mismo stack.
- Tres usuarias y usuarios ficticios: Certificación (supervisora), Operaciones (supervisor) y owner.
- El reloj de la base (`hoy_chile()`) se adelantó para ver las transiciones.
- Archivos y guion en `.superpowers/local-sim/` (fuera de git).

**El recorrido.**
1. Configurar 5 tipos de documento:
   - fecha impresa (Licencia, Revisión Técnica);
   - plazo desde la emisión (Antecedentes, 3 meses, aviso 15 días);
   - período mensual (F30-1, día 18);
   - solo a pedido (Política de Seguridad).
2. Activarlos.
3. Subir documentos: uno por vencer, uno nacido vencido.
4. Adelantar el reloj.
5. Reemplazar el vencido.
6. Repetir con el usuario de Operaciones.

### Bugs confirmados (con evidencia en la copia local)

| # | Bug | Efecto | Dónde |
|---|---|---|---|
| L1 | `/config/inventario` leía `profiles.role`, que se retiró con RBAC | La portada de Configuración decía "Sin datos por ahora" en todos los dominios (también en dev). **Corregido** en `b5375bd8`, con un test de integración. | `config.py:438` |
| L2 | `/compliance-records/pending` responde 500 si la empresa no tiene RUT | El modelo exige `carrier_tax_id: str` y la columna admite NULL. La fila de la empresa queda en blanco. | `compliance.py:633` |
| L3 | Ante un error de carga, la ficha dice "No le falta ningún documento" | Un fallo se presenta como "todo al día", contra la regla de `Estado` | panel de Certificación |
| L4 | Los documentos que se crean desde "Nuevo documento" quedan con `requires_file = false` | En el Directorio no se les puede subir archivo (Certificación sí deja). Afecta al F30-1 y a los 75 de WebCarga en producción (por verificar con datos reales). | `catalogo.py:crear_requisito` |
| L5 | El Directorio muestra "Subir documento" según `directory.edit`, pero la API exige `documents.upload` | El supervisor de Operaciones elige el archivo, pone la fecha y recibe 403 al guardar | `carriers/[id]/page.tsx:151` |
| L6 | Activar un documento se lo exige también a conductores y empresas **inactivos** | Configuración dice "alcanza 5 de 5" y crea 17 pendientes, mientras Certificación cuenta 14. Pablo pidió solo las activas. | disparadores de siembra |
| L7 | Un dominio de taxonomía sin filas responde 422 en vez de una lista vacía | Con un dominio vacío, la pantalla se rompe en lugar de mostrar el estado vacío | `status_taxonomies.py:32` |

### Gaps de UX observados

**Configuración**
- Dos flujos distintos para activar lo mismo:
  - en el panel: "Guardar → Ver qué cambia → Aplicar", con un `confirm()` nativo;
  - en la tabla: borrador con "Ver efecto → Publicar".
- Entre "Guardar" y "Aplicar", el documento figura vigente pero no se le exige a nadie, y la pantalla no lo dice.
- "Ver qué cambia" se habilita recién después de guardar.
- El estado vacío del catálogo dice "Ningún documento coincide con el filtro" sin que haya ningún filtro.
- El error de nombre duplicado expone nombres internos ("documento de DRIVER con el codigo …").
- Un documento "solo a pedido" muestra "Todas las empresas 3 de 3".

**Certificación**
- La vista por conductor incluye al conductor inactivo de la empresa inactiva.
- Un documento que se carga ya vencido queda marcado "Listo" sin ningún aviso.
- Un documento válido que está por vencer cuenta como "falta" ("0 de 2"), y la portada solo cuenta los vencidos, no los por vencer (pedido del 14/08).
- La vista por requisito mezcla los vencidos con los que faltan y no deja abrir la fila.
- El historial existe (cada archivo queda en el almacenamiento), pero no se ve desde Certificación.
- Error de concordancia: "1 DOCUMENTOS".

**Directorio**
- El panel del conductor es un modal centrado, otro patrón que el de la vista rápida.
- El estado de cada documento va solo con ícono y color, sin texto ni fecha.

**Transversal**
- No existe un paso de revisión: todo lo que se sube queda `APPROVED_MANUAL`. La base real tiene 0 documentos en revisión.
- La sesión de Certificación aterriza en el Monitor de Operaciones.
- En el login, los rótulos no están asociados a sus campos, y el campo de fecha de carga no tiene nombre accesible.

**Lo que funciona bien y hay que conservar**
- El formulario "Nuevo documento" usa lenguaje de negocio.
- La frase "Así queda: uno emitido el … vence el … Avisa desde el …".
- La carga en línea, que pide la fecha según la regla y advierte "no vale sin su vencimiento".
- Calcular el vencimiento desde la regla en vez de guardarlo.
- Reemplazar un documento conserva el archivo anterior.
