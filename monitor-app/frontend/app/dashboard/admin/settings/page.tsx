import { PortadaDominios } from './PortadaDominios'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'

export default function ConfiguracionPage() {
  return (
    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto">
      <div>
        <EncabezadoDePagina
          titulo="Configuración"
          bajada="Elige el área que quieres ajustar. Los cambios no requieren un despliegue."
        />
      </div>
      <PortadaDominios />
    </div>
  )
}
