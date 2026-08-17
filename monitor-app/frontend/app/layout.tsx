import type { Metadata } from 'next'
import { Roboto, Mulish, Fira_Code } from 'next/font/google'
import './globals.css'

const roboto = Roboto({
  variable: '--font-roboto',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
})

// La familia de los identificadores: patentes, IDs de viaje, RUT. En este
// producto la patente es lo que la gente dice en voz alta — "el LRTD13", "el
// Riquelme" — y monoespaciada se encuentra de un barrido en una tabla de 44
// filas. Emparejamiento recomendado por ui-ux-pro-max para tableros de datos.
const firaCode = Fira_Code({
  variable: '--font-fira-code',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

const mulish = Mulish({
  variable: '--font-mulish',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'Diario 2.0 — WebCarga',
  description: 'Monitor operacional de viajes WebCarga',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${roboto.variable} ${mulish.variable} ${firaCode.variable} h-full`}>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  )
}
