'use client'

import dynamic from 'next/dynamic'
import type { DiarioTrip } from '@/lib/types'

const MapaViajes = dynamic(() => import('./MapaViajes'), { ssr: false })

export default function MapaViajesWrapper({ trips }: { trips: DiarioTrip[] }) {
  return <MapaViajes trips={trips} />
}
