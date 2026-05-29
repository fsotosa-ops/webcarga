import { test, expect } from '@playwright/test'

const EMAIL    = process.env.DEMO_EMAIL    ?? ''
const PASSWORD = process.env.DEMO_PASSWORD ?? ''

test('demo tour completo', async ({ page }) => {
  // ── 1. Login ──────────────────────────────────────────────────
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/**', { timeout: 15000 })
  await page.waitForTimeout(1500)

  // Dismiss tour auto-start si aparece (clic en Skip)
  const skipBtn = page.locator('button:has-text("Saltar tour")')
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click()
  }

  // ── 2. Sidebar ────────────────────────────────────────────────
  await page.waitForSelector('[data-tour="sidebar"]')
  await page.hover('[data-tour="sidebar"]')
  await page.waitForTimeout(600)

  // ── 3. Diario — tabla de viajes ───────────────────────────────
  await page.goto('/dashboard/diario')
  await page.waitForSelector('[data-tour="trip-table"]', { timeout: 10000 })
  await page.waitForTimeout(1000)

  // Scroll suave por la tabla
  await page.evaluate(() => {
    document.querySelector('[data-tour="trip-table"]')?.scrollIntoView({ behavior: 'smooth' })
  })
  await page.waitForTimeout(800)

  // ── 4. Filtros ────────────────────────────────────────────────
  await page.waitForSelector('[data-tour="trip-filters"]')
  await page.hover('[data-tour="trip-filters"]')
  await page.waitForTimeout(600)

  // Interactuar con la búsqueda
  const searchInput = page.locator('[data-tour="trip-filters"] input[type="text"]').first()
  if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.click()
    await searchInput.type('test', { delay: 80 })
    await page.waitForTimeout(500)
    await searchInput.clear()
    await page.waitForTimeout(400)
  }

  // ── 5. SlideOver — detalle del viaje ──────────────────────────
  const firstRow = page.locator('[data-tour="trip-slideover-btn"]')
  if (await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstRow.click()
    await page.waitForTimeout(800)

    // Navegar los 3 tabs del SlideOver
    const tabs = page.locator('[role="tab"], button:has-text("Empresa"), button:has-text("Bitácora")')
    const tabCount = await tabs.count()
    for (let i = 0; i < Math.min(tabCount, 3); i++) {
      await tabs.nth(i).click({ force: true })
      await page.waitForTimeout(600)
    }

    // Cerrar SlideOver (buscar botón X o Escape)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  // ── 6. Botón Agregar viaje ────────────────────────────────────
  const addBtn = page.locator('[data-tour="trip-create-btn"]')
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.hover()
    await page.waitForTimeout(600)
  }

  // ── 7. Transportistas ─────────────────────────────────────────
  await page.goto('/dashboard/transportistas')
  await page.waitForSelector('[data-tour="transportistas-list"]', { timeout: 10000 })
  await page.waitForTimeout(800)

  // Scroll por la lista
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }))
  await page.waitForTimeout(600)
  await page.evaluate(() => window.scrollBy({ top: -300, behavior: 'smooth' }))
  await page.waitForTimeout(400)

  // ── 8. Admin ──────────────────────────────────────────────────
  await page.goto('/dashboard/admin/usuarios')
  const adminSection = page.locator('[data-tour="admin-users"]')
  if (await adminSection.isVisible({ timeout: 5000 }).catch(() => false)) {
    await adminSection.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1200)
  }

  // ── 9. Pausa final ────────────────────────────────────────────
  await page.waitForTimeout(2000)
})
