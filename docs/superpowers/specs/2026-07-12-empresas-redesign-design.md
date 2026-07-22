# Design: Rediseño del módulo Empresas — ficha (roster + panel de detalle) y pulido del listado

**Date:** 2026-07-12
**Status:** Approved

---

## Context

El módulo Empresas (`/dashboard/transportistas`) nunca recibió el pulido visual/interactivo que sí tuvo Seguros en esta misma sesión — quedó pendiente explícitamente para reusar el componente de checklist de documentos ya rediseñado (`DocumentChecklist.tsx`, ahora una lista vertical con contador de completitud).

**Contexto verificado en el código y en los planning docs anteriores:**
- `monitor-app/docs/plan-modulo-empresas-seguros.md` (2026-07-09): plan arquitectónico original, ya implementado en Fases 1-5 (modelo relacional, pipeline Mage, API). Sus secciones 4.1/4.2 describen el listado/ficha que está **live hoy**, nunca rediseñado visualmente.
- `contexto-modulo-empresas.md`: transcripción de la reunión 2026-07-08 (Felipe + Fabián) sobre cómo debe verse el módulo para Pablo (operaciones). Requisitos explícitos: lente mental "cuántos equipos tengo asignados vs. cuántos me faltan" (para saber a quién llamar); columnas separadas tracto/rampla; filtro activo/no-activo crítico; % de cumplimiento con alerta bajo 90% mostrando **por qué** bajó; Seguros como módulo separado (ya resuelto); preocupación explícita por que "reclutamiento" (la sección de conductores/equipos) se sienta "acotado", no abrumador.
- **Listado** (`app/dashboard/transportistas/page.tsx`, 253 líneas): ya cubre bien lo pedido en la reunión — KPIs accionables (Activas/Habilitadas/Alertas/No activas), filtros, columnas tracto/rampla, toggle tarjetas/tabla, `TransporterSlideOver` como vista rápida. No tiene el problema estructural que tuvo Seguros — solo necesita pulido visual.
- **Ficha** (`app/dashboard/transportistas/empresa/[id]/page.tsx`, ~1900 líneas): monolito real. Renderiza **todos** los conductores y equipos con sus campos completos editables inline simultáneamente (`DriverRow`/`MobileDriverCard`/`VehicleRow`/`MobileVehicleCard`), usa un patrón de documentos por campo individual hardcodeado (`GovernanceSelect`/`GovernanceStatusBadge` — un `<select>` + badge por cada doc_code, repetido decenas de veces en el archivo) en vez del catálogo genérico ya usado en Seguros. `TransporterDocumentsPanel.tsx` (documentos a nivel empresa) tampoco usa `DocumentChecklist` — es un componente aparte con su propio estilo.

**Diagnóstico central (brainstorm):** el problema no es solo "mucho contenido en una página" — es que la ficha muestra el detalle completo editable de **cada** conductor/equipo a la vez, para 12+ conductores y 8+ equipos simultáneamente. Ese es el origen real de la sobrecarga que preocupaba a Fabián ("reclutamiento es tan amplio"). La solución no es reordenar secciones, es cambiar el modelo de interacción: mismo principio que "próxima cuota" en Seguros — mostrar solo lo escaneable por defecto, detalle completo bajo demanda, uno a la vez.

---

## Decisiones de diseño

| Decisión | Elección | Alternativa descartada |
|----------|----------|------------------------|
| Estructura de la ficha | Una sola página con secciones (Header+Alertas, Contactos, Conductores, Equipos, Documentos empresa) | Tabs a nivel de página; secciones colapsables — ambas rechazadas por el usuario ("no me convence ninguna de las 3... si es necesario rediseño completo se hace") |
| Conductores/Equipos | Roster compacto en tarjetas (nombre/patente + avatar + 1-2 badges de estado) + panel de detalle lateral al hacer click (documentos + campos editables + transferir) — uno a la vez, no todos expandidos | Filas densas tipo tabla (también evaluada, el usuario prefirió tarjetas); mantener filas siempre-expandidas (statu quo, es la causa raíz del problema) |
| Documentos por conductor/equipo | El panel de detalle usa `DocumentChecklist` (mismo componente genérico ya usado en Seguros) contra el catálogo `compliance_doc_catalog` existente, reemplazando `GovernanceSelect`/`GovernanceStatusBadge` | Mantener el patrón de un `<select>` hardcodeado por doc_code |
| Documentos de la empresa | `TransporterDocumentsPanel` migra a envolver `DocumentChecklist` directamente (no necesita drill-in — ya es compacto) | Mantener el componente separado con su propio estilo |
| Alertas | Sección nueva y prominente arriba de la ficha, mostrando el motivo concreto del bloqueo (ej. "Cuota de seguro vencida", "Docs 82% < 90%") | Dejar el motivo enterrado en tooltips (statu quo) |
| Listado de Empresas | Pulido visual (colores/espaciado/tipografía al nivel de Seguros) + revisión visual de `TransporterSlideOver`, sin cambios estructurales | Rediseño estructural — no aplica, el usuario confirmó que la estructura actual (KPIs/filtros/columnas/toggle) ya funciona |
| Editar empresa / Transferir | Se mantienen como modales existentes, sin cambios estructurales | Fusionar con el panel de detalle — no identificado como problema |

