import { test, expect, type Page, type Response } from '@playwright/test'

/**
 * Humo E2E antes de cada despliegue (plan 2026-10-14, Entrega 0).
 *
 * Corre contra la copia local (`.superpowers/local-sim/start.sh`): datos 100 %
 * ficticios, así que puede escribir. Nunca contra dev ni producción.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test scripts/smoke
 *
 * La matriz: cada rol entra y visita CADA enlace que su menú le muestra. Una
 * pantalla pasa si no lanza errores, si ninguna llamada a la API responde 5xx
 * o 403 (un 403 es un botón o una pantalla que la API rechaza), y si su
 * contenido termina de cargar.
 */

// La contraseña de los usuarios ficticios vive fuera del repo (.superpowers/local-sim/sim.env).
const PASSWORD = process.env.SIM_PASSWORD ?? ''
const ROLES = [
  { role: 'Supervisor de Certificación', email: 'cert@sim.local' },
  { role: 'Supervisor de Operaciones', email: 'ops@sim.local' },
  { role: 'Operador de Operaciones', email: 'oper@sim.local' },
] as const
// El Propietario queda fuera: su rol exige verificación en dos pasos y la copia local
// no tiene TOTP. Ve todo lo que ven los otros tres, más Administración.

test.skip(
  !(process.env.PLAYWRIGHT_BASE_URL ?? '').match(/localhost|127\.0\.0\.1/),
  'El humo escribe datos: solo corre contra la copia local',
)
test.skip(!PASSWORD, 'Falta SIM_PASSWORD: carga .superpowers/local-sim/sim.env')

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  const skip = page.locator('button:has-text("Saltar tour")')
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click()
}

/** Las rutas del menú lateral del rol, sin repetir. */
async function menuLinks(page: Page): Promise<string[]> {
  const nav = page.locator('nav, aside').first()
  await nav.waitFor({ timeout: 15000 })
  const hrefs = await page
    .locator('nav a[href^="/dashboard"], aside a[href^="/dashboard"]')
    .evaluateAll(as => as.map(a => (a as HTMLAnchorElement).getAttribute('href') ?? ''))
  return [...new Set(hrefs.map(h => h.split('?')[0]).filter(Boolean))]
}

function watch(page: Page) {
  const problems: string[] = []
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
  page.on('response', (r: Response) => {
    const url = r.url()
    if (!url.includes('/api/')) return
    if (r.status() >= 500 || r.status() === 403) problems.push(`${r.status()} ${r.request().method()} ${url}`)
  })
  return problems
}

for (const { role, email } of ROLES) {
  test(`${role}: cada pantalla del menú carga sin errores ni 403`, async ({ page }) => {
    test.setTimeout(180000)
    await login(page, email)
    const links = await menuLinks(page)
    expect(links.length, 'el menú no puede venir vacío').toBeGreaterThan(0)

    const report: string[] = []
    for (const href of links) {
      const problems = watch(page)
      await page.goto(href)
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      // Un esqueleto o "Cargando" que sigue ahí después de la red quieta es una pantalla colgada.
      const stuck = await page.getByText(/^Cargando/).first().isVisible().catch(() => false)
      if (stuck) problems.push('sigue "Cargando…" con la red quieta')
      if (problems.length) report.push(`${href}\n  ${problems.join('\n  ')}`)
      page.removeAllListeners('response')
      page.removeAllListeners('pageerror')
    }
    expect(report, `pantallas con problemas para ${role}`).toEqual([])
  })
}

test('Directorio: la ficha de una empresa abre y sobrevive a recargar', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/carriers')
  const row = page.locator('a[href^="/dashboard/carriers/"]').first()
  await row.waitFor({ timeout: 30000 })
  await row.click()
  await page.waitForURL(/\/dashboard\/carriers\/[0-9a-f-]{36}/, { timeout: 15000 })
  const url = page.url()
  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(page.url()).toBe(url)
  expect(problems).toEqual([])
})

