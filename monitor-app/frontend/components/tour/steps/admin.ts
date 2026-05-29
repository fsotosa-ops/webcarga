import type { Step } from 'react-joyride'

export const adminSteps: Step[] = [
  {
    target: '[data-tour="admin-users"]',
    title: '👥 Gestión de usuarios',
    content: 'Administra usuarios, roles y permisos. Los roles (owner, admin, editor, writer, viewer) definen qué puede ver y editar cada persona en la app.',
    placement: 'top',
    skipBeacon: true,
  },
  {
    target: '[data-tour="admin-config"]',
    title: '🎛️ Configuración',
    content: 'Personaliza los metadatos de la app sin deploy: colores y labels de estados TMS, estados operacionales del equipo, y umbrales de alerta por días de vencimiento.',
    placement: 'top',
  },
]
