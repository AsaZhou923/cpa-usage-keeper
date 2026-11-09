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

  it('reads offsetless legacy timestamps as Tokyo time independently of the browser', () => {
    const previous = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(formatTokyoDateTime('2026-11-09T00:30:20')).toBe('2026/11/09 00:30:20')
      expect(formatTokyoDateTime('2026-11-09 00:30:20.123')).toBe('2026/11/09 00:30:20')
      expect(formatTokyoDateTime('2026-11-09')).toBe('2026/11/09 00:00:00')
      expect(formatTokyoDateTime('2026-11-08T15:30:20Z')).toBe('2026/11/09 00:30:20')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('returns an empty label for invalid timestamps', () => {
    expect(formatTokyoDateTime('invalid')).toBe('')
  })
})
