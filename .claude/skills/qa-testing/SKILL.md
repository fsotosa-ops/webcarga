---
name: qa-testing
description: Use when writing tests, deciding what level to test at, or before claiming work is done in suma-scout. Covers the DI pattern, what belongs in integration tests vs fakes, how to evaluate model output, and the defects tests structurally cannot catch.
---

# QA y testing en Suma Scout

## Qué se prueba y a qué nivel

**Unitario, con fakes.** Toda dependencia externa es interfaz + fake + adaptador real. La lógica se prueba contra el fake; el adaptador real no lleva test propio. Es lo que permitió que el cambio de plataforma no tocara la lógica de negocio.

Un fake que solo devuelve valores fijos no prueba nada: tiene que **guardar lo que se le escribió**, para que el test pueda afirmar *qué* se escribió y no solo que no lanzó excepción.

**Integración, contra Postgres real.** Los fakes no ven migraciones, RLS, restricciones de unicidad ni consultas de agregación. Todo eso se prueba contra la base:

- Que la unicidad la garantice la restricción y no el código.
- Que la agregación de cohorte **no devuelva nada por debajo de 4 diagnósticos**, y sí devuelva a partir de 4.
- Que las políticas RLS bloqueen lo que deben bloquear — probar el caso denegado, no solo el permitido.

**De punta a punta, poco y sobre el embudo.** Caros y lentos. Reservarlos para el camino que produce el activo del negocio: llegar por el link, conversar, cerrar, ver el reporte.

## El borde entre `web` y `agentes`

Ningún test unitario lo cubre, porque cada lado usa su propio fake. Lo cubre **el CI regenerando `packages/contracts` y fallando ante un diff**. Ese paso *es* el test de esa frontera; tratarlo como opcional reintroduce la clase de bug que cortó el embudo tres veces en el proyecto anterior.

## Lo que devuelve el modelo no se prueba con asserts

Un test no puede afirmar que un OKR es bueno. Lo que **sí** se prueba de forma determinística:

- Que la salida valide contra su esquema, y que **una salida inválida no tumbe el workflow** — que reintente o degrade.
- Que se escriba el rastro en `agent_turns`, con los fragmentos usados.
- Que el idioma de la respuesta sea el del diagnóstico.
- Que la dosis de estantes recuperados responda al `interventionMode`.

**La calidad se evalúa, no se testea**: un set fijo de transcripts con su resultado esperado, corrido contra cambios de prompt. Hoy no existe — es `TECH_DEBT.md` 1.2, y depende de `agent_turns`.

## Lo que los tests estructuralmente no ven

Nada de esto da error. Da un resultado plausible y equivocado, y solo se detecta **mirando**:

- **El PDF.** Colores que no se parsean, texto del color del fondo, interlineado que se estira, títulos que quedan huérfanos al pie. Los cuatro casos concretos están en `AGENTLOG.md`. Para verificarlo: archivo temporal que llame a `renderToBuffer` y escriba a una ruta, correrlo, **abrir el archivo**, y borrar el temporal al terminar.
- **La jerarquía editorial del reporte.** El criterio es documento editorial, no pantalla exportada.
- **El voseo** en texto visible y en prompts. Pasa lint y typecheck sin problema. Grepear antes de cerrar.
- **Los links impresos en el PDF.** Un dominio que no resuelve es lo único del documento que puede estar mal y que nadie detecta hasta que alguien lo abre.

## Antes de decir que algo está listo

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test
cd apps/agents && uv run mypy . && uv run ruff check . && uv run pytest
```

**Correr el comando y mirar la salida.** Una afirmación de que algo pasa sin evidencia del comando es una hipótesis.

Y si el trabajo tocó algo visual o el documento, **abrirlo**. El typecheck atrapa lo que los tests no; los ojos atrapan lo que ninguno de los dos.
