// Parser CSV RFC-4180 con autodetección de delimitador.
// Excel es-CL exporta con ';' — el parser anterior (split(',')) fallaba
// silenciosamente con esos archivos y con campos entrecomillados.

export type ParsedCSV = {
  headers: string[]
  rows:    string[][]
  delimiter: ';' | ','
}

export function detectDelimiter(headerLine: string): ';' | ',' {
  // Cuenta delimitadores fuera de comillas en la primera línea
  let semis = 0, commas = 0, inQuotes = false
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes) {
      if (ch === ';') semis++
      else if (ch === ',') commas++
    }
  }
  return semis >= commas && semis > 0 ? ';' : ','
}

/** Parse RFC-4180: comillas con delimitadores/saltos de línea embebidos, "" escapada */
export function parseCSV(text: string): ParsedCSV {
  // BOM strip
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const firstNewline = text.indexOf('\n')
  const headerLine = firstNewline === -1 ? text : text.slice(0, firstNewline)
  const delimiter = detectDelimiter(headerLine)

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  // última fila sin salto final
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some(c => c.trim() !== '')) rows.push(row)
  }

  const headers = (rows.shift() ?? []).map(h => h.trim().toLowerCase())
  return { headers, rows: rows.map(r => r.map(c => c.trim())), delimiter }
}

/** Heurística de mojibake: un archivo Latin-1 leído como UTF-8 produce U+FFFD */
export function looksMojibake(text: string): boolean {
  return text.includes('�')
}

/** Acepta YYYY-MM-DD, DD/MM/YYYY y DD-MM-YYYY → ISO, o null si no parsea */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

/** Columna destinos: "Local 1@2026-05-29 09:00|Local 2" → stops payload */
export function parseStopsColumn(raw: string): { local: string; planning_date: string | null }[] {
  if (!raw.trim()) return []
  return raw.split('|').map(part => {
    const [local, date] = part.split('@')
    return { local: local.trim(), planning_date: date?.trim() || null }
  }).filter(s => s.local !== '')
}
