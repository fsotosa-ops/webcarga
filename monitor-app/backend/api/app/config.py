from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    supabase_url: str
    supabase_service_role_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    # Módulo Empresas EETT — plan §3: 'relational' (default, modelo nuevo) o
    # 'jsonb' (legacy sobre app.transporter_profiles, fallback para rollback).
    transporters_backend: str = "relational"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
