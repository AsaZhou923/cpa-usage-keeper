import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadUsageRangeState, migrateLegacyUsageRangeState, persistMigratedUsageRangeState, appendUniqueUsageEvents, getBackToCPALinkURL, getCredentialSectionVisibility, getOverviewDisplayLoading, getUsageCustomRangeForTab, getUsageTabOptions, handleUsageEventLoadMoreError, isUsagePageVisible, loadAnalysisSections, loadUsagePageVersionInfo, normalizeStoredApiKeyFilter, normalizeUsageTabValue, refreshPageData, resolveApiKeyFilterRequestState, runUsageEventRequestLogDownload, sanitizeRequestEventFilters, scheduleOverviewAutoRefresh, shouldAutoRefreshUsageTab, shouldResetSelectedApiKeyFilter, shouldShowApiKeyFilter, shouldShowRangeControls, shouldShowUpdateCheckButton, getUpdateCheckToastDuration, API_KEY_FILTER_MAX_LENGTH } from '../UsagePage';
import { ApiError } from '@/lib/api';
import type { VersionResponse } from '@/lib/types';

describe('appendUniqueUsageEvents', () => {
  it('appends cursor batches without duplicating overlapping event ids', () => {
    const current = [
      { id: '3', timestamp: '2026-07-11T10:00:03Z', model: 'm3', source: 's', failed: false, latency_ms: 1, tokens: { input_tokens: 1, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1 } },
      { id: '2', timestamp: '2026-07-11T10:00:02Z', model: 'm2', source: 's', failed: false, latency_ms: 1, tokens: { input_tokens: 1, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1 } },
    ];
    const incoming = [
      current[1],
      { ...current[1], id: '1', timestamp: '2026-07-11T10:00:01Z', model: 'm1' },
    ];

    expect(appendUniqueUsageEvents(current, incoming).map((event) => event.id)).toEqual(['3', '2', '1']);
  });
});

