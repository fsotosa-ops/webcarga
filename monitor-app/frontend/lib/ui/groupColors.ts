import type { GroupColor } from '@/lib/api/filterGroups'

/**
 * Los colores que se eligen al armar un grupo del Monitor ("Mis activos", "Por vencer").
 *
 * No son colores del sistema: no dicen "resuelto" ni "alerta", identifican un grupo que
 * armó una persona, como la serie de un gráfico. Por eso no pueden ser `accion` ni
 * `informativo`, y viven aquí, una vez: antes estaban dos veces y distintas (el chip en
 * FilterPopover con 9 colores; el selector en GroupBuilder con 8).
 *
 * Las clases van escritas enteras para que Tailwind las encuentre.
 */
export const GROUP_COLORS: Record<GroupColor, { swatch: string; ring: string; chip: { on: string; off: string } }> = {
  blue:   { swatch: 'bg-blue-500',   ring: 'ring-blue-500',   chip: { on: 'bg-blue-500 border-blue-500 text-white font-semibold',     off: 'text-blue-700 border-blue-300 bg-blue-50 hover:border-blue-400' } },
  green:  { swatch: 'bg-green-500',  ring: 'ring-green-500',  chip: { on: 'bg-green-500 border-green-500 text-white font-semibold',   off: 'text-green-700 border-green-300 bg-green-50 hover:border-green-400' } },
  orange: { swatch: 'bg-orange-500', ring: 'ring-orange-500', chip: { on: 'bg-orange-500 border-orange-500 text-white font-semibold', off: 'text-orange-700 border-orange-300 bg-orange-50 hover:border-orange-400' } },
  purple: { swatch: 'bg-purple-500', ring: 'ring-purple-500', chip: { on: 'bg-purple-500 border-purple-500 text-white font-semibold', off: 'text-purple-700 border-purple-300 bg-purple-50 hover:border-purple-400' } },
  red:    { swatch: 'bg-red-500',    ring: 'ring-red-500',    chip: { on: 'bg-red-500 border-red-500 text-white font-semibold',       off: 'text-red-700 border-red-300 bg-red-50 hover:border-red-400' } },
  teal:   { swatch: 'bg-teal-500',   ring: 'ring-teal-500',   chip: { on: 'bg-teal-500 border-teal-500 text-white font-semibold',     off: 'text-teal-700 border-teal-300 bg-teal-50 hover:border-teal-400' } },
  amber:  { swatch: 'bg-amber-500',  ring: 'ring-amber-500',  chip: { on: 'bg-amber-500 border-amber-500 text-white font-semibold',   off: 'text-amber-700 border-amber-300 bg-amber-50 hover:border-amber-400' } },
  pink:   { swatch: 'bg-pink-500',   ring: 'ring-pink-500',   chip: { on: 'bg-pink-500 border-pink-500 text-white font-semibold',     off: 'text-pink-700 border-pink-300 bg-pink-50 hover:border-pink-400' } },
  slate:  { swatch: 'bg-slate-500',  ring: 'ring-slate-500',  chip: { on: 'bg-slate-500 border-slate-500 text-white font-semibold',   off: 'text-slate-700 border-slate-300 bg-slate-50 hover:border-slate-400' } },
}

/** Nombre del color para el lector de pantalla del selector. */
export const GROUP_COLOR_LABEL: Record<GroupColor, string> = {
  blue: 'Azul', green: 'Verde', orange: 'Naranjo', purple: 'Morado', red: 'Rojo',
  teal: 'Verde azulado', amber: 'Ámbar', pink: 'Rosado', slate: 'Gris',
}

export const GROUP_COLOR_IDS = Object.keys(GROUP_COLORS) as GroupColor[]
