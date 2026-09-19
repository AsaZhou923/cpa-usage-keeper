import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../KeyOverviewPage.tsx', import.meta.url), 'utf8')

describe('KeyOverviewPage caller wiring', () => {
  it('does not reload overview data just because language changes', () => {
    expect(source).toContain('}, [onAuthRequired, recoverRangeBoundsConflict, usageRangeQuery, usageRangeQueryKey]);')
    expect(source).toContain('}, [onAuthRequired, realtimeWindow]);')
  })

  it('disables manual refresh only while its own request is in flight', () => {
    expect(source).toContain('const refreshDisabled = manualRefreshLoading;')
  })

  it('keeps existing realtime data visible during background refreshes', () => {
    expect(source).not.toContain('setRealtime(null)')
    expect(source).toContain('realtime?.window === realtimeWindow ? realtime : undefined')
  })

  it('renders both Activity cards through Recent Activity before realtime metrics', () => {
    expect(source).toContain('<RecentActivityPanel')
    expect(source.indexOf('<RecentActivityPanel')).toBeLessThan(source.indexOf('<OverviewRealtimePanel'))
    expect(source).toContain('<OverviewRealtimePanel')
    expect(source).toContain("visibleDimensions={KEY_OVERVIEW_REALTIME_VISIBLE_DIMENSIONS}")
  })

})