describe('handleUsageEventLoadMoreError', () => {
  it('pauses automatic loading and surfaces ordinary errors', () => {
    const pauseAutoLoadMore = vi.fn();
    const recoverRangeBoundsConflict = vi.fn(() => false);
    const setError = vi.fn();

    handleUsageEventLoadMoreError({
      error: new Error('cursor failed'),
      pauseAutoLoadMore,
      recoverRangeBoundsConflict,
      setError,
    });

    expect(pauseAutoLoadMore).toHaveBeenCalledOnce();
    expect(recoverRangeBoundsConflict).toHaveBeenCalledOnce();
    expect(setError).toHaveBeenCalledWith('cursor failed');
  });

  it('recovers range conflicts without surfacing a pagination error', () => {
    const pauseAutoLoadMore = vi.fn();
    const recoverRangeBoundsConflict = vi.fn(() => true);
    const onAuthRequired = vi.fn();
    const setError = vi.fn();
    const error = new ApiError('range changed', 409);

    handleUsageEventLoadMoreError({
      error,
      pauseAutoLoadMore,
      recoverRangeBoundsConflict,
      onAuthRequired,
      setError,
    });

    expect(pauseAutoLoadMore).toHaveBeenCalledOnce();
    expect(recoverRangeBoundsConflict).toHaveBeenCalledWith(error);
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it('keeps authentication handling after pausing automatic loading', () => {
    const pauseAutoLoadMore = vi.fn();
    const recoverRangeBoundsConflict = vi.fn(() => false);
    const onAuthRequired = vi.fn();
    const setError = vi.fn();

    handleUsageEventLoadMoreError({
      error: new ApiError('unauthorized', 401),
      pauseAutoLoadMore,
      recoverRangeBoundsConflict,
      onAuthRequired,
      setError,
    });

    expect(pauseAutoLoadMore).toHaveBeenCalledOnce();
    expect(onAuthRequired).toHaveBeenCalledOnce();
    expect(setError).not.toHaveBeenCalled();
  });
});

const createAutoRefreshTestDocument = (visibilityState: DocumentVisibilityState = 'visible') => {
  const target = new EventTarget();
  return {
    get visibilityState() {
      return visibilityState;
    },
    setVisibilityState(nextVisibilityState: DocumentVisibilityState) {
      visibilityState = nextVisibilityState;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createMemoryStorage = (seed: Record<string, string>) => ({
  getItem: (key: string) => seed[key] ?? null,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UsagePage Request Events custom range', () => {
  const longRange = { unit: 'day' as const, start: '2025-07-18', end: '2026-07-17' };
  const options = { nowMs: Date.parse('2026-07-17T07:36:42.000Z'), timeZone: 'Asia/Shanghai' };

  it('clamps Request Events to the most recent 90 calendar days', () => {
    expect(getUsageCustomRangeForTab('events', longRange, options)).toEqual({
      unit: 'day',
      start: '2026-04-19',
      end: '2026-07-17',
    });
  });

  it('keeps the 365-day range available to other usage tabs', () => {
    expect(getUsageCustomRangeForTab('overview', longRange, options)).toBe(longRange);
  });

});

describe('UsagePage Overview loading display', () => {
  it('keeps existing Overview data visible during background refresh', () => {
    expect(getOverviewDisplayLoading({ loading: true, hasUsage: true })).toBe(false);
  });

  it('shows loading before Overview data has loaded', () => {
    expect(getOverviewDisplayLoading({ loading: true, hasUsage: false })).toBe(true);
  });
});

describe('UsagePage Analysis section loading', () => {
  it('starts core and latency requests together and publishes each result independently', async () => {
    const core = Promise.withResolvers<'core'>();
    const latency = Promise.withResolvers<'latency'>();
    const loadCore = vi.fn(() => core.promise);
    const loadLatency = vi.fn(() => latency.promise);
    const onCoreLoaded = vi.fn();
    const onCoreError = vi.fn();
    const onLatencyLoaded = vi.fn();
    const onLatencyError = vi.fn();

    const loading = loadAnalysisSections({
      loadCore,
      loadLatency,
      onCoreLoaded,
      onCoreError,
      onLatencyLoaded,
      onLatencyError,
    });

    expect(loadCore).toHaveBeenCalledOnce();
    expect(loadLatency).toHaveBeenCalledOnce();

    core.resolve('core');
    await flushPromises();
    expect(onCoreLoaded).toHaveBeenCalledWith('core');
    expect(onLatencyLoaded).not.toHaveBeenCalled();

    const latencyError = new Error('latency failed');
    latency.reject(latencyError);
    await loading;
    expect(onCoreError).not.toHaveBeenCalled();
    expect(onLatencyError).toHaveBeenCalledWith(latencyError);
  });
});

describe('UsagePage legacy Custom range migration', () => {
  it('keeps a valid legacy Custom range pending until the project timezone is available', () => {
    const storage = createMemoryStorage({
      'cli-proxy-usage-time-range-v1': 'custom',
      'cli-proxy-usage-custom-range-v1': '{"start":"2026-07-01","end":"2026-07-17"}',
    });

    expect(loadUsageRangeState(storage, Date.parse('2026-07-17T07:36:42.000Z'))).toEqual({
      state: { range: 'today' },
      pendingLegacyCustomRange: {
        unit: 'day',
        start: '2026-07-01',
        end: '2026-07-17',
      },
    });
  });

  it('ignores invalid legacy Custom state instead of scheduling a migration', () => {
    const storage = createMemoryStorage({
      'cli-proxy-usage-time-range-v1': 'custom',
      'cli-proxy-usage-custom-range-v1': '{"start":"bad","end":"2026-07-17"}',
    });

    expect(loadUsageRangeState(storage, Date.parse('2026-07-17T07:36:42.000Z'))).toEqual({
      state: { range: 'today' },
      pendingLegacyCustomRange: null,
    });
  });

  it('normalizes the pending legacy dates after the project timezone arrives', () => {
    expect(migrateLegacyUsageRangeState({
      unit: 'day',
      start: '2026-07-01',
      end: '2026-07-17',
    }, {
      nowMs: Date.parse('2026-07-17T07:36:42.000Z'),
      timeZone: 'Asia/Shanghai',
    })).toEqual({
      range: 'custom',
      customRange: {
        unit: 'day',
        start: '2026-07-01',
        end: '2026-07-17',
      },
      timeZone: 'Asia/Shanghai',
    });
  });

  it('preserves historical legacy dates and their selected end', () => {
    expect(migrateLegacyUsageRangeState({
      unit: 'day',
      start: '2026-06-17',
      end: '2026-07-16',
    }, {
      nowMs: Date.parse('2026-07-17T07:36:42.000Z'),
      timeZone: 'Asia/Shanghai',
    })).toEqual({
      range: 'custom',
      customRange: {
        unit: 'day',
        start: '2026-06-17',
        end: '2026-07-16',
      },
      timeZone: 'Asia/Shanghai',
    });
  });

  it('writes the migrated state before deleting the only legacy copy', () => {
    const calls: string[] = [];
    const state = {
      range: 'custom' as const,
      customRange: { unit: 'day' as const, start: '2026-07-01', end: '2026-07-17' },
      timeZone: 'Asia/Shanghai',
    };

    expect(persistMigratedUsageRangeState({
      setItem: (key) => calls.push(`set:${key}`),
      removeItem: (key) => calls.push(`remove:${key}`),
    }, state)).toBe(true);
    expect(calls).toEqual([
      'set:cli-proxy-usage-time-range-v1',
      'remove:cli-proxy-usage-custom-range-v1',
    ]);
  });

  it('keeps the legacy copy when writing the migrated state fails', () => {
    const removeItem = vi.fn();

    expect(persistMigratedUsageRangeState({
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem,
    }, {
      range: 'custom',
      customRange: { unit: 'day', start: '2026-07-01', end: '2026-07-17' },
      timeZone: 'Asia/Shanghai',
    })).toBe(false);
    expect(removeItem).not.toHaveBeenCalled();
  });
});

describe('UsagePage Back to CPA link', () => {
  it('uses the CPA public URL from status', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
  });

  it('uses the current origin when status does not include a CPA public URL', () => {
    expect(getBackToCPALinkURL({}, 'https://cpa.domain.com')).toBe('https://cpa.domain.com/management.html');
    expect(getBackToCPALinkURL(null, 'https://cpa.domain.com')).toBe('https://cpa.domain.com/management.html');
  });

  it('normalizes trailing slashes and existing management pages', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/cpa/' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/cpa/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/management.html' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
  });

  it('supports relative public paths and bare host names', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: '/cpa/' }, 'https://keeper.example.com')).toBe('https://keeper.example.com/cpa/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'cpa.domain.com/' }, 'https://keeper.example.com')).toBe('https://cpa.domain.com/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'cpa.domain.com:8317/' }, 'https://keeper.example.com')).toBe('https://cpa.domain.com:8317/management.html');
  });

  it('rejects explicit non-http public URL schemes', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'javascript://alert(1)' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'data://text/html,<script>alert(1)</script>' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'file:///etc/passwd' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'ftp://cpa.example.com' }, 'https://keeper.example.com')).toBe('');
  });
});

