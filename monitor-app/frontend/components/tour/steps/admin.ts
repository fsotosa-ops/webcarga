import type { Step } from 'react-joyride'

export const adminSteps: Step[] = [
  {
    target: '[data-tour="admin-users"]',
    title: '⚙️ Gestión de usuarios',
    content: 'Administra usuarios, roles y permisos. Solo visible para administradores y owners. Los roles definen qué puede ver y editar cada persona.',
    placement: 'top',
  },
]
