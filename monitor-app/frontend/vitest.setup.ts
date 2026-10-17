import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// `findBy*` y `waitFor` esperan 1 s por defecto: con carga no alcanza y el test
// falla por ruido (14/10). Igual cortan apenas aparece el elemento.
configure({ asyncUtilTimeout: 5000 })

// jsdom no trae `matchMedia` (todo navegador sí). Por defecto, una pantalla de teléfono
// que no cambia; el test que necesita otra cosa lo reemplaza.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList
}
