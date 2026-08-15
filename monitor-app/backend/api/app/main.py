from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import close_pool, init_pool
from .middleware.cache import CacheMiddleware
from .routers.assets import router as assets_router
from .routers.carriers import router as carriers_router
from .routers.compliance import router as compliance_router
from .routers.config import router as config_router
from .routers.document_ingest import router as document_ingest_router
from .routers.contacts import router as contacts_router
from .routers.coverage_types import router as coverage_types_router
from .routers.daily_closures import router as daily_closures_router
from .routers.drivers import router as drivers_router
from .routers.equipment_closures import router as equipment_closures_router
from .routers.filter_groups import router as filter_groups_router
from .routers.locations import router as locations_router
from .routers.policies import router as policies_router
from .routers.requirements import requirements_router as compliance_requirements_router
from .routers.roles import router as roles_router
from .routers.shippers import router as shippers_router
from .routers.status_report import router as status_report_router
from .routers.status_taxonomies import router as status_taxonomies_router
from .routers.trips import router as trips_router
from .routers.users import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    pool = await init_pool(settings.database_url)
    app.state.pool = pool
    yield
    await close_pool()


app = FastAPI(
    title="Webcarga Monitor API",
    version="1.0.0",
    description="API operacional de master data — transportistas",
    lifespan=lifespan,
    redirect_slashes=False,
)

settings = get_settings()

# Orden de middlewares (Starlette: último agregado = más externo para requests)
# CacheMiddleware primero → queda interno a CORS (CORS agrega headers incluso en hits)
app.add_middleware(CacheMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(roles_router,               prefix="/api/v1")
app.include_router(config_router,              prefix="/api/v1")
app.include_router(status_taxonomies_router,   prefix="/api/v1")
app.include_router(trips_router,               prefix="/api/v1")
app.include_router(users_router,               prefix="/api/v1")
app.include_router(filter_groups_router,       prefix="/api/v1")
# Módulo Empresas/Seguros (H2) — reemplaza por completo los routers de
# Checkpoint A-E (transporters.py/transporters_legacy.py/insurance.py,
# borrados 2026-07-16, ver AGENTLOG.md). Sin flag de coexistencia.
app.include_router(carriers_router,            prefix="/api/v1")
app.include_router(drivers_router,             prefix="/api/v1")
app.include_router(assets_router,              prefix="/api/v1")
app.include_router(contacts_router,            prefix="/api/v1")
app.include_router(policies_router,            prefix="/api/v1")
app.include_router(compliance_router,          prefix="/api/v1")
app.include_router(compliance_requirements_router, prefix="/api/v1")
app.include_router(document_ingest_router,      prefix="/api/v1")
app.include_router(coverage_types_router,      prefix="/api/v1")
# Catálogo de locales por generador de carga (H2.6, fase "catálogo de locales")
app.include_router(locations_router,           prefix="/api/v1")
app.include_router(shippers_router,            prefix="/api/v1")
# Cuadratura diaria de conductores (Fase 1, HU-01/02/03 — ver AGENTLOG.md).
# Sin uso desde la UI desde la Fase 4 (ver equipment_closures_router abajo)
# — se mantiene sin borrar, no fue un pedido explícito eliminarlo.
app.include_router(daily_closures_router,      prefix="/api/v1")
# Cierre del día por tracto/equipo (Fase 4, HU-03) — reemplaza a
# daily_closures_router como el flujo que usa la UI.
app.include_router(equipment_closures_router,  prefix="/api/v1")
# Reporte de estatus del día, 6 secciones (Fase 5, HU-04)
app.include_router(status_report_router,       prefix="/api/v1")


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "webcarga-monitor-api"}
