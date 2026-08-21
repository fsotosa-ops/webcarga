from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import get_settings
from .db import close_pool, init_pool
from .middleware.cache import CacheMiddleware
from .routers.assets import router as assets_router
from .routers.carriers import router as carriers_router
from .routers.compliance import router as compliance_router
from .routers.config import router as config_router
from .routers.config_reviews import buscador as config_search_router
from .routers.config_reviews import router as config_reviews_router
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

# GZip va AL FINAL, o sea el MAS EXTERNO, y eso no es una preferencia: Starlette
# inserta cada middleware al principio de la pila, asi que el ultimo agregado
# envuelve a todos. Tiene que quedar por FUERA de CacheMiddleware, que guarda
# `body.decode()` — si lo envolviera al reves, el cache recibiria bytes
# comprimidos y `decode()` reventaria con UnicodeDecodeError en cada MISS.
#
# Por que hace falta: las respuestas de este servicio son JSON con las mismas
# claves repetidas en cada fila —`/compliance-records/pending` mide ~662 bytes
# por fila, medido, y la ficha de una empresa pide hasta 500—, que es la forma
# que mejor comprime que existe. El salto que se ahorra es Next -> esta API,
# server a server, que hoy viaja crudo.
#
# `compresslevel=6` y no el 9 por defecto: el 9 cuesta bastante mas CPU y sobre
# JSON con claves repetidas da una diferencia marginal. Comprimir con el nivel
# maximo para ahorrar bytes seria mover el costo de la red a la CPU, que es
# justo lo que este servicio no tiene de sobra.
#
# `minimum_size=1000` queda declarado pero HOY NO SE APLICA, y conviene saberlo
# antes de perder una tarde: `CacheMiddleware` es un `BaseHTTPMiddleware`, que
# emite toda respuesta como streaming, y en ese camino GZip comprime sin mirar
# el tamano. Medido: una respuesta de 81 bytes sale comprimida con el cache
# puesto y sin comprimir sin el. Se acepta —el desperdicio sobre respuestas
# chicas es ruido al lado del 96% que se ahorra en las grandes— y volveria a
# aplicarse solo si `CacheMiddleware` pasara a ser ASGI puro. `test_compresion.py`
# fija esta interaccion para que el dia que cambie, avise.
#
# Sabido y aceptado: la descarga de documentos en zip (`carriers.py`, media_type
# "application/zip") se recomprime al pedo — Starlette solo excluye
# `text/event-stream` por content-type (leido en la fuente, no supuesto). Es una
# accion manual y ocasional; excluirla exigiria una subclase del middleware para
# un solo endpoint, que cuesta mas de lo que ahorra.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)

app.include_router(roles_router,               prefix="/api/v1")
app.include_router(config_router,              prefix="/api/v1")
app.include_router(config_reviews_router,      prefix="/api/v1")
app.include_router(config_search_router,       prefix="/api/v1")
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
