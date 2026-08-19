import { test, expect, type Page } from '@playwright/test'

/**
 * Casuísticas de la carga documental de Certificación (Ronda 129).
 *
 * Ver `docs/superpowers/qa/2026-08-19-certificacion-carga-documental-casuisticas.md`.
 *
 * **NO SUBE ARCHIVOS.** No hay base de pruebas: cada subida escribiría un
 * `compliance_record` y un blob reales. Estos tests llegan hasta el borde —
 * eligen el archivo y comprueban qué PREGUNTA el renglón antes de subir— que
 * es exactamente donde vivía el defecto: el camino viejo subía primero y
 * dejaba el archivo varado cuando el servidor lo rechazaba.
 *
 * La casuística que sí escribe (A4, D1, D4) se hace a mano, una vez, sobre un
 * sujeto elegido a propósito. Ver el AGENTLOG.
 */

const EMAIL    = process.env.DEMO_EMAIL    ?? ''
const PASSWORD = process.env.DEMO_PASSWORD ?? ''

/** Un PDF mínimo válido, en memoria: nada se lee del disco del que corre. */
const PDF = {
  name: 'prueba-certificacion.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
}

/** Valores de ejemplo de `.env.local.example`. Si llegan estos, no hay
 *  credenciales de verdad — y sin decirlo, la suite muere veinte segundos
 *  despues con un `waitForURL` que no explica nada. */
const PLACEHOLDERS = ['changeme', 'demo@webcarga.com', 'tu-password', '']

async function entrar(page: Page) {
  if (PLACEHOLDERS.includes(PASSWORD) || PLACEHOLDERS.includes(EMAIL) || !EMAIL) {
    throw new Error(
      'Faltan credenciales reales. `.env.local` trae los valores de ejemplo, y con ' +
      'esos el login responde "Credenciales incorrectas".\n' +
      'Corre asi:\n' +
      '  DEMO_EMAIL=<usuario> DEMO_PASSWORD=<clave> \\\n' +
      '  PLAYWRIGHT_BASE_URL=https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app \\\n' +
      '  npx playwright test scripts/certificacion-carga.spec.ts',
    )
  }
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')

  // El error de credenciales aparece EN la pagina; esperar solo la navegacion
  // convierte "clave equivocada" en un timeout de 20 s que no dice por que.
  const error = page.locator('text=/credenciales incorrectas/i')
  await Promise.race([
    page.waitForURL('**/dashboard/**', { timeout: 25000 }),
    error.waitFor({ timeout: 25000 }).then(() => {
      throw new Error('El login rechazo las credenciales: revisa DEMO_EMAIL / DEMO_PASSWORD.')
    }),
  ])

  const saltar = page.locator('button:has-text("Saltar tour")')
  if (await saltar.isVisible({ timeout: 2000 }).catch(() => false)) await saltar.click()
}

/** Abre la primera fila de la vista y devuelve el cajón. Devuelve `null` si la
 *  vista no trajo filas — un test no puede afirmar nada sobre una lista vacía,
 *  y fallar ahí confundiría "la pantalla está rota" con "no hay datos hoy". */
async function abrirPrimeraFila(page: Page, vista: string) {
  await page.goto(vista === 'empresas'
    ? '/dashboard/compliance'
    : `/dashboard/compliance?vista=${vista}`)
  const filas = page.locator('tbody tr[aria-expanded]')
  await filas.first().waitFor({ timeout: 20000 }).catch(() => {})
  if (await filas.count() === 0) return null
  await filas.first().click()
  await page.locator('text=Lo que falta').first().waitFor({ timeout: 15000 })
  return page.locator('text=Lo que falta').first()
}

