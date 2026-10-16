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
  { role: 'Supervisor de Seguros', email: 'seg@sim.local' },
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
  // La primera empresa activa: solo a ella se le ofrece "Dar de baja", en el ⋯.
  const baja = page.getByRole('menuitem', { name: 'Dar de baja' })
  let encontrada = false
  for (const href of fichas.slice(0, 10)) {
    await page.goto(href)
    await page.getByRole('button', { name: 'Más acciones' }).click({ timeout: 30000 })
    if (await baja.isVisible().catch(() => false)) { encontrada = true; break }
    await page.keyboard.press('Escape')
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
    await ops.getByRole('group', { name: 'Secciones de la empresa' }).getByRole('button', { name: /^Conductores/ }).click()
    await ops.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    // La flota de la empresa es una tabla (15/10): cada fila abre la ficha en modal.
    const cards = ops.locator('tbody tr')
    const total = await cards.count()
    for (let i = 0; i < Math.min(total, 4) && !pedido; i++) {
      await cards.nth(i).click()
      // El modal es la ficha del conductor: sus documentos están a la vista, sin pestañas.
      await ops.getByRole('dialog').getByRole('region', { name: 'Documentos' }).waitFor({ timeout: 15000 })
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
    await expect(page.getByRole('region', { name: 'Detalles' })).toBeVisible({ timeout: 15000 })
  } else {
    // La copia local puede no tener conductores sin empresa: abrir cualquiera.
    await page.goto('/dashboard/drivers')
    await page.locator('tbody a[href^="/dashboard/drivers/"]').first().click()
    await expect(page.getByRole('region', { name: 'Detalles' })).toBeVisible({ timeout: 15000 })
  }
  expect(problems).toEqual([])
})

test('La ficha de un equipo: "Ver en el Monitor" desde Detalles (C11)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/assets')
  await page.locator('tbody a[href^="/dashboard/assets/"]').first().click()
  await page.waitForURL(/\/dashboard\/assets\/[0-9a-f-]{36}/)
  await page.getByRole('link', { name: /Ver en el Monitor/ }).click()
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
  await page.waitForURL(/\/dashboard\/drivers\/[0-9a-f-]{36}\?.*tab=documentos/)
  await expect(page.getByRole('region', { name: 'Documentos' })).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

test('La ficha de un equipo: Documentos al centro y Detalles al costado, sin errores', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/assets')
  await page.locator('tbody a[href^="/dashboard/assets/"]').first().click()
  await page.waitForURL(/\/dashboard\/assets\/[0-9a-f-]{36}/)
  // Sin pestañas (15/10): las dos cosas a la vista a la vez.
  await expect(page.getByRole('region', { name: 'Detalles' }).getByText('Tipo de operación')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('region', { name: 'Documentos' })).toBeVisible({ timeout: 15000 })
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

test('Monitor › Asignar conductor: el alta es la común y un RUT existente ofrece asignarlo (D5)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/operations/monitor?tab=historial')
  // Necesita el viaje de `.superpowers/local-sim/seed_smoke.sql` (conductor del TMS sin registrar).
  const celda = page.getByRole('button', { name: /Sin registrar/ }).first()
  await celda.waitFor({ timeout: 30000 })
  await celda.click()
  await expect(page.getByText('El TMS reportó')).toBeVisible()
  await page.getByRole('button', { name: /dar de alta/i }).click()
  // El alta común trae el origen habitual, que el popover viejo no tenía.
  await expect(page.getByLabel('Origen habitual')).toBeVisible()
  // CARLA SOTO, de la siembra de la copia local.
  await page.getByLabel('RUT').fill('14444444-2')
  await page.getByRole('button', { name: 'Crear y asignar' }).click()
  await expect(page.getByRole('button', { name: /^Asignar a / })).toBeVisible({ timeout: 15000 })
  expect(problems).toEqual([])
})

// ── Entrega 1 de fichas (kit, fichas y navegación) ─────────────────────────

test('Ficha de conductor: la razón lleva a sus documentos', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/drivers?documents=pending')
  const href = await page.locator('tbody a[href^="/dashboard/drivers/"]').first().getAttribute('href', { timeout: 30000 })
  await page.goto(href!.split('?')[0])
  await page.getByRole('button', { name: 'Ver documentos' }).click({ timeout: 15000 })
  const docs = page.getByRole('region', { name: 'Documentos' })
  await expect(docs).toBeVisible({ timeout: 15000 })
  await expect(docs.getByRole('group', { name: 'Filtrar documentos' }).locator('[aria-pressed="true"]')).not.toHaveText(/^Todos/)
  expect(problems).toEqual([])
})

