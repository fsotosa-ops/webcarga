import { describe, it, expect } from 'vitest'
import { matchesTab, countByTab } from './transporterFilters'

describe('matchesTab', () => {
  it('active tab matches only ACTIVE', () => {
    expect(matchesTab({ operational_status: 'ACTIVE' }, 'active')).toBe(true)
    expect(matchesTab({ operational_status: 'LEGACY_INACTIVE' }, 'active')).toBe(false)
    expect(matchesTab({ operational_status: 'INACTIVE' }, 'active')).toBe(false)
  })

  it('legacy tab matches everything that is not ACTIVE', () => {
    expect(matchesTab({ operational_status: 'LEGACY_INACTIVE' }, 'legacy')).toBe(true)
    expect(matchesTab({ operational_status: 'INACTIVE' }, 'legacy')).toBe(true)
    expect(matchesTab({ operational_status: 'ACTIVE' }, 'legacy')).toBe(false)
  })
})

describe('countByTab', () => {
  it('splits counts between active and legacy', () => {
    const items = [
      { operational_status: 'ACTIVE' as const },
      { operational_status: 'ACTIVE' as const },
      { operational_status: 'LEGACY_INACTIVE' as const },
    ]
    expect(countByTab(items)).toEqual({ active: 2, legacy: 1 })
  })
})
