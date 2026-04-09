FROM python:3.11-slim-bookworm

WORKDIR /app

# Copiar el proyecto completo
COPY . .

# Instalar el proyecto y sus dependencias (esto instala playwright)
RUN pip install --no-cache-dir .

# Instalar dependencias de sistema operativo para Chromium
RUN playwright install --with-deps chromium

ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
