# Ajustes post weekly 20260720 (v2) — diseño y diagnóstico

**Fecha**: 2026-07-22
**Fuente**: `monitor-app/docs/user-stories/20260720/refinamiento-weekly-20260720-v2.md` — feedback del usuario tras usar la app real en producción, 8 ítems.

Este documento no es un brainstorming clásico de un solo tema — son 8 hallazgos reportados por el usuario sobre distintas partes de la app, cada uno investigado en el código real antes de proponer una solución (no se adivina ningún fix). Cada sección deja claro qué está confirmado, qué es hipótesis y qué requiere una decisión del usuario que no está cerrada todavía.

---

## Ítem 1 — Seguros: no se pueden crear pólizas / algunos usuarios no pueden subir documentación

### 1a. Crear pólizas — CONFIRMADO, bug real

`InsurancePolicyModal.tsx`, función `handleAddPolicy` (línea ~322): a diferencia de su función hermana `handleGenerateSchedule` (justo arriba, con `try/catch/setScheduleErr`), `handleAddPolicy` **no tiene manejo de errores** — si `carriersApi.createPolicy(...)` falla (403 por rol, 422 por validación, 500, red), la excepción se propaga sin capturar. El `finally` sigue ejecutando `setAddingPolicy(false)`, pero como el `throw` ocurre antes de `setPolicyForm(...)`/`setAddPolicyOpen(false)`/la invalidación de la query, el usuario ve: el botón vuelve a su estado normal, el modal no se cierra, no aparece ningún mensaje — la póliza nunca se crea y no hay ninguna señal de por qué.

**Fix**: envolver en `try/catch`, agregar un estado de error (mismo patrón que `scheduleErr`) y mostrarlo en el formulario.

### 1b. Subir documentación — DOS HIPÓTESIS, requiere confirmación del usuario

El flujo de subida (`TransporterDocumentsPanel.tsx`, `handleUpload`) sí tiene manejo de errores correcto (`try/catch/setErr`, renderizado en línea 225) — a diferencia de 1a, esto no es un bug de silencio. Dos causas reales y verificadas en el código que podrían explicar el reporte:

- **RBAC**: el botón de subida solo se renderiza si `canEdit === true` (gateado por rol en la página padre). Si los usuarios afectados tienen rol `viewer` (no `editor`/`admin`), **no ven ningún control de subida** — para ellos, "no puedo subir documentación" describe exactamente lo que ven (nada), sin ningún error de por medio.
- **Límite de 7MB**: bajado de 10MB a 7MB en Fase 0 (pedido explícito de Pablo, para forzar compresión de fotos de celular). El backend sí devuelve un mensaje claro (`"{file} supera 7MB — comprimí el archivo antes de subirlo"`) y el frontend sí lo muestra — pero si el mensaje no queda visible/claro en la práctica (ej. se pierde scrolleando, o el usuario no lo lee), se percibe igual como "no puedo subir".

**Necesito confirmar con el usuario**: ¿qué rol tienen los usuarios que reportan el problema? Eso determina si el fix es de permisos o de UX del mensaje de error — son cambios distintos.

---

## Ítem 2 — Badges de compliance ambiguos en el Diario (tabla + bitácora)

El mockup de Figma "Listado de Recursos" (`node-id=35-15699`) confirma el patrón correcto: una columna de texto **etiquetada explícitamente** "ESTADO CERTIFICACIÓN" (COMPLETO / PENDIENTE / PRÓXIMO A VENCER) junto a la patente — no un badge de color ambiguo sin contexto.

**Decisión**: en `TripTable.tsx` y `TripSlideOver.tsx`, los `PendingDocsBadge` (conductor/tracto/empresa, agregados en Ronda 40) necesitan una etiqueta de texto visible indicando a qué entidad corresponden — no alcanza con la posición relativa al nombre. Aplican el mismo criterio `InsuranceAlertBadge`. Tratamiento exacto (tooltip vs. label inline vs. columna separada) se resuelve en la Fase de implementación, no es una decisión abierta de fondo — el criterio ya está claro: **nunca un badge sin identificar de qué documentación habla**.

---

## Ítem 3 — Columnas fijas de la tabla del Diario esconden columnas detrás de "Estado"

