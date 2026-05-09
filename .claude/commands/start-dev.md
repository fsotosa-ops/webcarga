# /start-dev — Iniciar extraction_service en modo desarrollo

Inicia el servidor local del extraction_service:

1. Verifica que el archivo `.env` exista en `extraction_service/`:
   ```bash
   ls /Users/usuario/Desktop/projects/webcarga/extraction_service/.env
   ```

2. Inicia el servidor (el .env se carga automáticamente via pydantic-settings):
   ```bash
   cd /Users/usuario/Desktop/projects/webcarga/extraction_service && uvicorn app.main:app --reload --port 8080
   ```

El servidor queda disponible en `http://localhost:8080`.
Docs interactivos en `http://localhost:8080/docs`.

Nota: `--reload` hace hot-reload al editar archivos Python. Para producción omitir ese flag.
