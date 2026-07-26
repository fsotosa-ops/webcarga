'use client'

import { useState } from 'react'
import { EstadosTmsTab, EstadosOperacionalesTab, EstadosEquipoTab } from './estados-tabs'
import { AlertasVencimientoTab, RangosTemperaturaTab, AlertasMonitorTab } from './umbrales-tabs'

type Tab = 'estados_tms' | 'estados_op' | 'estados_equipo' | 'alertas_monitor' | 'alertas' | 'rangos_temperatura'

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'estados_tms',        label: 'Estados TMS',            desc: 'Colores y columna del tablero' },
  { key: 'estados_op',         label: 'Estados Operacionales',  desc: 'Vocabulario del equipo' },
  { key: 'estados_equipo',     label: 'Estados de Equipo',      desc: 'Motivo cuando un equipo no sale hoy' },
  { key: 'alertas_monitor',    label: 'Alertas del Monitor',    desc: 'Umbrales operacionales' },
  { key: 'alertas',            label: 'Alertas de Vencimiento', desc: 'Documentos, en días' },
  { key: 'rangos_temperatura', label: 'Rangos de Temperatura',  desc: 'Por tipo de carga' },
]

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<Tab>('estados_tms')

  return (
    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Configuración</h1>
        <p className="text-xs text-gray-400 mt-0.5">Administra los metadatos del monitor sin necesidad de deploy</p>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div role="tablist" aria-label="Secciones de configuración" className="flex border-b border-border overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-w-[130px] px-4 py-3.5 text-left transition-colors border-b-2 ${
                tab === t.key
                  ? 'border-accent bg-accent/3'
                  : 'border-transparent hover:bg-gray-50/60'
              }`}
            >
              <p className={`text-xs font-semibold ${tab === t.key ? 'text-accent' : 'text-gray-600'}`}>{t.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">{t.desc}</p>
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === 'estados_tms'        && <EstadosTmsTab />}
          {tab === 'estados_op'         && <EstadosOperacionalesTab />}
          {tab === 'estados_equipo'     && <EstadosEquipoTab />}
          {tab === 'alertas_monitor'    && <AlertasMonitorTab />}
          {tab === 'alertas'            && <AlertasVencimientoTab />}
          {tab === 'rangos_temperatura' && <RangosTemperaturaTab />}
        </div>
      </div>
    </div>
  )
}
