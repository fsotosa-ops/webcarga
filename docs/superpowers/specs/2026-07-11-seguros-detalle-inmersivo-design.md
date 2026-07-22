# Design: Seguros — detalle de empresa inmersivo, antigüedad de mora en Cobranza, panel único en Pólizas

**Date:** 2026-07-11
**Status:** Approved

---

## Context

El rediseño visual de Seguros (`2026-07-11-seguros-redesign-design.md`, implementado y pusheado en `fc07224`/`78d86c6`) pasó dos rondas de fixes basados en feedback de texto, pero al revisar en el navegador seguía sin convencer:

- El slide-over de detalle de empresa (cuotas + documentos) tiene un bug real: ambas secciones son tiras de scroll horizontal que se **cortan a la mitad en el borde del panel**, sin ninguna señal (fade, flecha, scrollbar) de que hay más contenido al costado.
- El gráfico de barras en Cobranza (top-8 grupos por monto, agrupados por semana/mes/etc.) es decorativo, no informativo: los montos de las semanas rondan valores parecidos, así que el gráfico no revela ningún patrón accionable.
- Pólizas muestra el donut, los 3 KPI accionables, las 3 estadísticas informativas y el buscador como 4 piezas visualmente desconectadas (islas blancas separadas por espacio gris), en vez de sentirse como un solo panel de control.

Esta vez el diseño se validó con el companion visual (mockups reales) antes de escribir código, después de que dos rondas de "adivinar en texto y mostrar" fallaran.

**Fuera de alcance:** el rediseño de Empresas (fuera de Seguros) sigue pendiente de una sesión de brainstorm separada, como ya estaba definido. Este spec solo cubre Seguros.

---

## Decisiones de diseño

| Decisión | Elección | Alternativa descartada |
|----------|----------|------------------------|
| Forma del detalle de empresa | Modal centrado y ancho (2 columnas), no un panel lateral angosto | Slide-over angosto con scroll horizontal arreglado (fade/flecha); slide-over con tabs por póliza sin ampliar el ancho |
| Contenido del detalle | Header con % pagado + "próxima cuota" destacada y accionable + resto de cuotas colapsado detrás de "Ver todas" + documentos como lista simple con contador "X de N" | Timeline horizontal conectado con todas las cuotas visibles; tabla densa tipo dashboard con todas las cuotas y anillo de progreso |
| Etiqueta de cuota | "Cuota 1 de 5" | "#1" (se veía tosco/genérico) |
| Revertir un pago marcado por error | Botón "↺ revertir" que aparece al hover sobre una cuota pagada, con confirmación en popover pequeño anclado al botón (la fila nunca cambia de forma) | Toast/snackbar de deshacer transitorio; confirmación que reemplaza toda la fila |
| Visualización de Cobranza | Widget de "antigüedad de mora": 4 mini-barras verticales (0–30 / 31–60 / 61–90 / +90 días vencidos), cada una filtra la lista de abajo | Gráfico de barras por bucket temporal (statu quo, descartado por no informativo); donut de mora; barra apilada única |
| Agrupar por responsable (aseguradora/cliente GC) en Cobranza | Ya cubierto por el selector existente (Semana/Mes/Trimestre/Empresa/Aseguradora/Cliente GC), que sigue existiendo sin cambios — solo ordena la lista, ya no compite con un gráfico | Duplicar el desglose por responsable arriba, además del selector existente |
| Cohesión visual de Pólizas | Donut + 3 KPI accionables + 3 estadísticas informativas + buscador/chips, todo dentro de **un solo panel con borde** | Mantenerlos como 4 piezas separadas con gap entre ellas (statu quo) |

---

## 1. Detalle de empresa: modal inmersivo de dos columnas

Reemplaza `InsurancePolicySlideOver.tsx` (panel lateral fijo a la derecha). El nuevo componente es un modal centrado, ancho (≈900px en desktop), con backdrop — mismo contrato de accesibilidad que el slide-over actual (`role="dialog"`, `aria-modal`, foco atrapado, Escape cierra, click en backdrop cierra, foco vuelve al elemento que abrió el modal).

**Columna izquierda (≈34% del ancho, fondo gris claro `bg-gray-50`):**
- Header de la empresa: avatar circular con iniciales, nombre, RUT, badge de estado (mismo criterio que hoy: N vencidas / Sin información / Al día).
- Lista de pólizas de la empresa (`PÓLIZAS (N)`), cada una una fila clickeable mostrando aseguradora + resumen corto (ej. "1 vencida · próxima 25-07-26" o "al día"). La póliza seleccionada tiene fondo blanco + borde izquierdo de acento (`border-left: 3px solid var(--accent)`) y sombra sutil — el resto queda plano.
- **Si la empresa tiene una sola póliza, esta columna no se muestra** — el detalle ocupa todo el ancho del modal (evita una columna angosta con un solo ítem y mucho espacio vacío).

