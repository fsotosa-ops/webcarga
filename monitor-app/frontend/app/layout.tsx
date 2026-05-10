import type { Metadata } from 'next'
import { Roboto, Mulish, Poppins } from 'next/font/google'
import './globals.css'

const roboto = Roboto({
  variable: '--font-roboto',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
})

const mulish = Mulish({
  variable: '--font-mulish',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
})

const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'Diario 2.0 — WebCarga',
  description: 'Monitor operacional de viajes WebCarga',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${roboto.variable} ${mulish.variable} ${poppins.variable} h-full`}>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  )
}
