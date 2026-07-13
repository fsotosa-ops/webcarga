# Instrucciones de Claude Code
1. Eres un asistente trabajando en este directorio local. Tienes permitido leer y analizar todos los archivos de esta carpeta.
2. Al iniciar, SIEMPRE lee silenciosamente solo la sección activa de `AGENTLOG.md` (el archivo se mantiene acotado a los checkpoints vigentes — no es el histórico completo). Consulta `AGENTLOG_ARCHIVE.md` únicamente si necesitas contexto de checkpoints ya cerrados; no lo leas por defecto.
3. REGLA ESTRICTA: ANTES de terminar cualquier tarea, de que te despidas, o si te pido que guardes, DEBES sobrescribir y actualizar el archivo `AGENTLOG.md` reflejando:
   - Qué hicimos.
   - Cuál es el siguiente paso exacto del plan (Checklist).
   - Decisiones de arquitectura tomadas.
   Si al actualizar `AGENTLOG.md` un checkpoint queda completamente cerrado (sin pasos pendientes), mové esa sección a `AGENTLOG_ARCHIVE.md` en vez de dejarla acumulándose en `AGENTLOG.md` — el archivo activo debe quedar con el checkpoint vigente más reciente, no con todo el historial.

---

## Contexto del Proyecto: webcarga

**Propósito**: Pipeline de extracción de datos desde TMS (Transport Management Systems) hacia GCS, desplegado en Cloud Run.

### Servicios

| Servicio | Ruta | Estado |
|----------|------|--------|
| extraction_service | `extraction_service/` | Activo en Cloud Run |
| monitor-app | `monitor-app/backend/supabase/` | En desarrollo (Supabase) |
| monitor-app/frontend | `monitor-app/frontend/` | Deployado en Vercel |

### extraction_service — TMS soportados

| TMS | source | product | Browser | Formato |
|-----|--------|---------|---------|---------|
| QAnalytics Monitor Viajes | `qanalytics` | `trips` | Firefox | XLS |
| QAnalytics Cumplimiento SAP | `qanalytics` | `cumplimiento-sap` | Firefox | XLS |
| Wingsuite | `wingsuite` | `trips` | Firefox | CSV (`;`) |
| Sodimac/Falabella | `sodimac` | `trips` | Chromium | CSV (`;`) |

### Arquitectura clave

```
POST /api/v1/jobs {source, product, client_name, date_from, date_to}
  → factory.get_adapter(source, product)   # valida combo, retorna extractor
  → extractor.extract(...)                 # Playwright headless → archivo local
  → gcs_client.upload_file_to_gcs(...)    # best-effort upload
  → GET /api/v1/jobs/{job_id}             # polling: queued→running→done/failed
```

**Patrón de extractor** (todos los TMS siguen este contrato):
```python
class MiTMSExtractor(BaseTMSExtractor):
    SOURCE_NAME = "mitms"
    PRODUCT_NAME = "trips"
    async def extract(self, *, client_name, date_from, date_to, timeout_ms) -> ExtractionArtifact
```

### Archivos clave

```
extraction_service/
  app/tms/base.py          # BaseTMSExtractor + ExtractionArtifact + build_path()
  app/tms/factory.py       # EXTRACTORS dict + get_adapter() + list_sources()
  app/tms/{tms}/scraper.py # Implementaciones: qanalytics, wingsuite, sodimac
  app/api/routes.py        # Endpoints FastAPI
  app/core/config.py       # Settings (pydantic-settings, lee .env)
  app/jobs/store.py        # JobStore in-memory con asyncio.Lock
  app/utils/gcs_client.py  # upload_file_to_gcs()
```

### Comandos frecuentes

```bash
# Tests
cd extraction_service && python -m pytest tests/ -v

# Dev server
cd extraction_service && uvicorn app.main:app --reload --port 8080

# Smoke test (con servidor corriendo)
curl -s -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"source":"sodimac","product":"trips","client_name":"test"}' | python3 -m json.tool

# Poll job
curl -s http://localhost:8080/api/v1/jobs/{job_id} | python3 -m json.tool
```

### Skills disponibles (slash commands)

**extraction_service:**
- `/run-tests` — corre pytest de extraction_service
- `/start-dev` — inicia el servidor local
- `/smoke-test` — hace POST + poll de un job completo
- `/new-tms` — guía para agregar un nuevo adapter TMS

**monitor-app/frontend (Vercel):**
- `/deploy` — ciclo completo: build local → push → deploy producción → verificar env
- `/check-env` — compara `.env.local` vs Vercel, detecta faltantes

**Vercel config:**
- Proyecto: `fsotosas-projects-7b3a7c7c/frontend`
- URL producción: `https://frontend-two-alpha-39.vercel.app`
- Root dir: `monitor-app/frontend/`
- Framework: Next.js 16.2.6
