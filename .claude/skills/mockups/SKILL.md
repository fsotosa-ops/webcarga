---
name: mockups
description: Use when designing a screen, choosing between visual options, or before writing any interface code in suma-scout. Covers where mockups live and why, the states every screen must carry, which installed tool to reach for at each step, and how to verify a visual deliverable before calling it done.
---

# Dibujar una pantalla en Suma Scout

Antes de codificar una pantalla se lee su mockup y sus estados. La razón está en
la regla 4 de `CLAUDE.md` y no es teórica: **las dos veces que se construyó sin
mirar el documento —el panel de la comunidad y el caso de inversión— hubo que
rehacer decisiones que el mockup ya tenía resueltas.**

Esta skill no decide *qué dice* una pantalla. Eso es de Felipe y Edmundo. Dice
dónde se dibuja, qué es obligatorio, con qué herramienta, y cómo se comprueba.

## 1 · Dónde vive la verdad

**En la página `#pantallas` del blueprint (`docs/arquitectura/2026-08-13-blueprint-suma-scout.html`), siempre.**

Es HTML de baja fidelidad a propósito, con la paleta y la tipografía reales del
producto. El propio documento lo explica: *"lo que hay que decidir acá es qué
información va en cada pantalla y en qué orden, no el radio de los bordes."*

Todo lo demás es borrador:

| Medio | Qué es |
| :--- | :--- |
| La página `#pantallas` del blueprint | **La fuente.** Manda sobre qué información va y en qué orden |
| Visual companion de `brainstorming` | Borrador para elegir entre opciones. Vive en `.superpowers/brainstorm/` |
| Figma | **Fuera**, salvo que alguien de fuera de la terminal tenga que revisar y comentar |

**Por qué Figma queda fuera**: dos fuentes divergen, y la divergencia no avisa.
El 11 de agosto se encontró que el mockup de la pantalla 2 decía *"Dijiste que se
les van diez horas semanales"* — una frase que el código había corregido el día
anterior porque le atribuía a la persona una cifra que nunca dijo. Llevaba días
contradiciendo al producto, en el mismo repositorio. Con el mockup en otra
herramienta, eso no se encuentra nunca.

**Y el documento se publica como artefacto.** Editar el archivo del repo no
actualiza la página publicada: hay que republicar con su misma URL. Un documento
de diseño que quedó atrás deja de mandar y pasa a estorbar.

## 2 · Los estados, que son la mitad del trabajo

Una pantalla sin sus estados **no está lista**. Son la parte que se salta quien
va directo al código, y después se parcha.

Los cuatro obligatorios:

- **El vacío** — todavía no hay datos. Nunca una tabla vacía con encabezados.
- **El a medias** — hay algo pero no todo. Qué se muestra y qué se omite.
- **El sin permiso** — la organización no autorizó. Se ve la participación, no el
  perfil.
- **El que falló** — y qué NO puede parecer. En el cierre, un error al guardar no
  puede hacer creer que se perdió la conversación.

Además, para cualquier pantalla que muestre una cifra derivada: **si el dato no
está, se omite esa mitad.** Inventar el número es peor que no tenerlo.

**El "no encontrado" es pantalla propia, no un estado de cada una.** Es una sola,
compartida por `/r/` y `/c/`, y hoy **no existe**: sale la de Next, en inglés. Es
el único texto del producto que no respeta los tres idiomas — alguien que dirige
una fundación en Chile abre un link vencido desde su correo y lee *"This page
could not be found"*. Deuda 1.19.

## 3 · Qué herramienta, y en qué momento

Las cuatro están instaladas y sin ruta de entrada. Este es el orden:

1. **Elegir entre opciones visuales** → `superpowers:brainstorming` con su visual
   companion. Sirve cuando la pregunta se entiende mejor viéndola: dos
   disposiciones, dos paletas, dónde va una leyenda. **Se ofrece cuando aparece la
   primera pregunta visual, no al arrancar** — así lo pide la propia skill.
2. **Estilo, paleta, tipografía, tipo de producto** → `ui-ux-pro-max`. Es una base
   consultable, no un consejo genérico:
   `python .claude/skills/ui-ux-pro-max/scripts/search.py "<consulta>" --domain <dominio>`
3. **Un gráfico** → la skill `dataviz`, antes de escribir la primera línea.
4. **Un diagrama** → `artifact-diagramming`.
5. **Dirección estética** cuando la pantalla es nueva → `frontend-design`.

## 4 · Verificar: se mira antes de decir "listo"

**Obligatorio, no recomendado.** `CLAUDE.md` ya lo pide para los entregables
visuales, y esta es la mecánica.

Un test no ve un color que no se parsea, un renglón que se parte mal ni un título
huérfano. Todos los defectos visuales del proyecto aparecieron mirando:

- El gráfico del reporte comparaba contra la cohorte **sin decir cuál línea era
  cuál** — se encontró abriendo el PDF, que es la única forma. La web sí tiene
  leyenda; el PDF no. Deuda 1.20.
- El diagrama de infraestructura tenía **tres defectos invisibles en el código**:
  un rótulo tachado por su propia curva, una línea de base cruzando una caja, y un
  pie saliéndose por la derecha.

### Renderizar un SVG para mirarlo

```bash
# Extraer el SVG a un archivo aparte, con las clases CSS resueltas y un lienzo
# CUADRADO del alto del viewBox: los renderizadores fuerzan proporción cuadrada
# y recortan la derecha sin avisar.
qlmanage -t -s <ancho> -o <dir> <archivo>.svg
```

**Dibuja un marco en el borde exacto del `viewBox`** antes de mirar:

```html
<rect x="0.5" y="0.5" width="<W-1>" height="<H-1>" fill="none" stroke="#d33"/>
```

Sin ese marco no se distingue *"la caja no está"* de *"el renderizador la
recortó"* — pasó el 11 de agosto con una caja que sí existía en el markup.

### El resto

- **El PDF se abre**, no se mide por peso. Un umbral de bytes ajustado a lo
  observado no comprueba nada: mide el pasado. Se verifica cabecera, `%%EOF` y
  número de páginas.
- **Una pantalla se mira en escritorio y en teléfono.** Los recorridos ya corren
  en los dos.
- **Un HTML editado a mano se comprueba balanceado** antes de publicarlo.

## 5 · Idioma

Tres locales: **`es-CL`, `en-US`, `pt-BR`** — los códigos del sitio publicado, no
`es` a secas. Español neutral en todo texto visible: nunca voseo, nunca
`vosotros`.

**Los marcadores fallan en silencio.** Si `{declaradas}` se traduce junto con la
frase —que es lo natural, porque parece parte del texto— la sustitución no
encuentra nada y la pantalla imprime la llave. No falla, no avisa, y **el
typecheck no lo ve porque los tres son `string`**. Solo se nota abriendo esa
pantalla en ese idioma.

## Antes de dar una pantalla por lista

1. ¿Está en la página `#pantallas` del blueprint, con sus cuatro estados?
2. ¿Se renderizó y se miró — en los dos tamaños, y el PDF si aplica?
3. ¿Los tres idiomas, con los marcadores sin traducir?
4. ¿Se republicó el artefacto si el documento cambió?
5. ¿El mockup y el código dicen lo mismo? Si no, uno de los dos está mal y hay
   que decir cuál.