Bug de layout confirmado por inspección: `TripTable.tsx` tiene 3 columnas `sticky` (`left-0` Patente, `right-[90px]` Estado, `right-0` chevron) sobre una tabla ancha (`minWidth: 1080`) con scroll horizontal — con varias columnas fijas compitiendo por espacio, es fácil que el usuario no note que hay más contenido a la derecha/izquierda sin scrollear. Necesita una señal visual de scroll disponible (sombra/gradiente en el borde, o un indicador) — tratamiento exacto a definir en implementación, el problema en sí no tiene ambigüedad.

---

## Ítem 4 — Modal "Cerrar el día" no interactivo

**Confirmado**: en `CloseDayDialog.tsx`, la fila con estado `MISMATCH` ("Por regularizar") muestra:
```tsx
<span className="text-[11px] text-red-500 flex items-center gap-1">
  <AlertTriangle size={11} /> Revisar en Empresas
</span>
```
Es texto estático, no un link ni un botón — le dice al usuario qué hacer sin darle manera de hacerlo desde ahí. Mismo problema estructural que el resto del modal: es una vista de solo lectura con una sola acción real (cerrar el día), sin poder navegar a resolver cada fila pendiente.

**Fix**: "Revisar en Empresas" pasa a ser un link real (`<a href="/dashboard/transportistas/empresa/{carrier_id}">` o al conductor específico si hay una ruta better-suited) — igual que ya hicimos en Fase 3 con "Sin coincidencias — dar de alta en Empresas" en `TripSlideOver.tsx`. El resto de la interactividad del modal (filas de conductor con motivo de no-asignación) ya es funcional — el gap reportado es específicamente el caso MISMATCH.

---

## Ítem 5 — Flujo de "conductores disponibles" (aprobado, ver conversación previa)

**Root cause confirmado contra datos reales**: `available_drivers`/`available_assets` (`trips.py:772-900`) calculan "tiene viaje hoy" mirando solo `trip_fleet_links.driver_id`/`tractor_asset_id` — sin la cadena de resolución en vivo (`d_auto` vía `vehicle_driver_assignments`, match exacto de nombre) que `_TRIP_FROM` y `daily_closures.py` ya usan. Es la 4ª vez que este mismo patrón de bug aparece (después de `_TRIP_FROM`, `available_drivers` original, y el fix de Ronda 38 en `daily_closures.py`) — confirma que ya no conviene seguir parchando cada copia por separado.

**Nomenclatura real de Pablo** (investigado en `transcript-meeting.md`/`notes-meeting.md`, no es una inversión driver→vehículo — esa lectura literal del ítem 5 original no está respaldada por la fuente):
- Conductor y tracto se validan **como par**, ambos bajo la misma empresa — no hay un "ganador" entre los dos.
- El término real para un par sin cruce es **"Equipo OVNI"** (`transcript-meeting.md` línea 605) — hoy la app usa "Por regularizar"/`UNMATCHED`, nunca "Equipo OVNI".
- "Favorito" (nombre favorito, conductor favorito) es un patrón de Pablo que en la fuente real solo aparece para locales/Tarifario — el Figma lo extiende a `CONDUCTOR FAVORITO`/`PATENTE TRAILER FAVORITO` en Recursos, pero no es una cita textual de Pablo sobre conductores.

**Alcance aprobado por el usuario**:
1. Aplicar la cadena de resolución completa a `today_trips` en `available_drivers`/`available_assets`.
2. Consolidar la cadena de resolución (hoy duplicada en 4 lugares) en una vista o función SQL compartida — la duplicación es la causa raíz de que este bug siga reapareciendo.
3. Adoptar **"Equipo OVNI"** como término visible donde corresponda a un par conductor/tracto sin cruce (reemplaza "Por regularizar" en ese caso específico — a definir en implementación si aplica también al enum interno o solo al label, mismo criterio que el rename anterior de "Mismatch").

---

## Ítem 6 — Alertas/badges y Reportería alineados a los mockups de Figma

4 mockups revisados (archivo Figma `NW7aAqbiCxML2HLd8uMTzf`):