**Columna derecha (contenido de la póliza seleccionada):**
- Header: nombre de la aseguradora + número de póliza + vigencia, con el % de cuotas pagadas grande a la derecha (mismo cálculo que hoy, `paid_pct`).
- **Próxima cuota** (label `PRÓXIMA CUOTA`): la cuota pendiente/vencida más próxima por vencer, destacada en una tarjeta con fondo tintado (`bg-accent/5` o similar), mostrando "Cuota N de M", fecha relativa ("vence en 14 días" / "vencida hace X días"), monto, y botón "Pagar". Si no hay cuotas pendientes (todas pagadas), esta sección no se muestra.
- Link "▾ Ver todas las cuotas (N)" debajo — expande in situ la lista completa de cuotas (no navega a otra vista). Al expandir, cada cuota es una fila (no un círculo ni una tira horizontal): ícono de estado + "Cuota N de M" + fecha + monto + acción Pagar/Revertir según corresponda. La cuota destacada arriba también aparece en esta lista, resaltada.
- Documentos (label `DOCUMENTOS · X de N completos`): lista simple de filas (ícono de estado + nombre del documento + acción "Subir"/OK), igual que hoy pero sin el layout de nodos circulares en tira horizontal.

**Responsive:** en viewports angostos (`<sm`), la columna izquierda colapsa a una fila de pills horizontal scrolleable arriba (selector de póliza), y la columna derecha ocupa el ancho completo debajo.

### Revertir un pago marcado por error

Una cuota con `status='pagada'` muestra, al hacer hover (o tap sostenido en touch), un botón secundario "↺ revertir" a la derecha de la fila — no reemplaza el contenido de la fila, solo aparece adicional. Al hacer click, se abre un popover pequeño anclado al botón (fondo oscuro `#192a3e`, con triángulo apuntando al botón) con el texto "¿Revertir a pendiente?" y dos acciones: "No" (cierra el popover, sin cambios) / "Sí" (ejecuta la reversión). La fila en sí nunca cambia de tamaño ni de layout durante este flujo.

Revertir implica: `status` vuelve a `'pendiente'` si `due_date >= hoy`, o a `'vencida'` si `due_date < hoy`; `paid_at` se limpia. Reusa el mismo endpoint `PATCH /installments/{iid}` ya existente (con `expected_updated_at` para optimistic locking, igual que "Pagar"). El detalle exacto del contrato (si el endpoint actual ya acepta esto o necesita un pequeño ajuste) se resuelve en el plan de implementación.

---

## 2. Cobranza: antigüedad de mora reemplaza el gráfico de barras

Se elimina por completo el componente `GroupBarChart` (barras top-8 por grupo temporal) — no informativo, feedback confirmado de que "no dice nada".

En su lugar, un widget fijo arriba de la lista (no depende del selector de agrupamiento):

- **4 mini-barras verticales**, una por banda de antigüedad de **cuotas vencidas** (`is_overdue=true`), calculada client-side como `hoy - due_date` en días: `0–30`, `31–60`, `61–90`, `+90`. Cada barra muestra su altura proporcional al monto UF de esa banda, con la etiqueta del monto arriba y el rango de días debajo. Colores en escala de urgencia (ámbar → naranja → rojo → rojo oscuro para `+90`).
- Colores exactos (del mockup aprobado): `0–30` → `#fbbf24`, `31–60` → `#f97316`, `61–90` → `#ef4444`, `+90` → `#991b1b`.
- Cada barra es clickeable: filtra la lista de abajo para mostrar solo las cuotas de esa banda (nuevo filtro independiente del agrupamiento, ver siguiente punto). Click de nuevo en la misma barra quita el filtro.
- Al costado, un dato secundario en texto plano (no protagonista): "**N** UF no vencidas aún · **M** cuotas" — también clickeable, muestra solo las cuotas no vencidas.
- El selector de agrupamiento existente (Semana/Mes/Trimestre/Empresa/Aseguradora/Cliente GC) **no cambia** — sigue ordenando la lista de abajo. Ya no convive con ningún gráfico, así que dejar de "fingir" ser una visualización no es un problema: su rol siempre fue organizar la lista, y ahora es explícito.
- El filtro de antigüedad y el agrupamiento son composables: se puede filtrar a "+90 días" y agrupar por "Aseguradora" simultáneamente.

---

## 3. Pólizas: panel único

El donut de estado, los 3 KPI accionables (Al día / Con vencidas / Vencen este mes), las 3 estadísticas informativas (vencen en 30 días / sin pólizas / docs incompletos) y el buscador con chips de filtro pasan a vivir dentro de **un solo contenedor con borde** (`border border-border rounded-2xl`), separados internamente por bordes/fondos sutiles (`border-b`, franjas `bg-gray-50` para las estadísticas) en vez de gaps de fondo gris entre piezas separadas. El comportamiento de cada pieza no cambia (el donut sigue siendo solo visual, los KPI accionables siguen filtrando, las estadísticas siguen siendo texto plano no-clickeable, el buscador/chips igual que hoy) — el cambio es puramente de agrupación visual.

---

## Fuera de alcance

- Cruces de navegación "Ver en Cobranza" / "Ver en Pólizas" entre tabs (deuda ya documentada de la sesión anterior, no se aborda acá).
- Rediseño de Empresas (sesión de brainstorm separada).
- Mapeo real `doc_code`↔cliente (pendiente de Fabián).
