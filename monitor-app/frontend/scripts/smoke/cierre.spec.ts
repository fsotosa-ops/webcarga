import { test, expect, type Page } from '@playwright/test'

/**
 * Humo del Cierre con un solo patrón (C11), contra la copia local con el router real
 * de Next (los tests de vitest usan una URL en memoria que confirma al instante):
 * Flota del día → recuadro → chip → filtro de Empresa tipeando → ocultar y mover una
 * columna → recargar → todo sigue igual. Deja capturas de las cuatro pestañas a 1440
 * y 390 en test-results/cierre/.
 *
 *   set -a; . ../../.superpowers/local-sim/sim.env; set +a
 *   npx playwright test scripts/smoke/cierre.spec.ts
 */

const PASSWORD = process.env.SIM_PASSWORD ?? ''
const FECHA = process.env.CIERRE_FECHA ?? '2026-10-12'
const CIERRE = `/dashboard/operations/closures?date=${FECHA}`

test.skip(!(process.env.PLAYWRIGHT_BASE_URL ?? '').match(/localhost|127\.0\.0\.1/), 'Solo contra la copia local')
test.skip(!PASSWORD, 'Falta SIM_PASSWORD: carga .superpowers/local-sim/sim.env')

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'ops@sim.local')
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  const skip = page.locator('button:has-text("Saltar tour")')
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click()
}

const tabla = (page: Page) => page.getByRole('table', { name: 'Flota del día' })

/** "Columnas" › "Restablecer", esperando a que la API lo guarde: cada corrida parte
 *  y termina con las columnas por defecto, sin depender de la anterior. */
async function restablecerColumnas(page: Page) {
  await page.getByRole('button', { name: 'Columnas' }).click()
  const guardado = page.waitForResponse(r => r.url().includes('/me/table-preferences/closure.fleet') && r.request().method() === 'DELETE')
  await page.getByRole('button', { name: 'Restablecer' }).click()
  await guardado
  await page.keyboard.press('Escape')
}
const encabezados = (page: Page) => tabla(page).locator('thead th').allInnerTexts()

test('C11: recuadro, filtro tipeado y columnas sobreviven a recargar', async ({ page }) => {
  test.setTimeout(120000)
  const errores: string[] = []
  page.on('pageerror', e => errores.push(e.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  await page.goto(CIERRE)
  await expect(tabla(page)).toBeVisible({ timeout: 30000 })
  await restablecerColumnas(page)

  // Recuadro → chip con las palabras de la columna, y el recuadro marcado. El primer
  // recuadro (fuera de "Todos") que tenga filas ese día.
  const recuadros = page.locator('button[aria-pressed]').filter({ hasText: /\d/ })
  await expect(recuadros.first()).toBeVisible()
  const nombres = await recuadros.evaluateAll(bs => bs.map(b => b.getAttribute('aria-label') ?? ''))
  const elegido = nombres.find(n => !n.startsWith('Todos') && Number(n.split(', ').at(-1)) > 0)!
  const recuadro = page.getByRole('button', { name: elegido, exact: true })
  await recuadro.click()
  await expect(recuadro).toHaveAttribute('aria-pressed', 'true')
  // El recuadro puede ser de Estado o de Tipo de motivo (estado + motivo).
  const chipDelRecuadro = page.getByRole('button', { name: /^Quitar filtro (Estado|Tipo de motivo)$/ })
  await expect(chipDelRecuadro).toBeVisible()

  // Filtro de Empresa tipeando: la primera empresa que ofrece, buscada por sus letras.
  await page.getByRole('button', { name: 'Filtrar por Empresa' }).click()
  const filtro = page.getByRole('dialog', { name: 'Filtrar por Empresa' })
  const primera = (await filtro.getByRole('checkbox').first().getAttribute('aria-label'))!.split(',')[0]
  await filtro.getByRole('searchbox').fill(primera.slice(0, 4))
  await filtro.getByRole('checkbox', { name: new RegExp(`^${primera.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`) }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByText(`Empresa: ${primera}`)).toBeVisible()

  // Columnas: ocultar una y subir otra.
  await page.getByRole('button', { name: 'Columnas' }).click()
  // La casilla cambia cuando se escribe la preferencia (al instante, en la caché).
  const origen = page.getByRole('checkbox', { name: 'Mostrar Origen habitual' })
  await origen.click()
  await expect(origen).not.toBeChecked()
  await page.getByRole('button', { name: 'Subir Generador de carga' }).click()
  await page.keyboard.press('Escape')
  const antes = await encabezados(page)
  expect(antes.join('|')).not.toContain('Origen habitual')
  const url = page.url()

  // Recargar: la vista (URL) y las columnas (preferencia de la persona) siguen iguales.
  await page.reload()
  await expect(tabla(page)).toBeVisible({ timeout: 30000 })
  expect(page.url()).toBe(url)
  await expect(page.getByRole('button', { name: /^Quitar filtro (Estado|Tipo de motivo)$/ })).toBeVisible()
  await expect(page.getByText(`Empresa: ${primera}`)).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`^${elegido.split(', ')[0]}, `) })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => encabezados(page)).toEqual(antes)

  // Dejar las columnas como estaban para la próxima corrida.
  await restablecerColumnas(page)
  expect(errores).toEqual([])
})

test('capturas de las cuatro pestañas a 1440 y 390', async ({ page }) => {
  test.setTimeout(180000)
  await login(page)
  for (const ancho of [1440, 390]) {
    await page.setViewportSize({ width: ancho, height: ancho === 1440 ? 900 : 844 })
    for (const [tab, nombre] of [['fleet', 'flota'], ['trips', 'viajes'], ['pending', 'pendientes'], ['report', 'reporte']] as const) {
      await page.goto(`${CIERRE}&tab=${tab}`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(800)
      await page.screenshot({ path: `test-results/cierre/${nombre}-${ancho}.png`, fullPage: true })
    }
  }
})
