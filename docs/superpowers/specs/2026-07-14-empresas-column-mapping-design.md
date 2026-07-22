# Mapeo self-service de columnas nuevas del Excel EETT (diseño)

## Contexto

Desde que Checkpoint E entró en uso real, el parser (`centralizer_parser.py`) ya bloqueó dos uploads completos por columnas reales de producción no anticipadas ("ANEXO RepLeg (GC)", "Cuenta Banco Empresa") — ambas resueltas manualmente (mapeo en código + migración a `app.compliance_doc_catalog`). El diseño original del parser elige deliberadamente "fallar ruidoso, nunca ignorar en silencio" para evitar perder datos — pero eso significa que **cualquier columna nueva que alguien agregue al Excel compartido bloquea el archivo completo** hasta que un desarrollador intervenga.

El usuario pidió un mecanismo tipo "mapeo de columnas al importar CSV" (patrón conocido de Brevo/Mailchimp/HubSpot): cuando aparece una columna desconocida, se resuelve ahí mismo — sin bloquear el archivo completo y sin depender de un desarrollador para columnas de documento nuevas.

## Decisiones del brainstorm

1. **Bloquea antes del preview, no después**: al detectar columnas sin mapear, se muestra una pantalla de mapeo (estilo Brevo) ANTES de calcular el diff — no se genera ningún preview parcial con columnas ignoradas silenciosamente.
2. **Self-service total para documentos**: se puede crear un tipo de documento nuevo ahí mismo (código + etiqueta) sin necesitar una migración de desarrollador. Límite de alcance explícito: esto solo cubre columnas de **estado de documento** (OK/Pendiente/Factible/N/A — el patrón real de todas las columnas vistas hasta ahora, incluida "Cuenta Banco Empresa"). Un **campo nativo** genuinamente nuevo (no un documento) seguiría requiriendo desarrollador + migración de schema — eso no cambia con este diseño.
3. **Se recuerda automáticamente**: una vez resuelta (mapeada, creada, o ignorada), la decisión queda guardada — la pantalla de mapeo solo vuelve a aparecer para columnas realmente nunca vistas.
4. **Aplica a las 3 hojas** (Empresas/Conductores/Vehiculos_Equipos), no solo Empresas.
5. **Layout: lista/tabla, todas las columnas nuevas juntas** — un dropdown (mapear a existente) + botón "crear nuevo" + botón "ignorar" por fila, un solo botón de confirmar al final. Elegido sobre un wizard de-a-una por ser más rápido cuando aparece más de una columna nueva en la misma subida.
6. **Solo `admin` puede resolver el mapeo** (mismo nivel que aprobar/aplicar) — crear un doc_code nuevo toca `app.compliance_doc_catalog`, que afecta cálculos de elegibilidad de todas las empresas. `editor` sigue pudiendo subir el archivo; si su upload cae en `pending_mapping`, ve un mensaje de solo lectura ("esperando resolución de un admin"), no la tabla de resolución.

## Modelo de datos

Nueva tabla:
```sql
CREATE TABLE app.centralizer_column_mappings (
  sheet_name text NOT NULL CHECK (sheet_name IN ('Empresas', 'Conductores', 'Vehiculos_Equipos')),
  excel_header text NOT NULL,
  doc_code text,  -- NULL = "ignorar esta columna permanentemente"
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_name, excel_header)
);
```
No se toca `app.compliance_doc_catalog` — crear un doc_code nuevo reusa exactamente ese INSERT (mismo que ya se hizo manualmente para `anexo_repleg_gc`), con `entity_type` derivado de `sheet_name` (Empresas→transporter, Conductores→driver, Vehiculos_Equipos→vehicle).

## Backend

- `parse_centralizer_workbook` (o un paso previo) escanea headers de las 3 hojas contra el mapa combinado: dict estático de Python (`EMPRESAS_COLUMNS`/etc.) + filas de `centralizer_column_mappings` para esa hoja (una fila con `doc_code=NULL` se traduce al tipo `"ignore"` que `_parse_sheet_rows` ya soporta — no requiere cambios ahí). Headers que no aparecen en ninguno de los dos se recolectan como `unresolved_columns`, sin lanzar excepción todavía.
- `POST /centralizer-uploads`: si `unresolved_columns` no está vacío, crea el upload con `status='pending_mapping'` y responde `{upload_id, status, unresolved_columns: [{sheet, header}]}` — no calcula diff.
- Nuevo endpoint `POST /centralizer-uploads/{id}/column-mappings` (admin-only): recibe una lista de resoluciones `{sheet, header, action: "ignore"|"map"|"create", doc_code?, label?}`. Valida TODAS antes de aplicar ninguna (doc_code snake_case, no vacío, no ya existente para ese entity_type si `action="create"`). Aplica: `create` → INSERT en `compliance_doc_catalog` + INSERT en `centralizer_column_mappings`; `map` → INSERT en `centralizer_column_mappings` con el doc_code elegido; `ignore` → INSERT con `doc_code=NULL`. Luego re-descarga el archivo (mismo `storage_path` del upload original) y re-parsea con el mapa ya completo, transicionando a `previewed` con el diff normal.
- `GET /centralizer-uploads/{id}` ya devuelve `status`; para `pending_mapping` incluye `unresolved_columns` en vez de `diff`.

## Frontend

- Página de detalle (`app/dashboard/uploads/[id]/page.tsx`) gana una rama nueva para `status === 'pending_mapping'`: si `canAdmin`, muestra la tabla de resolución (una fila por columna: nombre + hoja, dropdown de doc_codes existentes para ese entity_type, botón "+ Nuevo tipo" que expande un mini-formulario código+etiqueta, botón "Ignorar"), botón "Confirmar y continuar" al final que llama al nuevo endpoint y refetchea. Si no es admin, mensaje de solo lectura.
- `lib/api/centralizerUploads.ts` gana el nuevo método; tipos nuevos para `unresolved_columns`/el body de resolución.

## Testing

- Backend: pre-check de headers no lanza y devuelve la lista correcta; endpoint de mapeo cubre `map`/`create`/`ignore` + validación de `create`; re-parseo post-mapeo produce el diff correcto; una segunda subida con el mismo header ya no cae en `pending_mapping`.
- Frontend: Vitest para la tabla de resolución (dropdown/crear/ignorar por fila, submit).
- Manual: subir archivo con columna nueva → pantalla de mapeo → resolver → diff aparece → resubir mismo header → confirma que ya no pregunta.

## Fuera de alcance

- Campos nativos nuevos (no-documento) — siguen requiriendo desarrollador + migración de schema.
- Editar/borrar mapeos ya guardados desde la UI (si una decisión fue un error, corregirlo hoy requiere acceso directo a la tabla) — no pedido, no se construye preventivamente.
