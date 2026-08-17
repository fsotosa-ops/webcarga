import type { ReactNode } from 'react'

/**
 * El encabezado de un modulo: titulo, bajada y acciones.
 *
 * La auditoria del 2026-08-16 encontro CATORCE <h1> escritos a mano con SIETE
 * combinaciones distintas de clases. Cinco modulos usaban
 * `font-mulish font-bold text-xl text-text-primary`; el Cierre ya habia
 * divergido. Es lo primero que ve el usuario en cada modulo, y que cada uno
 * se vea distinto es la version mas visible de que no hay sistema.
 *
 * La bajada NO es decorativa: es donde se explica que responde la pantalla,
 * y por eso se limita el ancho — un parrafo de 140 caracteres por linea no se
 * lee, se saltea.
 */
export function EncabezadoDePagina({
  titulo,
  bajada,
  icono,
  children,
}: {
  titulo: string
  bajada?: string
  /** Opcional, y solo si aporta: un icono por tener uno es ruido. */
  icono?: ReactNode
  /** Acciones de la pagina. Van a la derecha, fuera del titulo. */
  children?: ReactNode
}) {
  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="font-mulish font-bold text-cifra text-text-primary flex items-center gap-2 text-balance leading-tight">
          {icono}
          {titulo}
        </h1>
        {bajada && (
          <p className="text-dato text-gray-500 mt-1 max-w-[70ch]">{bajada}</p>
        )}
      </div>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  )
}
