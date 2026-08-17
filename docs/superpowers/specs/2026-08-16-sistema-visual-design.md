# Sistema visual — diseño

**Fecha**: 2026-08-16
**Origen**: auditoría visual del ambiente desplegado (`webcarga-frontend-dev`), medida sobre el DOM
renderizado con Playwright a 1440×900, no estimada sobre capturas.
**Relación con el Cierre**: `2026-08-16-cierre-de-viajes-design.md` §8bis declara este spec como
dependencia dura — las pantallas del Cierre se construyen encima, no antes.

---

## 1. El problema, medido

El usuario lo describió como *"la app está fea en look & feel"*. Al medirlo, no está rota ni mal
resuelta pantalla por pantalla: **está sin sistema**.

| Pantalla | Tamaños de letra | Texto ≤ 11 px | Colores de texto |
|---|---|---|---|
| Monitor | 8 | 72 % | 13 |
| Cierre del Día | 8 | 77 % | 13 |
| Certificación | 9 | 59 % | 13 |
| Configuración · Operaciones | 8 | 53 % | **21** |

En el Monitor hay **428 elementos de texto a 10 px o menos** — 248 a 10, 152 a 9 y 28 a 8. Ocho
tamaños entre 8 y 16 px no son jerarquía: son ruido. Nada guía el ojo porque casi todo pesa lo mismo
y casi todo es diminuto. **Esa es la causa principal de que se lea como tosca.**

### El diagnóstico exacto: el sistema existe y se lo saltan

`app/globals.css` son **68 líneas con 14 tokens, todos de color**. Cero de tipografía, espaciado,
radio, sombra o peso.

Y aun en color, el sistema se aplica poco:

| | Ocurrencias |
|---|---|
| Usos de tokens propios (`text-accent`, `bg-status-*`, …) | **571** |
| Usos de color crudo de Tailwind (`text-gray-500`, `bg-amber-50`, …) | **1.824** |
| Combinaciones distintas de color crudo en uso | **148** |

**Tres a uno a favor del color suelto**, sobre 148 valores distintos. No hace falta inventar un
sistema: hace falta terminarlo y hacer que se use.

---

## 2. Alcance

**Adentro**: los tokens (tipografía, color, espaciado, radio) y los **cuatro componentes
compartidos** que toda pantalla necesita y ninguna tiene. Más la deuda urgente del §6.

**Afuera**: rediseñar pantallas una por una. Con los tokens y los componentes puestos, cada pantalla
hereda; hacerlo al revés es cómo se llegó acá.

---

## 3. Tokens

### 3.1 Tipografía — cinco pasos, no ocho

Hoy hay ocho tamaños improvisados. Cinco elegidos:

| Token | Tamaño / peso | Para qué |
|---|---|---|
| `--text-etiqueta` | 11 px · 600 · +0.08em, mayúsculas | encabezado de columna, eyebrow. **Uso escaso** |
| `--text-dato` | 13 px · 400 | el texto de las tablas — el default del producto |
| `--text-lectura` | 15 px · 400 | párrafos, descripciones, ayuda |
| `--text-titulo` | 20 px · 600 | título de sección o de tarjeta |
| `--text-cifra` | 28 px · 640 · −0.5px | la cifra grande, y los títulos de página |

**Nada por debajo de 11 px.** Los 428 elementos a 10 px o menos suben a 11 o a 13 según sean
etiqueta o dato.

**`font-variant-numeric: tabular-nums` en todo lo que sea cifra, patente, fecha u hora.** Hoy ninguna
columna de números alinea, porque el `1` ocupa menos que el `8` y la columna baila de fila en fila.
En un producto donde lo único que importa son los números, es el cambio de menor esfuerzo y mayor
efecto.

### 3.2 Color — cinco señales

Se conserva lo que ya existe (`--accion`, `--espera`, `--resuelto`, `--status-*`) y se completa hasta
cubrir cinco significados, no más:

| Señal | Significa | Ya existe |
|---|---|---|
| normal | nada que hacer | sí |
| atención | falta algo, no urge | `--espera` |
| urgente | hay que actuar hoy | `--status-incidente` |
| resuelto | listo | `--resuelto` |
| informativo | dato de contexto | — |

**El acento deja de usarse para todo.** Hoy el cian es el logo, el item activo del menú, los links y
los botones a la vez; cuando todo es del color de acento, el acento deja de avisar.

Las zonas (RM · Z0 · Región) **ya tienen color en Configuración: se reusan, no se inventan otras.**

### 3.3 Espaciado, radio y densidad

