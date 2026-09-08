import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n')

const usagePageSource = readSource(new URL('../UsagePage.tsx', import.meta.url))
const keyOverviewPageStyles = readSource(new URL('../../features/key-viewer/KeyViewerShell.module.scss', import.meta.url))
const keyOverviewPageSource = readSource(new URL('../KeyOverviewPage.tsx', import.meta.url))
const keyAnalysisPageSource = readSource(new URL('../KeyAnalysisPage.tsx', import.meta.url))
const keyViewerShellSource = readSource(new URL('../../features/key-viewer/KeyViewerShell.tsx', import.meta.url))

const usagePageEffectBlock = (needle: string) => {
  const needleIndex = usagePageSource.indexOf(needle)
  expect(needleIndex).toBeGreaterThanOrEqual(0)
  const start = usagePageSource.lastIndexOf('  useEffect(() => {', needleIndex)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = usagePageSource.indexOf('\n  }, [', start)
  expect(end).toBeGreaterThan(start)
  const close = usagePageSource.indexOf(');', end)
  expect(close).toBeGreaterThan(end)
  return usagePageSource.slice(start, close + 2)
}

describe('UsagePage caller wiring', () => {
  it('patches the local ranking cache by Key ID after a settings alias save', () => {
    const start = usagePageSource.indexOf('const handleSaveApiKeyAlias = useCallback')
    const end = usagePageSource.indexOf('\n  const handleRevokeAuthSession', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const handler = usagePageSource.slice(start, end)
    expect(handler).toContain('patchLocalRankingProfileCache(updated.id, {')
    expect(handler).toContain('key_alias: updated.keyAlias')
    expect(handler).toContain('display_name: updated.label')
  })

  it('uses the shared C time-range control on both dashboard surfaces', () => {
    expect(usagePageSource).toContain('<TimeRangeControl')
    expect(keyOverviewPageSource).toContain('<TimeRangeControl')
    expect(usagePageSource).toContain('parseStoredUsageRangeState')
    expect(keyOverviewPageSource).toContain('loadKeyViewerTimeRange')
    expect(keyAnalysisPageSource).toContain('loadKeyViewerTimeRange')
  })

  it('threads the tab-effective custom range through Usage and Key Overview queries', () => {
    expect(usagePageSource).toContain('const activeCustomRange = useMemo(() => getUsageCustomRangeForTab(')
    expect(usagePageSource).toContain('customRange={activeCustomRange}')
    expect(usagePageSource).toContain("maxCustomDayRangeDays={activeTab === 'events' ? REQUEST_EVENTS_CUSTOM_DAY_RANGE_MAX_DAYS : undefined}")
    expect(usagePageSource).toContain('onChange={handleTimeRangeChange}')
    expect(usagePageSource).toContain('fetchAnalysis(usageRangeQuery, controller.signal, requestApiKeyId)')
    expect(usagePageSource).toContain('fetchAnalysisLatency(usageRangeQuery, controller.signal, requestApiKeyId)')
    expect(usagePageSource).toContain('fetchUsageEvents(usageRangeQuery, controller.signal, {')
    expect(usagePageSource).toContain('exportUsageEvents(usageRangeQuery, format, {')

    expect(keyOverviewPageSource).toContain('customRange={customRange}')
    expect(keyOverviewPageSource).toContain('onChange={handleTimeRangeChange}')
    expect(keyOverviewPageSource).toContain('fetchKeyOverview(usageRangeQuery, controller.signal)')
  })

  it('persists one time range across API Key viewer pages', () => {
    expect(keyOverviewPageSource).toContain('persistKeyViewerTimeRange(timeRangeState)')
    expect(keyAnalysisPageSource).toContain('persistKeyViewerTimeRange(timeRangeState)')
  })

  it('shows a dedicated notice when Usage Events export capacity is full', () => {
    expect(usagePageSource).toContain('error instanceof ApiError && error.status === 429')
    expect(usagePageSource).toContain("t('usage_stats.export_busy')")
  })

  it('recovers applied Custom ranges only after a backend bounds conflict', () => {
    expect(usagePageSource).not.toContain('scheduleCustomRangeBoundsRefresh({')
    expect(keyOverviewPageSource).not.toContain('scheduleCustomRangeBoundsRefresh({')
    expect(usagePageSource).toContain('const recoverRangeBoundsConflict = useCallback')
    expect(keyOverviewPageSource).toContain('const recoverRangeBoundsConflict = useCallback')
    expect(usagePageSource).toContain('if (recoverRangeBoundsConflict(error))')
    expect(keyOverviewPageSource).toContain('if (recoverRangeBoundsConflict(nextError))')
  })

  it('does not reload Request Events filter options for table query changes', () => {
    const filterOptionsEffect = usagePageEffectBlock('void loadEventFilterOptions();')
    const eventsEffect = usagePageEffectBlock('void loadEvents();')

    expect(filterOptionsEffect).not.toContain('void loadEvents();')
    expect(filterOptionsEffect).toContain('}, [activeTab, loadEventFilterOptions]);')
    expect(eventsEffect).not.toContain('loadEventFilterOptions')
    expect(eventsEffect).toContain('}, [activeTab, loadEvents]);')
  })

  it('uses an authenticated native request log download URL instead of fetching a blob into memory', () => {
    expect(usagePageSource).toContain('triggerBrowserURLDownload')
    expect(usagePageSource).toContain('createDownloadURL = createUsageEventRequestLogDownloadURL')
    expect(usagePageSource).toContain('const downloadURL = await createDownloadURL(normalizedEventId)')
    const downloadHandler = usagePageSource.slice(
      usagePageSource.indexOf('const handleRequestLogDownload = useCallback'),
      usagePageSource.indexOf('const refreshActiveTab = useCallback'),
    )
    expect(downloadHandler).not.toContain("showTopNotice('success'")
    expect(downloadHandler).toContain("showTopNotice('error'")
    expect(downloadHandler).not.toContain('handleRequestLogClose()')
  })

  it('cancels request log work when UsagePage unmounts', () => {
    const cleanupStart = usagePageSource.indexOf('useEffect(() => () => {\n    requestLogDownloadGenerationRef.current += 1;')
    expect(cleanupStart).toBeGreaterThanOrEqual(0)
    const cleanupEnd = usagePageSource.indexOf('\n  }, []);', cleanupStart)
    expect(cleanupEnd).toBeGreaterThan(cleanupStart)
    const cleanupEffect = usagePageSource.slice(cleanupStart, cleanupEnd)

    expect(cleanupEffect).toContain('requestLogControllerRef.current?.abort();')
    expect(cleanupEffect).toContain('requestLogControllerRef.current = null;')
    expect(cleanupEffect).not.toContain('setRequestLog')
  })

  it('loads core and latency Analysis sections through independent endpoints', () => {
    expect(usagePageSource).toContain('fetchAnalysis')
    expect(usagePageSource).toContain('fetchAnalysisLatency')
    expect(usagePageSource).toContain('<AnalysisPanel')
    expect(usagePageSource).toContain('latencyDiagnostics={analysisLatencyData}')
    expect(usagePageSource).toContain('latencyLoading={analysisLatencyLoading}')
    expect(usagePageSource).toContain('latencyError={analysisLatencyError}')
  })

  it('keeps Sign out as the rightmost shared main action after Check Updates', () => {
    const checkUpdates = usagePageSource.indexOf("t('usage_stats.check_updates')")
    expect(checkUpdates).toBeGreaterThanOrEqual(0)
    expect(usagePageSource.indexOf("t('common.logout')")).toBeGreaterThan(checkUpdates)
    expect(usagePageSource).toContain("aria-label={t('common.logout')}")
    expect(keyViewerShellSource).toContain("aria-label={t('common.logout')}")
  })

  it('renders primary navigation as direct links without replacing activeTab rendering', () => {
    const navigationStart = usagePageSource.indexOf('{tabOptions.map((option) => (')
    const navigationEnd = usagePageSource.indexOf('))}', navigationStart)
    const navigationBlock = usagePageSource.slice(navigationStart, navigationEnd)

    expect(navigationStart).toBeGreaterThanOrEqual(0)
    expect(navigationEnd).toBeGreaterThan(navigationStart)
    expect(navigationBlock).toContain('<a')
    expect(navigationBlock).toContain('href={appPath(getUsageTabPath(option.value)) + cpamcEmbedSearch()}')
    expect(navigationBlock).toContain('onClick={(event) => handleUsageTabNavigation(event, option.value)}')
    expect(navigationBlock).toContain('onKeyDown={(event) => handleUsageTabKeyActivation(event, option.value, activateUsageTab)}')
    expect(navigationBlock).toContain('aria-selected={activeTab === option.value}')
    expect(navigationBlock).not.toContain('<button')
    expect(usagePageSource).toContain('const activateUsageTab = useCallback((tab: UsageTab) => {')
    expect(usagePageSource).toContain('setActiveTab(tab);')
    expect(usagePageSource).toContain("window.history.replaceState(null, '', appPath(getUsageTabPath(tab)) + cpamcEmbedSearch());")
  })

  it('keeps the connected shell out of CPAMC embed while sharing it with Key Overview', () => {
    expect(usagePageSource).toContain("${!isEmbeddedInCPAMC ? styles.tabBarConnected : ''}")
    expect(keyViewerShellSource).toContain('styles.tabBarConnected')
    expect(keyOverviewPageSource).toContain('KeyViewerShell')
    expect(keyOverviewPageStyles).toContain('.tabBarConnected')
  })

  it('passes realtime error state and current data guard to the realtime panel', () => {
    expect(usagePageSource).toContain('error: realtimeError')
    expect(usagePageSource).toContain('const displayRealtimeError = realtimeError')
    expect(usagePageSource).toContain('realtime={currentRealtime ?? undefined}')
    expect(usagePageSource).toContain('error={displayRealtimeError}')
  })

  it('loads both Activity cards through one independent Recent Activity request', () => {
    expect(usagePageSource).toContain('useUsageActivityData({')
    expect(usagePageSource).toContain('useRecentActivityWindow(usageRangeQuery)')
    expect(usagePageSource).toContain('await Promise.all([loadUsage(), loadActivity(), loadRealtime()])')
    expect(usagePageSource).toContain('await Promise.all([loadUsage(), loadActivity({ skipIfInFlight: true }), loadRealtime()])')
  })
})
