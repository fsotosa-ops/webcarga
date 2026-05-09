# /smoke-test — E2E test de un job de extracción

Hace un smoke test completo: POST de un job y polling hasta done/failed.

El usuario puede indicar el TMS con `/smoke-test sodimac` (u otro source).
Si no especifica, usa `sodimac` por defecto.

## Pasos

**1. Verificar que el servidor esté corriendo:**
```bash
curl -s http://localhost:8080/api/v1/health | python3 -m json.tool
```
Si falla, indicar que debe correr `/start-dev` primero.

**2. POST del job** (adaptar source/client_name/fechas según lo que pida el usuario):
```bash
curl -s -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"source":"sodimac","product":"trips","client_name":"test","date_from":"2026-04-01","date_to":"2026-04-30"}' \
  | python3 -m json.tool
```

**3. Extraer job_id y hacer polling** (sustituir `{JOB_ID}` por el UUID recibido):
```bash
curl -s http://localhost:8080/api/v1/jobs/{JOB_ID} | python3 -m json.tool
```
Repetir cada 5-10 segundos hasta que `status` sea `done` o `failed`.

**4. Reportar resultado:**
- Si `done`: mostrar `result.local_path` y `result.gcs_uri`
- Si `failed`: mostrar `error` y sugerir revisar logs del servidor
