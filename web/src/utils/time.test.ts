import { describe, expect, it } from 'vitest'
import {
  MONITORING_TIME_ZONE,
  formatTokyoClock,
  formatTokyoDateTime,
  formatTokyoMonthDayTime,
} from './time'

describe('Tokyo monitoring time formatting', () => {
  it('uses the canonical IANA timezone', () => {
    expect(MONITORING_TIME_ZONE).toBe('Asia/Tokyo')
  })

  it('converts UTC instants to JST and preserves seconds when requested', () => {
    expect(formatTokyoClock('2026-05-10T10:02:03Z', true)).toBe('19:02:03')
    expect(formatTokyoMonthDayTime('2026-05-10T10:02:03Z')).toBe('05/10 19:02')
  })

  it('handles Tokyo date rollover', () => {
    expect(formatTokyoDateTime('2026-05-10T16:30:00Z')).toBe('2026/05/11 01:30:00')
  })

  it('returns an empty label for invalid timestamps', () => {
    expect(formatTokyoDateTime('invalid')).toBe('')
  })
})
