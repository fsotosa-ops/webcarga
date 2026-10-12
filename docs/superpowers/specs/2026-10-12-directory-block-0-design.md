# Directorio · Bloque 0: arreglos inmediatos de coherencia

**Estado:** spec aprobada por el usuario el 12/10.

**Origen:** auditoría del Directorio, `docs/superpowers/plans/2026-10-12-directory-audit-findings.md` (§5 bloque 0 y §7
decisiones). Alternativa B aprobada; este bloque va antes de D1 ("Una sola respuesta") y no rediseña nada: corta los
defectos que hoy engañan o bloquean.

---

## 1. Objetivo y criterio de éxito

- Ningún día del Cierre queda bloqueado por líneas que la tabla no muestra.
- Ningún botón responde "sin permiso" (403): cada uno se muestra según el mismo permiso que pide su endpoint.
- Un cambio hecho en el Directorio se ve sin recargar en Certificación, el Cierre (tras su recálculo, con aviso), el
  Monitor y la vista rápida.
- Ninguna asignación nueva toma la fecha en UTC.
- El pre-cierre no reescribe el nombre de un conductor.
- La flota de una empresa dada de baja se ve marcada como tal.

## 2. Decisiones que lo condicionan (usuario, 12/10)

| # | Decisión |
|---|---|
| D-a | Mage ya no escribe empresas, conductores, equipos ni asignaciones: los escritores son solo los de la app. |
| D-b | P1: dar de baja archiva, no oculta. La flota queda vinculada como historial y sale de las colas de trabajo. |
| D-c | P9: el nombre del conductor lo gestiona el Directorio; el TMS solo dice quién manejó cada viaje. |
| D-d | P5: el recálculo nunca borra hechos del viaje. P6: cada día se juzga con la empresa de ese día (llega en D2). |
| D-e | P2 → opción C: Operaciones (operador y supervisor) da de baja y reactiva conductores y equipos; la baja de una empresa es de Certificación (y del Propietario). |
| D-f | Operaciones no da de baja empresas: la "solicitud de baja de empresa" es un tipo de "Pedir a Certificación" y llega en el bloque 3. |
| D-g | Se entrega en dos despliegues, ordenados por efecto: primero lo que da datos falsos o bloquea; después la coherencia entre pantallas. |

## 3. Despliegue 1 — lo que hoy da datos falsos o bloquea

### 0.4 · El Cierre muestra lo mismo que cuenta la firma
- **Hoy:** `_LINES_SQL` y `_REPORT_SQL` de `app/routers/daily_closures.py` (~:75 y ~:170) hacen
  `JOIN active_roster`; la firma (`cierre_lineas.py` ~:603) cuenta todas las líneas del día. Medido el 11/10: 29 líneas
  de 14 conductores fuera del roster; 28 bloquean 4 días abiertos.
- **Cambio:** `LEFT JOIN active_roster` y una columna `in_roster boolean` en la línea (y en el reporte).
- **Pantalla:** las líneas con `in_roster = false` van en un grupo propio, **"Ya no están en el roster"**, arriba (porque
  bloquean), con las mismas acciones de resolución de siempre (motivo de no asignación). La tabla y la firma cuentan el
  mismo universo.
- **Transitorio:** hasta D2 no se sabe la empresa de cada día; con asignaciones con vigencia, las líneas de días
  anteriores a la salida dejarán de caer en este grupo (D-d).

### 0.1 · Fecha de Chile en las asignaciones
- Migración que cambia `DEFAULT CURRENT_DATE` por `DEFAULT public.hoy_chile()` en `start_date` de
  `public.driver_assignments`, `public.asset_assignments`, `public.vehicle_driver_assignments`,
  `public.carrier_shippers` y `public.carrier_fleet_service_types`.
- Solo cambia el default (metadato, sin reescribir la tabla). No toca filas existentes; corregir las viejas va en D2.

### 0.2 · Roster de conductores en vivo
- `list_carrier_drivers` (`app/routers/carriers.py` ~:710) deja de leer `app.carrier_driver_roster` (vista
  materializada sin trigger sobre `public.drivers`) y lee el nombre y el estado de `public.drivers` vía
  `driver_assignments` activa, igual que `list_carrier_assets`. Los conteos de documentos siguen viniendo de
  `app.driver_compliance_status`.