test('Directorio: dar de baja muestra antes lo que toca (D2), sin confirmar', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/carriers')
  await page.locator('a[href^="/dashboard/carriers/"]').first().waitFor({ timeout: 30000 })
  const fichas = await page.locator('a[href^="/dashboard/carriers/"]')
    .evaluateAll(as => [...new Set(as.map(a => (a as HTMLAnchorElement).getAttribute('href')!))])
  // La primera empresa activa: solo a ella se le ofrece "Dar de baja".
  const baja = page.getByRole('button', { name: 'Dar de baja' })
  let encontrada = false
  for (const href of fichas.slice(0, 10)) {
    await page.goto(href)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    if (await baja.isVisible().catch(() => false)) { encontrada = true; break }
  }
  expect(encontrada, 'ninguna de las primeras 10 empresas está activa').toBe(true)
  await baja.click()
  await expect(page.getByText(/Su flota activa:/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Confirmar baja' })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  expect(problems).toEqual([])
})

test('Por asignar: la sección Descartados abre sin errores', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/compliance/inbox')
  await page.getByRole('button', { name: /Descartados/ }).click()
  await expect(page.getByText(/No hay documentos descartados|Restaurar/).first()).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

test('Pedir a Certificación: Operaciones pide un documento y Certificación lo resuelve (Entrega B)', async ({ browser }) => {
  test.setTimeout(180000)
  // Operaciones: desde la ficha de un conductor del Directorio.
  const ops = await (await browser.newContext()).newPage()
  const opsProblems = watch(ops)
  await login(ops, 'oper@sim.local')
  await ops.goto('/dashboard/carriers')
  await ops.locator('a[href^="/dashboard/carriers/"]').first().waitFor({ timeout: 30000 })
  const fichas = await ops.locator('a[href^="/dashboard/carriers/"]').evaluateAll(
    as => [...new Set(as.map(a => (a as HTMLAnchorElement).getAttribute('href')!))])
  let pedido = false
  for (const href of fichas.slice(0, 6)) {
    await ops.goto(href)
    await ops.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await ops.getByRole('button', { name: /^Conductores/ }).click()
    await ops.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    // Tarjetas del roster de conductores: un botón con el avatar de iniciales.
    const cards = ops.locator('button:has(div.rounded-full.w-8)')
    const total = await cards.count()
    for (let i = 0; i < Math.min(total, 4) && !pedido; i++) {
      await cards.nth(i).click()
      const pedir = ops.getByRole('button', { name: /^Pedir .* a Certificación$/ }).first()
      // isVisible no espera: waitFor sí.
      if (await pedir.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
        await pedir.click()
        await expect(ops.getByText('Pedido a Certificación').first()).toBeVisible({ timeout: 15000 })
        pedido = true
      }
      await ops.keyboard.press('Escape')
    }
    if (pedido) break
  }
  expect(pedido, 'no se encontró ningún documento pendiente para pedir').toBe(true)
  expect(opsProblems).toEqual([])

  // Certificación: lo ve arriba de Pendientes y lo resuelve.
  const cert = await (await browser.newContext()).newPage()
  const certProblems = watch(cert)
  await login(cert, 'cert@sim.local')
  await cert.goto('/dashboard/compliance/pending')
  const bloque = cert.getByRole('region', { name: 'Pedidos de Operaciones' })
  await expect(bloque).toBeVisible({ timeout: 20000 })
  const antes = await bloque.getByRole('button', { name: 'Resolver' }).count()
  await bloque.getByRole('button', { name: 'Resolver' }).first().click()
  await expect.poll(async () => (await bloque.isVisible()) ? bloque.getByRole('button', { name: 'Resolver' }).count() : 0,
    { timeout: 15000 }).toBeLessThan(antes)
  expect(certProblems).toEqual([])
})

// ── Entrega C (D4 + Cert 2b) ────────────────────────────────────────────────

test('Directorio › Conductores: filtrar "Sin empresa" y abrir su ficha propia (C5)', async ({ page }) => {
  // Sin conductores sin empresa en la copia local, el recorrido toma el camino largo.
  test.setTimeout(90000)
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/drivers')
  await page.getByRole('button', { name: /^Sin empresa/ }).click()
  await page.waitForURL(/flag=without_carrier/)
  const ficha = page.locator('tbody a[href^="/dashboard/drivers/"]').first()
  if (await ficha.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
    await ficha.click()
    await page.waitForURL(/\/dashboard\/drivers\/[0-9a-f-]{36}/)
    await expect(page.getByText('Dónde trabaja')).toBeVisible({ timeout: 15000 })
  } else {
    // La copia local puede no tener conductores sin empresa: abrir cualquiera.
    await page.goto('/dashboard/drivers')
    await page.locator('tbody a[href^="/dashboard/drivers/"]').first().click()
    await expect(page.getByText('Dónde trabaja')).toBeVisible({ timeout: 15000 })
  }
  expect(problems).toEqual([])
})

test('La ficha de un equipo: Actividad → "Ver viajes en el Monitor" (C11)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/assets')
  await page.locator('tbody a[href^="/dashboard/assets/"]').first().click()
  await page.waitForURL(/\/dashboard\/assets\/[0-9a-f-]{36}/)
  await page.getByRole('button', { name: 'Actividad' }).click()
  await page.getByRole('link', { name: /Ver viajes en el Monitor/ }).click()
  await page.waitForURL(/\/operations\/monitor\?tab=historial&q=/)
  const q = new URL(page.url()).searchParams.get('q')!
  await expect(page.locator(`input[value="${q}"]`)).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

test('Certificación › Conductores con pendientes: la fila abre la ficha en la pestaña Documentos', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/drivers?documents=pending')
  await page.locator('tbody a[href^="/dashboard/drivers/"]').first().click()
  await page.waitForURL(/\/dashboard\/drivers\/[0-9a-f-]{36}\?tab=documentos/)
  await expect(page.getByRole('button', { name: 'Documentos' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Documentación')).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

test('La ficha de un equipo: sus 4 pestañas abren sin errores', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/assets')
  await page.locator('tbody a[href^="/dashboard/assets/"]').first().click()
  await page.waitForURL(/\/dashboard\/assets\/[0-9a-f-]{36}/)
  const tabs = page.getByRole('group', { name: 'Secciones del equipo' }).getByRole('button')
  await expect(tabs).toHaveText(['Resumen', 'Documentos', 'Dónde trabaja', 'Actividad'])
  await page.getByRole('button', { name: 'Documentos' }).click()
  await expect(page.getByText('Documentación')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'Dónde trabaja' }).click()
  await expect(page.getByRole('heading', { name: 'Dónde trabaja' })).toBeVisible()
  await page.getByRole('button', { name: 'Actividad' }).click()
  await expect(page.getByRole('link', { name: /Ver viajes en el Monitor/ })).toBeVisible()
  await page.getByRole('button', { name: 'Resumen' }).click()
  await expect(page.getByText('Tipo de equipo', { exact: true })).toBeVisible()
  expect(problems).toEqual([])
})

test('La URL vieja de la ficha de Certificación cae en la ficha única (C6)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/carriers')
  const href = await page.locator('a[href^="/dashboard/carriers/"]').first().getAttribute('href', { timeout: 30000 })
  const id = href!.split('/').pop()!.split('?')[0]
  await page.goto(`/dashboard/compliance/${id}`)
  await page.waitForURL(new RegExp(`/dashboard/carriers/${id}\\?tab=documentos`), { timeout: 15000 })
  await expect(page.getByText('De la empresa').first()).toBeVisible({ timeout: 20000 })
  expect(problems).toEqual([])
})

test('El Monitor abre la vista rápida desde una fila (C10)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/operations/monitor?tab=historial')
  const trigger = page.getByRole('button', { name: /^Ver (conductor|equipo|empresa) / }).first()
  await trigger.waitFor({ timeout: 30000 })
  await trigger.click()
  await expect(page.getByRole('link', { name: 'Abrir ficha completa' })).toBeVisible({ timeout: 15000 })
  expect(page.url()).toContain('/operations/monitor')
  expect(problems).toEqual([])
})

