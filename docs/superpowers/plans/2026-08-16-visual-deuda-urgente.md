# Deuda visual urgente — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar de producción los dos defectos que no son de estética: texto en voseo y pantallas que afirman cosas falsas mientras cargan.

**Architecture:** Sin dependencias con nada más. Son cinco cadenas de texto y dos condiciones de render. Cada arreglo se blinda con un test que impide que vuelva.

**Tech Stack:** Next.js 15 (App Router), React, TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-16-sistema-visual-design.md` (§6)

## Global Constraints

- **Español neutral, nunca voseo.** "Elige", "Selecciona", "Revisa", "Cierra", "Comparte", "puedes".
  Es un MUST del usuario, no una preferencia de estilo.
- **Cero emojis** en UI; iconos sólo `lucide-react`.
- **Nombrar por el trabajo, no por el modelo de datos.**
- Comandos, siempre desde `monitor-app/frontend/`:
  ```
  npx vitest run <ruta>      # un archivo
  npx vitest run             # todo
  npx tsc --noEmit
  npm run build
  ```
- **Ningún test cuenta como pasado sin haberlo ejecutado.**

---

## Estructura de archivos

| Archivo | Qué cambia | Tarea |
|---|---|---|
| `lib/copy/espanol-neutral.test.ts` | Crear — el guardia contra el voseo | 1 |
| `app/dashboard/operations/closures/page.tsx:146` | Texto | 1 |
| `components/dashboard/LocationCreateForm.tsx:36` | Texto | 1 |
| `components/dashboard/GestionPanel.tsx:247` | Texto | 1 |
| `components/dashboard/TripAssignDialog.tsx:134` | Texto | 1 |
| `components/dashboard/RouteEditor.tsx:137` | Texto | 1 |
| `app/dashboard/compliance/page.tsx:239-241` | La cifra que miente | 2 |
| `app/dashboard/operations/closures/page.tsx:236` | El botón que firma sin datos | 3 |
| `CLAUDE.md` | Puntero roto | 3 |

---

## Task 1: El voseo, y el guardia que impide que vuelva

Cinco textos visibles al usuario están en voseo rioplatense. Arreglarlos es trivial; lo que importa
es que no vuelvan — han vuelto antes, porque nada los detecta.

**Files:**
- Create: `monitor-app/frontend/lib/copy/espanol-neutral.test.ts`
- Modify: los cinco archivos de la tabla

**Interfaces:**
- Consumes: nada.
- Produces: un test que recorre el código fuente. Cualquier tarea futura que agregue voseo lo rompe.

- [ ] **Step 1: Escribir el test que falla**

Crear `monitor-app/frontend/lib/copy/espanol-neutral.test.ts`:

```ts
// @vitest-environment node
/**
 * El producto opera en Chile y el equipo no es rioplatense: el voseo es un
 * MUST del usuario, no una preferencia de estilo. Este test existe porque
 * cinco casos llegaron a producción sin que nada los detectara — el más
 * visible encabezaba el módulo de Cierre.
 *
 * Recorre el código fuente en vez de renderizar: el voseo puede estar en un
 * texto de error, en un placeholder o en una rama que ningún test monta.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Formas verbales del voseo que aparecen en interfaz. Sólo imperativos y
// presentes de 2ª persona rioplatense — nada que pueda chocar con una
// palabra legítima del dominio.
const VOSEO = [
  'revisá', 'cerrá', 'compartí', 'elegí', 'ingresá', 'seleccioná', 'agregá',
  'arrastrá', 'mirá', 'poné', 'hacé', 'tenés', 'podés', 'chequeá', 'verificá',
  'guardá', 'cargá', 'buscá', 'escribí', 'subí', 'marcá', 'confirmá', 'editá',
  'borrá', 'filtrá', 'andá', 'fijate', 'acordate', 'querés', 'sabés', 'debés',
]

function archivosDeInterfaz(): string[] {
  const raiz = join(__dirname, '..', '..')
  return globSync('{app,components,lib}/**/*.{ts,tsx}', { cwd: raiz })
    .filter(f => !f.includes('.test.'))
    .map(f => join(raiz, f))
}

