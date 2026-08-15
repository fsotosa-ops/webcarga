---
name: qa-testing
description: Use when writing tests, deciding what level to test at, or before claiming work is done in webcarga. Covers what mocked tests structurally cannot catch, when to verify against the real database, and the commands that count as evidence.
---

# QA y testing en webcarga

## Los comandos, y dónde vive cada suite

```bash
# Backend (monitor-app/backend/api) — el venv correcto es `venv`, NO .venv ni anaconda
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -v

# Frontend (monitor-app/frontend)
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build

# extraction_service
cd extraction_service && python -m pytest tests/ -v
```

**Correr el comando y mirar la salida.** Una afirmación de que algo pasa sin la
salida del comando es una hipótesis, no un resultado.

`npm run build` no es opcional cuando se agregó una ruta: es lo único que
confirma que la página entró al manifest de Next.

## Lo que los tests con mocks estructuralmente no ven

El backend testea con `AsyncMock`, así que **el mock nunca contradice al SQL**.
Dos bugs reales que pasaron los tests y reventaron contra Postgres: un
`max(uuid)` que Postgres no soporta, y una columna que no existía.

**Regla**: todo SQL nuevo se corre contra la base real (MCP de Supabase) antes
de confiar en que el test verde significa algo. Si la tabla está vacía, la
consulta al menos prueba que las columnas y los casts existen — decilo así, no
como "verificado".

## Un mock con la forma equivocada hace pasar el test por la razón incorrecta

Caso real (Ronda 102): un test mockeaba `carriersApi.list` devolviendo
`{ rows: [...] }`, pero el contrato real es `{ data: [...] }`. El componente
filtraba sobre `data`, encontraba una lista vacía, y el test pasaba igual
porque no afirmaba sobre el resultado sino sobre el efecto.

**Antes de mockear una función, abrir su definición y copiar la forma real de
lo que devuelve.** No inferirla del nombre.

## Lo que solo se detecta mirando

Nada de esto da error. Da un resultado plausible y equivocado:

- **Huso horario**: un `datetime` naive escrito a `timestamptz` toma el TZ del
  sistema operativo del proceso, no el de Postgres. Los scrapers de Playwright
  sin `timezone_id` capturan la hora del contenedor, no la de Chile.
- **Emojis en la UI**: prohibidos por decisión explícita del usuario, solo
  `lucide-react`. Pasa lint y typecheck.
- **Drafts sin resincronizar** (visto 4 veces): el botón que ABRE la edición
  debe resetear el borrador desde el prop. Un `useState` inicial se queda con
  el valor viejo y el test que solo abre una vez no lo ve.
- **Dependencias del backend**: el `Dockerfile` tiene las deps hardcodeadas y
  **no lee `pyproject.toml`**. Agregar una dep sin tocar el Dockerfile pasa
  todos los tests y rompe el deploy.

## El click-through, cuando toca datos reales

Los desplegables listan **todo el catálogo**, no solo lo pendiente. Ya se pisó
un documento real por elegir a ojo.

**Elegir por SQL una entidad sin datos cargados antes de abrir el navegador**,
limpiar al terminar, y confirmar con un conteo global.

## Antes de decir que algo está listo

1. ¿Corriste los comandos y miraste la salida?
2. ¿El SQL nuevo se probó contra la base real?
3. ¿Los mocks devuelven la forma real del contrato?
4. Si tocaste algo visual, ¿lo abriste?
