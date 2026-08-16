import { PortadaDominios } from './PortadaDominios'

export default function ConfiguracionPage() {
  return (
    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Configuración</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Elige el área que quieres ajustar. Los cambios no requieren un despliegue.
        </p>
      </div>
      <PortadaDominios />
    </div>
  )
}