describe('UsagePage update check controls', () => {
  it('loads version info through the dedicated version loader', async () => {
    const signal = new AbortController().signal;
    const versionInfo = { version: 'v1.2.3', updateCheckEnabled: true };
    const loadVersion = vi.fn(async () => versionInfo);
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo });

    expect(loadVersion).toHaveBeenCalledWith(signal);
    expect(setVersionInfo).toHaveBeenCalledWith(versionInfo);
  });

  it('clears version info when version loading fails', async () => {
    const signal = new AbortController().signal;
    const loadVersion = vi.fn(async () => {
      throw new Error('network failed');
    });
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo });

    expect(setVersionInfo).toHaveBeenCalledWith(null);
  });

  it('requests reauthentication when version loading returns 401', async () => {
    const signal = new AbortController().signal;
    const loadVersion = vi.fn(async () => {
      throw new ApiError('expired', 401);
    });
    const setVersionInfo = vi.fn();
    const onAuthRequired = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo, onAuthRequired });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(setVersionInfo).not.toHaveBeenCalled();
  });

  it('ignores version results after the request is aborted', async () => {
    const requestController = new AbortController();
    const versionInfo = { version: 'v1.2.3', updateCheckEnabled: true };
    const loadVersion = vi.fn(async () => {
      requestController.abort();
      return versionInfo;
    });
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal: requestController.signal, setVersionInfo });

    expect(setVersionInfo).not.toHaveBeenCalled();
  });

  it('hides the update button before version loads', () => {
    expect(shouldShowUpdateCheckButton(null)).toBe(false);
  });

  it('hides the update button for dev builds', () => {
    expect(shouldShowUpdateCheckButton({ version: 'dev', updateCheckEnabled: false } satisfies VersionResponse)).toBe(false);
  });

  it('shows the update button for release builds', () => {
    expect(shouldShowUpdateCheckButton({ version: 'v1.2.3', updateCheckEnabled: true })).toBe(true);
  });

  it('keeps failure toasts visible longer than success toasts', () => {
    expect(getUpdateCheckToastDuration('success')).toBe(4_000);
    expect(getUpdateCheckToastDuration('info')).toBe(4_000);
    expect(getUpdateCheckToastDuration('error')).toBe(6_000);
  });
});

