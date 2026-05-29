from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import close_pool, init_pool
from .routers.filter_groups import router as filter_groups_router
from .routers.roles import router as roles_router
from .routers.transporters import router as transporters_router
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(roles_router,         prefix="/api/v1")
app.include_router(transporters_router,  prefix="/api/v1")
app.include_router(trips_router,         prefix="/api/v1")
app.include_router(users_router,         prefix="/api/v1")
app.include_router(filter_groups_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "webcarga-monitor-api"}
