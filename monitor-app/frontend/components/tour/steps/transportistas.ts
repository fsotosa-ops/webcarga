import type { Step } from 'react-joyride'

export const transportistasSteps: Step[] = [
  {
    target: '[data-tour="transportistas-list"]',
    title: '🏢 Empresas transportistas',
    content: 'Gestiona aquí todas las empresas transportistas. Puedes buscar, ver el perfil de cada empresa y asignarlas a viajes desde el detalle del viaje.',
    placement: 'top',
    skipBeacon: true,
  },
]
