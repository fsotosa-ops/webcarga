'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileText, Loader2, Upload, X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { complianceApi } from '@/lib/api/compliance'
import { ApiError } from '@/lib/api/client'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import type { ResultadoDePlanilla } from '@/lib/types'

/** Cargar las fechas que ya están escritas en otro lado.
 *
 *  Pablo, reunión del 21/08: *"sería bueno poder subir de alguna forma las
 *  fechas nomás. La información que yo tengo en un Excel. Sin el documento."*
 *  De 5.026 documentos pendientes, 1.326 corresponden a documentos que piden
 *  vencimiento en las 39 empresas activas, y de esos hoy sólo 12 tienen fecha:
 *  las alertas de vencimiento están implementadas y no tienen con qué
 *  dispararse.
 *
 *  NO es la única vía de carga y no reemplaza a la celda. `ExpirationDateCell`
 *  sigue siendo el camino para corregir una fecha de a una; la planilla es el
 *  camino para las que ya existen en un Excel. La grilla no evitaba el doble
 *  trabajo — lo creaba, obligando a transcribir a mano lo ya escrito.
 */
type Paso = 'inicio' | 'previa' | 'listo'

interface Props {
  open:      boolean
  onClose:   () => void
  /** Se avisa sólo cuando algo se escribió, para que la portada se refresque. */
  onAplicado: () => void
  puedeEditar: boolean
}

const BOTON_PRIMARIO =
  'inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-accent rounded-lg ' +
  'px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer'
const BOTON_SECUNDARIO =
  'inline-flex items-center gap-1.5 text-xs font-semibold text-accion border border-accent/30 ' +
  'rounded-lg px-3 py-1.5 hover:bg-accent/5 transition-colors disabled:opacity-50 cursor-pointer'

