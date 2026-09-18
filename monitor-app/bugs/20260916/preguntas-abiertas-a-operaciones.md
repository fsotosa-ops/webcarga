# Preguntas abiertas a Operaciones — HU-28 (origen y operación)

> Escrito el 2026-09-18, al cerrar la Ronda 162. Las cuatro olas de la HU-28 están
> **desplegadas y funcionando** en `dev`; nada de lo de abajo bloquea el uso de la
> app, salvo la pregunta 1, que si se responde distinto obliga a rediseñar.
>
> Contexto: `Solicitud de Cambios Diario 2.0.docx` (líneas 9, 10 y 11) y
> `levantamiento-user-story.md` (las cuatro respuestas de Operaciones).

---

## 1. ¿"Dejar abierto el filtro de CD Origen para modificación" es el FILTRO o el VALOR?

**La frase original** (línea 11 del documento): *"Revisar para hacer asistencia y
cierre por CD (peñon, QL y LOA) más por operación, Walmart y por operación.
**(Dejar abierto el filtro de CD Origen para modificación)**"*.

**Cómo se interpretó, y por qué.** Se leyó como *el filtro lista todos los
orígenes y se puede cambiar la selección*, apoyado en la respuesta de Operaciones
a la pregunta 3 del levantamiento: *"cada Cliente tiene sus CD de carga, y se ven
por separado"*. O sea "abierto" = **no cerrado a Peñón, Quilicura y Lo Aguirre**.

**Lo que está construido con esa lectura**: el desplegable de la columna "Origen
habitual" ofrece **los 24 orígenes del catálogo**, incluidos los que no tienen a
nadie ese día — que son justamente aquellos cuya asistencia hay que poder pedir.

**La otra lectura posible**: que el **origen de una fila del cierre se pueda
sobrescribir a mano**.

| Si la respuesta es… | Qué pasa |
| :--- | :--- |
| **El filtro** | No hay nada que hacer. Está listo. |
| **El valor** | **Hay que rediseñar.** Es un dato que hoy sale del viaje que reportó el TMS, y permitir editarlo abre la pregunta de qué manda cuando el TMS dice otra cosa — exactamente la discusión que se tuvo al diseñar la HU. No es un ajuste de una tarde. |

**Es la única pregunta cara de esta lista.**

---

## 2. Los estados de acción: ¿los tiles deben seguir al filtro?

**Qué cambió.** Al elegir un origen en el filtro, los números de arriba (Total /
Asignados / No asignados / No trabajando) pasan a ser **los de ese origen**. Antes
eran siempre los del día completo.

**Por qué se cambió.** Sin eso, filtrar por "CD EL PEÑON" muestra las filas de
Peñón pero deja arriba el número de los 40 del día, y la asistencia por origen hay
que contarla a mano — que es justo lo que pidieron.

**Qué se necesita**: confirmación de que así lo quieren. Es un cambio a la vista de
todos, y no debería decidirlo quien programa.

---

## 3. ¿Qué se hace con "Cargaron en otro origen"?

**Qué es.** Una sección nueva del Reporte que lista a quien salió desde un origen
distinto al suyo. Ejemplo: un conductor asignado a Peñón que hoy cargó en
Quilicura.

**Por qué existe.** Declarar el origen habitual no sirve para que todos calcen,
sino para poder **ver cuándo no calzan**. Hasta ahora eso se perdía: el reporte
agrupaba por el origen adivinado y por construcción nunca podía contradecirse.

**El volumen esperado, medido.** Con los orígenes cargados según la sugerencia, en
los últimos 15 días serían **4 desvíos sobre 354 viajes (1,1%), en 2 conductores**.
Corto y legible, no ruido.

**La pregunta**: ¿es información para mirar en el reporte, o debería avisar a
alguien cuando pasa?

---

## 4. ¿Hay orígenes que no deberían estar en el catálogo?

**El criterio vigente** lo fijó el usuario el 17/09: *"si aparecen dentro de la
trazabilidad de origen es porque lo son"*. Sin umbral. Los 24 lugares que el TMS
reporta como origen están en el catálogo, y el sistema registra solo los que
aparezcan de aquí en adelante.

**Los que conviene mirar**, porque son de muy bajo volumen y algunos parecen
tiendas despachando (logística inversa) más que puntos de carga habituales:

| Generador | Lugar | Viajes (90 días) |
| :--- | :--- | ---: |
| Sodimac | Bodega CD Maderas Rengo (381) | 3 |
| Sodimac | Logística Inversa (351) | 3 |
| IANSA | Saam Renca | 3 |
| Walmart | HIPER SANTA CRUZ | 2 |
| Walmart | BIO BIO · SAN BERNARDO · VIÑA DEL MAR · MAIPU 3 PONIENTE · Express Maipú · José Domingo Cañas · Tienda Virtual BR Temuco | 1 c/u |
| Colun | PILU - UHT | 1 |

**No bloquea nada**: se quitan o se agregan desde **Configuración › Operaciones ›
Orígenes**, sin tocar código ni esperar un despliegue.

---

## Lo que no es pregunta, y es lo que falta para que esto rinda

**Cargar el origen habitual de los 41 conductores del roster de Tractoreo.** Se
hace desde el Directorio, en la ficha de cada conductor.

| Caso | Cuántos | Qué hay que hacer |
| :--- | ---: | :--- |
| Un origen concentra ≥80% de sus viajes | **35** | Un clic: el botón ya dice el origen ("Asignar CD LO AGUIRRE") |
| Dominante entre 60% y 80% | 3 | La pantalla muestra el reparto y elige la persona |
| Bajo 60% | 2 | Decisión de Operaciones |
| Sin historial de viajes | 1 | Elegir a mano |

Mientras no estén cargados, el Cierre y el Reporte dicen **"Sin origen"**. Es
correcto y no es un error: reemplaza a un dato que el sistema venía inventando —
tomaba el origen del viaje más reciente del conductor *de cualquier fecha*, con
casos de hasta dos meses de antigüedad, e incluso de un viaje **posterior** al día
que estaba describiendo.