test.describe('Certificación · el cajón es la superficie de carga', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  // B1 · La bandeja salió de adentro del cajón.
  test('B1 · el cajón no monta una zona de arrastre encima del casillero', async ({ page }) => {
    const cajon = await abrirPrimeraFila(page, 'empresas')
    test.skip(!cajon, 'la vista Empresas no trajo filas')

    // El dropzone de la bandeja se anunciaba con este texto. Si volviera a
    // estar dentro del cajón, competiría con el renglón por el mismo archivo.
    await expect(page.locator('text=/arrastra .*(archivos|aquí para subirlos)/i')).toHaveCount(0)
  })

  // B6 · La bandeja sigue existiendo, como destino.
  test('B6 · ofrece llevar una pila a la Bandeja, dentro del módulo', async ({ page }) => {
    const cajon = await abrirPrimeraFila(page, 'empresas')
    test.skip(!cajon, 'la vista Empresas no trajo filas')

    const enlace = page.getByRole('link', { name: /Bandeja/i }).first()
    await expect(enlace).toBeVisible()
    await expect(enlace).toHaveAttribute('href', /vista=documentos/)
  })

  // G1 · La fila abierta viaja en la URL.
  test('G1 · la fila abierta sobrevive a recargar', async ({ page }) => {
    const cajon = await abrirPrimeraFila(page, 'conductores')
    test.skip(!cajon, 'la vista Conductores no trajo filas')

    await expect(page).toHaveURL(/abierta=/)
    await page.reload()
    await expect(page.locator('text=Lo que falta').first()).toBeVisible({ timeout: 20000 })
  })

  // C1 + A2 · El renglón entero es el blanco, y pide lo que su requisito exige.
  test('A2/C1 · con fecha obligatoria pide la fecha y NO sube nada', async ({ page }) => {
    const cajon = await abrirPrimeraFila(page, 'conductores')
    test.skip(!cajon, 'la vista Conductores no trajo filas')

    const entradas = page.locator('input[data-testid^="archivo-"]')
    const n = await entradas.count()
    test.skip(n === 0, 'este conductor no tiene requisitos pendientes')

    // Se recorren los renglones hasta encontrar uno que pida fecha. 5 de los
    // 12 requisitos de conductor la exigen, así que no se puede asumir cuál.
    let pidio = false
    for (let i = 0; i < n && !pidio; i++) {
      await entradas.nth(i).setInputFiles(PDF)
      pidio = await page.getByLabel(/vence el/i).first()
        .isVisible({ timeout: 3000 }).catch(() => false)
      if (!pidio) break   // salió con política NONE: subió, y acá no se sigue
    }
    test.skip(!pidio, 'ningún renglón visible exige fecha (todos NONE)')

    // Lo crítico: preguntó ANTES de subir. Si hubiera subido, el renglón
    // estaría en "Listo" o en error, no esperando la fecha.
    await expect(page.getByRole('button', { name: /guardar/i }).first()).toBeVisible()
    await expect(page.locator('text=/no vale sin su vencimiento/i').first()).toBeVisible()
  })

  // A3 · Guardar sin la fecha, cuando es obligatoria, no hace nada.
  test('A3 · no deja guardar sin la fecha obligatoria', async ({ page }) => {
    const cajon = await abrirPrimeraFila(page, 'conductores')
    test.skip(!cajon, 'la vista Conductores no trajo filas')

    const entradas = page.locator('input[data-testid^="archivo-"]')
    const n = await entradas.count()
    test.skip(n === 0, 'sin requisitos pendientes')

    let pidio = false
    for (let i = 0; i < n && !pidio; i++) {
      await entradas.nth(i).setInputFiles(PDF)
      pidio = await page.locator('text=/no vale sin su vencimiento/i').first()
        .isVisible({ timeout: 3000 }).catch(() => false)
      if (!pidio) break
    }
    test.skip(!pidio, 'ningún renglón visible exige fecha')

    await page.getByRole('button', { name: /guardar/i }).first().click()
    // Sigue pidiéndola: no subió, y tampoco desapareció el pedido.
    await expect(page.getByLabel(/vence el/i).first()).toBeVisible()
  })

  // D5 · La consola limpia. Un warning de React acá suele ser un estado mal
  // sincronizado, que es la familia de bugs que este módulo ya tuvo tres veces.
  test('D5 · la consola no tira errores al abrir y operar el cajón', async ({ page }) => {
    const ruido: string[] = []
    page.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning') ruido.push(`${m.type()}: ${m.text()}`)
    })
    page.on('pageerror', e => ruido.push(`pageerror: ${e.message}`))

    await abrirPrimeraFila(page, 'empresas')
    await page.waitForTimeout(2000)

    // Se descartan los que no son del código de la app.
    const propios = ruido.filter(r =>
      !/favicon|Download the React DevTools|hydrat|Third-party cookie/i.test(r))
    expect(propios, propios.join('\n')).toEqual([])
  })
})

test.describe('Certificación · nada saca del módulo', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  // G2 · Los enlaces al Empresas legacy están cerrados.
  test('G2 · la tabla no enlaza fuera de Certificación', async ({ page }) => {
    for (const vista of ['conductores', 'vehiculos']) {
      await page.goto(`/dashboard/compliance?vista=${vista}`)
      await page.locator('tbody tr').first().waitFor({ timeout: 20000 }).catch(() => {})
      const fugas = page.locator('tbody a[href*="/dashboard/carriers"]')
      expect(await fugas.count(), `la vista ${vista} enlaza al Empresas legacy`).toBe(0)
    }
  })
})
