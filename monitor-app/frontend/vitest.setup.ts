import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// `findBy*` y `waitFor` esperan 1 s por defecto: con carga no alcanza y el test
// falla por ruido (14/10). Igual cortan apenas aparece el elemento.
configure({ asyncUtilTimeout: 5000 })
