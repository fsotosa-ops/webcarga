import { test, expect, type Page } from '@playwright/test'

/**
 * Click-through de la ficha de empresa y los dos mundos de Certificación.
 *
 * **Corre contra la rama, no contra dev.** Esta rama no está desplegada, así
 * que apuntar a `webcarga-frontend-dev` mediría el código viejo y daría un
 * falso verde — y el backend de dev tampoco entiende el parámetro `estado`
 * que la ficha pide. Se levanta el par en local:
 *
 *     cd monitor-app/backend/api && venv/bin/uvicorn app.main:app --port 8001
 *     cd monitor-app/frontend && FASTAPI_URL=http://localhost:8001 npm start
 *
 * **NO SUBE ARCHIVOS.** No hay base de pruebas: cada subida escribiría un
 * `compliance_record` y un blob reales.
 */

const EMAIL    = process.env.DEMO_EMAIL    ?? ''
const PASSWORD = process.env.DEMO_PASSWORD ?? ''
/** El unico dato del ENTORNO que este spec necesita ademas de las
 *  credenciales: el nombre de una empresa real con al menos un documento
 *  cargado. Va por variable y no escrito aca porque es el nombre de una
 *  empresa de verdad, y los nombres reales no viven en los tests. Sale de
 *  `.env.local`, junto a DEMO_EMAIL/DEMO_PASSWORD. */
const EMPRESA  = process.env.DEMO_CARRIER  ?? ''

const PLACEHOLDERS = ['changeme', 'demo@webcarga.com', 'tu-password', '']

