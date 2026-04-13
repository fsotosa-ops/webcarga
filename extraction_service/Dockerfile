FROM python:3.11-slim-bookworm

WORKDIR /app

# Copiar spec de dependencias primero para layer caching
COPY pyproject.toml .

# Instalar dependencias (sin el proyecto en sí aún)
RUN pip install --no-cache-dir .

# Instalar Chromium y sus dependencias de sistema
RUN playwright install --with-deps chromium

# Copiar código de la aplicación (cambios de código no invalidan el layer de deps)
COPY app/ app/

# Usuario no-root por seguridad
RUN useradd -m appuser
USER appuser

ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
