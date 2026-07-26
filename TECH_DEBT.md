# Technical Debt — webcarga

Lista de deuda técnica priorizada. Actualizar con `/debt-log`.

| Prioridad | Item | Archivo | Fecha |
|-----------|------|---------|-------|
| Media | `app.trip_stops.local` es texto libre sin FK real a `public.locations` — 320 nombres distintos de parada usados en viajes reales, 305 (95%) calzan exacto (case/trim-insensitive) con un nombre en `public.locations` (700 locales activos), ~15 no calzan con nada del catálogo. Sin FK no hay garantía de alineación futura ni señal cuando un nombre no calza (drift silencioso). Decisión del usuario (2026-07-25): dejarlo pendiente para conversar primero con el equipo de negocio antes de diseñar cualquier fix — rango de opciones va desde solo superficiar los nombres sin calzar como señal de calidad de dato, hasta migrar `trip_stops.local` a un `location_id` real con flujo de resolución tipo fleet-match. No ejecutar ningún cambio de modelo hasta esa conversación. | `app.trip_stops` / `public.locations` | 2026-07-25 |
