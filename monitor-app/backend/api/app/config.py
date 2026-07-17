from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    supabase_url: str
    supabase_service_role_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    # Graph API (SharePoint) — fetch automático del Excel EETT, ver
    # utils/sharepoint_client.py. Vacío en dev/test no rompe nada — solo
    # falla si efectivamente se intenta hacer el fetch sin credenciales.
    sharepoint_client_id: str = ""
    sharepoint_client_secret: str = ""
    sharepoint_tenant_id: str = ""

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
