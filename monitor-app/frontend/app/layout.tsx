import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Las fuentes viven en el repo (`app/_fonts`, subconjunto latino, variables) y
// no se bajan de Google en cada build: con `next/font/google`, una falla de red
// del runner rompía el deploy entero (08/10 y 30/10). Para cambiar un peso o
// una familia, se baja el woff2 de Google Fonts y se reemplaza el archivo.
// Licencias: Roboto (Apache 2.0), Fira Code y Mulish (OFL).
const roboto = localFont({
  variable: '--font-roboto',
  src: './_fonts/roboto-latin.woff2',
  weight: '400 700',
})

// La familia de los identificadores: patentes, IDs de viaje, RUT. En este
// producto la patente es lo que la gente dice en voz alta — "el LRTD13", "el
// Riquelme" — y monoespaciada se encuentra de un barrido en una tabla de 44
// filas. Emparejamiento recomendado por ui-ux-pro-max para tableros de datos.
const firaCode = localFont({
  variable: '--font-fira-code',
  src: './_fonts/fira-code-latin.woff2',
  weight: '400 600',
})

const mulish = localFont({
  variable: '--font-mulish',
  src: './_fonts/mulish-latin.woff2',
  weight: '400 800',
})

export const metadata: Metadata = {
  title: 'WebCarga',
  description: 'Monitor operacional de viajes WebCarga',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${roboto.variable} ${mulish.variable} ${firaCode.variable} h-full`}>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  )
}