- Sin trigger ni `REFRESH` nuevos. Medido el 12/10 para la empresa con más conductores: vista 1,9 ms, en vivo 1,6 ms,
  ambas desde caché.

### 0.10 · El pre-cierre deja de renombrar conductores
- Se elimina la rama `c.renombres` del pre-cierre (`UPDATE public.drivers SET full_name …`) y lo que solo la alimenta.
- La reasignación de la empresa de un tracto y el vínculo de clientes del pre-cierre **no cambian** en este bloque
  (P11 y P10, abiertas; entran en D3).

## 4. Despliegue 2 — coherencia entre pantallas

### 0.3 · Permisos según D-e, y botones alineados
| Acción | Permiso | Roles |
|---|---|---|
| Dar de baja / reactivar **conductor o equipo** (`PATCH` de `operational_status`) | **`directory.fleet_status`** (nuevo) | Operador y Supervisor de Operaciones, Supervisor de Certificación (y el Propietario, que tiene todo) |
| Dar de baja / reactivar **empresa** (`PATCH` de `operational_status` de `carriers`) | `directory.delete` | Supervisor de Certificación, Propietario |
| "Quitar del roster" (terminar la asignación) | `directory.edit` (antes `directory.delete`) | Supervisores de Operaciones y de Certificación |
| Resto de campos de empresa, conductor y equipo | `directory.edit` (sin cambio) | Supervisores |
| Borrado real de empresa y contactos | `directory.delete` (sin cambio) | Supervisor de Certificación, Propietario |

- El permiso nuevo entra por el catálogo y la sincronización de RBAC (`app/authz/permissions.py`, `sync.py`), con el
  patrón del 10/10. Se actualiza la descripción de `directory.delete` en el catálogo para que diga lo que cubre.
- Un `PATCH` que mezcla `operational_status` con otros campos exige ambos permisos.
- **Frontend:** cada botón usa el mismo permiso que su endpoint. En la ficha de una empresa, quien no tiene
  `directory.delete` ve "La baja de una empresa la hace Certificación" en lugar del botón.

### 0.5 · Refresco entre módulos
- **Una fábrica de claves y una función:** `lib/queries/directorio.ts` con las claves de empresa, conductor y equipo, y
  `invalidateDirectory(qc, change)`, donde `change` describe la entidad y el tipo de cambio (incluida la empresa destino
  de una transferencia).
- **La llaman todas las mutaciones** que tocan empresas, conductores o equipos, desde el Directorio, Certificación, el
  Cierre y el Monitor, en lugar de su lista propia de claves.
- **Invalida solo lo afectado:** las claves de la entidad; la lista y los conteos del Directorio (`carriers`,
  `carriers-count`, `carriers-directorio`); las raíces de Certificación; `['entity-summary', kind, id]`; las
  disponibilidades del Monitor (`available-drivers`, `available-assets`); en una transferencia, los rosters de origen y
  destino.
- **El Cierre se marca viejo sin releer de inmediato** (`refetchType: 'none'`): el servidor recalcula en ~1 minuto y
  una relectura inmediata leería la foto anterior. Lo cubre 0.6.
- **Consumo:** sin sondeos nuevos; React Query relee solo lo montado.
- Se unifican `['carrier-detail', id]` y `['carriers','detail', id]` en una sola clave.

### 0.6 · Aviso de frescura en el Cierre
- `equipment-closures` y `cierre-viajes` reciben lo que ya tiene `daily-closure`: `AvisoDeActualizacion` y relectura
  cada 15 s **solo mientras el día tiene un recálculo pendiente**. Si sus endpoints no exponen la marca de pendiente,
  se agrega a su respuesta con la misma fuente que usa `daily-closure`.
- Guardar en el Directorio un cambio que afecta al Cierre muestra "El Cierre se actualizará en alrededor de un minuto".

### 0.7 · Red mínima
- Confirmación antes de "Quitar del roster".
- Aviso de éxito al transferir.
- Un solo diccionario de estados en `lib/types.ts`, con concordancia: "Dada de baja" (empresa), "Dado de baja"
  (conductor, equipo). Se retira "Inactiva" (`TransporterCard.tsx`).