---

## 1. Ficha de empresa: nueva estructura de una sola página

Reemplaza el archivo monolítico actual por una composición de componentes más chicos (el archivo de 1900 líneas se descompone — no se reescribe como un segundo monolito).

**Orden de secciones:**

1. **Header** — nombre, RUT, badge de elegibilidad, % cumplimiento, chips de clientes GC, botón "Editar", badge "difiere del origen" si aplica. Mismo contenido que hoy, pulido visual únicamente.
2. **Alertas** (solo si hay alguna) — banner prominente arriba de todo listando los motivos concretos de bloqueo ("Cuota de seguro vencida", "Documentación 82% < 90% requerido"), no solo un ícono con tooltip.
3. **Contactos** — sin cambios (ya funciona bien: 4 tarjetas por rol).
4. **Conductores** — buscador + chip "Con alertas" + roster de tarjetas compactas (avatar con iniciales + nombre + 1 badge de estado: "Docs OK" en verde o el motivo concreto en rojo, ej. "Licencia vencida"). Click en una tarjeta abre el panel de detalle.
5. **Equipos** — mismo patrón que Conductores, más chip de filtro Tracto/Rampla (pedido explícito de la reunión).
6. **Documentos de la empresa** — `DocumentChecklist` inline directo (catálogo `compliance_doc_catalog` con `entity_type='transporter'`).

**Panel de detalle (conductor o vehículo):** se abre como slide-over lateral al hacer click en una tarjeta del roster (mismo lenguaje de interacción que `InsurancePolicyModal`/`TransporterSlideOver`: overlay + panel, Escape cierra, foco atrapado, foco vuelve al elemento que abrió). Contenido:
- Nombre/patente + RUT.
- `DocumentChecklist` con los documentos propios de esa entidad (`entity_type='driver'` o `'vehicle'`).
- Campos editables actuales (vencimiento de licencia/cédula para conductor; vencimientos de permiso de circulación/revisión técnica/gases/SOAP para vehículo) — mismos campos de hoy, sin cambios de negocio, solo reubicados del row-siempre-expandido al panel.
- Botón "Transferir a otra empresa" (abre el `TransferModal` existente, sin cambios) — visible solo con `canAdmin` (mismo gate que hoy en `DriverRow`/`VehicleRow`). Los campos editables del panel requieren `canEdit || canAdmin` (mismo gate que hoy).

El roster de conductores/equipos, al ser compacto, hace innecesarias las variantes mobile actuales (`MobileDriverCard`/`MobileVehicleCard`) — las tarjetas del roster ya son responsive por diseño (grid que colapsa a 1 columna en mobile).

---

## 2. Listado de Empresas: pulido visual únicamente

Sin cambios estructurales — KPIs, chips de filtro, columnas tracto/rampla, toggle tarjetas/tabla, y `TransporterSlideOver` como vista rápida se mantienen. El único trabajo es visual: alinear colores, espaciado y tipografía al lenguaje ya validado en Seguros (mismo tratamiento de avatares/iniciales, mismos tonos de estado verde/ámbar/rojo, mismo estilo de tarjetas con borde que `InsuranceCompanyCard`).

`TransporterSlideOver` recibe el mismo pulido visual (encabezado, espaciado de secciones) sin cambios de estructura ni de datos.

---

## Fuera de alcance

- Cambios al modelo de datos, pipeline Mage, o API — este spec es solo frontend.
- Fusionar Seguros dentro de la ficha de Empresas — se mantiene como módulo separado (decisión ya tomada y validada en la reunión del 2026-07-08).
- Modal de "Editar Datos Empresa" y `TransferModal` — no identificados como problema, sin cambios.
- Notificaciones/campana en Topbar (mencionado en el plan original, sección 4.4) — no forma parte de este rediseño visual.
