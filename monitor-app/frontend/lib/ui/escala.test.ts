// @vitest-environment node
/**
 * La auditoria del 2026-08-16 midio 8-9 tamanos de letra por pantalla, con
 * 428 elementos a 10px o menos en el Monitor (248 a 10px, 152 a 9px, 28 a
 * 8px). Eso no es jerarquia, es ruido — y es la causa principal de que la app
 * se lea como tosca.
 *
 * Este test no impide usar Tailwind: impide seguir bajando. Cualquier
 * `text-[9px]` o `text-[10px]` NUEVO rompe la suite.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

// El minimo de la escala. Ver app/globals.css → --text-etiqueta.
const MINIMO_PX = 11

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

export function tamanosPorDebajoDelMinimo(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
      const usos = linea.match(/text-\[(\d+(?:\.\d+)?)px\]/g)
      if (!usos) return
      for (const uso of usos) {
        const px = Number(uso.match(/\d+(?:\.\d+)?/)![0])
        if (px < MINIMO_PX) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → ${uso}`)
      }
    })
  }
  return hallazgos
}

describe('la escala tipografica', () => {
  it('encuentra archivos que revisar', () => {
    // Guardia del guardia: si el recorrido deja de encontrar nada, el test de
    // abajo pasaria siempre y nadie se enteraria.
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('no crece la deuda de tamanos por debajo de 11px', () => {
    // Deuda heredada, MEDIDA el 2026-08-16 (no estimada). Este numero SOLO
    // puede bajar: se reduce al migrar cada pantalla, y cuando llegue a 0 la
    // asercion pasa a `toEqual([])`. Subirlo para que pase la suite es
    // exactamente lo que este test viene a impedir.
    // 268 -> 262 en la Ronda 152 (2026-09-07): la tira de chips de
    // VehicleRosterCard subio entera al minimo de la escala. El chip nuevo
    // —el tipo de operacion, y el de baja— no podia nacer a 9px, y dejarlo
    // solo a 11px entre hermanos de 9px se veia desparejo.
    // 262 -> 260 en la Ronda 155, por el mismo cambio.
    // 260 -> 214 el 2026-10-11: la Bitácora y los indicadores del detalle del
    // viaje dejaron los 9-10 px (pasada visual del detalle), más bajas previas
    // que no se habían descontado.
    // 214 -> 213 el 2026-10-12: la línea de empresa de DriverSearchPicker pasó a tokens (bloque 0, 0.9).
    // 213 -> 209 el 2026-10-12: los chips de ciclo de vida pasaron a StatusChip (D1, Task 11).
    // 209 -> 205 el 2026-10-12: las filas del checklist y del panel dejaron los 10px (D1, Task 12).
    // 205 -> 201 el 2026-10-12: tarjetas y tabla del Directorio dejaron los 10px (D1, Task 13).
    // 201 -> 199 el 2026-10-12: los avisos de TripBulkUpload usan text-etiqueta (D1, Task 14).
    // 199 -> 197 el 2026-10-12: Alertas de vencimiento dejó los 10px (D1, Task 14, Parte C).
    // 197 -> 185 el 2026-10-15: CABECERA sin 10px (kit de fichas) más lo que bajaron las entregas A-D;
    //   el tope estaba por encima del número real.
    // 185 -> 182 el 2026-10-15: encabezado y Resumen de la ficha de empresa sin 10px (kit de fichas, Tarea 5).
    // 182 -> 172 el 2026-10-15: se retiraron los paneles de conductor y equipo (kit de fichas, Tarea 6).
    // 172 -> 167 el 2026-10-15: Empresas y Por asignar sin 10px (Entrega 2 de fichas).
    // 167 -> 163 el 2026-10-15: las listas del Directorio con el kit; se retiró TransporterSlideOver.
    // 163 -> 158 el 2026-10-15: fichas en dos columnas, flota de la empresa en tabla, Seguros y Requisito con el kit.
    // 158 -> 130 el 2026-10-15: Seguros con el kit; se retiraron el modal de pólizas y sus piezas (Seguros E2).
    const DEUDA = 130

    const hallazgos = tamanosPorDebajoDelMinimo()
    expect(
      hallazgos.length,
      `Tamanos por debajo de ${MINIMO_PX}px: ${hallazgos.length} (tope actual ${DEUDA}).\n` +
        `Si subio, hay uno nuevo. Los primeros:\n${hallazgos.slice(0, 10).join('\n')}`,
    ).toBeLessThanOrEqual(DEUDA)
  })
})
