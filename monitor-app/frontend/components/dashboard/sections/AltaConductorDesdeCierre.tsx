'use client'

import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { carriersApi } from '@/lib/api/carriers'
import { ApiError } from '@/lib/api/client'
import { CarrierSearchPicker, type CarrierSearchResult } from '../CarrierSearchPicker'

interface Props {
  /** RUT canónico, tal como lo escaló el pre-cierre. No se edita: es el dato
   *  que el TMS informó y por el que este viaje está bloqueando el cierre. */
  rut: string
  /** El nombre que reporta el TMS, si es único entre los viajes de ese RUT.
   *  Puede venir vacío: entonces lo escribe la persona. */
  nombreTms: string | null
  onListo: () => Promise<void> | void
}

/**
 * Dar de alta, desde el Cierre, al conductor que lo está bloqueando.
 *
 * POR QUÉ EXISTE. Es la mitad de UI del "círculo bloqueante" que describe la
 * minuta del 25/08. `CONDUCTOR_NO_REGISTRADO` bloquea el cierre desde el 23/08,
 * y la única salida que ofrecía este panel era un enlace `Revisar en el
 * directorio` — a un módulo que además estaba fuera del menú. Las otras dos
 * escalaciones bloqueantes sí tenían acción propia (`Crear empresa nueva`,
 * `Activar empresa`); ésta no, justo la que Pablo se encontró.
 *
 * **La empresa se pregunta acá y no después**: un conductor sin empresa no
 * entra al roster del cierre, así que darlo de alta sin ella no destraba nada
 * — el día siguiente vuelve a bloquear por otro lado.
 */
export function AltaConductorDesdeCierre({ rut, nombreTms, onListo }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState(nombreTms ?? '')
  const [empresa, setEmpresa] = useState<CarrierSearchResult | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-1"
      >
        <UserPlus size={11} /> Dar de alta a este conductor
      </button>
    )
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const creado = await driversApi.create({ tax_id: rut, full_name: nombre.trim() })
      if (empresa) await carriersApi.assignDriver(empresa.id, creado.id)
      await onListo()
      setAbierto(false)
    } catch (e) {
      // Un 409 acá es raro pero posible (dos coordinadores a la vez); igual se
      // muestra el mensaje del backend, que ya nombra a la persona que existe.
      setError(e instanceof ApiError ? e.message : 'No se pudo dar de alta al conductor')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <label className="block text-[11px] text-text-primary">
        Nombre
        <input
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          placeholder="Nombre y apellidos"
          className="mt-0.5 w-full text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
        />
      </label>

      <div className="text-[11px] text-text-primary">
        Empresa
        {empresa ? (
          <p className="mt-0.5 rounded-lg border border-border bg-white px-2 py-1 flex items-center gap-1.5">
            <span className="truncate">{empresa.business_name}</span>
            <button type="button" onClick={() => { setEmpresa(null); setBusqueda('') }}
                    className="ml-auto shrink-0 text-informativo hover:text-text-primary underline">
              cambiar
            </button>
          </p>
        ) : (
          <div className="mt-0.5">
            <CarrierSearchPicker
              query={busqueda}
              onQueryChange={setBusqueda}
              onPick={c => setEmpresa(c)}
              placeholder="Buscar empresa…"
              size="sm"
              maxHeightClass="max-h-28"
            />
            <span className="block text-[11px] text-informativo mt-0.5">
              Sin empresa no entra al cierre, y mañana vuelve a bloquear.
            </span>
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-status-incidente">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={guardando || !nombre.trim()}
          onClick={guardar}
          className="text-[11px] font-semibold bg-accent text-white rounded-lg px-2 py-1 disabled:opacity-50 flex items-center gap-1"
        >
          {guardando && <Loader2 size={11} className="animate-spin" />}
          {guardando ? 'Creando…' : `Crear ${rut}`}
        </button>
        <button type="button" disabled={guardando} onClick={() => setAbierto(false)}
                className="text-[11px] text-informativo hover:underline disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}
