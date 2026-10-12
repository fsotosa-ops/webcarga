# Auditoría del Directorio (y su sincronía con Certificación, Cierre y Monitor) — plan

**Pedido del usuario (12/10):** auditar el Directorio y la parte de Empresas de Certificación, porque hay muchas
inconsistencias. Se repite el método de `2026-10-11-certification-audit.md`: cuatro lentes, una síntesis y,
recién después, la spec del primer bloque.

**Ya auditado, no se repite:** Sin clasificar (`2026-10-11-sin-clasificar-ux-audit.md`). Sus hallazgos se citan
en la síntesis cuando tocan al Directorio o a Empresas.

## 0. Alcance

- **Directorio:** `/dashboard/carriers`, `/dashboard/drivers`, `/dashboard/assets` y sus fichas.
- **Empresas de Certificación:** `/dashboard/compliance` y `/dashboard/compliance/[carrierId]` (la "segunda ficha"
  de empresa que el bloque 2 propone retirar).
- **Sincronía:** el Cierre (`/dashboard/operations/closures`) y el Monitor (`/dashboard/operations/monitor`)
  leen las mismas entidades. La pregunta central es si las cuatro superficies responden lo mismo a:
  - ¿la empresa, el conductor o el equipo está **activo**?
  - ¿el conductor o el equipo está **asignado**, y **a qué empresa**?
  - ¿está **habilitado para operar** (documentos)?
  - ¿cuál es su **origen habitual** y su **tipo de operación**?
  - después de editar algo en el Directorio, ¿las otras pantallas lo ven **sin recargar**?

## 1. Lentes

Cada hallazgo lleva: id, lente, evidencia (archivo:línea, consulta o captura), efecto para el usuario, causa
raíz y severidad (bloquea / confunde / costo interno). Un hallazgo sin evidencia no entra.

### Lente A — Trabajos y clics (copia local, Playwright)
Lista cerrada de trabajos, sacada de la voz del cliente (minutas, transcripciones de Granola, AGENTLOG):
crear empresa, conductor y equipo; asignar y desasignar; dar de baja y reactivar; corregir RUT o patente;
buscar; ver si opera; ver sus documentos; ver sus viajes; fijar origen habitual y tipo de operación.
Medir cada trabajo por cada camino que hoy existe (Directorio, Certificación › Empresas, Cierre, Monitor, vista
rápida), con clics, capas y campos, a 1440 y 390 px. Matriz trabajo × camino con los duplicados.
Comparación breve con el estándar del rubro (Samsara, Fleetio, Avetta) y heurísticas de Nielsen.

### Lente B — Dominio y datos (base real, solo SELECT parametrizado)
Inventario de cada definición de activo, asignado, empresa del conductor/equipo, habilitado y origen habitual,
en backend (routers, servicios, vistas, funciones SQL como `app.is_trip_open`/`app.is_trip_assigned`,
`trip_fleet_links`, `in_scope_sql`) y en frontend. Medir con SQL cuántas entidades clasifica distinto cada
definición frente a la canónica. Ninguna consulta recorre el padrón completo de forma pesada.

### Lente C — Arquitectura de código (API y frontend)
Endpoints por superficie, fichas y componentes duplicados, cálculos de estado repetidos, claves de React Query
y qué invalida cada mutación del Directorio (¿refresca Cierre, Monitor, Certificación, vista rápida?),
archivos de más de 400 líneas, tests que fijan un defecto.

### Síntesis
Mapa de "fuente de verdad por campo", arquitectura objetivo (una ficha por entidad o criterio explícito de qué
vive en cada una), 2-3 alternativas con costos y una recomendación, hoja de ruta en bloques desplegables y
preguntas para el cliente.

## 2. Reglas
- Solo lectura de punta a punta. Mage no se toca. Dev no se modifica.
- Toda afirmación con evidencia; cifras vivas con fecha.
- Sin datos personales reales en el informe (la copia local es ficticia; de la base real, solo conteos).
- Informe final: `docs/superpowers/plans/2026-10-12-directory-audit-findings.md`.