Escala de 4 px (`4 · 8 · 12 · 16 · 24 · 32 · 48`) y dos radios (6 px para controles, 12 px para
superficies). **Una fila de tabla mide 40 px** con una línea de contenido, 56 con dos. Hoy el Monitor
tiene filas de entre 63 y 96 px porque los nombres del TMS se parten en tres y cuatro renglones.

---

## 4. Los cuatro componentes compartidos

Todas las pantallas los necesitan; ninguna los tiene, y por eso una queda bien y la siguiente no.

1. **Encabezado de página** — título, subtítulo de una línea, y la fila de acciones. Hoy cada
   pantalla lo arma a mano y ninguna coincide con otra.
2. **Tarjeta de cifra** — el número con `--text-cifra` y numeración tabular, su etiqueta, y opcional
   una señal de color. Resuelve de una vez que "37 documentos" tenga el mismo peso que la
   descripción de al lado.
3. **Fila de tabla** — alto fijo, truncado explícito con título completo accesible, y la celda de
   identificador (patente, ID de viaje) en numeración tabular.
4. **Estados de vacío, carga y error** — el que falta en todas partes y el que más se ve (§6.2).

---

## 5. Los datos reales, que hoy rompen el layout

No es un problema de tokens sino de reglas, y va en el mismo trabajo porque vive en el componente de
fila:

- **46 textos cortados** en la tabla del Monitor. Cuatro de cada seis nombres de empresa aparecen
  truncados —*"Sociedad Mendieta …"*, *"Transportes Capsule…"*—, que es exactamente lo que Pablo
  reclamó en la reunión del 14/08. Regla: truncar es válido, **pero el valor completo tiene que estar
  disponible** (título accesible) y la columna dimensionada al percentil 90 real, no al promedio.
- **221 px ocultos** tras scroll horizontal a 1440 px: las columnas Destinos y Temperatura caen fuera
  de pantalla en un laptop estándar. O caben, o se declaran secundarias y se mueven al detalle.
- **Nombres sin normalizar**: `SUAREZ LOPEZ EFRAIN EDUARDO` convive con
  `Aravena Herrera Francisco Javier` en filas contiguas. Se normaliza **en presentación**, no en el
  dato — el dato del TMS no se toca (regla 1 de Pablo).

---

## 6. Deuda urgente — no depende de nada de lo anterior

### 6.1 Voseo en producción

Cinco textos visibles al usuario están en voseo rioplatense, contra la regla explícita de español
neutral. El más visible encabeza el propio módulo de Cierre:

> *"Revisá pendientes, cerrá Tractoreo y Equipos Completos, y compartí el reporte del día — todo en
> un solo lugar."*

`closures/page.tsx:146` · `LocationCreateForm.tsx:36` · `GestionPanel.tsx:247` ·
`TripAssignDialog.tsx:134` · `RouteEditor.tsx:137`

### 6.2 Estados de carga que afirman cosas falsas

**Certificación** muestra **"0 documentos por cubrir"** en cifra grande mientras carga, y después
salta a 2.360. Durante ese segundo la pantalla afirma con total seguridad algo falso.

**El Cierre** es peor: el área de datos está vacía con un spinner **y el botón "Confirmar cierre" ya
está activo**. Se puede firmar un día sobre datos que no terminaron de llegar.

Regla: **una cifra derivada no se muestra hasta tener el dato**, y las acciones que escriben quedan
deshabilitadas mientras carga la información de la que dependen.

### 6.3 Menor

`monitor-app/frontend/CLAUDE.md` contiene `@AGENTS.md` y ese archivo no existe.

---

## 7. Verificación

La auditoría dejó números de partida, así que la aceptación es medible con el mismo método —
Playwright sobre el ambiente desplegado, midiendo el DOM:

| Métrica | Hoy | Meta |
|---|---|---|
| Tamaños de letra por pantalla | 8–9 | **≤ 5** |
| Texto ≤ 11 px | 53–77 % | **≤ 25 %** |
| Colores de texto por pantalla | 13–21 | **≤ 8** |
| Textos cortados sin valor accesible | 46 | **0** |
| Desborde horizontal a 1440 px | 221 px | **0** |
| Alto de fila del Monitor | 63–96 px | **40 / 56 fijo** |
| Casos de voseo | 5 | **0** |
| Cifras visibles durante la carga | 2 pantallas | **0** |

Y lo que no se mide solo: **se mira**, en escritorio y en teléfono. Un test no ve un renglón que se
parte mal ni un cero que miente.

---

## 8. Por qué ahora

El módulo de Cierre está por agregar cinco o seis pantallas. Si se construyen sobre la base actual
hay que rehacerlas — y son justamente las que el equipo de operaciones tiene que adoptar. Hacer los
tokens primero también sirve de prueba: si el sistema no aguanta las pantallas del Cierre, no aguanta
nada.