describe('UsagePage Overview auto-refresh', () => {
  it('refreshes the Overview tab every 10 seconds', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    vi.advanceTimersByTime(9_999);
    expect(refreshOverview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refreshOverview).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('does not schedule refreshes outside the Overview tab', () => {
    vi.useFakeTimers();
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: false, refreshOverview });

    vi.advanceTimersByTime(10_000);
    expect(refreshOverview).not.toHaveBeenCalled();

    cleanup();
  });

  it('pauses while the browser tab is hidden', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    vi.advanceTimersByTime(10_000);
    expect(refreshOverview).not.toHaveBeenCalled();

    cleanup();
  });

  it('refreshes once when the browser tab becomes visible again', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });
    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('routes auto-refresh failures to the refresh error handler', async () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const failure = new Error('refresh failed');
    const refreshOverview = vi.fn(async () => {
      throw failure;
    });
    const onRefreshError = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, onRefreshError, documentRef: testDocument });

    vi.advanceTimersByTime(10_000);
    await flushPromises();

    expect(onRefreshError).toHaveBeenCalledWith(failure);

    cleanup();
  });

  it('restarts the interval cadence after refreshing on visibility restore', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });
    vi.advanceTimersByTime(9_999);
    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(refreshOverview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(9_999);
    expect(refreshOverview).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleans up the interval and visibility listener', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const refreshOverview = vi.fn();
    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    cleanup();
    vi.advanceTimersByTime(10_000);
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).not.toHaveBeenCalled();
  });
});

describe('UsagePage visibility guard', () => {
  it('treats hidden documents as inactive for credentials polling', () => {
    expect(isUsagePageVisible({ visibilityState: 'visible' })).toBe(true);
    expect(isUsagePageVisible({ visibilityState: 'hidden' })).toBe(false);
  });
});

describe('UsagePage active tab auto-refresh guard', () => {
  it('allows Request Events auto-refresh only on the first page', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'events', eventsPage: 1 })).toBe(true);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'events', eventsPage: 2 })).toBe(false);
  });

  it('does not auto-refresh credential detail tabs', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'auth-files', eventsPage: 1 })).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'ai-provider', eventsPage: 1 })).toBe(false);
  });

  it('keeps Overview auto-refresh enabled and does not auto-refresh other tabs', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'overview', eventsPage: 2 })).toBe(true);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'analysis', eventsPage: 1 })).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'ranking', eventsPage: 1 })).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'settings', eventsPage: 1 })).toBe(false);
  });
});

describe('UsagePage request event filters', () => {
  it('keeps restored model and source filters until backend filter options load', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      {
        models: [],
        sources: [],
      },
      false,
    );

    expect(next).toEqual({
      model: 'claude-opus',
      source: 'authidx-source-b',
      result: 'failed',
    });
  });

  it('clears model and source filters that are no longer available', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      {
        models: ['claude-sonnet'],
        sources: [{ value: 'authidx-source-a', label: 'authidx-source-a' }],
      },
    );

    expect(next).toEqual({
      model: '__all__',
      source: '__all__',
      result: 'failed',
    });
  });

  it('keeps source filters that are still available after refreshing options', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-sonnet',
        source: 'authidx-source-a',
        result: 'success',
      },
      {
        models: ['claude-sonnet'],
        sources: [{ value: 'authidx-source-a', label: 'authidx-source-a' }],
      },
    );

    expect(next).toEqual({
      model: 'claude-sonnet',
      source: 'authidx-source-a',
      result: 'success',
    });
  });
});

it.each([
  ['overview', true],
  ['analysis', true],
  ['ranking', false],
  ['events', true],
  ['auth-files', false],
  ['ai-provider', false],
  ['settings', false],
] as const)('shows range and API Key controls on %s: %s', (tab, expected) => {
  expect(shouldShowRangeControls(tab)).toBe(expected);
  expect(shouldShowApiKeyFilter(tab)).toBe(expected);
});

describe('UsagePage tab labels', () => {
  it('resolves tab labels through translation keys', () => {
    const labels = getUsageTabOptions((key) => `translated:${key}`).map((option) => option.label);

    expect(labels).toEqual([
      'translated:usage_stats.tab_overview',
      'translated:usage_stats.tab_analysis',
      'translated:usage_stats.tab_ranking',
      'translated:usage_stats.tab_events',
      'translated:usage_stats.tab_auth_files',
      'translated:usage_stats.tab_ai_provider',
      'translated:usage_stats.tab_settings',
    ]);
  });

  it('omits Ranking from the CPAMC embedded navigation', () => {
    const values = getUsageTabOptions((key) => key, { includeRanking: false }).map((option) => option.value);

    expect(values).toEqual(['overview', 'analysis', 'events', 'auth-files', 'ai-provider', 'settings']);
  });
});

