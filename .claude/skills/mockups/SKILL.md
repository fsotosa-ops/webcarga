---
name: mockups
description: Use when designing a screen, choosing between visual options, or before writing any interface code in webcarga. Covers where mockups live, the states every screen must carry, which installed tool to reach for at each step, and how to verify a visual deliverable before calling it done.
---

# Dibujar una pantalla en webcarga

Esta skill no decide *qué dice* una pantalla. Dice dónde se documenta, qué es
obligatorio, con qué herramienta y cómo se comprueba.

## 1 · Dónde vive la verdad

**En la HU, junto a sus criterios de aceptación**:
`monitor-app/docs/user-stories/<AAAAMMDD>/NN-hu-<tema>.md`, en una sección
`## Diseño de interfaz`. Ahí vive el mockup ASCII, la comparativa de patrones
evaluados y el motivo de la decisión — no en un archivo aparte que se
desincroniza.

El plan de implementación (`docs/superpowers/plans/`) **argumenta desde la HU**
y la referencia; no la duplica.

| Medio | Qué es |
| :--- | :--- |
| La sección `## Diseño de interfaz` de la HU | **La fuente.** Manda sobre qué información va y en qué orden |
| Visual companion de `superpowers:brainstorming` | Borrador para elegir entre opciones. Vive en `.superpowers/brainstorm/` (ignorado por git) |
| Artifact publicado | Para que alguien fuera de la terminal lo mire y comente |

**Si el mockup y el código dicen cosas distintas, uno de los dos está mal y hay
que decir cuál.** Un documento de diseño que quedó atrás deja de mandar y pasa
a estorbar.

## 2 · Los estados, que son la mitad del trabajo

Una pantalla sin sus estados **no está lista**. Los cuatro obligatorios:

- **El vacío** — todavía no hay datos. Nunca una tabla vacía con encabezados.
  Un mensaje que diga qué hacer.
- **El a medias** — hay algo pero no todo. Qué se muestra y qué se omite.
- **El sin permiso** — el rol no puede editar. La app usa `useCanEdit()`; la
  vista se ve, las acciones no.
- **El que falló** — y qué NO puede parecer. Un error al guardar no puede
  hacer creer que se perdió lo cargado.

Y para cualquier cifra derivada: **si el dato no está, se omite esa mitad.**
Inventar el número es peor que no tenerlo.

## 3 · Qué herramienta, y en qué momento

1. **Elegir entre opciones visuales** → `superpowers:brainstorming` con su
   visual companion:
   `scripts/start-server.sh --project-dir <repo> --open`. Sirve cuando la
   pregunta se entiende mejor viéndola. **Se ofrece cuando aparece la primera
   pregunta visual, no al arrancar.** Las preguntas técnicas y de alcance van
   por el terminal, no por el navegador.
2. **Estilo, patrones de UX, tipo de producto** → `ui-ux-pro-max`:
   `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<consulta>" --domain ux`
   Ojo: la base es genérica y no cubre patrones de dominio (bandejas de triage,
   colas de trabajo). Para eso, **contrastar contra productos reales del rubro**
   y nombrarlos.
3. **Un gráfico** → la skill `dataviz`, antes de la primera línea de código.
4. **Un diagrama** → `artifact-diagramming`.
5. **Dirección estética** cuando la pantalla es nueva → `frontend-design`.

## 4 · Las reglas duras de esta app

- **Cero emojis.** Solo `lucide-react`. Es una decisión explícita del usuario, y
  al tocar un componente que tenga emojis viejos, se reemplazan.
- **Etiqueta en español, ruta en inglés** (`Certificación` → `/dashboard/compliance`).
- **Español neutral, sin voseo**: "Arrastra", "Elige", "Selecciona" — nunca
  "Arrastrá"/"Elegí", y nunca `vosotros`. Es un requisito explícito del
  usuario; el producto opera en Chile y el equipo no es rioplatense.
- **Nombrar las cosas por el trabajo, no por el modelo de datos**: "¿A quién
  pertenece?", no "Sujeto"; "¿Qué documento es?", no "requirement_id".
- **Selección múltiple antes que acciones por fila** cuando el volumen es alto,
  y **barra contextual** que aparece al seleccionar.
- **Todo accesible por teclado** — `ui-ux-pro-max` marca *Keyboard Navigation*
  con severidad alta.

## 5 · Verificar: se mira antes de decir "listo"

Un test no ve un color que no se parsea, un renglón que se parte mal ni un
título huérfano.

- **Una pantalla se mira**, en escritorio y en teléfono.
- **`npm run build`** es lo único que confirma que una ruta nueva entró al
  manifest de Next.
- **Un HTML editado a mano se comprueba balanceado** antes de publicarlo.
- Si el trabajo toca datos reales, ver el click-through en `qa-testing`:
  elegir la entidad por SQL, no a ojo del desplegable.

## Antes de dar una pantalla por lista

1. ¿Está en la sección `## Diseño de interfaz` de su HU, con sus cuatro estados?
2. ¿Se corrió `npx vitest run && npx tsc --noEmit && npm run build`?
3. ¿Se miró, en los dos tamaños?
4. ¿El mockup y el código dicen lo mismo?
