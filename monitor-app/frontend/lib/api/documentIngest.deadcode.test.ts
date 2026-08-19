// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { documentIngestApi } from './documentIngest'

/** `uploadAndClassify` se borro en la Ronda 130, y esto impide que vuelva.
 *
 *  Subia el archivo ANTES de clasificarlo, asi que cada rechazo del servidor
 *  —tipicamente el 422 por falta de fecha de vencimiento, que alcanza a 5 de
 *  los 12 requisitos de conductor y 8 de los 10 de vehiculo— dejaba el
 *  documento varado en la bandeja con el requisito vacio. En pantalla se leia
 *  como "no paso nada".
 *
 *  El reemplazo es `useSubirDocumento`, que llama a
 *  `POST /compliance-records/{id}/file` en UNA operacion y no toca storage
 *  hasta que el servidor valido. `upload` y `classifyBatch` siguen existiendo
 *  por separado, que es lo que usa la Bandeja: ahi el archivo llega SIN destino
 *  y clasificarlo despues es el flujo correcto. */
describe('el camino que subia antes de clasificar', () => {
  it('ya no existe, y no vuelve por una busqueda', () => {
    expect('uploadAndClassify' in documentIngestApi).toBe(false)
  })

  it('las dos piezas que si usa la Bandeja siguen ahi', () => {
    expect(typeof documentIngestApi.upload).toBe('function')
    expect(typeof documentIngestApi.classifyBatch).toBe('function')
  })
})