### 0.9 · Flota de una empresa dada de baja, marcada
- Tarjetas del Directorio, vista rápida y búsqueda de conductores del Monitor muestran "Empresa dada de baja" junto a
  conductores y equipos cuya empresa está dada de baja. La vista rápida deja de decir "Activo" en ese caso.
- `entity-summary` y la búsqueda devuelven el estado de la empresa (campo de un `JOIN` que ya hacen).

### 0.8 · Sin clasificar: H2 y H4
- H2: un error de la cola se muestra como error (`Estado tipo="error"` y "Reintentar"), nunca como
  "0 sin clasificar · No hay documentos" (`TriageWorkbench.tsx` ~:544).
- H4: mientras carga se ven esqueletos, nunca "no tiene pendientes".

## 5. Fuera de alcance
- Asignaciones con vigencia, corrección de asignaciones viejas, empresa del día en el Cierre (D2).
- Funciones canónicas `is_operating` / `carrier_of` y migración de lectores (D1).
- Override por campo, corrección de RUT/patente, edición de clientes, reasignación de tractos del pre-cierre (D3).
- Solicitud de baja de empresa desde Operaciones (bloque 3 de Certificación).
- `REFRESH` selectivo de vistas materializadas (D5).
- Mage no se toca.

## 6. Pruebas y verificación
- Cada test nuevo se ve fallar antes de implementar. Los de datos van contra la base real con `conexion_revertida`,
  sujetos `ZZ-TEST-DIRECTORIO`, sin depender de datos de producción.
- **0.4:** un conductor fuera del roster con una línea en un día abierto aparece en la tabla con `in_roster = false`, y
  la cantidad de líneas de la tabla es igual a la que cuenta la firma.
- **0.1:** una asignación insertada sin `start_date` toma `hoy_chile()` (test con la hora simulada después de las 21:00).
- **0.2:** renombrar un conductor se ve en `GET /carriers/{id}/drivers` sin refrescar ninguna vista.
- **0.10:** el pre-cierre con un nombre distinto en el TMS no cambia `drivers.full_name`.
- **0.3:** un test por endpoint (403 / 200 según rol) y por botón (visible según el mismo permiso);
  `test_toda_ruta_declara_permiso.py` en verde.
- **0.5:** test que compara, por mutación, las claves que invalida `invalidateDirectory` con las que leen las
  pantallas afectadas (una pantalla nueva sin cubrir hace fallar el test).
- **0.6, 0.7, 0.8, 0.9:** tests de componente de los estados y textos; trinquetes `lib/ui` y `lib/copy`.
- **Recorrido en la copia local:** editar en el Directorio y ver el cambio sin recargar en Certificación, el Cierre (tras
  el aviso), el Monitor y la vista rápida; como `ops@sim.local`, ningún botón responde 403.
- **En dev, tras el despliegue 1:** contar los días bloqueados por líneas fuera del roster; se espera que las 28 líneas
  se vean y se puedan resolver.
- Suite del área y build al final de cada despliegue (se toca código compartido). Despliegue a dev; nada a `main`.

## 7. Reglas transversales
- Nombres nuevos en inglés; interfaz en español neutral, sin voseo ni emojis (solo lucide-react).
- Solo tokens y primitivas del sistema visual.
- Ningún trigger ni `REFRESH` nuevo.
- Commits con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## 8. Nota sobre roles
El rol "Administración" (`admin`) no tiene hoy permisos de edición del Directorio: gestiona personas, roles y
configuración. Solo el Propietario (`owner`, `grants_all`) los tiene todos. Este bloque no cambia eso.

Configuración medida el 12/10 (solo conteos): las 2 personas con `admin` tienen además los cuatro roles de supervisor,
así que ya editan, dan de baja y borran en el Directorio; las 6 personas con algún supervisor tienen los cuatro. Con este
bloque solo ganan permisos los 4 Operadores de Operaciones (`directory.fleet_status`). **Decisión del usuario:** el rol
`admin` queda sin cambios. Revisar el reparto de roles de supervisor es una decisión de negocio fuera de este bloque.

**Spec aprobada por el usuario el 12/10.**
