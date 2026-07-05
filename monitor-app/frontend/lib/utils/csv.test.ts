import { describe, it, expect } from 'vitest'
import { parseCSV, detectDelimiter, normalizeDate, parseStopsColumn, looksMojibake } from './csv'

describe('detectDelimiter', () => {
  it('detects semicolon (Excel es-CL) and comma', () => {
    expect(detectDelimiter('fecha;cliente;origen')).toBe(';')
    expect(detectDelimiter('fecha,cliente,origen')).toBe(',')
  })

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a;b",c,d')).toBe(',')
  })
})

describe('parseCSV', () => {
  it('parses a comma CSV with headers lowercased', () => {
    const { headers, rows, delimiter } = parseCSV('Fecha,Cliente\n2026-07-06,Walmart\n')
    expect(delimiter).toBe(',')
    expect(headers).toEqual(['fecha', 'cliente'])
    expect(rows).toEqual([['2026-07-06', 'Walmart']])
  })

  it('parses a semicolon CSV (Excel es-CL)', () => {
    const { headers, rows, delimiter } = parseCSV('fecha;cliente\n2026-07-06;Colun\n')
    expect(delimiter).toBe(';')
    expect(headers).toEqual(['fecha', 'cliente'])
    expect(rows[0]).toEqual(['2026-07-06', 'Colun'])
  })

  it('handles quoted fields with embedded delimiters (RFC-4180)', () => {
    const { rows } = parseCSV('cliente,origen\n"Walmart, Chile",Santiago\n')
    expect(rows[0]).toEqual(['Walmart, Chile', 'Santiago'])
  })

  it('handles escaped quotes and CRLF', () => {
    const { rows } = parseCSV('a,b\r\n"dijo ""hola""",x\r\n')
    expect(rows[0]).toEqual(['dijo "hola"', 'x'])
  })

  it('strips BOM and skips empty lines', () => {
    const { headers, rows } = parseCSV('﻿fecha,cliente\n\n2026-07-06,Acme\n\n')
    expect(headers[0]).toBe('fecha')
    expect(rows).toHaveLength(1)
  })
})

describe('normalizeDate', () => {
  it('accepts ISO, DD/MM/YYYY and DD-MM-YYYY', () => {
    expect(normalizeDate('2026-07-06')).toBe('2026-07-06')
    expect(normalizeDate('6/7/2026')).toBe('2026-07-06')
    expect(normalizeDate('06-07-2026')).toBe('2026-07-06')
  })

  it('rejects garbage', () => {
    expect(normalizeDate('mañana')).toBeNull()
    expect(normalizeDate('2026/07/06')).toBeNull()
  })
})

describe('parseStopsColumn', () => {
  it('parses names with optional @datetime, separated by |', () => {
    expect(parseStopsColumn('Local Maipú@2026-07-06 09:00|Local Puente Alto')).toEqual([
      { local: 'Local Maipú', planning_date: '2026-07-06 09:00' },
      { local: 'Local Puente Alto', planning_date: null },
    ])
  })

  it('returns empty for blank input and skips empty segments', () => {
    expect(parseStopsColumn('')).toEqual([])
    expect(parseStopsColumn('|Local 1|')).toEqual([{ local: 'Local 1', planning_date: null }])
  })
})

describe('looksMojibake', () => {
  it('detects the replacement character', () => {
    expect(looksMojibake('Maip�')).toBe(true)
    expect(looksMojibake('Maipú')).toBe(false)
  })
})
