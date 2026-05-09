# /run-tests — Correr tests de extraction_service

Corre los tests del extraction_service con el siguiente comando:

```bash
cd /Users/usuario/Desktop/projects/webcarga/extraction_service && python -m pytest tests/ -v
```

Si el usuario pasa flags adicionales (ej. `-x`, `-k "nombre"`, `--tb=short`), agrégalos al comando.

Muestra el output completo y reporta cuántos tests pasaron/fallaron.
Si falla algún test, muestra el traceback y sugiere la causa más probable.