describe('el texto de la interfaz está en español neutral', () => {
  it('no usa formas de voseo', () => {
    const hallazgos: string[] = []

    for (const ruta of archivosDeInterfaz()) {
      const lineas = readFileSync(ruta, 'utf8').split('\n')
      lineas.forEach((linea, i) => {
        const bajo = linea.toLowerCase()
        for (const forma of VOSEO) {
          // \b no sirve con acentos en JS: se delimita a mano.
          const re = new RegExp(`(^|[^a-záéíóúñ])${forma}([^a-záéíóúñ]|$)`, 'i')
          if (re.test(bajo)) {
            hallazgos.push(`${ruta.split('/frontend/')[1]}:${i + 1} → "${forma}"`)
            break
          }
        }
      })
    }

    expect(hallazgos, `Voseo encontrado:\n${hallazgos.join('\n')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla con los 5**

```
cd monitor-app/frontend
npx vitest run lib/copy/espanol-neutral.test.ts
```

Esperado: FAIL, listando exactamente 5 hallazgos:
`closures/page.tsx:146` · `LocationCreateForm.tsx:36` · `GestionPanel.tsx:247` ·
`TripAssignDialog.tsx:134` · `RouteEditor.tsx:137`.

Si aparecen más de 5, mejor — arreglarlos todos. Si aparecen 0, el detector está mal: revisar el
regex antes de seguir.

- [ ] **Step 3: Corregir los cinco textos**

`app/dashboard/operations/closures/page.tsx:146`:
```tsx
            Revisa pendientes, cierra Tractoreo y Equipos Completos, y comparte el reporte del día — todo en un solo lugar.
```

`components/dashboard/LocationCreateForm.tsx:36`:
```tsx
      setCreateErr('Elige un generador de carga'); return
```

`components/dashboard/GestionPanel.tsx:247`:
```tsx
                Es el mismo estado que se muestra en el encabezado — aquí puedes confirmarlo manualmente si hace falta.
```

`components/dashboard/TripAssignDialog.tsx:134`:
```tsx
    if (!fleet.driver_id) { setErr('Elige un conductor del directorio de Empresas antes de crear el viaje'); return }
```

`components/dashboard/RouteEditor.tsx:137`:
```tsx
                Elige una sugerencia de la lista para clasificar la zona automáticamente
```

- [ ] **Step 4: Correr y verificar que pasa**

```
npx vitest run lib/copy/espanol-neutral.test.ts
```
Esperado: 1 passed.

Y la suite completa, porque hay tests que afirman texto:
```
npx vitest run
```
Si alguno falla, es porque afirmaba el texto viejo — actualizar la aserción, no revertir el texto.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/copy/espanol-neutral.test.ts \
        monitor-app/frontend/app/dashboard/operations/closures/page.tsx \
        monitor-app/frontend/components/dashboard/LocationCreateForm.tsx \
        monitor-app/frontend/components/dashboard/GestionPanel.tsx \
        monitor-app/frontend/components/dashboard/TripAssignDialog.tsx \
        monitor-app/frontend/components/dashboard/RouteEditor.tsx
git commit -m "fix(ui): el texto vuelve a espanol neutral, y un guardia impide que el voseo regrese"
```

---

## Task 2: La cifra que miente mientras carga

`app/dashboard/compliance/page.tsx:240` renderiza `{statusQuery.data?.total_pending ?? 0}`. Ese
`?? 0` pinta un **0 en cifra grande** mientras la consulta está en vuelo, y después salta a 2.360.
Durante ese segundo la pantalla afirma con seguridad algo falso.

El mismo archivo ya trata bien el caso once líneas más abajo (`statusQuery.isPending` en la línea
250) — es una inconsistencia dentro de un archivo, no una decisión.

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/compliance/page.tsx:238-241`
- Test: `monitor-app/frontend/app/dashboard/compliance/page.test.tsx`

**Interfaces:**
- Consumes: `statusQuery` (React Query) ya existente en el archivo.
- Produces: nada nuevo.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `app/dashboard/compliance/page.test.tsx` (seguir el estilo de mocks del propio archivo):

```tsx
it('no muestra un total mientras la consulta está en vuelo', async () => {
  // La consulta nunca resuelve: reproduce el instante de carga.
  mockStatusQuery({ isPending: true, data: undefined })

  render(<CompliancePage />)

  // El "0" grande era la mentira: durante la carga no hay total que mostrar.
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  expect(screen.queryByText(/documentos por cubrir/)).not.toBeInTheDocument()
})
```

Si el archivo no tiene un helper `mockStatusQuery`, usar el mismo mecanismo con el que ya mockea
`useQuery` — **no inventar uno nuevo**.

- [ ] **Step 2: Correr y verificar que falla**

```
npx vitest run app/dashboard/compliance/page.test.tsx
```
Esperado: FAIL — encuentra el `0`.

- [ ] **Step 3: Corregir**

En `app/dashboard/compliance/page.tsx`, reemplazar el bloque de las líneas 238-241:

```tsx
          <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border">
            {statusQuery.isPending ? (
              // Una cifra derivada no se muestra hasta tener el dato: un "0"
              // grande durante la carga afirma algo falso (el valor real es
              // 2.360). Se reserva el alto para que la fila no salte.
              <span className="h-8 w-40 rounded bg-gray-100 animate-pulse" aria-hidden />
            ) : (
              <>
                <span className="text-2xl font-bold text-slate-800 tabular-nums leading-none">
                  {statusQuery.data?.total_pending ?? 0}
                </span>
                <span className="text-xs text-gray-500">documentos por cubrir</span>
                {group === 'carrier' && (statusQuery.data?.total_unclassified ?? 0) > 0 && (
                  <span className="text-xs text-gray-400">
                    · {statusQuery.data?.total_unclassified} sin clasificar
                  </span>
                )}
              </>
            )}
          </div>
```

- [ ] **Step 4: Correr y verificar que pasa**

```
npx vitest run app/dashboard/compliance/page.test.tsx
```
Esperado: passed, sin romper los casos existentes del archivo.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/compliance/page.tsx \
        monitor-app/frontend/app/dashboard/compliance/page.test.tsx
git commit -m "fix(certificacion): la cifra no aparece hasta tener el dato, en vez de un cero falso"
```

---

## Task 3: El botón que firma un día sin datos

En `/dashboard/operations/closures`, mientras el área de datos muestra el spinner, **"Confirmar
cierre" ya está habilitado** (`page.tsx:236`, `disabled={closing}` — sólo mira si el cierre está en
curso, no si los datos llegaron). Se puede firmar un día sobre información que no terminó de cargar.

De paso, el puntero roto: `monitor-app/frontend/CLAUDE.md` contiene `@AGENTS.md` y ese archivo no
existe.

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx`
- Modify: `monitor-app/frontend/CLAUDE.md`
- Test: `monitor-app/frontend/app/dashboard/operations/closures/page.test.tsx`

**Interfaces:**
- Consumes: el estado de carga de las secciones (`FlotaDelDiaSection` consulta
  `dailyClosuresApi.get` y `equipmentClosuresApi.get`). Si la página no conoce ese estado hoy, se
  eleva con las mismas `queryKey` ya usadas (`['daily-closure', fecha]`,
  `['equipment-closures', fecha]`) — **no se agrega una consulta nueva**.
- Produces: nada nuevo.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `app/dashboard/operations/closures/page.test.tsx`:

```tsx
it('no deja confirmar el cierre mientras los datos del día están cargando', async () => {
  // Firmar un día es un acto con nombre y hora. No puede ocurrir sobre datos
  // que todavía no llegaron.
  mockDailyClosure({ isPending: true, data: undefined })

  render(<ClosuresPage />)

  expect(screen.getByRole('button', { name: /confirmar cierre/i })).toBeDisabled()
})
```

Usar el mismo mecanismo de mock que el archivo ya tiene para `dailyClosuresApi`.

- [ ] **Step 2: Correr y verificar que falla**

```
npx vitest run app/dashboard/operations/closures/page.test.tsx
```
Esperado: FAIL — el botón está habilitado.

- [ ] **Step 3: Corregir**

En `page.tsx`, junto a `const [closing, setClosing] = useState(false)` (línea 61), leer el estado de
carga desde las mismas `queryKey` que ya usan las secciones:

```tsx
  // Firmar el día sobre datos a medio cargar produce un cierre falso. El
  // boton espera a que las dos consultas que alimentan el cierre resuelvan;
  // son las mismas queryKey que usa FlotaDelDiaSection, no consultas nuevas.
  const cargandoDatos = useIsFetching({ queryKey: ['daily-closure', fecha] }) > 0
                     || useIsFetching({ queryKey: ['equipment-closures', fecha] }) > 0
```

con `import { useIsFetching } from '@tanstack/react-query'`, y en la línea 236:

```tsx
            disabled={closing || cargandoDatos}
```

Si el botón muestra texto según el estado, agregar el caso: `cargandoDatos ? 'Cargando…' : …`,
manteniendo el nombre de la acción igual al de la confirmación.

- [ ] **Step 4: Arreglar el puntero roto**

`monitor-app/frontend/CLAUDE.md` contiene `@AGENTS.md`, que no existe. O se crea el `AGENTS.md` con
las reglas del frontend, o se reemplaza el contenido de `CLAUDE.md` por esas reglas directamente.
**Elegir una y dejar el archivo consistente** — un puntero a un archivo inexistente es peor que no
tener puntero.

- [ ] **Step 5: Correr todo**

```
npx vitest run
npx tsc --noEmit
npm run build
```
Esperado: los tres en verde.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/app/dashboard/operations/closures/page.tsx \
        monitor-app/frontend/app/dashboard/operations/closures/page.test.tsx \
        monitor-app/frontend/CLAUDE.md
git commit -m "fix(cierre): no se puede firmar el dia con los datos a medio cargar"
```

---

## Task 4: Verificar en el ambiente real

No hay código nuevo. Es comprobar que los arreglos se ven, con el mismo método de la auditoría.

- [ ] **Step 1: Desplegar a `dev` y esperar**

Push a `origin/dev` y confirmar el workflow (`gh run watch`).

- [ ] **Step 2: Medir contra el ambiente desplegado**

Con Playwright sobre `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`, a 1440×900:

1. `/dashboard/compliance` — recargar y confirmar que **no aparece ningún "0" grande** antes de que
   llegue el total.
2. `/dashboard/operations/closures` — recargar y confirmar que **"Confirmar cierre" está
   deshabilitado** mientras el área de datos muestra el spinner.
3. `/dashboard/operations/closures` — leer el subtítulo y confirmar que dice
   *"Revisa pendientes, cierra…"*.

- [ ] **Step 3: Actualizar `AGENTLOG.md`**

Registrar qué se corrigió, con los números medidos, y dejar como próximo paso el
**Plan 2 — Tokens y componentes compartidos**.

- [ ] **Step 4: Commit**

```bash
git add AGENTLOG.md
git commit -m "docs: AGENTLOG — deuda visual urgente corregida y verificada en dev"
```

---

## Lo que sigue

- **Plan 2 — Tokens y componentes compartidos** (§3 y §4 del spec). Sin dependencias; es el que
  desbloquea las pantallas del Cierre.
- **Plan 3 — El recorrido del Cierre**, que se construye sobre el Plan 2.