describe('UsagePage credentials tab migration', () => {
  it('migrates the legacy Credentials tab value to Auth Files', () => {
    expect(normalizeUsageTabValue('credentials')).toBe('auth-files');
  });

  it('keeps Ranking as an independent persisted tab value', () => {
    expect(normalizeUsageTabValue('ranking')).toBe('ranking');
  });

  it('keeps each credential section scoped to its own tab', () => {
    expect(getCredentialSectionVisibility('auth-files')).toEqual({
      enabled: true,
      showAuthFiles: true,
      showAiProvider: false,
    });
    expect(getCredentialSectionVisibility('ai-provider')).toEqual({
      enabled: true,
      showAuthFiles: false,
      showAiProvider: true,
    });
    expect(getCredentialSectionVisibility('overview')).toEqual({
      enabled: false,
      showAuthFiles: false,
      showAiProvider: false,
    });
  });
});

describe('UsagePage refresh action', () => {
  it('refreshes the active tab once', async () => {
    const refreshActiveTab = vi.fn();
    await refreshPageData({ refreshActiveTab });
    expect(refreshActiveTab).toHaveBeenCalledOnce();
  });
});

describe('UsagePage request log download guard', () => {
  it('does not trigger a stale native download after the modal is closed', async () => {
    const generationRef = { current: 0 };
    const downloadURL = Promise.withResolvers<string>();
    const createDownloadURL = vi.fn(() => downloadURL.promise);
    const triggerDownload = vi.fn();
    const setDownloading = vi.fn();
    const showDownloadError = vi.fn();

    const pendingDownload = runUsageEventRequestLogDownload({
      eventId: ' 42 ',
      generationRef,
      createDownloadURL,
      triggerDownload,
      setDownloading,
      showDownloadError,
    });

    expect(createDownloadURL).toHaveBeenCalledWith('42');
    expect(setDownloading).toHaveBeenCalledWith(true);

    generationRef.current += 1;
    downloadURL.resolve('/api/v1/usage/events/42/request-log/download-file?token=abc');
    await pendingDownload;

    expect(triggerDownload).not.toHaveBeenCalled();
    expect(showDownloadError).not.toHaveBeenCalled();
    expect(setDownloading).toHaveBeenCalledTimes(1);
  });
});

describe('persisted API key filter', () => {
  it('accepts only positive int64 ids accepted by the backend', () => {
    expect(normalizeStoredApiKeyFilter('42')).toBe('42');
    expect(normalizeStoredApiKeyFilter(' 0042 ')).toBe('42');
    expect(normalizeStoredApiKeyFilter('key-42')).toBe('');
    expect(normalizeStoredApiKeyFilter('')).toBe('');
    expect(normalizeStoredApiKeyFilter('0')).toBe('');
    expect(normalizeStoredApiKeyFilter('-1')).toBe('');
    expect(normalizeStoredApiKeyFilter(null)).toBe('');
    expect(normalizeStoredApiKeyFilter(42)).toBe('');
    expect(normalizeStoredApiKeyFilter('9223372036854775807')).toBe('9223372036854775807');
    expect(normalizeStoredApiKeyFilter('9223372036854775808')).toBe('');
    expect(normalizeStoredApiKeyFilter('1'.repeat(API_KEY_FILTER_MAX_LENGTH + 1))).toBe('');
  });

  it('keeps a restored selection until the options actually load', () => {
    // 首帧选项还是空列表，此时清空会让持久化的筛选永远存活不过一次刷新。
    expect(shouldResetSelectedApiKeyFilter('42', [], false)).toBe(false);
    expect(shouldResetSelectedApiKeyFilter('42', [{ id: '1' }], false)).toBe(false);
  });

  it('clears the selection once loaded options no longer contain it', () => {
    expect(shouldResetSelectedApiKeyFilter('42', [{ id: '1' }], true)).toBe(true);
    expect(shouldResetSelectedApiKeyFilter('42', [{ id: '42' }], true)).toBe(false);
    expect(shouldResetSelectedApiKeyFilter('', [], true)).toBe(false);
  });

  it('does not send a restored id until it has been checked against loaded options', () => {
    expect(resolveApiKeyFilterRequestState('42', [], false, false)).toEqual({ ready: false, apiKeyId: '' });
    expect(resolveApiKeyFilterRequestState('42', [{ id: '42' }], true, true)).toEqual({ ready: true, apiKeyId: '42' });
    expect(resolveApiKeyFilterRequestState('42', [{ id: '7' }], true, true)).toEqual({ ready: true, apiKeyId: '' });
    expect(resolveApiKeyFilterRequestState('', [], false, false)).toEqual({ ready: true, apiKeyId: '' });
  });

  it('keeps a locally valid restored id when option loading fails', () => {
    expect(resolveApiKeyFilterRequestState('42', [], false, true)).toEqual({ ready: true, apiKeyId: '42' });
  });
});
