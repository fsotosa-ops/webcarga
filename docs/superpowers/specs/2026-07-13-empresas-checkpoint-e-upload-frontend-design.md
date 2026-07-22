# Checkpoint E — Frontend del upload EETT (diseño)

## Contexto

Checkpoint D (`centralizer_parser.py` + `centralizer_diff.py` + `routers/centralizer_uploads.py`) ya está completo y pusheado: parsea el Excel EETT de 3 hojas, calcula diff en memoria contra `app.transporters`/`drivers`/`vehicles`, y expone 6 endpoints (subir+preview, listar, detalle, aprobar, rechazar, aplicar). Hoy no existe frontend — el único consumidor sería `curl`/Postman.

El objetivo explícito (confirmado por el usuario) no es un parche temporal: es establecer **el estándar** con el que se gestionan/crean/habilitan empresas — y el mismo patrón debe poder reutilizarse para Seguros (Checkpoint F) más adelante. Para Empresas, este flujo es un puente razonable durante la migración desde la cultura de Excel/SharePoint hacia la app como fuente de verdad — las protecciones ya construidas en Checkpoint D (`manually_edited_fields`, `baja_override`) existen justamente para que edición-en-app y reconciliación periódica por Excel convivan sin pisarse, así que ese trabajo no se tira aunque el frontend evolucione. Para Seguros, el origen (aseguradoras externas) hace que el upload+reconciliación sea probablemente el mecanismo permanente, no transitorio.

**Decisión de alcance**: construir la versión más delgada que resuelve el riesgo real (evitar corrupción de datos de compliance por sync ciego), sin pulir de más — mismo criterio que ya se aplicó al rechazar el modelo relacional de 13 commits en Checkpoint A.

## Decisiones de arquitectura (del brainstorm)

1. **Modal chico + página completa**, no todo-en-un-modal: el modal de `CentralizerUploadModal.tsx` solo sube y muestra el resumen inmediato (`sheet_summary`/`parse_errors`); revisar el diff completo, aprobar/rechazar/aplicar vive en una página propia con URL (`/dashboard/uploads/[id]`), porque el backend ya soporta revisión asíncrona (subir hoy, aprobar mañana, por otra persona) vía roles separados (`editor` sube, `admin` aprueba/aplica) y endpoints de lista/detalle ya persistidos.
2. **Historial de uploads como página compartida y top-level** (`/dashboard/uploads`, no anidada bajo Empresas): dado que Seguros va a reusar el mismo estándar, la lista/chrome (header, chips, action bar, drawer de motivo de rechazo) se diseñan genéricos sobre `upload_kind`, y solo el cuerpo del diff (agrupado por Empresas/Conductores/Vehículos) es específico del shape de centralizer. Cuando exista Checkpoint F, se conecta un cuerpo de diff propio para `upload_kind='insurance'` sin reestructurar el resto.
3. **Filas "sin cambios" ocultas por defecto**, solo un contador — con ~2800 entidades, la mayoría no cambia; el foco va a Nuevas/Modificadas/Conflictos.
4. **Diff campo-por-campo, expandible, en tarjetas** (no filas de tabla) — cada tarjeta expandible muestra valor viejo → nuevo por campo, con los campos en conflicto (protegidos por edición manual) marcados aparte y explícitamente excluidos de lo que se va a aplicar.
5. **Barra de acciones sticky abajo**, solo visible para `admin` y solo el botón que corresponde al `status` actual (Aprobar/Rechazar en `previewed`, Aplicar en `approved`).

## Hallazgo que amplía el alcance de backend

`GET /centralizer-uploads/{id}` hoy solo devuelve la fila cruda de `app.centralizer_uploads` — el diff nunca se persiste, así que no hay forma de volver a verlo en una revisión asíncrona sin recalcularlo. Se agrega:
- Recomputar el diff en `GET /centralizer-uploads/{id}` (re-descarga de Storage + re-parseo + `compute_diff`, mismo patrón que ya usa `apply`, sin lock/transacción por ser de solo lectura). Consistente con la filosofía ya establecida ("el diff nunca se persiste"); el costo de recalcular en cada visita es aceptable al volumen actual (~2800 filas).
- `uploaded_by`/`approved_by`/`rejected_by` pasan de UUID crudo a `LEFT JOIN public.profiles` (mismo patrón que `edited_by` en `trips.py`) para mostrar nombre en vez de UUID.