test('Pendientes: el titular abre su vista rápida (clic y Enter) y de ahí su ficha', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/compliance/pending')
  const titular = page.getByRole('link', { name: /^Ver (conductor|equipo|empresa) / }).first()
  await titular.waitFor({ timeout: 30000 })
  // RF4: Enter sobre el enlace abre la vista rápida (el navegador lo vuelve clic).
  await titular.focus()
  await page.keyboard.press('Enter')
  const abrir = page.getByRole('link', { name: 'Abrir ficha completa' })
  await expect(abrir).toBeVisible({ timeout: 15000 })
  expect(page.url()).toContain('/compliance/pending')
  await abrir.click()
  await page.waitForURL(/\/dashboard\/(drivers|assets|carriers)\/[0-9a-f-]{36}/, { timeout: 15000 })
  // La vista rápida no queda encima de la ficha (revisión final de la Entrega 1).
  await expect(abrir).not.toBeVisible()
  expect(problems).toEqual([])
})

test('Lista filtrada → ficha → volver conserva el filtro', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/drivers?q=CARLA')
  await page.locator('tbody a[href^="/dashboard/drivers/"]').first().click({ timeout: 30000 })
  await page.waitForURL(/\/dashboard\/drivers\/[0-9a-f-]{36}/)
  await page.getByRole('link', { name: 'Volver a Conductores' }).click({ timeout: 15000 })
  await page.waitForURL(/\/dashboard\/drivers\?q=CARLA/)
  expect(problems).toEqual([])
})

