import { test, expect, type Page } from '@playwright/test'

/**
 * Humo del ciclo de vida del Directorio (plan 2026-10-21), contra la copia local:
 * una empresa heredada del padrón viejo (INACTIVE + LEGACY_IMPORT) se reactiva con
 * motivo y vuelve a darse de baja; un conductor se da de baja y se reactiva; los
 * motivos se ven en Configuración › Directorio. Deja capturas a 1440 y 390 en
 * test-results/ciclo-de-vida/. Cambia datos de la copia local: lo deja como estaba.
 *
 *   set -a; . ../../.superpowers/local-sim/sim.env; set +a
 *   npx playwright test scripts/smoke/ciclo-de-vida.spec.ts
 */

const PASSWORD = process.env.SIM_PASSWORD ?? ''
const EMPRESA = process.env.LIFECYCLE_CARRIER_ID ?? '00000000-0000-0000-0000-00000000c003'
const CONDUCTOR = process.env.LIFECYCLE_DRIVER_ID ?? '00000000-0000-0000-0000-0000000d0003'
const OUT = 'test-results/ciclo-de-vida'

test.skip(!(process.env.PLAYWRIGHT_BASE_URL ?? '').match(/localhost|127\.0\.0\.1/), 'Solo contra la copia local')
test.skip(!PASSWORD, 'Falta SIM_PASSWORD: carga .superpowers/local-sim/sim.env')
test.describe.configure({ mode: 'serial' })
// `next dev` compila cada ruta la primera vez que se pide: con 30 s no alcanza.
test.setTimeout(240_000)

async function login(page: Page, email: string) {
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  const skip = page.locator('button:has-text("Saltar tour")')
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click()
}

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Más acciones' }).first().click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function elegirMotivo(page: Page, motivo: string) {
  const select = page.getByRole('combobox', { name: 'Motivo' })
  await expect(select.locator('option', { hasText: motivo })).toHaveCount(1)
  await select.selectOption({ label: motivo })
}

test('una empresa heredada del padrón viejo se reactiva con motivo y vuelve a darse de baja', async ({ page }) => {
  await login(page, 'cert@sim.local')
  await page.goto(`/dashboard/carriers/${EMPRESA}`)
  await expect(page.getByText('Dada de baja').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Motivo: Heredada del padrón anterior')).toBeVisible()
  await page.screenshot({ path: `${OUT}/empresa-de-baja-1440.png` })

  await menu(page, 'Reactivar')
  const reactivar = page.getByRole('button', { name: 'Reactivar', exact: true })
  await expect(reactivar).toBeDisabled()
  await elegirMotivo(page, 'Retoma la relación comercial')
  await page.screenshot({ path: `${OUT}/reactivar-1440.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${OUT}/reactivar-390.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await reactivar.click()
  await expect(page.getByText('Activa', { exact: true }).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/^Motivo:/)).toHaveCount(0)

  await menu(page, 'Dar de baja')
  await elegirMotivo(page, 'Lo pidió el transportista')
  await page.getByRole('button', { name: 'Confirmar baja' }).click()
  await expect(page.getByText('Motivo: Lo pidió el transportista')).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: `${OUT}/empresa-dada-de-baja-1440.png` })
})

test('un conductor se da de baja y se reactiva con motivo', async ({ page }) => {
  await login(page, 'ops@sim.local')
  await page.goto(`/dashboard/drivers/${CONDUCTOR}`)
  await expect(page.getByRole('button', { name: 'Más acciones' }).first()).toBeVisible({ timeout: 120_000 })
  await menu(page, 'Dar de baja')
  await elegirMotivo(page, 'Otro')
  await expect(page.getByRole('button', { name: 'Confirmar baja' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Comentario (obligatorio)' }).fill('Prueba de humo')
  await page.getByRole('button', { name: 'Confirmar baja' }).click()
  await expect(page.getByText('Motivo: Otro')).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: `${OUT}/conductor-de-baja-1440.png` })

  await menu(page, 'Reactivar')
  await elegirMotivo(page, 'Se dio de baja por error')
  await page.getByRole('button', { name: 'Reactivar', exact: true }).click()
  await expect(page.getByText(/^Motivo:/)).toHaveCount(0, { timeout: 15000 })
})

test('los motivos se editan en Configuración › Directorio', async ({ page }) => {
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/admin/settings/directory/deactivation-reasons')
  await expect(page.getByText('Heredada del padrón anterior')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Vendido, siniestrado o fuera de servicio')).toBeVisible()
  await page.screenshot({ path: `${OUT}/configuracion-motivos-1440.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${OUT}/configuracion-motivos-390.png` })
})
