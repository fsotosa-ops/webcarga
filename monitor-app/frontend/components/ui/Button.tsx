import { forwardRef, type ButtonHTMLAttributes } from 'react'

const VARIANTE = {
  primary: 'bg-accent text-white hover:bg-accent/90',
  secondary: 'border border-border bg-white text-text-primary hover:bg-bg-main',
  danger: 'bg-status-incidente text-white hover:bg-status-incidente/90',
  link: 'text-accion hover:underline',
} as const

const TAMANO = {
  md: 'rounded-md px-3 py-1.5 text-dato',
  sm: 'rounded-md px-2.5 py-1 text-etiqueta',
} as const

/** Un enlace no tiene caja: solo el tamaño de letra. */
const TAMANO_DE_ENLACE = { md: 'text-dato', sm: 'text-etiqueta' } as const

type Variante = keyof typeof VARIANTE
type Tamano = keyof typeof TAMANO

/** Las clases de un botón del kit, para lo que se ve como botón sin serlo (un enlace
 *  "Ver histórico" junto a las descargas). */
export function buttonClass({ variant = 'secondary', size = 'md' }: { variant?: Variante; size?: Tamano } = {}): string {
  const base = variant === 'link'
    ? `inline-flex items-center gap-1.5 font-semibold ${TAMANO_DE_ENLACE[size]}`
    : `inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors ${TAMANO[size]}`
  return `${base} ${VARIANTE[variant]} disabled:cursor-not-allowed disabled:opacity-50`
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `primary`: la acción de la pantalla; `secondary`: las demás; `danger`: la que no se
   *  deshace o salta una regla; `link`: una acción menor dentro de un texto. */
  variant?: Variante
  size?: Tamano
}

/** El botón del kit. Había ocho maneras de escribir el botón principal (16/10), con
 *  tamaños y grises propios; el color y el tamaño salen de aquí. `type="button"` por
 *  defecto: un botón dentro de un formulario no lo envía sin querer. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant, size, type = 'button', className, ...rest }, ref,
) {
  return <button ref={ref} type={type} {...rest} className={`${buttonClass({ variant, size })} ${className ?? ''}`.trim()} />
})
