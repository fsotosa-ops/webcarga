import Image from 'next/image'

/** El logo oficial de WebCarga, tomado de app.webcarga.com.
 *
 *  - `completo`: cubo + "WebCarga" en BLANCO, para fondo oscuro (barra lateral,
 *    login). Sobre blanco no se ve.
 *  - `isotipo`: el cubo azul del favicon, para fondo claro.
 *
 *  Una sola pieza con la forma como prop: es la misma marca en dos tamaños.
 *  Los archivos son PNG del sitio (el completo mide 279×60); si WebCarga
 *  entrega un SVG, se cambia acá y en ningún otro lado. */
const ARCHIVOS = {
  completo: { src: '/brand/webcarga-logo.png', ancho: 279, alto: 60 },
  isotipo:  { src: '/brand/webcarga-icon.png', ancho: 64,  alto: 64 },
} as const

export default function LogoWebCarga({ forma, alto, className, prioridad = false }: {
  forma: keyof typeof ARCHIVOS
  /** Alto en px; el ancho sale de la proporción del archivo. */
  alto: number
  className?: string
  prioridad?: boolean
}) {
  const a = ARCHIVOS[forma]
  return (
    <Image
      src={a.src}
      alt="WebCarga"
      height={alto}
      width={Math.round((alto * a.ancho) / a.alto)}
      priority={prioridad}
      className={className}
    />
  )
}
