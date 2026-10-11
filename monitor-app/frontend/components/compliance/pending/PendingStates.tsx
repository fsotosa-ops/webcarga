import { Estado } from '@/components/ui/Estado'

/** Lo que Pendientes muestra cuando no pudo cargar: el mismo bloque en la
 *  página (el resumen) y en el panel (la lista). Una sola definición, para que
 *  las dos no terminen diciendo cosas distintas — y **nunca** como vacío: un
 *  fallo mostrado como "no hay nada" hace creer que no se debe nada. */
export function PendingLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Estado tipo="error" titulo="No se pudo cargar lo pendiente." detalle="Lo que ya estaba cargado no se perdió.">
      <button type="button" onClick={onRetry}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
        Reintentar
      </button>
    </Estado>
  )
}

/** Cargando: renglones grises, **sin cifras**. Un "0" mientras carga afirma
 *  algo falso y después salta. */
export function PendingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Cargando lo pendiente" className="space-y-3 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className={`h-2.5 rounded bg-bg-main motion-safe:animate-pulse ${i % 2 ? 'w-3/5' : 'w-4/5'}`} />
          <div className="h-2.5 w-2/5 rounded bg-bg-main motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}