| node-id | Nombre | Contenido relevante |
|---|---|---|
| `19-17067` | gestor-de-viajes (home) | Dashboard genérico con cards de conteo (viajes en ruta/asignados/con incidentes/etc.) — bajo detalle, mockup temprano/plantilla |
| `24-18435` | reportes_conductores | Tabla "Reportes de Conductores Operativos": Conductor, EETT, Patente Tracto, Trabajando, Estado Conductor, Estado Viaje, **GC Habilitado** (selector), Locales Asignados, Acción — exportable a XML |
| `25-9068` | viajes_adjudicados | Tabla "Listado de Viajes": GC, Tipo de Servicio, OCA, ID Envío, Título Envío (Origen-Destino), Tipo de Publicación, Fecha Retiro, EETT, Conductor, Patente, Estado Viaje, Acción |
| `35-15699` | recursos_conductores | Tabla "Listado de Recursos" (Equipos), tabs Habilitados/Deshabilitados/No Activos: Patente Tracto, **Estado Certificación** (texto, no badge), EETT, GC Habilitado, Fecha, Estado Equipo (dropdown), Patente Trailer Favorito, Conductor Favorito, Estado Viaje, Locales Asignados, Acción |

**Decisión concreta ya tomada** (informa el Ítem 2): la columna "Estado Certificación" con texto explícito, no un badge ambiguo — ya incorporada arriba.

**Abierto, no resuelto en esta sesión**: replicar la Reportería completa como estas tablas (con export XML, tabs Habilitados/Deshabilitados/No Activos, selector "GC Habilitado" editable inline) es un rediseño real de `/dashboard/diario/reporteria` (hoy un motor de pivot genérico construido en Fase Cerrar-el-día/Reportería) — decidir si el pivot actual se reemplaza por estas tablas planas específicas, o coexisten, requiere una sesión de brainstorming propia dado el tamaño del cambio. **No se incluye en el plan de implementación de este documento** — queda como siguiente paso explícito.

---

## Ítem 7 — Tarifario: rediseño de UI tipo SaaS

`TarifarioPage` (recién construida en Fase 5) clona el patrón de Configuración → Locales (un `<select>`, tabla HTML simple, "+ Nuevo local" al final) — funcional pero visualmente/interactivamente desalineado del resto de la app. Feedback explícito: necesita paginación y filtros como el Diario, y el botón de creación no puede estar al final de la página (carga cognitiva).

**Decisión**: alinear con el patrón real de `DiarioPage`/`TripTable`:
- Header con acción primaria ("+ Nuevo local") arriba, no abajo — mismo lugar que "Nuevo viaje"/"Cargar CSV" en el Diario.
- Filtro de búsqueda por nombre/N° de local (el backend `GET /locations` ya soporta `?q=`, no usado hoy en Tarifario).
- Paginación — hoy `GET /locations` no pagina (devuelve todo); dado que el volumen real es bajo (259 locales incompletos totales, generadores de carga individuales tienen decenas, no miles), evaluar si conviene paginación real en backend o alcanza con una tabla client-side más pulida visualmente (sticky header, densidad, hover states) sin folios de paginación de servidor — **a definir en implementación** según el volumen real por generador de carga (verificar contra datos antes de decidir).

---

## Ítem 8 — Retirar "Locales" de Configuración

**Depende del Ítem 7**: una vez que `TarifarioPage` cubra el set completo de campos que hoy tiene `locales-tab.tsx` (nombre, N° local, formato, dirección, región, clasificación RM/Zona Cero, activo/inactivo) — no solo tarifa/vigencia — recién ahí se puede retirar la pestaña de Configuración sin perder funcionalidad. `LocationCreateForm.tsx` (extraído en Fase 5) ya es compartido entre ambas pantallas, así que la migración de campos es aditiva sobre `TarifarioPage`, no requiere tocar el componente de creación.

---

## Resumen de alcance para el plan de implementación

**Incluido** (bugs confirmados + fixes acotados, sin preguntas de diseño abiertas):
- 1a (bug de manejo de errores en crear póliza)
- 2 (etiquetar badges por entidad)
- 3 (indicador de scroll en columnas fijas)
- 4 (link real en "Revisar en Empresas")
- 5 (resolución en vivo + consolidación + "Equipo OVNI") — alcance ya aprobado
- 7 (rediseño de Tarifario)
- 8 (retiro de Locales, depende de 7)

**Requiere una respuesta del usuario antes de codear** (no se puede resolver por inspección de código):
- 1b — rol de los usuarios afectados por la subida de documentos

**Fuera de este plan, es su propio brainstorming**:
- 6 — rediseño completo de Reportería según los mockups de Figma (export XML, tabs, tablas planas por dominio)
