/**
 * El numero con su etiqueta.
 *
 * En un producto donde lo unico que importa son los numeros —cuantos sin
 * asignar, cuantos dias abierto, cuantos de cuantos— los numeros no tenian
 * peso: en la portada de Configuracion, "37 documentos" se veia igual que la
 * descripcion de al lado. Y ninguna cifra usaba numeracion tabular, asi que
 * las columnas bailaban de fila en fila porque el 1 ocupa menos que el 8.
 *
 * `cargando` NO es un detalle de presentacion. Certificacion mostraba un "0"
 * en cifra grande mientras la consulta estaba en vuelo y despues saltaba a
 * 2.360: durante ese segundo afirmaba con seguridad algo falso. La regla vive
 * aca adentro para que no haya que acordarse de ella en cada pantalla — que
 * es exactamente como se colo la primera vez.
 *
 * Un cero REAL si se muestra: "cero pendientes" es una respuesta, y buena.
 */
export function Cifra({
  valor,
  etiqueta,
  cargando = false,
  tono = 'normal',
}: {
  valor: number | string | undefined | null
  etiqueta: string
  cargando?: boolean
  tono?: 'normal' | 'atencion' | 'urgente' | 'resuelto'
}) {
  const color = {
    normal: 'text-text-primary',
    atencion: 'text-espera',
    urgente: 'text-status-incidente',
    resuelto: 'text-resuelto',
  }[tono]

  if (cargando || valor === undefined || valor === null) {
    return (
      <span
        className="h-7 w-32 rounded bg-gray-100 motion-safe:animate-pulse inline-block align-middle"
        aria-hidden
      />
    )
  }

  return (
    <span className="flex items-baseline gap-2">
      <span className={`text-cifra font-bold tabular-nums leading-none ${color}`}>{valor}</span>
      <span className="text-etiqueta text-gray-500">{etiqueta}</span>
    </span>
  )
}
