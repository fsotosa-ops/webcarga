# /debug-run — Inspeccionar logs y screenshots del último run del scraper

Ayuda a diagnosticar si el scraper está interactuando con la página correcta.

## Paso 1: Listar archivos de debug recientes

```bash
ls -lt /tmp/qanalytics_*.png /tmp/qanalytics_*.html \
        /tmp/wingsuite_*.png /tmp/wingsuite_*.html \
        /tmp/sodimac_*.png  /tmp/sodimac_*.html 2>/dev/null | head -15
```

## Paso 2: Abrir el screenshot más reciente (macOS)

```bash
LATEST=$(ls -t /tmp/qanalytics_*.png /tmp/wingsuite_*.png /tmp/sodimac_*.png 2>/dev/null | head -1)
echo "Abriendo: $LATEST"
open "$LATEST"
```

## Paso 3: Buscar selectores clave en el HTML dump

Para verificar que el scraper navegó a la página correcta:

```bash
LATEST_HTML=$(ls -t /tmp/qanalytics_*.html /tmp/sodimac_*.html /tmp/wingsuite_*.html 2>/dev/null | head -1)
echo "=== Archivo: $LATEST_HTML ==="
grep -oE 'id="[^"]{1,40}"|href="[^"]{1,80}\.aspx[^"]*"|onclick="[^"]{1,60}"' "$LATEST_HTML" | sort -u | head -30
```

## Paso 4: Activar dump preventivo (antes de que falle)

Para dumpear el HTML en el momento exacto de navegación, reiniciar el servidor con:

```bash
QANALYTICS_DUMP_PAGE=1 BROWSER_HEADLESS=False \
  uvicorn app.main:app --reload --port 8080
```

Luego lanzar el job y revisar `/tmp/qanalytics_dump_post_nav.html` y `.png`.

## Paso 5: Filtrar logs del servidor por pasos clave

Si el servidor está corriendo en otra terminal, buscar en su output:
- `[STEP` → pasos del flujo
- `[xhr]★` → requests a la API/páginas propias del TMS
- `ERROR` / `WARNING` → problemas
- `[DUMP]` → confirmación de que el dump se escribió

Reportar qué archivos encontró, su timestamp, y el contenido relevante de los selectores.
