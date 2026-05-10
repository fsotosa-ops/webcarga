export type LatLng = { lat: number; lng: number }

const GEO: Record<string, LatLng> = {
  // Región Metropolitana
  'Santiago':        { lat: -33.4489, lng: -70.6693 },
  'Quilicura':       { lat: -33.3567, lng: -70.7347 },
  'Pudahuel':        { lat: -33.4433, lng: -70.7594 },
  'Maipú':           { lat: -33.5122, lng: -70.7581 },
  'San Bernardo':    { lat: -33.5928, lng: -70.6995 },
  'Lampa':           { lat: -33.2833, lng: -70.8833 },
  'Colina':          { lat: -33.2017, lng: -70.6667 },
  'Lo Espejo':       { lat: -33.5203, lng: -70.6964 },
  'Cerrillos':       { lat: -33.4961, lng: -70.7119 },
  'Buín':            { lat: -33.7333, lng: -70.7333 },
  // Norte
  'Antofagasta':     { lat: -23.6524, lng: -70.3954 },
  'Iquique':         { lat: -20.2140, lng: -70.1522 },
  'Calama':          { lat: -22.4567, lng: -68.9251 },
  'Arica':           { lat: -18.4783, lng: -70.3126 },
  'Copiapó':         { lat: -27.3668, lng: -70.3319 },
  'La Serena':       { lat: -29.9027, lng: -71.2519 },
  'Coquimbo':        { lat: -29.9533, lng: -71.3394 },
  // Centro
  'Valparaíso':      { lat: -33.0472, lng: -71.6127 },
  'Viña del Mar':    { lat: -33.0245, lng: -71.5518 },
  'Rancagua':        { lat: -34.1703, lng: -70.7444 },
  'San Fernando':    { lat: -34.5856, lng: -70.9847 },
  'Curicó':          { lat: -34.9854, lng: -71.2394 },
  'Talca':           { lat: -35.4264, lng: -71.6554 },
  // Sur
  'Chillán':         { lat: -36.6067, lng: -72.1034 },
  'Los Ángeles':     { lat: -37.4706, lng: -72.3522 },
  'Concepción':      { lat: -36.8270, lng: -73.0498 },
  'Temuco':          { lat: -38.7359, lng: -72.5904 },
  'Valdivia':        { lat: -39.8196, lng: -73.2452 },
  'Osorno':          { lat: -40.5739, lng: -73.1352 },
  'Puerto Montt':    { lat: -41.4693, lng: -72.9424 },
  'Castro':          { lat: -42.4816, lng: -73.7630 },
  'Coyhaique':       { lat: -45.5712, lng: -72.0658 },
  'Punta Arenas':    { lat: -53.1638, lng: -70.9171 },
}

export function geocode(origin: string | null): LatLng | null {
  if (!origin) return null
  const key = Object.keys(GEO).find(k =>
    origin.toLowerCase().includes(k.toLowerCase())
  )
  return key ? GEO[key] : null
}

export function geocodeAll(origins: string[]): Array<{ origin: string; coords: LatLng }> {
  return origins
    .map(origin => ({ origin, coords: geocode(origin) }))
    .filter((x): x is { origin: string; coords: LatLng } => x.coords !== null)
}
