# Configuración, Parte 2: Certificación › Documentos exigidos

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, revisión final opus). Pasos con checkbox (`- [ ]`).

**Goal:** que el catálogo de documentos exigidos deje de ser una tabla densa dentro de Configuración y pase a ser lo que
es, un catálogo de trabajo de Certificación: una lista que filtra y una ficha por documento que responde sus preguntas.

**Architecture:** una sola forma de escribir una regla: la ficha, una pregunta por `PanelLateral`, con los endpoints por
documento que ya existen (`PATCH …/conditions`, `…/expiration-rule/preview`, `…/recalc-preview`, `…/recalc`, alias).
Las piezas de la pregunta (`CondicionPanel`, `EditorVigencia`, `SelectorExigibilidad`, `NuevoDocumentoPanel`,
`frase-de-la-regla`) se mueven a `components/compliance/requirements/` sin reescribirse. El borrador en lote se retira
de la UI y de la API (decisión del usuario, 16/10). La API suma el detalle de un documento, su historial de reglas y
"cumplen n de m".

**Tech Stack:** Next.js (App Router), TanStack Query, vitest + Testing Library, FastAPI + asyncpg, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-configuracion-en-tres-partes-design.md` §5 y §3. **Maqueta:**
`.superpowers/brainstorm/56411-1792100703/content/config-tres-partes.html`, bloque "PARTE 2" (fuera de git).

## Decisión previa: el lote se retira (16/10)

- **Uso real** (base real, solo lectura, 60 días): 80 documentos editados; toda edición de una persona tocó 1 o 2
  documentos a la vez. El único minuto con 75 fue la carga del catálogo por script (altas sin actor), no el borrador.
- **Estándar** (Vanta, Drata, Avetta, Samsara Compliance, Salesforce Setup): cada requisito se edita en su ficha con
  la vista previa del impacto; lo masivo, si existe, es "seleccionar filas → una acción", no celdas editables.
- **Robusto y de la arquitectura:** hoy hay dos caminos para escribir una regla (panel y borrador), con dos
  validaciones. El panel ya cubre los cuatro campos del borrador (vigencia, `exigible_on`, `requirement_level`,
  `is_active`). D3 de la spec: un solo patrón de edición.
- Si algún día hace falta actuar sobre muchos, se agrega selección en la lista sobre los endpoints por documento.

## Global Constraints

- Sin parches ni código duplicado; lo que se mueve se borra de su lugar viejo en la misma tarea, con su guarda.
- Español neutral, sin voseo; cero emojis (solo `lucide-react`); rutas e identificadores en inglés, etiquetas en
  español; solo tokens del sistema visual (los trinquetes solo bajan); sin valores de catálogo en el código.
- Lectura `certification.read`; escritura `certification.configure`. Sin permiso, todo se ve y nada ofrece editar
  (la API responde 403).
- Los cuatro estados de toda pantalla: vacío, a medias, sin permiso, falló. Ninguna cifra mientras carga.
- **Sin migraciones:** no cambia el modelo. La clave de revisión `certification/conditions` (`services/revisiones.py:70`)
  se conserva: es un identificador, no una ruta, y `test_revisiones.py` sigue sirviendo.

## HU

Como Supervisor de Certificación, quiero ver cada documento que se exige como una ficha con sus respuestas (a quién,
cuándo vence, cuándo se exige, con cuánta anticipación se avisa y quiénes no cumplen) y cambiar la regla viendo antes a
quiénes afecta, en vez de editarla dentro de una fila de Configuración.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Test |
|---|---|---|
| P2.1 | La lista filtra por entidad (Empresa · Conductor · Equipo) y por estado (Sin revisar · Con condición · Mensuales · Sin vigencia) con conteos; columnas Documento (+ código) · Se exige a · Vence · Aviso · Cumplen (n de m) · Revisión | `app/dashboard/compliance/requirements/page.test.tsx` |
| P2.2 | La fila abre la ficha y "Volver" regresa a la lista con sus filtros | `app/dashboard/compliance/requirements/page.test.tsx` |
| P2.3 | Cada pregunta de la ficha se edita en su panel con `certification.configure`; sin él, se lee y no hay "Editar" ni ⋯ | `components/compliance/requirements/RequirementProfile.test.tsx` |
| P2.4 | Editar la regla muestra a cuántos les cambia el estado antes de guardar | `components/compliance/requirements/CondicionPanel.test.tsx` (portado) |
| P2.5 | Configuración ya no tiene "Condiciones de documentos"; `/settings/certification/conditions` lleva a la lista y `?doc=CODIGO` a la ficha de ese documento | `app/dashboard/admin/settings/[area]/[section]/page.test.tsx` |
| P2.6 | La API da el detalle, el historial de reglas y "cumplen n de m", y ya no tiene `batch-preview` ni `batch-update` | `tests/test_requirements_detalle.py` |
| P2.7 | Humo: Certificación › Documentos exigidos → filtro → ficha → abrir "¿Cuándo vence?" y ver la vista previa → cancelar → Volver con el filtro | `scripts/smoke/smoke.spec.ts` |

## Contratos

### API (backend, `routers/requirements.py`)
- `GET /compliance-requirements` (READ) suma por fila `cumplen` y `exigidos`. `cumplen` = registros vigentes con
  `cubierto_predicate`; `exigidos` = `alcance.alcanzadas`. Se calcula en **una** subconsulta agregada por
  `requirement_id` sobre `compliance_records` (`is_current`), con los mismos predicados de `contar_estados()`
  (`services/edicion_catalogo.py:203`). Nada de una consulta por fila. Los consumidores de hoy (desplegables de
  clasificación) ignoran los campos nuevos.
- `GET /compliance-requirements/{id}` (READ): la fila del catálogo (mismo `SQL_CATALOGO` filtrado por id, sin una
  segunda consulta escrita a mano) + `estados` (`contar_estados`) + `reglas`. `reglas` es el historial de la regla base:
  `[{vigente_desde, validity_months, frequency_months, cutoff_day, period_offset_months, warning_days, grace_days}]`
  de `compliance_requirement_rules` con `shipper_id IS NULL`, de la más nueva a la más vieja. 404 si no existe; 422 si
  el id no es UUID.
- `GET /compliance-requirements/by-code/{code}` no se agrega: la redirección de `?doc=` busca el id en la lista que el
  frontend ya tiene en caché.
- **Se borran** `POST /batch-preview` y `POST /batch-update`, `LoteDeCambios` y sus piezas en
  `schemas/requirement.py`, y `tests/test_catalogo_en_lote.py`. Antes, grep de cada nombre en `app/`, `tests/` y
  `frontend/` para confirmar que no queda ningún usuario.

### Frontend
- `lib/types`: `RequirementOption` suma `cumplen`, `exigidos`; `RequirementDetail` (fila + `estados` + `reglas`).
  `lib/api/requirements.ts`: `get(id)`; se borran `verEfectoDelLote` y `publicarLote`.
- `lib/navegacion/compliance.ts`: `REQUIREMENTS = '/dashboard/compliance/requirements'`,
  `requirementHref(id, returnTo?)` (patrón de `clientHref`). `lib/rutas.test.ts` suma la ruta.
- Sidebar: Certificación suma `{ href: '/dashboard/compliance/requirements', label: 'Documentos exigidos' }` al final
  (`Sidebar.test.tsx`). La carpeta estática `requirements/` tiene precedencia sobre `[carrierId]`; un test lo fija.
- **Piezas movidas** a `components/compliance/requirements/` con sus tests: `CondicionPanel`, `EditorVigencia`,
  `SelectorExigibilidad`, `NuevoDocumentoPanel`, `frase-de-la-regla`, y de `celdas-editables.tsx` `CeldaAlias` (para
  "Se reconoce como"). `CeldaNombre` se borra: el nombre ya se edita en `CondicionPanel`. Los textos de "Vence" salen
  de `RENOVACIONES`/`renovacionDe`, que pasan de `borrador.ts` a `frase-de-la-regla.ts` antes de borrar el borrador.
- **Lista** `app/dashboard/compliance/requirements/page.tsx` (esqueleto de `app/dashboard/insurance/page.tsx`):
  - `EncabezadoDePagina` ("Documentos exigidos", "N documentos") + "+ Nuevo documento" (`NuevoDocumentoPanel`) solo
    con `certification.configure`.
  - Buscador por nombre o código; dos `SegmentedControl` (entidad; estado) que escriben `?entity=&state=&q=`.
  - Conteos calculados en el cliente sobre la lista completa (114 filas, una sola consulta). La spec pedía conteos
    "de la API"; con un catálogo de este tamaño, contar la misma lista que se dibuja es una sola fuente y no se
    desincroniza. Ninguna cifra mientras carga.
  - Definiciones de estado (una función pura, `requirementFilters.ts`, con su test): **Sin revisar** = chip de
    `useRevisiones('certification','conditions')`; **Con condición** = `applies_to_fleet_service_type_ids` o
    `applies_to_management_types` no vacíos; **Mensuales** = regla base con `frequency_months = 1`; **Sin vigencia** =
    `!is_active`, igual que el chip de hoy. Los filtros, salvo Sin vigencia, muestran solo los activos.
  - **Sin vigencia y Desactivados son el mismo conjunto** (verificado 16/10 en la base real: 77 inactivos, 75 de
    ellos el catálogo cargado apagado el 09/10 y 0 apagados a mano). La maqueta los mostraba como dos filtros con
    cifras ilustrativas (77 y 3; "Mensuales 6" cuando hoy hay 1). Va un solo filtro, **Sin vigencia**, que es la
    palabra que ya usa la pantalla y el chip "Vigente" de la ficha. Cifras reales de hoy: 114 documentos, 77 sin
    vigencia, 2 con condición, 1 mensual, 17 activos que no vencen.
  - Tabla del kit (`CABECERA`, `EncabezadoOrdenable`); la fila entera abre `requirementHref(id, returnTo)`.
- **Ficha** `app/dashboard/compliance/requirements/[id]/page.tsx` → `components/compliance/requirements/RequirementProfile.tsx`:
  - `ProfileBreadcrumb` (Certificación › Documentos exigidos › nombre, con `returnLink`), `ProfileHeader`: nombre,
    chips entidad · obligatorio/opcional · Vigente/Sin vigencia del glosario; ⋯ con Poner en vigencia/Quitar vigencia
    (`is_active`, vía `PATCH …/conditions`) solo con permiso.
  - Centro (`ProfileLayout`): cinco bloques-pregunta con su respuesta en una frase y "Editar":
    ¿A quién se le exige? (`fraseDeLaRegla` + "n de m activos"), ¿Cuándo vence? (+ "Historial: N cambios · ver",
    que despliega `reglas`), ¿Cuándo se exige?, ¿Con cuánta anticipación se avisa? (`warning_days` o "la alerta
    general: N días" desde `app.alert_thresholds`), ¿Qué cambia si edito la regla? (texto fijo que explica la vista
    previa). Cada "Editar" abre `CondicionPanel` enfocado en esa pregunta (prop `section`), sin un panel nuevo por
    pregunta.
  - Costado (`AsidePanel`): Detalles (código, entidad, revisión con `MarcaDeRevision`/`BotonConfirmar`), Se reconoce
    como (`CeldaAlias`), Quiénes no cumplen ("N no cumplen · ver en Pendientes" → `/dashboard/compliance/pending?doc=CODIGO`,
    que ya existe).
  - Id inexistente → `Estado` vacío con "Volver a Documentos exigidos".
- **Configuración:** fuera `conditions` de `dominios.ts` y de `secciones.ts` (`PERMISO_DE_SECCION`); fuera
  `PARAM_DE_SECCION` y su uso en `BuscadorConfig.tsx` (queda sin entradas). `MUDADAS` suma
  `'certification/conditions' → '/dashboard/compliance/requirements'`; `?doc=CODIGO` se traduce a la ficha por id.
  El aterrizaje por defecto (`page.tsx`, `primeraEditable` de `[area]/page.tsx`) pasa a la primera sección que quede
  (Alertas de vencimiento). `not-found.tsx` deja de enlazar Condiciones.
- **Se borran:** `condiciones-tabla.tsx`, `BarraDelBorrador.tsx`, `borrador.ts`, `celdas-del-borrador.tsx`,
  `celdas-editables.tsx` (vacío tras mover `CeldaAlias`) y sus tests. Lo que esos tests cubrían y sigue vivo se porta
  a los tests de la ficha, diciendo de dónde viene.

## Tareas

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7. Commit solo con los tests de la tarea en verde; línea del ledger en el mismo paso.

### Tarea 1 — API: detalle, historial y "cumplen" (P2.6, parte)
- [ ] Test rojo `tests/test_requirements_detalle.py` (integración, `conexion_revertida`, sujeto creado por el test): un
  documento con dos versiones de regla devuelve `reglas` en orden; `cumplen`/`exigidos` coinciden con registros creados
  (uno al día, uno vencido, uno faltante); el `GET` de la lista trae los dos campos en todas las filas; 404 y 422; 403
  sin `certification.read`.
- [ ] Implementar. Medir la lista contra la base real (solo lectura, `EXPLAIN ANALYZE`): debe seguir bajo ~200 ms.
- [ ] pytest del archivo y de `test_revisiones.py`. Commit.

### Tarea 2 — Mover las piezas sin cambiar comportamiento
- [ ] `git mv` de `CondicionPanel`, `EditorVigencia`, `SelectorExigibilidad`, `NuevoDocumentoPanel`,
  `frase-de-la-regla` (+ `RENOVACIONES`/`renovacionDe`) y `CeldaAlias` a `components/compliance/requirements/`, con sus
  tests. Imports actualizados; `condiciones-tabla` sigue funcionando desde la ruta nueva.
- [ ] vitest de los archivos movidos y de `condiciones-tabla.test.tsx` en verde, sin tocar aserciones. tsc. Commit.

### Tarea 3 — Lista (P2.1, P2.2)
- [ ] Test rojo `requirementFilters.test.ts` (las cuatro definiciones; un inactivo solo cuenta en Sin vigencia) y
  `page.test.tsx`: columnas, conteos por entidad y estado, sin cifras en vuelo, buscador por código, la fila enlaza con
  `returnTo` que conserva `?entity=&state=&q=`, "+ Nuevo documento" solo con permiso; vacío, cargando y error.
- [ ] Implementar la página, `lib/navegacion/compliance.ts`, el ítem del menú (`Sidebar.test.tsx`) y `lib/rutas.test.ts`.
  Commit.

### Tarea 4 — Ficha (P2.3, P2.4)
- [ ] Test rojo `RequirementProfile.test.tsx`: las cinco preguntas con su frase; "Editar" de cada una abre
  `CondicionPanel` en su sección; sin permiso no hay "Editar" ni ⋯ y todo se lee; historial desplegable; "Quiénes no
  cumplen" enlaza a Pendientes con `doc`; Poner en vigencia/Quitar vigencia; id inexistente. P2.4: el test portado de
  `CondicionPanel` que exige la vista previa antes de guardar sigue en verde con la prop `section`.
- [ ] Implementar con `ProfileLayout`/`ProfileHeader`/`AsidePanel`/`DetailsBlock`/`ProfileBreadcrumb`. Commit.

### Tarea 5 — Retirar el lote (P2.6, resto)
- [ ] Grep de `batch-preview`, `batch-update`, `LoteDeCambios`, `ver_efecto_del_lote`, `publicar_lote`,
  `verEfectoDelLote`, `publicarLote` en todo el repo (fuera de `node_modules`, `.next`, `AGENTLOG*`).
- [ ] Test rojo en `test_requirements_detalle.py`: `POST /compliance-requirements/batch-preview` y `/batch-update`
  responden 404/405.
- [ ] Borrar los endpoints, los esquemas, `test_catalogo_en_lote.py`, las funciones de `lib/api/requirements.ts`,
  `BarraDelBorrador`, `borrador.ts`, `celdas-del-borrador` y sus tests. Commit.

### Tarea 6 — Fuera de Configuración (P2.5)
- [ ] Test rojo en `[area]/[section]/page.test.tsx` y `[area]/page.test.tsx`: `certification/conditions` redirige a la
  lista; `?section=conditions&doc=CODIGO` y `/certification/conditions?doc=CODIGO` a la ficha de ese documento; un
  código desconocido, a la lista. `page.test.tsx`: el aterrizaje por defecto ya no es `conditions`.
- [ ] Quitar la sección (`dominios.ts`, `secciones.ts`, `PARAM_DE_SECCION`, `BuscadorConfig.tsx`, `not-found.tsx`),
  `MUDADAS`, borrar `condiciones-tabla.tsx` y su test (portar a la ficha lo que siga vivo); ajustar `dominios.test.ts`,
  `BuscadorConfig.test.tsx`, `not-found.test.tsx`. Commit.

### Tarea 7 — Verificación y despliegue (P2.7)
- [ ] Humo P2.7 en la copia local (usuario Supervisor de Certificación). La matriz por rol recoge el menú nuevo sola.
- [ ] `vitest` completo (se toca código compartido: Sidebar, navegación, Configuración), `tsc`, `npm run build`;
  backend del área (`test_requirements_detalle`, `test_revisiones`, `test_config_monitor`); trinquetes al número real.
- [ ] Capturas a 1440 y 390 de la lista (dos filtros), la ficha y un panel abierto, lado a lado con la maqueta.
- [ ] Revisión final opus y un pase de arreglos; push a `dev` (sin migraciones); Deploy Frontend y Deploy Monitor API
  en verde; recorrido en dev con sesión (solo lectura). AGENTLOG.

## Review Focus

- Un documento sin vigencia (inactivo) no aparece en "Sin revisar", "Con condición" ni "Mensuales" (Tarea 3).
- Un documento que no vence: "Vence" dice "No vence", Aviso "—", y "¿Con cuánta anticipación se avisa?" no ofrece
  editar (Tarea 3 y 4).
- Un documento sin nadie alcanzado: "0 de 0", sin división por cero ni "NaN%" (Tarea 1 y 3).
- Un enlace viejo guardado (`/dashboard/admin/settings?section=conditions&doc=SOAP`) llega a la ficha de SOAP (Tarea 6).
- Quien entra sin `certification.configure`: ve la lista y la ficha y no hay un solo control que la API rechace (Tarea 4).
- Ningún archivo nuevo queda bajo `app/dashboard/admin/settings/` para esta función (Tarea 2 y 6).
