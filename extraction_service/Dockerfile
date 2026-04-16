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

# Firefox: bundle portable que `playwright install` deja en el cache del user
# (/home/appuser/.cache/ms-playwright/). Lo usan wingsuite y qanalytics.
USER appuser
RUN playwright install firefox

# Deps de sistema de Firefox (libdbus, libgtk, etc.) — requiere root.
USER root
RUN playwright install-deps firefox

# Chrome real: `playwright install chrome` baja el .deb oficial de Google y lo
# instala a /opt/google/chrome/ — instalación sistémica, obliga a root. Lo
# usa sodimac via `channel="chrome"` (único stack que pasó el Bot Management
# de CF sobre tms.falabella.supply, confirmado por la PoC). `--with-deps`
# resuelve también las libs del sistema en una sola pasada.
RUN playwright install --with-deps chrome

# Copiar código de la aplicación
COPY app/ app/

# Correr como non-root
USER appuser

ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