## Componentes y páginas

- **`app/dashboard/uploads/page.tsx`** (nueva) — tabla: archivo, fecha, subido por, estado (badge), botón "+ Subir Excel EETT" (abre el modal). Click en fila → `uploads/[id]`.
- **`components/dashboard/CentralizerUploadModal.tsx`** (nuevo) — dropzone (mismo patrón visual que `TripBulkUpload.tsx`, solo acepta `.xlsx`), sube vía `POST /centralizer-uploads`, muestra `sheet_summary`/`parse_errors` de inmediato, botón "Ver diff completo" → navega a `uploads/[id]`. Un 422 (columna no mapeada) se muestra igual que el error de archivo en `TripBulkUpload`.
- **`app/dashboard/uploads/[id]/page.tsx`** (nueva) — fetch de `GET /centralizer-uploads/{id}` (con diff). Header (archivo/estado/quién subió) + chips resumen (Nuevas/Modificadas/Conflictos accionables; Sin cambios/Errores como contadores mudos) + tabs (Nuevas/Modificadas/Conflictos/Errores) + dentro de cada tab, secciones por Empresas/Conductores/Vehículos con tarjetas expandibles. Tab Errores lista `parse_errors` (hoja/identificador/motivo), solo lectura. Barra sticky abajo con Aprobar/Rechazar/Aplicar según `status` + rol; Rechazar expande un textarea inline para el motivo (`POST .../reject`).
- **`lib/api/centralizerUploads.ts`** (nuevo) — cliente delgado para los 6 endpoints, mismo patrón que `lib/api/trips.ts`.

## Estados y comportamiento por `status`

| status | Diff visible | Acciones (admin) |
|---|---|---|
| `failed` | No — solo `parse_errors[0].reason` | ninguna |
| `previewed` | Sí, recalculado | Aprobar / Rechazar |
| `approved` | Sí, recalculado | Aplicar / Rechazar |
| `applied` | Sí, recalculado (todo aparece `unchanged` porque ya se aplicó — comportamiento esperado, no bug) | ninguna |
| `rejected` | Sí, recalculado, + `rejection_reason` visible | ninguna |

Un usuario sin rol `admin` (p.ej. `editor` que subió el archivo) ve la página en modo solo-lectura, sin la barra de acciones.

Tras cualquier acción (Aprobar/Rechazar/Aplicar) exitosa, la página refetchea `GET /centralizer-uploads/{id}` completo (no actualización optimista) — el nuevo `status` determina qué acciones se muestran a continuación, siguiendo la tabla de arriba.

## Manejo de errores

- Extensión de archivo inválida se rechaza en el cliente antes de llamar a la API (igual que `TripBulkUpload` con `.csv`).
- 409 de `apply` (otro admin ya aplicó, o ya se aplicó dos veces) se muestra como "otro admin ya lo aplicó, refresca la página".
- 502 de descarga de Storage (en `apply` o en el nuevo recálculo de `GET`) se muestra como error de página, no como crash.

## Testing

- Vitest: `CentralizerUploadModal` (dropzone → resumen → navegación) y el renderer del cuerpo del diff (agrupación por bucket/entidad, expandir/colapsar, estilo de conflicto) — usando la forma de datos de `tests/fixtures/centralizer_sample.xlsx`, sin PII real.
- Backend: tests nuevos para el diff-on-GET y el join a `profiles`.
- Playwright smoke E2E con `centralizer_sample.xlsx`: subir → preview → aprobar → aplicar, confirmando barra sticky y buckets.

## Fuera de alcance (explícitamente, YAGNI)

- Paginación/virtualización más allá de lo que ~2800 filas necesitan hoy (sin infra genérica "por si crece").
- Cuerpo de diff para `upload_kind='insurance'` (Checkpoint F) — se deja el punto de extensión, no la implementación.
- Selector de tipo de upload en el modal — hoy solo existe `centralizer`, así que el modal no necesita elegir "kind".
