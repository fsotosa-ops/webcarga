# Auto-fetch del Excel EETT desde SharePoint (diseño)

## Contexto

Descargar manualmente el Excel desde SharePoint y volver a subirlo a la app causó confusión real esta sesión (archivo desactualizado, incertidumbre sobre cuál era la versión "real", dificultad para depurar contra el archivo correcto). El usuario propuso conectar SharePoint directamente — se descartó la opción de automatizar también la aprobación (eso reabriría exactamente la razón por la que se reemplazó el pipeline viejo de Mage/"Claudote" el 2026-07-12: "no se quiere conectar ciegamente"), pero automatizar solo la **búsqueda/lectura** del archivo, manteniendo preview/diff/aprobación admin/aplicar exactamente igual que hoy, sí tiene sentido y no reabre ese riesgo.

Durante el brainstorm se encontraron dos scripts de Mage (`monitor-app/docs/sharepoint_eett.py`, `vehicle_insurances.py`) que ya hacían este fetch para el pipeline viejo (ahora congelado) — confirman la ruta exacta y canónica del archivo, y traen credenciales de Graph API (Azure AD app registration) con los permisos ya otorgados sobre el sitio.

**Hallazgo de seguridad, fuera del alcance de este spec pero real**: esas credenciales están en texto plano en `monitor-app/docs/sharepoint_eett.py`/`vehicle_insurances.py` (gitignorado, nunca llegó a GitHub, pero expuesto en disco). Se reusan tal cual (decisión del usuario) pero cargadas a GCP Secret Manager — recomendado rotar el secret en Azure AD en algún momento dado que ya estuvo expuesto, pero no es parte de esta implementación.

## Decisiones del brainstorm

1. **Solo se automatiza el fetch, no la aprobación** — preview/diff/aprobación admin/aplicar quedan exactamente iguales. Esto es aditivo, no reemplaza el gate humano.
2. **Reemplaza completamente la subida de archivo local** en el modal — no queda un dropzone de respaldo. Ruta fija y conocida (`sites/webcarga.com` → `General/Documentos Reclutamiento EETT/01 -Status General de EETT/Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx`), no hay razón para pedir un archivo si siempre es el mismo.
3. **Credenciales**: mismo app registration ya usado por el pipeline viejo (mismos permisos ya otorgados, sin trámite de consentimiento nuevo) — cargadas a GCP Secret Manager en vez de vivir en texto plano.
4. **Backend**: el endpoint `POST /centralizer-uploads` mantiene `file` como parámetro **opcional** (no uno nuevo) — si se omite, hace el fetch desde SharePoint internamente antes de seguir exactamente el mismo camino de siempre (Storage, parseo, columnas sin resolver, diff). Esto evita duplicar toda la lógica downstream en un endpoint aparte, y mantiene testeable el flujo con un archivo directo sin mockear Graph API en cada test.
5. **Reusable para Checkpoint F**: el helper de fetch se construye genérico (site+path como parámetros), no hardcodeado al archivo de Empresas — Seguros lo puede reusar después sin reescribirlo.

## Backend

- `config.py`: `sharepoint_client_id`, `sharepoint_client_secret`, `sharepoint_tenant_id` (default `""`, mismo patrón que `upstash_redis_rest_url`/`token` — no rompe dev/tests si no están seteadas).
- `app/utils/sharepoint_client.py` (nuevo): `fetch_sharepoint_file(site_path: str, file_path: str) -> bytes` — replica el flujo de `sharepoint_eett.py`: `POST` a `login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token` (client_credentials) → `GET` al site de Graph API para resolver `site_id` → `GET` al `download_url` (`.../drive/root:/{file_path}:/content`). Lanza una excepción clara (capturada por el router como 502) si cualquier paso falla — igual que el patrón ya usado para fallos de Storage.
- `routers/centralizer_uploads.py::upload_and_preview`: `file: UploadFile = File(None)` (antes requerido). Si `file` es `None`, llama a `fetch_sharepoint_file(SHAREPOINT_EETT_SITE, SHAREPOINT_EETT_PATH)` (constantes con la ruta canónica) para obtener `raw`, y construye un `UploadFile` real (no un wrapper artificial — es el mismo tipo que FastAPI ya inyecta para uploads normales):
  ```python
  from starlette.datastructures import Headers
  file = UploadFile(
      file=io.BytesIO(raw), filename="Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx",
      headers=Headers({"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
  )
  ```
  El `content-type` explícito es necesario — `upload_document_version` valida `file.content_type` contra `ALLOWED_STORED_FILE_MIMES`, y sin `headers` ese valor queda vacío y la subida se rechazaría con 422. Con esto, `upload_document_version` no necesita cambiar. El resto de la función (parseo, `find_unresolved_columns`, diff) no cambia.

## Frontend

- `CentralizerUploadModal.tsx`: se elimina el dropzone/input de archivo. Un solo paso: botón "Traer archivo actual desde SharePoint" → llama a `centralizerUploadsApi.upload()` (sin argumento) → mismo manejo de resultado que hoy (summary o redirect a `pending_mapping`). Loading state mientras dura el fetch real (puede tardar unos segundos).
- `lib/api/centralizerUploads.ts`: `upload()` pasa a no recibir `file`, hace `POST` con body vacío (sin `FormData`).

## Testing

- Backend: nuevo test que mockea `fetch_sharepoint_file` (no llamadas de red reales) y confirma que `file=None` dispara el fetch; tests existentes que pasan `file` directo siguen funcionando sin cambios (cubren el resto del pipeline sin necesidad de mockear Graph API en cada uno).
- Frontend: actualizar `CentralizerUploadModal.test.tsx` — ya no simula selección de archivo, simula click en el botón de fetch.

## Fuera de alcance

- Rotar el secret de Azure AD expuesto (recomendado, pero es una acción del usuario en el portal de Azure, no código).
- Aplicar este mismo patrón a Seguros (Checkpoint F) — el helper queda listo para reusar, pero no se conecta todavía.
- Scheduling/webhooks automáticos — el fetch sigue siendo disparado por un clic del usuario (`editor`+), no hay polling ni trigger automático.