test('Ficha de empresa: el modal de un conductor ofrece su ficha completa', async ({ page }) => {
  test.setTimeout(90000)
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  await page.goto('/dashboard/carriers')
  await page.locator('a[href^="/dashboard/carriers/"]').first().waitFor({ timeout: 30000 })
  const fichas = await page.locator('a[href^="/dashboard/carriers/"]')
    .evaluateAll(as => [...new Set(as.map(a => (a as HTMLAnchorElement).getAttribute('href')!.split('?')[0]))])
  // La primera empresa con conductores (la flota es una tabla desde el 15/10).
  const card = page.locator('tbody tr').first()
  let conConductores = false
  for (const href of fichas.slice(0, 8)) {
    await page.goto(`${href}?tab=conductores`)
    if (await card.waitFor({ timeout: 8000 }).then(() => true, () => false)) { conConductores = true; break }
  }
  expect(conConductores, 'ninguna de las primeras 8 empresas tiene conductores').toBe(true)
  await card.click()
  await page.getByRole('dialog').getByRole('link', { name: /Abrir ficha completa/ }).click({ timeout: 15000 })
  await page.waitForURL(/\/dashboard\/drivers\/[0-9a-f-]{36}\?next=/)
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

test('Seguros: póliza nueva → su ficha → marcar una cuota pagada → aparece en Cuotas › Pagadas (S12)', async ({ page }) => {
  const problems = watch(page)
  const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
  const numero = `SMK-${Date.now()}`
  await login(page, 'seg@sim.local')
  // Una empresa activa cualquiera (todas admiten otra póliza): la póliza la crea el
  // test. Elegir "sin póliza" se agotaba, porque cada corrida le crea una a alguna.
  await page.goto('/dashboard/insurance?group=carrier')
  // El nombre abre la vista rápida; el resto de la fila, la ficha de la empresa › Seguros.
  await page.locator('tbody tr').first().locator('td').nth(1).click({ timeout: 30000 })
  await page.getByRole('button', { name: '+ Póliza' }).click({ timeout: 20000 })
  await page.getByPlaceholder('Aseguradora').fill('Aseguradora Humo')
  await page.getByPlaceholder('N° de póliza').fill(numero)
  await page.getByLabel('Vigencia desde').fill(dia(-30))
  await page.getByLabel('Vigencia hasta').fill(dia(335))
  await page.getByRole('button', { name: 'Guardar' }).click()
  // Crear la póliza lleva a su ficha.
  await page.waitForURL('**/dashboard/insurance/policies/**', { timeout: 20000 })
  await page.getByRole('button', { name: 'Generar calendario' }).click({ timeout: 20000 })
  await page.getByLabel('N° de cuotas').fill('3')
  await page.getByLabel('Monto UF c/u').fill('1.5')
  await page.getByLabel('Primera fecha de vencimiento').fill(dia(-10))
  await page.getByRole('button', { name: 'Generar', exact: true }).click()
  await page.getByRole('checkbox').first().check({ timeout: 20000 })
  await page.getByRole('button', { name: 'Marcar pagadas…' }).click()
  await page.getByRole('button', { name: 'Marcar 1 pagada' }).click()
  await expect(page.getByRole('button', { name: /Deshacer pago/ })).toHaveCount(1, { timeout: 20000 })
  await page.goto(`/dashboard/insurance/installments?state=PAID&q=${numero}`)
  await expect(page.getByText(numero).first()).toBeVisible({ timeout: 20000 })
  expect(problems).toEqual([])
})

test('Configuración: índice → Motivos de conductor → abrir un motivo → "Está bien así" → la fila queda revisada (P1.9)', async ({ page }) => {
  const problems = watch(page)
  await login(page, 'ops@sim.local')
  await page.goto('/dashboard/admin/settings')
  const indice = page.getByRole('navigation', { name: 'Configuración' }).first()
  await indice.getByRole('link', { name: /Motivos de conductor/ }).click({ timeout: 30000 })
  await page.waitForURL('**/settings/operations/driver-reasons', { timeout: 20000 })
  await page.getByRole('group', { name: 'Filtrar' }).getByRole('button', { name: /Sin revisar/ }).click()
  const fila = page.locator('tbody tr').first()
  const nombre = (await fila.locator('td').first().innerText()).trim()
  await fila.click()
  const panel = page.getByRole('dialog')
  await panel.getByRole('button', { name: /está bien así/i }).click({ timeout: 20000 })
  await panel.getByRole('button', { name: /cerrar/i }).click()
  await page.getByRole('group', { name: 'Filtrar' }).getByRole('button', { name: /Todos/ }).click()
  const revisada = page.locator('tbody tr', { hasText: nombre }).first()
  await expect(revisada.getByText('Sin revisar')).toHaveCount(0, { timeout: 20000 })
  expect(problems).toEqual([])
})

test('Directorio › Clientes → un cliente → marcar un lugar como Origen → aparece en el Tarifario con Orígenes (P3.8)', async ({ page }) => {
  test.setTimeout(120000)
  const problems = watch(page)
  await login(page, 'com@sim.local')
  await page.goto('/dashboard/clients')
  // Un cliente con lugares (columna Lugares distinta de 0).
  const filas = page.locator('tbody tr')
  await filas.first().waitFor({ timeout: 30000 })
  let elegido = -1
  for (let i = 0; i < await filas.count(); i++) {
    if ((await filas.nth(i).locator('td').nth(2).innerText()).trim() !== '0') { elegido = i; break }
  }
  expect(elegido).toBeGreaterThanOrEqual(0)
  await filas.nth(elegido).locator('a').first().click()
  await page.waitForURL('**/dashboard/clients/**', { timeout: 20000 })
  const origen = page.getByRole('checkbox', { name: /^Origen: / }).first()
  await origen.waitFor({ timeout: 30000 })
  const lugar = (await origen.getAttribute('aria-label'))!.replace('Origen: ', '')
  const eraOrigen = await origen.isChecked()
  if (!eraOrigen) {
    await origen.check()
    await expect(origen).toBeChecked({ timeout: 20000 })
  }
  await page.goto('/dashboard/pricing?origen=1')
  const fila = page.locator('tbody tr', { has: page.getByRole('checkbox', { name: `Origen: ${lugar}` }) })
  await expect(fila).toHaveCount(1, { timeout: 30000 })
  // Deja el lugar como estaba: la corrida siguiente parte igual.
  if (!eraOrigen) {
    await fila.getByRole('checkbox', { name: `Origen: ${lugar}` }).uncheck()
    await expect(fila).toHaveCount(0, { timeout: 20000 })
  }
  expect(problems).toEqual([])
})

test('Certificación › Documentos exigidos → filtro → ficha → "¿Cuándo vence?" con su efecto → cancelar → Volver con el filtro (P2.7)', async ({ page }) => {
  test.setTimeout(120000)
  const problems = watch(page)
  await login(page, 'cert@sim.local')
  // El menú lo recorre la matriz por rol; aquí se entra directo.
  await page.goto('/dashboard/compliance/requirements')
  await page.getByRole('group', { name: 'Entidad' }).getByRole('button', { name: /Equipo/ }).click()
  await page.waitForURL('**/requirements?entity=ASSET', { timeout: 20000 })
  // Un documento vigente: su vigencia se puede cambiar y su efecto se calcula.
  const vigente = page.locator('tbody tr').filter({ hasNotText: 'No se exige' }).first()
  await vigente.waitFor({ timeout: 30000 })
  const nombre = (await vigente.locator('a').first().innerText()).trim()
  await vigente.locator('a').first().click()
  await page.waitForURL('**/dashboard/compliance/requirements/**', { timeout: 20000 })
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible({ timeout: 30000 })

  const vence = page.getByRole('region', { name: '¿Cuándo vence?' })
  await vence.getByRole('button', { name: 'Editar' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  // Solo la pregunta elegida: el panel no ofrece cambiar a quién se exige.
  await expect(panel.getByText('¿A quién se le exige?')).toHaveCount(0)
  const plazo = panel.getByRole('radio', { name: 'Dura un plazo desde que se emite' })
  const otra = (await plazo.isChecked()) ? panel.getByRole('radio', { name: 'No vence' }) : plazo
  await otra.click()
  // El efecto se ve ANTES de guardar.
  await expect(panel.getByText(/Con esta regla:/)).toBeVisible({ timeout: 30000 })
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await page.getByRole('link', { name: 'Volver a Documentos exigidos' }).click()
  await page.waitForURL('**/requirements?entity=ASSET', { timeout: 20000 })
  expect(problems).toEqual([])
})
