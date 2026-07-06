// Genera lib/data/chile-locations.json desde country-state-city (devDependency).
// Se commitea el JSON generado para no embarcar el dataset mundial en el bundle.
// Regenerar con: node scripts/generate-chile-locations.mjs
import { State, City } from 'country-state-city'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const regions = State.getStatesOfCountry('CL')
  .map(s => ({
    code:   s.isoCode,
    name:   s.name,
    cities: City.getCitiesOfState('CL', s.isoCode).map(c => c.name).sort((a, b) => a.localeCompare(b, 'es')),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'data', 'chile-locations.json')
writeFileSync(out, JSON.stringify(regions, null, 2) + '\n')
console.log(`OK: ${regions.length} regiones, ${regions.reduce((n, r) => n + r.cities.length, 0)} ciudades → ${out}`)