// ── Entrega D (una forma de subir + Por asignar) ────────────────────────────

test('Por asignar: subir sin contexto deja lo no resuelto en la bandeja, y se resuelve ahí (D)', async ({ page }) => {
  test.setTimeout(120000)
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/compliance/inbox')
  await expect(page.getByRole('heading', { name: /Por asignar/ })).toBeVisible({ timeout: 20000 })

  // Un nombre que no dice nada: el reconocedor no lo puede asignar.
  const nombre = `IMG_${Date.now()}.pdf`
  await page.getByLabel('Elegir documentos').setInputFiles({
    name: nombre, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${nombre}`),
  })
  const panel = page.getByRole('dialog', { name: 'Subir documentos' })
  await expect(panel).toBeVisible({ timeout: 20000 })
  await panel.getByRole('button', { name: /Guardar · 1 a Por asignar/ }).click()
  await expect(panel.getByText('En Por asignar', { exact: true })).toBeVisible({ timeout: 20000 })
  await panel.getByRole('button', { name: 'Cerrar el lote' }).click()

  // Llegó a la bandeja: se abre y se descarta (queda restaurable en Descartados).
  const fila = page.getByRole('table').getByText(nombre)
  await expect(fila).toBeVisible({ timeout: 20000 })
  await fila.click()
  await page.getByRole('button', { name: 'Descartar' }).click()
  await expect(page.getByText(/Puedes restaurarlos en Descartados/)).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

test('La ficha de empresa sube documentos con la empresa ya puesta (D)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/compliance')
  const href = await page.locator('a[href*="?tab=documentos"]').first().getAttribute('href', { timeout: 30000 })
  await page.goto(href!)
  await expect(page.getByText('De la empresa').first()).toBeVisible({ timeout: 20000 })
  // Solo si la empresa está activa recibe documentos.
  const subir = page.getByRole('button', { name: 'Subir documentos' })
  if (await subir.isVisible().catch(() => false)) await expect(subir).toBeEnabled()
  expect(problems).toEqual([])
})