export function CargarFechasModal({ open, onClose, onAplicado, puedeEditar }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [paso, setPaso]           = useState<Paso>('inicio')
  const [historico, setHistorico] = useState(false)
  const [bajando, setBajando]     = useState(false)
  const [archivo, setArchivo]     = useState<File | null>(null)
  const [previa, setPrevia]       = useState<ResultadoDePlanilla | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  const alcance = historico ? 'todas' : 'activas'

  const resumen = useQuery({
    queryKey: ['planilla-vencimientos', alcance],
    queryFn:  () => complianceApi.planillaResumen(alcance),
    enabled:  open,
  })

  const reiniciar = useCallback(() => {
    setPaso('inicio'); setArchivo(null); setPrevia(null); setError(null)
    setTrabajando(false); setArrastrando(false)
  }, [])

  const cerrar = useCallback(() => { reiniciar(); onClose() }, [reiniciar, onClose])

  // Semántica de diálogo: Escape cierra, foco inicial y retorno.
  useEffect(() => {
    if (!open) return
    const enfocadoAntes = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('keydown', alTeclear)
      enfocadoAntes?.focus?.()
    }
  }, [open, cerrar])

  async function descargar() {
    setBajando(true); setError(null)
    try {
      const blob = await complianceApi.bajarPlanilla(alcance)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'vencimientos.csv'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo descargar la planilla')
    } finally {
      setBajando(false)
    }
  }

  async function revisar(elegido: File) {
    setArchivo(elegido); setError(null); setTrabajando(true)
    try {
      setPrevia(await complianceApi.subirPlanilla(elegido, true))
      setPaso('previa')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo leer la planilla')
    } finally {
      setTrabajando(false)
    }
  }

  async function aplicar() {
    if (!archivo) return
    setTrabajando(true); setError(null)
    try {
      setPrevia(await complianceApi.subirPlanilla(archivo, false))
      setPaso('listo')
      onAplicado()
    } catch (e) {
      // El archivo NO se suelta: un error al aplicar no puede hacer creer que
      // se perdió lo cargado. Se queda en la vista previa con el motivo arriba.
      setError(e instanceof ApiError ? e.message : 'No se pudo aplicar la planilla')
    } finally {
      setTrabajando(false)
    }
  }

  if (!open) return null

  const vacia = resumen.data?.filas === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Cargar fechas de vencimiento"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh] focus:outline-none animate-modal-in"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-text-primary">Cargar fechas de vencimiento</h2>
            <p className={`text-xs ${TEXTO_APOYO} mt-0.5`}>
              Registra cuándo vence cada documento sin subir el archivo
            </p>
          </div>
          <button
            type="button" onClick={cerrar} aria-label="Cerrar"
            className={`shrink-0 ${TEXTO_APOYO} hover:text-text-primary transition-colors cursor-pointer`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {error && (
            <p className="flex items-start gap-1.5 text-xs font-semibold text-espera">
              <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
              {error}
            </p>
          )}

          {paso === 'inicio' && (
            <>
              <section className="space-y-2">
                <p className="text-xs font-bold text-text-primary">1 · Baja la planilla</p>
                {resumen.isLoading && (
                  <p className={`text-xs ${TEXTO_APOYO}`}>Contando lo que falta…</p>
                )}
                {vacia && (
                  <p className={`text-xs ${TEXTO_CUERPO}`}>
                    No hay documentos con vencimiento pendientes
                    {historico ? '' : ' en las empresas activas'}. No hay nada que cargar.
                  </p>
                )}
                {resumen.data && !vacia && (
                  <p className={`text-xs ${TEXTO_CUERPO}`}>
                    {resumen.data.filas.toLocaleString('es-CL')} filas ·{' '}
                    {resumen.data.empresas} empresas · sólo documentos que llevan
                    vencimiento
                    {resumen.data.con_fecha_cargada > 0 && (
                      <> · {resumen.data.con_fecha_cargada} ya tienen fecha</>
                    )}
                  </p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button" onClick={descargar} disabled={bajando || vacia}
                    className={BOTON_SECUNDARIO}
                  >
                    {bajando
                      ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" />
                      : <Download size={13} aria-hidden="true" />}
                    Descargar planilla
                  </button>
                  <label className={`flex items-center gap-1.5 text-xs ${TEXTO_CUERPO} cursor-pointer`}>
                    <input
                      type="checkbox" checked={historico}
                      onChange={e => setHistorico(e.target.checked)}
                      className="accent-accent"
                    />
                    Incluir el histórico
                  </label>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-bold text-text-primary">
                  2 · Complétala y vuelve a subirla
                </p>
                {!puedeEditar ? (
                  <p className={`text-xs ${TEXTO_CUERPO}`}>
                    Tu perfil puede consultar la planilla, pero no cargarla.
                  </p>
                ) : (
                  <div
                    onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
                    onDragLeave={() => setArrastrando(false)}
                    onDrop={e => {
                      e.preventDefault(); setArrastrando(false)
                      const caido = e.dataTransfer.files?.[0]
                      if (caido) void revisar(caido)
                    }}
                    className={`border border-dashed rounded-xl px-4 py-6 text-center transition-colors ${
                      arrastrando ? 'border-accent bg-accent/5' : 'border-border'
                    }`}
                  >
                    {trabajando ? (
                      <p className={`flex items-center justify-center gap-1.5 text-xs ${TEXTO_CUERPO}`}>
                        <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                        Revisando la planilla…
                      </p>
                    ) : (
                      <>
                        <Upload size={18} className={`mx-auto mb-1.5 ${TEXTO_APOYO}`} aria-hidden="true" />
                        <p className={`text-xs ${TEXTO_CUERPO}`}>
                          Arrastra la planilla o{' '}
                          <button
                            type="button" onClick={() => inputRef.current?.click()}
                            className="font-semibold text-accion hover:opacity-70 transition-opacity cursor-pointer"
                          >
                            elige un archivo
                          </button>
                        </p>
                        <input
                          ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
                          onChange={e => {
                            const elegido = e.target.files?.[0]
                            // Se limpia para que elegir DOS VECES el mismo
                            // archivo vuelva a disparar el onChange.
                            e.target.value = ''
                            if (elegido) void revisar(elegido)
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {paso === 'previa' && previa && (
            <section className="space-y-3">
              <p className="text-sm font-bold text-text-primary">
                {previa.cambian === 0
                  ? 'No hay fechas nuevas que cargar'
                  : `Se van a cargar ${previa.cambian.toLocaleString('es-CL')} ${previa.cambian === 1 ? 'fecha' : 'fechas'}`}
              </p>
              <ul className={`text-xs ${TEXTO_CUERPO} space-y-1`}>
                {previa.vacias > 0 && (
                  <li>
                    {previa.vacias.toLocaleString('es-CL')} filas quedaron en blanco y no se tocan
                  </li>
                )}
                {previa.sin_cambios > 0 && (
                  <li>{previa.sin_cambios.toLocaleString('es-CL')} ya tenían esa misma fecha</li>
                )}
              </ul>
              {previa.total_errores > 0 && (
                <div className="border border-espera/30 rounded-lg p-3 space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-espera">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {previa.total_errores.toLocaleString('es-CL')}{' '}
                    {previa.total_errores === 1 ? 'fila con problema' : 'filas con problemas'}
                    {' · '}no se aplica nada hasta resolverlas
                  </p>
                  <ul className={`text-xs ${TEXTO_CUERPO} space-y-0.5`}>
                    {previa.errores.map((e, i) => (
                      <li key={i}>
                        {e.fila ? `Fila ${e.fila}: ` : ''}{e.error}
                      </li>
                    ))}
                  </ul>
                  {previa.total_errores > previa.errores.length && (
                    <p className={`text-xs ${TEXTO_APOYO}`}>
                      y {(previa.total_errores - previa.errores.length).toLocaleString('es-CL')} más
                    </p>
                  )}
                </div>
              )}
              <p className={`flex items-center gap-1.5 text-xs ${TEXTO_APOYO}`}>
                <FileText size={12} aria-hidden="true" />
                {archivo?.name}
              </p>
            </section>
          )}

          {paso === 'listo' && previa && (
            <section className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-bold text-resuelto">
                <CheckCircle2 size={15} aria-hidden="true" />
                {previa.cambian.toLocaleString('es-CL')}{' '}
                {previa.cambian === 1 ? 'fecha cargada' : 'fechas cargadas'}
              </p>
              <p className={`text-xs ${TEXTO_CUERPO}`}>
                Los documentos siguen pendientes de archivo: ahora avisan cuándo
                vencen.
              </p>
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          {paso === 'previa' && previa && (
            <>
              <button type="button" onClick={reiniciar} disabled={trabajando} className={BOTON_SECUNDARIO}>
                <ArrowLeft size={13} aria-hidden="true" /> Volver
              </button>
              <button
                type="button" onClick={aplicar}
                disabled={trabajando || previa.total_errores > 0 || previa.cambian === 0}
                className={BOTON_PRIMARIO}
              >
                {trabajando && <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" />}
                Aplicar
              </button>
            </>
          )}
          {paso !== 'previa' && (
            <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
              {paso === 'listo' ? 'Cerrar' : 'Listo'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
