// @vitest-environment node
/**
 * Los guardias que hacen que el sistema gane.
 *
 * Este proyecto YA tenia tokens de color antes de esta ronda, y la auditoria
 * del 2026-08-16 midio 571 usos de tokens contra 1.824 de color crudo de
 * Tailwind, sobre 148 combinaciones distintas. O sea: la convencion sola ya
 * perdio una vez aca. Un componente o un token sin algo que los haga ganar es
 * una sugerencia.
 *
 * Los dos topes SOLO pueden bajar. Subirlos para que pase la suite es
 * exactamente lo que estos tests vienen a impedir.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}

const archivos = () => ['app', 'components'].flatMap((d) => recorrer(join(RAIZ, d)))

// Las 22 familias de color de Tailwind. Un `text-gray-500` suelto no es un
// error en si mismo — es una decision de color tomada fuera del sistema, y
// 1.824 de esas es por que la app se ve como se ve.
const FAMILIAS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|')
const COLOR_CRUDO = new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:${FAMILIAS})-\\d{2,3}\\b`, 'g')

export function usosDeColorCrudo(): number {
  let total = 0
  for (const ruta of archivos()) {
    total += (readFileSync(ruta, 'utf8').match(COLOR_CRUDO) ?? []).length
  }
  return total
}

export function h1FueraDelEncabezado(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    // El propio componente es el unico que puede escribir un <h1>.
    if (ruta.endsWith('EncabezadoDePagina.tsx')) continue
    readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
      if (/<h1[\s>]/.test(linea)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`)
    })
  }
  return hallazgos
}

describe('el sistema visual se usa, no solo existe', () => {
  it('el contenedor de cada pantalla es PageContainer, no un margen escrito a mano', () => {
    // 16/10: cada pantalla escribía el suyo (p-4 md:p-6 con space-y-3, -4 o -5; el
    // Cierre, p-6 también en el teléfono), y por eso los márgenes no calzaban.
    const aMano: string[] = []
    for (const ruta of archivos()) {
      if (ruta.endsWith('PageContainer.tsx')) continue
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/className="(?=[^"]*\bp-4\b)(?=[^"]*\bmd:p-6\b)[^"]*"/.test(linea)) aMano.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`)
      })
    }
    expect(aMano).toEqual([])
  })

  it('encuentra archivos que revisar', () => {
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('no crece el color decidido fuera del sistema', () => {
    // Medido el 2026-08-16. Baja al migrar cada pantalla a los tokens.
    // 1.765 -> 1.755 en la Ronda 129: CarrierDrawer paso a tokens al soltar la
    // zona de arrastre (sky/gray/amber/red crudos -> accent/informativo/border).
    // 1.755 -> 1.753 en la Ronda 138: VehicleRosterCard dejo de repetir la
    // tabla de etiquetas de chasis, y la baja de empresa se pinto con
    // `status-incidente` en vez de `red-*` crudo.
    // 1.753 -> 1.744 en la Ronda 149 (2026-08-27): el tope estaba 9 por encima
    // del numero real, y este trinquete es justo lo que impide que ese margen
    // se llene solo. La UI nueva del arreglo del Cierre —la caja de error del
    // popover de conductor, SinFlotaList y el alta desde el pre-cierre— nacio
    // con 16 usos crudos y se escribio de nuevo con tokens: `status-incidente`
    // para el error, `informativo` para el gris de apoyo. Bajarlo hasta el
    // numero real es lo que hace que el proximo margen no exista.
    // 1.744 -> 1.721 en la Ronda 152 (2026-09-07): el cabezal del Cierre eran
    // dos tarjetas de markup calcado; pasaron a ser UNA con props, y la
    // tercera (los tractos Tractoreo, que antes no existia) nacio con tokens
    // —`informativo` para el gris de apoyo, `status-incidente` para el numero
    // que bloquea— en vez de gray-400/red-500 crudos. VehicleDetailPanel
    // sumaba dos usos crudos por el renglon nuevo, asi que sus seis etiquetas
    // de campo pasaron a `informativo` y el fondo deshabilitado a `bg-main`.
    // 1.721 -> 1.719 en la Ronda 155: la cabecera de la tabla del cierre y el
    // chip de estado pasaron a tokens al volverse ordenables.
    // 1.719 -> 1.717 en la Ronda 156: se retiro el cajon "Editar Empresa".
    // 1.717 -> 1.685 en la Ronda 161 (2026-09-16): se retiro CloseDayDialog, que
    // nadie importaba y firmaba contra un endpoint que dejo de existir, y la UI
    // nueva del cierre (dia cerrado, reabrir, error al guardar) nacio con
    // tokens — `resuelto`, `status-incidente`, `informativo`.
    // 1.685 -> 1.672 en HU-C1 entrega 2c (2026-10-08): la tabla de documentos
    // de Configuración paso a tokens al volverse editable en el lugar, y se
    // retiraron CeldaVigencia, CeldaNivel y AplicarEnLaFila.
    // 1.672 -> 1.406 el 2026-10-11: la pasada visual del detalle del viaje
    // (encabezado, tabla de paradas, Gestión, Bitácora, línea de paradas) y la
    // vista rápida nacieron o pasaron a tokens; el tope no se había bajado
    // desde la entrega 2c.
    // 1.406 -> 1.405 el 2026-10-12: la línea de empresa de DriverSearchPicker pasó a tokens (bloque 0, 0.9).
    // 1.405 -> 1.392 el 2026-10-12: STATUS_CLS y los chips de ciclo de vida pasaron a StatusChip (D1, Task 11).
    // 1.392 -> 1.364 el 2026-10-12: la ficha de empresa, el checklist, el banner, el panel y el slide-over pintan con StatusChip y tokens (D1, Task 12).
    // 1364 -> 1348 el 2026-10-12: Directorio, roster y tarjetas usan StatusChip (D1, Task 13).
    // 1348 -> 1339 el 2026-10-12: el embudo de Certificación pinta con tokens y StatusChip (D1, Task 14, Parte A).
    // 1339 -> 1333 el 2026-10-12: PendingDocsBadge toma tono e ícono de alertSeverityStyle (D1, Task 14, Parte B).
    // 1333 -> 1329 el 2026-10-12: Alertas de vencimiento con tokens (D1, Task 14, Parte C).
    // 1329 -> 1288 el 2026-10-15: lo que bajaron las entregas A-D y el kit de fichas (Table, ComplianceCounts,
    //   CABECERA con tokens); el tope estaba por encima del número real.
    // 1288 -> 1255 el 2026-10-15: la ficha de empresa con ProfileHeader y DetailsBlock (kit de fichas, Tarea 5).
    // 1255 -> 1216 el 2026-10-15: se retiraron DriverDetailPanel y VehicleDetailPanel; el modal es la ficha (Tarea 6).
    // 1216 -> 1194 el 2026-10-15: Empresas y Por asignar con las piezas del kit (Entrega 2 de fichas).
    // 1194 -> 1142 el 2026-10-15: las listas del Directorio con el kit; se retiró TransporterSlideOver.
    // 1142 -> 1084 el 2026-10-15: fichas en dos columnas, flota de la empresa en tabla, Seguros y Requisito con el kit.
    // 1084 -> 962 el 2026-10-15: Seguros con el kit; se retiraron el modal de pólizas y sus piezas (Seguros E2).
    // 962 -> 954 el 2026-10-15: PolicyCreateForm con tokens (menores de la revisión final de Seguros E2).
    // 954 -> 911 el 2026-10-16: Configuración con la lista + panel; fuera los formularios por fila (Parte 1, tarea 5).
    // 911 -> 891 el 2026-10-16: umbrales, rangos y reglas del Monitor como lista + panel (Parte 1, tarea 6).
    // 891 -> 855 el 2026-10-16: Personas y Roles con el kit (Parte 1, tarea 8).
    // 855 -> 819 el 2026-10-16: los grupos del Monitor con el tono del glosario (revisión final de la Parte 1).
    // 819 -> 797 el 2026-10-16: lugares, Clientes del TMS y Orígenes con tokens (Parte 3).
    // 797 -> 787 el 2026-10-16: Documentos exigidos con el kit; se retiraron la tabla editable y el borrador (Parte 2).
    // 787 -> 769 el 2026-10-16: CondicionPanel y NuevoDocumentoPanel con tokens (menores de la Parte 2).
    // 769 -> 574 el 2026-10-17: el Cierre y el Monitor con el sistema (PageContainer y Button
    //   del kit, tabla de viajes, alertas por significado, Alertas sobre el Popover del kit) y
    //   lo que bajaron el Cierre con un solo patrón y Pendientes/Reporte con el kit.
    const DEUDA = 574

    const total = usosDeColorCrudo()
    expect(
      total,
      `Usos de color crudo de Tailwind: ${total} (tope actual ${DEUDA}).\n` +
        `Si subio, hay una decision de color nueva tomada fuera del sistema.\n` +
        `Los tokens estan en app/globals.css: accent, espera, accion, resuelto, status-*.`,
    ).toBeLessThanOrEqual(DEUDA)
  })

  it('no crecen los botones principales escritos a mano: el color y el tamaño salen de Button', () => {
    // 2026-10-17: había ocho maneras de escribir el botón principal. Button y buttonClass
    // (components/ui/Button.tsx) son la una; este tope solo baja al migrar pantallas.
    const BOTON_A_MANO = /<button\b[^>]*className=["{`][^"`}]*\bbg-accent\b[^"`}]*\btext-white\b/g
    let total = 0
    for (const ruta of archivos()) {
      if (ruta.endsWith('Button.tsx')) continue
      total += (readFileSync(ruta, 'utf8').replace(/\n\s*/g, ' ').match(BOTON_A_MANO) ?? []).length
    }
    const TOPE = 27
    expect(total, `Botones principales escritos a mano: ${total} (tope ${TOPE}). Usa Button del kit.`).toBeLessThanOrEqual(TOPE)
  })

  it('no crecen los encabezados de pagina escritos a mano', () => {
    // Medido el 2026-08-16: eran 15 <h1> con SIETE combinaciones distintas de
    // clases. Baja a medida que cada pagina usa <EncabezadoDePagina>.
    // 9 -> 8 el 2026-10-15: el nombre editable de la ficha de empresa salió del <h1> (kit de fichas, Tarea 5).
    // 8 -> 7 el 2026-10-15: Por asignar usa EncabezadoDePagina (Entrega 2 de fichas).
    // 7 -> 5 el 2026-10-16: Configuración con EncabezadoDePagina en la sección, la raíz y 'no existe' (Parte 1).
    const DEUDA = 5

    const hallazgos = h1FueraDelEncabezado()
    expect(
      hallazgos.length,
      `<h1> fuera de EncabezadoDePagina: ${hallazgos.length} (tope actual ${DEUDA}).\n` +
        `Usa <EncabezadoDePagina titulo="…" /> en vez de escribirlo a mano.\n${hallazgos.join('\n')}`,
    ).toBeLessThanOrEqual(DEUDA)
  })
})
