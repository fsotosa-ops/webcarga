FROM python:3.11-slim-bookworm

WORKDIR /app

# Copiar spec de dependencias primero para layer caching
COPY pyproject.toml .

# Instalar dependencias (sin el proyecto en sí aún)
RUN pip install --no-cache-dir .

# Crear usuario no-root ANTES de instalar browsers
RUN useradd -m appuser \
    && mkdir -p /app/downloads \
    && chown -R appuser:appuser /app/downloads

# Instalar Firefox como appuser para que quede en /home/appuser/.cache/ms-playwright/
USER appuser
RUN playwright install firefox

# Volver a root para instalar dependencias de sistema de Firefox
USER root
RUN playwright install-deps firefox

# Copiar código de la aplicación
COPY app/ app/

# Correr como non-root
USER appuser

ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
