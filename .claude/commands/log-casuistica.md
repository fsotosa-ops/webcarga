# /log-casuistica — Registrar una casuística de negocio del Monitor

Registra un nuevo caso de negocio en `docs/casuistica-negocio-diario.md` — el documento vivo que explica, en lenguaje simple, comportamientos reales de la app que en algún momento parecieron un error, para que el equipo de negocio los entienda y que sirva de base al futuro manual de uso.

**Público objetivo: el equipo de negocio, no ingeniería.** Nada de nombres de archivos, funciones, tablas o SQL en el texto del caso — eso vive en `AGENTLOG.md` y los commits. Acá solo va la explicación en términos de "qué ve el usuario" y "qué significa realmente".

## Cómo usarlo

- `/log-casuistica` (sin argumentos) → revisa la conversación actual en busca de un hallazgo de negocio reciente (un comportamiento investigado, explicado, y resuelto o confirmado como "no es un bug") y arma la entrada.
- `/log-casuistica <descripción breve>` → usa la descripción como punto de partida, completando con lo que ya se investigó en la conversación.

Si no hay ningún hallazgo real que registrar en la conversación actual (p. ej. el usuario invocó el comando pero no se investigó nada de negocio), dilo explícitamente y no fuerces una entrada — no todo cambio de código es una casuística de negocio.

## Proceso

1. Lee `docs/casuistica-negocio-diario.md` completo para no duplicar un caso ya registrado (si el caso ya existe, actualízalo en vez de duplicar — agrega una nueva fecha de confirmación si se volvió a verificar, o corrige el texto si el comportamiento cambió).

2. Redacta la entrada con esta estructura exacta (mismo formato que los casos existentes):

```markdown
## N. <Título corto, en términos de negocio>

**Qué se observa**: <lo que el usuario ve o reporta, sin jerga técnica>.

**Qué pasa en realidad**: <la causa, explicada en términos de negocio — qué hace el TMS, qué dato existe o no existe, por qué>.

**Por qué opera así**: <el objetivo de negocio detrás de esa lógica — no repitas la causa técnica, explica PARA QUÉ le sirve a WebCarga/operaciones que la app se comporte de esta forma. Ejemplos de la pregunta que responde este campo: ¿qué disputa evita?, ¿qué trabajo manual le ahorra a operaciones?, ¿qué decisión mala evita que alguien tome?, ¿qué se podría auditar después gracias a esto? Si de verdad no hay una razón de negocio distinta de la causa técnica (p. ej. una limitación pura de datos sin decisión de diseño detrás), dilo explícitamente en vez de inventar una — pero es la excepción, no la regla.>

**Cómo lo resuelve la app**: <el comportamiento actual — qué hace la app hoy, o qué acción (si alguna) debe tomar el usuario>.

**Confirmado**: YYYY-MM-DD (viaje(s) de ejemplo si aplica).
```

- El número `N` es el siguiente correlativo de la lista.
- Si el caso es un bug ya corregido (no un comportamiento esperado), agrega `*(histórico, corregido)*` al título, como en el caso 8 del documento.
- Si el caso tiene alcance medible (cuántos viajes afecta, qué porcentaje), inclúyelo — ayuda a que negocio priorice.
- **No omitas "Por qué opera así"** — es el campo que distingue este documento de un changelog técnico. Un caso sin ese campo está incompleto.

3. Inserta la nueva entrada al final del documento, separada por `---` como las demás.

4. Confirma al usuario en 1-2 líneas qué caso quedó registrado y en qué número — no repitas el contenido completo de vuelta en el chat, ya está en el archivo.

## Ejemplo de invocación

```
/log-casuistica el badge de temperatura ya no marca incumplimiento cuando el viaje entregó toda la carga
```

Debe producir una entrada nueva siguiendo el formato de arriba, basada en lo que se investigó y se implementó en la conversación (causa raíz real, no una suposición).
