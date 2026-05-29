import type { Step } from 'react-joyride'

export const diarioSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    title: '🗺️ Navegación principal',
    content: 'Desde aquí navegas entre Diario, Empresas y Administración. El sidebar se puede colapsar para más espacio.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="trip-table"]',
    title: '📋 Tabla de viajes',
    content: 'Aquí están todos los viajes activos del día. Cada fila muestra patente, conductor, EETT, destinos y estado en tiempo real. Haz clic en una fila para ver el detalle completo.',
    placement: 'top',
  },
  {
    target: '[data-tour="trip-filters"]',
    title: '🔍 Filtros y búsqueda',
    content: 'Filtra por estado de grupo, TMS source, flags o busca por patente, conductor o EETT. Los cambios aplican al instante sin recargar la página.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="trip-slideover-btn"]',
    title: '📂 Detalle del viaje',
    content: 'Haz clic en cualquier fila para abrir el detalle: tab Viaje (paradas, tiempos, SAP), tab Empresa (asignación de transportista) y tab Bitácora (notas y estado manual).',
    placement: 'left',
  },
  {
    target: '[data-tour="trip-create-btn"]',
    title: '➕ Agregar viaje',
    content: 'Crea un viaje manualmente o sube un CSV con carga masiva. Útil para registrar viajes que no están sincronizados desde el TMS.',
    placement: 'left',
  },
]
