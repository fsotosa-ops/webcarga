'use client'

import { useEffect, useRef } from 'react'
import type { DiarioTrip } from '@/lib/types'
import { geocode } from '@/lib/geocoding'

interface OriginBucket {
  origin: string
  lat: number
  lng: number
  count: number
  dominantStatus: string
}

const STATUS_COLOR: Record<string, string> = {
  'RUTA': '#62a420',
  'EN LOCAL': '#ea6b25',
  'ASIGNADO': '#053bfa',
  'RETORNANDO': '#1cb9ec',
  'CANCELADO': '#b00020',
  'CERRADO FINALIZADO': '#6b7280',
}

function bucketByOrigin(trips: DiarioTrip[]): OriginBucket[] {
  const map = new Map<string, { count: number; statuses: Record<string, number>; lat: number; lng: number }>()

  for (const t of trips) {
    const origin = t.cd_planta_origen
    if (!origin) continue
    const coords = geocode(origin)
    if (!coords) continue

    const key = origin
    if (!map.has(key)) {
      map.set(key, { count: 0, statuses: {}, lat: coords.lat, lng: coords.lng })
    }
    const bucket = map.get(key)!
    bucket.count++
    const st = t.normalized_status ?? 'OTRO'
    bucket.statuses[st] = (bucket.statuses[st] ?? 0) + 1
  }

  return Array.from(map.entries()).map(([origin, { count, statuses, lat, lng }]) => {
    const dominantStatus = Object.entries(statuses).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'OTRO'
    return { origin, lat, lng, count, dominantStatus }
  })
}

interface MapaViajesProps {
  trips: DiarioTrip[]
}

export default function MapaViajes({ trips }: MapaViajesProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<unknown>(null)

  const buckets = bucketByOrigin(trips)
  const maxCount = Math.max(...buckets.map(b => b.count), 1)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    async function initMap() {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')

      const map = L.map(mapRef.current!, {
        center: [-35.5, -71.0],
        zoom: 5,
        zoomControl: true,
        scrollWheelZoom: false,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      mapInstanceRef.current = map

      for (const bucket of buckets) {
        const radius = 10 + (bucket.count / maxCount) * 30
        const color = STATUS_COLOR[bucket.dominantStatus] ?? '#6b7280'

        L.circleMarker([bucket.lat, bucket.lng], {
          radius,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.7,
        })
          .addTo(map)
          .bindTooltip(
            `<strong>${bucket.origin}</strong><br>${bucket.count} viajes<br>Estado dominante: ${bucket.dominantStatus}`,
            { permanent: false }
          )
      }
    }

    initMap()

    return () => {
      if (mapInstanceRef.current) {
        ;(mapInstanceRef.current as { remove(): void }).remove()
        mapInstanceRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (buckets.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border h-64 flex items-center justify-center">
        <p className="text-sm text-gray-400">Sin datos geocodificables para el período</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Distribución por origen</h2>
        <p className="text-xs text-gray-400">{buckets.length} CDs geocodificados</p>
      </div>
      <div ref={mapRef} className="h-72 w-full" />
    </div>
  )
}