async function entrar(page: Page) {
  if (PLACEHOLDERS.includes(PASSWORD) || PLACEHOLDERS.includes(EMAIL) || !EMAIL || !EMPRESA) {
    throw new Error(
      'Faltan credenciales reales o DEMO_CARRIER. Corre asi, tomandolos de .env.local sin imprimirlos:\n' +
      '  set -a; . .env.local; set +a; npx playwright test scripts/ficha-empresa.spec.ts',
    )
  }
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/**', { timeout: 30000 })
  const saltar = page.locator('button:has-text("Saltar tour")')
  if (await saltar.isVisible({ timeout: 2000 }).catch(() => false)) await saltar.click()
}

/** Los errores de consola que NO cuentan: ruido de terceros y del propio
 *  Next en producción. Todo lo demás es un hallazgo. */
const RUIDO = [
  /Download the React DevTools/,
  /\[Fast Refresh\]/,
  /favicon/i,
]

function erroresReales(mensajes: { type: string; text: string }[]) {
  return mensajes
    .filter(m => m.type === 'error')
    .map(m => m.text)
    .filter(t => !RUIDO.some(r => r.test(t)))
}

test.describe('Certificación · los dos mundos', () => {
  test('el sidebar abre en Empresas y Sin clasificar', async ({ page }) => {
    await entrar(page)
    await page.goto('/dashboard/compliance')

    await expect(page.getByRole('link', { name: /^Empresas$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Sin clasificar/ })).toBeVisible()

    // Etiqueta en español, ruta en inglés.
    await expect(page.getByRole('link', { name: /Sin clasificar/ }))
      .toHaveAttribute('href', '/dashboard/compliance/inbox')
  })

  test('un enlace guardado a ?vista=documentos lleva a la Bandeja', async ({ page }) => {
    await entrar(page)
    await page.goto('/dashboard/compliance?vista=documentos')
    // La razón por la que el redirect viejo se conservó —"quedó en enlaces
    // guardados y en el historial"— sigue valiendo, ahora al revés.
    await page.waitForURL('**/dashboard/compliance/inbox', { timeout: 15000 })
  })

  test('la Bandeja tiene ruta propia y pide de quién es el lote', async ({ page }) => {
    await entrar(page)
    await page.goto('/dashboard/compliance/inbox')
    await expect(page.getByText(/¿De quién son estos documentos\?/)).toBeVisible()
  })
})

test.describe('Certificación · la ficha de una empresa', () => {
  test('la fila navega a la ficha, y la ficha sobrevive a recargar', async ({ page }) => {
    await entrar(page)
    await page.goto('/dashboard/compliance')

    const fila = page.getByText(EMPRESA).first()
    await fila.waitFor({ timeout: 30000 })
    await fila.click()

    await page.waitForURL(/\/dashboard\/compliance\/[0-9a-f-]{36}/, { timeout: 15000 })
    const url = page.url()

    await page.reload()
    expect(page.url()).toBe(url)
    await expect(page.getByText(EMPRESA).first()).toBeVisible()
  })

  test('muestra lo que TIENE junto a lo que le falta, y el filtro cambia la lista', async ({ page }) => {
    const consola: { type: string; text: string }[] = []
    page.on('console', m => consola.push({ type: m.type(), text: m.text() }))

    await entrar(page)
    await page.goto('/dashboard/compliance')
    await page.getByText(EMPRESA).first().click()
    await page.waitForURL(/\/dashboard\/compliance\/[0-9a-f-]{36}/, { timeout: 15000 })

    // Arranca en "Todo": es la razón de ser de la pantalla — los documentos
    // cargados no aparecían en ningún lado del módulo.
    await expect(page.getByRole('button', { name: /^Todo/ })).toHaveAttribute('aria-pressed', 'true')

    // Con "Todo" tiene que verse al menos un documento YA CARGADO, que es lo
    // que el cajón nunca mostraba. Su marca es el botón "Ver".
    await expect(page.getByRole('button', { name: 'Ver' }).first()).toBeVisible({ timeout: 15000 })

    await page.screenshot({ path: 'test-results/ficha-todo.png', fullPage: true })

    // Al día: sólo lo cargado. La aserción con dientes es que NO queda ningún
    // renglón de carga — el `aria-pressed` que el clic acaba de poner es
    // estado local del botón y pasaría con la pantalla rota.
    await page.getByRole('button', { name: /Al día/ }).click()
    await expect(page.getByTestId(/^renglon-/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ver' }).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/ficha-al-dia.png', fullPage: true })

    // Falta: lo contrario. Todo lo que hay es un renglón de carga. (No se
    // exige "ningún Ver": un vencido TIENE archivo y ofrece verlo además de
    // renovarlo, que es justamente lo que la ficha vino a hacer visible.)
    await page.getByRole('button', { name: /^Falta/ }).click()
    await expect(page.getByTestId(/^renglon-/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/ficha-falta.png', fullPage: true })

    expect(erroresReales(consola), 'la consola no puede tener errores').toEqual([])
  })

  test('la ficha pide UNA sola vez, con estado=todos', async ({ page }) => {
    const pedidos: string[] = []
    page.on('request', r => {
      if (r.url().includes('/compliance-records/pending')) pedidos.push(r.url())
    })

    await entrar(page)
    await page.goto('/dashboard/compliance')
    await page.getByText(EMPRESA).first().click()
    await page.waitForURL(/\/dashboard\/compliance\/[0-9a-f-]{36}/, { timeout: 15000 })
    await page.getByRole('button', { name: 'Ver' }).first().waitFor({ timeout: 15000 })

    // La primera versión pedía las cuatro variantes en paralelo. Una sola, con
    // `estado=todos`, y el filtro cambia en el cliente sin volver a pedir.
    expect(pedidos.length, `pidió ${pedidos.length} veces: ${pedidos.join(' | ')}`).toBe(1)
    expect(pedidos[0]).toContain('estado=todos')

    const antes = pedidos.length
    await page.getByRole('button', { name: /Al día/ }).click()
    await page.waitForTimeout(1500)
    expect(pedidos.length, 'cambiar el filtro no puede volver a pedir').toBe(antes)
  })
})
