import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  exportKeyOverviewUsageEvents,
  fetchKeyOverview,
  fetchKeyOverviewRealtime,
  fetchKeyOverviewUsageEventModelFilterOptions,
  fetchKeyOverviewUsageEventSourceFilterOptions,
  fetchKeyOverviewUsageEvents,
  fetchKeyOverviewUsageIdentitiesPage,
  fetchKeyOverviewUsageQuotaCache,
  logout,
  type UsageEventsExportFormat,
} from '@/lib/api';
import type { AuthSessionAPIKeySummary, KeyOverviewTimeRange, OverviewRealtimeBlock, OverviewRealtimeWindow, UsageEvent, UsageOverviewResponse, UsageSourceFilterOption } from '@/lib/types';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { IconRefreshCw } from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useThemeStore } from '@/stores';
import {
  DailyAveragePanel,
  OverviewRealtimePanel,
  ServiceHealthCard,
  StatCards,
  AuthFileCredentialsSection,
  CredentialProviderFilterBar,
  useCredentialsTabData,
  useSparklines,
} from '@/components/usage';
import {
  RequestEventsDetailsCard,
  REQUEST_EVENT_COLUMN_IDS,
  normalizeRequestEventVisibleColumnIds,
  type RequestEventColumnId,
} from '@/components/usage/RequestEventsDetailsCard';
import type { UsageOverviewPayload } from '@/components/usage/hooks/useUsageData';
import { BrandLink } from '@/components/BrandLink';
import { getCurrentOverviewUsage, getDailyAveragePanelUsage, getOverviewDisplayLoading, isDailyAverageRange } from '@/utils/usage/overview';
import type { Theme } from '@/types';
import styles from './KeyOverviewPage.module.scss';

const KEY_OVERVIEW_RANGE_STORAGE_KEY = 'cli-proxy-key-overview-range-v1';
const KEY_OVERVIEW_TAB_STORAGE_KEY = 'cli-proxy-key-overview-tab-v1';
const OVERVIEW_REALTIME_WINDOW_STORAGE_KEY = 'cli-proxy-usage-overview-realtime-window-v1';
const DEFAULT_TIME_RANGE: KeyOverviewTimeRange = '8h';
const DEFAULT_REALTIME_WINDOW: OverviewRealtimeWindow = '15m';
const KEY_OVERVIEW_REALTIME_VISIBLE_DIMENSIONS = ['models'] as const;
const REFRESH_THROTTLE_MS = 1_000;
const KEY_OVERVIEW_AUTO_REFRESH_INTERVAL_MS = 10_000;
const KEY_OVERVIEW_TAB_OPTIONS = ['overview', 'events', 'auth-files'] as const;
type KeyOverviewTab = (typeof KEY_OVERVIEW_TAB_OPTIONS)[number];
const KEY_OVERVIEW_TAB_LABEL_KEYS: Record<KeyOverviewTab, string> = {
  overview: 'usage_stats.tab_overview',
  events: 'usage_stats.tab_events',
  'auth-files': 'usage_stats.tab_auth_files',
};
const DEFAULT_KEY_OVERVIEW_TAB: KeyOverviewTab = 'overview';
const REQUEST_EVENTS_PAGE_SIZES = [20, 50, 100, 500, 1000] as const;
const REQUEST_EVENTS_DEFAULT_PAGE_SIZE = 100;
const ALL_REQUEST_EVENTS_FILTER = '__all__';
const KEY_REQUEST_EVENT_COLUMN_IDS = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'api_key');

const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: KeyOverviewTimeRange; labelKey: string }> = [
  { value: '4h', labelKey: 'usage_stats.range_4h' },
  { value: '8h', labelKey: 'usage_stats.range_8h' },
  { value: '12h', labelKey: 'usage_stats.range_12h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: 'today', labelKey: 'usage_stats.range_today' },
  { value: 'yesterday', labelKey: 'usage_stats.range_yesterday' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
];

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; labelKey: string }> = [
  { value: 'white', labelKey: 'usage_stats.theme_light' },
  { value: 'dark', labelKey: 'usage_stats.theme_dark' },
  { value: 'auto', labelKey: 'usage_stats.theme_auto' },
];

const isKeyOverviewTimeRange = (value: unknown): value is KeyOverviewTimeRange => (
  value === '4h' || value === '8h' || value === '12h' || value === '24h' || value === 'today' || value === 'yesterday' || value === '7d' || value === '30d'
);

const loadTimeRange = (): KeyOverviewTimeRange => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TIME_RANGE;
    const raw = localStorage.getItem(KEY_OVERVIEW_RANGE_STORAGE_KEY);
    return isKeyOverviewTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const isOverviewRealtimeWindow = (value: unknown): value is OverviewRealtimeWindow => (
  value === '15m' || value === '30m' || value === '60m'
);

const loadRealtimeWindow = (): OverviewRealtimeWindow => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_REALTIME_WINDOW;
    const raw = localStorage.getItem(OVERVIEW_REALTIME_WINDOW_STORAGE_KEY);
    return isOverviewRealtimeWindow(raw) ? raw : DEFAULT_REALTIME_WINDOW;
  } catch {
    return DEFAULT_REALTIME_WINDOW;
  }
};

const normalizeKeyOverviewTab = (value: unknown): KeyOverviewTab | null => (
  typeof value === 'string' && (KEY_OVERVIEW_TAB_OPTIONS as readonly string[]).includes(value)
    ? value as KeyOverviewTab
    : null
);

const loadKeyOverviewTab = (): KeyOverviewTab => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_KEY_OVERVIEW_TAB;
    return normalizeKeyOverviewTab(localStorage.getItem(KEY_OVERVIEW_TAB_STORAGE_KEY)) ?? DEFAULT_KEY_OVERVIEW_TAB;
  } catch {
    return DEFAULT_KEY_OVERVIEW_TAB;
  }
};

type RequestEventFilterState = {
  model: string;
  source: string;
  result: string;
};

const DEFAULT_REQUEST_EVENT_FILTERS: RequestEventFilterState = {
  model: ALL_REQUEST_EVENTS_FILTER,
  source: ALL_REQUEST_EVENTS_FILTER,
  result: ALL_REQUEST_EVENTS_FILTER,
};

const triggerKeyOverviewFileDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

type KeyOverviewAutoRefreshDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

type KeyOverviewAutoRefreshOptions = {
  refreshOverview: () => void | Promise<void>;
  onRefreshError?: (error: unknown) => void;
  documentRef?: KeyOverviewAutoRefreshDocument;
  intervalMs?: number;
};

type KeyOverviewLoadOptions = {
  skipIfInFlight?: boolean;
};

type KeyOverviewRequestStartOptions = {
  currentController: AbortController | null;
  skipIfInFlight?: boolean;
};

export const startKeyOverviewRequest = ({
  currentController,
  skipIfInFlight,
}: KeyOverviewRequestStartOptions): { controller: AbortController | null; skipped: boolean } => {
  if (currentController && skipIfInFlight) {
    return { controller: null, skipped: true };
  }
  currentController?.abort();
  return { controller: new AbortController(), skipped: false };
};

export const scheduleKeyOverviewAutoRefresh = ({
  refreshOverview,
  onRefreshError,
  documentRef,
  intervalMs = KEY_OVERVIEW_AUTO_REFRESH_INTERVAL_MS,
}: KeyOverviewAutoRefreshOptions) => {
  const targetDocument = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  if (!targetDocument) {
    return () => undefined;
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };
  const runRefresh = () => {
    Promise.resolve(refreshOverview()).catch((nextError: unknown) => {
      onRefreshError?.(nextError);
    });
  };
  const refreshIfVisible = () => {
    if (targetDocument.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    runRefresh();
  };
  const startTimer = () => {
    if (timer !== undefined) return;
    timer = setInterval(refreshIfVisible, intervalMs);
  };
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    runRefresh();
    stopTimer();
    startTimer();
  };

  if (targetDocument.visibilityState !== 'hidden') {
    startTimer();
  }
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    stopTimer();
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

export interface KeyOverviewPageProps {
  apiKey?: AuthSessionAPIKeySummary;
  onAuthRequired?: () => void;
}

export function KeyOverviewPage({ apiKey, onAuthRequired }: KeyOverviewPageProps) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const setTheme = useThemeStore((state) => state.setTheme);
  const [activeTab, setActiveTab] = useState<KeyOverviewTab>(loadKeyOverviewTab);
  const [timeRange, setTimeRange] = useState<KeyOverviewTimeRange>(loadTimeRange);
  const [realtimeWindow, setRealtimeWindow] = useState<OverviewRealtimeWindow>(loadRealtimeWindow);
  const [usage, setUsage] = useState<UsageOverviewPayload | null>(null);
  const [loadedUsageRange, setLoadedUsageRange] = useState<KeyOverviewTimeRange | null>(null);
  const [realtime, setRealtime] = useState<OverviewRealtimeBlock | null>(null);
  const [loading, setLoading] = useState(false);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [error, setError] = useState('');
  const [realtimeError, setRealtimeError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [refreshThrottled, setRefreshThrottled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [eventsData, setEventsData] = useState<UsageEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState(REQUEST_EVENTS_DEFAULT_PAGE_SIZE);
  const [eventsTotalCount, setEventsTotalCount] = useState(0);
  const [eventsTotalPages, setEventsTotalPages] = useState(0);
  const [eventsModelOptions, setEventsModelOptions] = useState<string[]>([]);
  const [eventsSourceOptions, setEventsSourceOptions] = useState<UsageSourceFilterOption[]>([]);
  const [eventsFilters, setEventsFilters] = useState<RequestEventFilterState>(DEFAULT_REQUEST_EVENT_FILTERS);
  const [eventsExportingFormat, setEventsExportingFormat] = useState<UsageEventsExportFormat | null>(null);
  const [eventsVisibleColumnIds, setEventsVisibleColumnIds] = useState<RequestEventColumnId[]>(() => (
    normalizeRequestEventVisibleColumnIds(KEY_REQUEST_EVENT_COLUMN_IDS)
  ));
  const overviewRequestControllerRef = useRef<AbortController | null>(null);
  const realtimeRequestControllerRef = useRef<AbortController | null>(null);
  const eventsRequestControllerRef = useRef<AbortController | null>(null);
  const eventsFilterOptionsRequestControllerRef = useRef<AbortController | null>(null);
  const refreshThrottleTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const credentialsData = useCredentialsTabData({
    enabledAuthFiles: activeTab === 'auth-files',
    enabledAiProviders: false,
    quotaAutoRefreshEnabled: false,
    readOnly: true,
    onAuthRequired,
    fetchUsageIdentitiesPage: fetchKeyOverviewUsageIdentitiesPage,
    fetchUsageQuotaCache: fetchKeyOverviewUsageQuotaCache,
  });

  const rangeOptions = useMemo(() => TIME_RANGE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  })), [t]);

  const themeOptions = useMemo(
    () => THEME_OPTIONS.map((option) => ({ ...option, label: t(option.labelKey) })),
    [t]
  );

  const loadOverview = useCallback(async (options: KeyOverviewLoadOptions = {}) => {
    const { controller, skipped } = startKeyOverviewRequest({
      currentController: overviewRequestControllerRef.current,
      skipIfInFlight: options.skipIfInFlight,
    });
    if (skipped || !controller) return;
    overviewRequestControllerRef.current = controller;
    const requestRange = timeRange;
    setLoading(true);
    setError('');
    try {
      const overview = await fetchKeyOverview(requestRange, controller.signal);
      if (overviewRequestControllerRef.current !== controller) return;
      setUsage(overview as UsageOverviewResponse as UsageOverviewPayload);
      setLoadedUsageRange(requestRange);
      setLastRefreshedAt(new Date());
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (nextError instanceof ApiError && nextError.status === 401) {
        onAuthRequired?.();
        return;
      }
      if (nextError instanceof ApiError && nextError.status === 429) {
        setError('KEY_OVERVIEW_RATE_LIMITED');
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'KEY_OVERVIEW_LOAD_FAILED');
    } finally {
      if (overviewRequestControllerRef.current === controller) {
        setLoading(false);
        overviewRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired, timeRange]);

  const loadRealtime = useCallback(async (options: KeyOverviewLoadOptions = {}) => {
    const { controller, skipped } = startKeyOverviewRequest({
      currentController: realtimeRequestControllerRef.current,
      skipIfInFlight: options.skipIfInFlight,
    });
    if (skipped || !controller) return;
    realtimeRequestControllerRef.current = controller;
    setRealtimeLoading(true);
    setRealtimeError('');
    try {
      const nextRealtime = await fetchKeyOverviewRealtime({
        window: realtimeWindow,
        signal: controller.signal,
      });
      if (realtimeRequestControllerRef.current !== controller) return;
      setRealtime(nextRealtime);
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (nextError instanceof ApiError && nextError.status === 401) {
        onAuthRequired?.();
        return;
      }
      if (nextError instanceof ApiError && nextError.status === 429) {
        setRealtimeError('KEY_OVERVIEW_RATE_LIMITED');
        return;
      }
      setRealtimeError('KEY_OVERVIEW_REALTIME_LOAD_FAILED');
    } finally {
      if (realtimeRequestControllerRef.current === controller) {
        setRealtimeLoading(false);
        realtimeRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired, realtimeWindow]);

  const loadEventFilterOptions = useCallback(async () => {
    eventsFilterOptionsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    eventsFilterOptionsRequestControllerRef.current = controller;
    try {
      const [modelResponse, sourceResponse] = await Promise.all([
        fetchKeyOverviewUsageEventModelFilterOptions(controller.signal),
        fetchKeyOverviewUsageEventSourceFilterOptions(controller.signal),
      ]);
      if (eventsFilterOptionsRequestControllerRef.current !== controller) return;
      setEventsModelOptions(modelResponse.models ?? []);
      setEventsSourceOptions(sourceResponse.sources ?? []);
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (eventsFilterOptionsRequestControllerRef.current === controller) {
        setEventsModelOptions([]);
        setEventsSourceOptions([]);
      }
      if (nextError instanceof ApiError && nextError.status === 401) {
        onAuthRequired?.();
      }
    } finally {
      if (eventsFilterOptionsRequestControllerRef.current === controller) {
        eventsFilterOptionsRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired]);

  const loadEvents = useCallback(async () => {
    eventsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    eventsRequestControllerRef.current = controller;

    setEventsLoading(true);
    setEventsError('');
    try {
      const response = await fetchKeyOverviewUsageEvents(timeRange, undefined, undefined, controller.signal, {
        page: eventsPage,
        pageSize: eventsPageSize,
        model: eventsFilters.model === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.model,
        source: eventsFilters.source === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.source,
        result: eventsFilters.result === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.result,
      });
      if (eventsRequestControllerRef.current !== controller) return;
      if (response.total_pages > 0 && eventsPage > response.total_pages) {
        setEventsPage(response.total_pages);
        return;
      }
      setEventsData(response.events ?? []);
      setEventsTotalCount(response.total_count ?? 0);
      setEventsTotalPages(response.total_pages ?? 0);
      setLastRefreshedAt(new Date());
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (eventsRequestControllerRef.current === controller) {
        setEventsData([]);
        setEventsTotalCount(0);
        setEventsTotalPages(0);
      }
      if (nextError instanceof ApiError && nextError.status === 401) {
        onAuthRequired?.();
        return;
      }
      if (nextError instanceof ApiError && nextError.status === 429) {
        setEventsError('KEY_OVERVIEW_RATE_LIMITED');
        return;
      }
      setEventsError(nextError instanceof Error ? nextError.message : 'KEY_OVERVIEW_EVENTS_LOAD_FAILED');
    } finally {
      if (eventsRequestControllerRef.current === controller) {
        setEventsLoading(false);
        eventsRequestControllerRef.current = null;
      }
    }
  }, [eventsFilters.model, eventsFilters.result, eventsFilters.source, eventsPage, eventsPageSize, onAuthRequired, timeRange]);

  const resetEventsPage = useCallback(() => {
    setEventsPage(1);
  }, []);

  const handleEventsPageSizeChange = useCallback((pageSize: number) => {
    setEventsPageSize(pageSize);
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsModelFilterChange = useCallback((model: string) => {
    setEventsFilters((current) => ({ ...current, model }));
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsSourceFilterChange = useCallback((source: string) => {
    setEventsFilters((current) => ({ ...current, source }));
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsResultFilterChange = useCallback((result: string) => {
    setEventsFilters((current) => ({ ...current, result }));
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsExport = useCallback(async (format: UsageEventsExportFormat) => {
    setEventsExportingFormat(format);
    setEventsError('');
    try {
      const file = await exportKeyOverviewUsageEvents(timeRange, undefined, undefined, format, {
        model: eventsFilters.model === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.model,
        source: eventsFilters.source === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.source,
        result: eventsFilters.result === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsFilters.result,
      });
      triggerKeyOverviewFileDownload(file.blob, file.filename);
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.status === 401) {
        onAuthRequired?.();
        return;
      }
      if (nextError instanceof ApiError && nextError.status === 429) {
        setEventsError('KEY_OVERVIEW_RATE_LIMITED');
        return;
      }
      setEventsError(nextError instanceof Error ? nextError.message : 'KEY_OVERVIEW_EVENTS_EXPORT_FAILED');
    } finally {
      setEventsExportingFormat(null);
    }
  }, [eventsFilters.model, eventsFilters.result, eventsFilters.source, onAuthRequired, timeRange]);

  useEffect(() => {
    void loadOverview();
    return () => {
      overviewRequestControllerRef.current?.abort();
      overviewRequestControllerRef.current = null;
    };
  }, [loadOverview]);

  useEffect(() => {
    void loadRealtime();
    return () => {
      realtimeRequestControllerRef.current?.abort();
      realtimeRequestControllerRef.current = null;
    };
  }, [loadRealtime]);

  useEffect(() => {
    if (activeTab !== 'events') {
      eventsFilterOptionsRequestControllerRef.current?.abort();
      eventsFilterOptionsRequestControllerRef.current = null;
      return;
    }
    void loadEventFilterOptions();
    return () => {
      eventsFilterOptionsRequestControllerRef.current?.abort();
      eventsFilterOptionsRequestControllerRef.current = null;
    };
  }, [activeTab, loadEventFilterOptions]);

  useEffect(() => {
    if (activeTab !== 'events') {
      eventsRequestControllerRef.current?.abort();
      eventsRequestControllerRef.current = null;
      setEventsLoading(false);
      return;
    }
    void loadEvents();
    return () => {
      eventsRequestControllerRef.current?.abort();
      eventsRequestControllerRef.current = null;
    };
  }, [activeTab, loadEvents]);

  useEffect(() => () => {
    if (refreshThrottleTimerRef.current !== null) {
      window.clearTimeout(refreshThrottleTimerRef.current);
      refreshThrottleTimerRef.current = null;
    }
  }, []);

  const refreshKeyOverview = useCallback(async (options: KeyOverviewLoadOptions = {}) => {
    await Promise.all([loadOverview(options), loadRealtime(options)]);
  }, [loadOverview, loadRealtime]);

  const refreshCredentials = credentialsData.refresh;
  const refreshActiveTab = useCallback(async (options: KeyOverviewLoadOptions = {}) => {
    if (activeTab === 'events') {
      await Promise.all([loadEventFilterOptions(), loadEvents()]);
      return;
    }
    if (activeTab === 'auth-files') {
      await refreshCredentials();
      return;
    }
    await refreshKeyOverview(options);
  }, [activeTab, loadEventFilterOptions, loadEvents, refreshCredentials, refreshKeyOverview]);

  const refreshAutoRefreshTab = useCallback(async (options: KeyOverviewLoadOptions = {}) => {
    if (activeTab === 'events') {
      if (eventsPage === 1) {
        await loadEvents();
      }
      return;
    }
    if (activeTab === 'overview') {
      await refreshKeyOverview(options);
    }
  }, [activeTab, eventsPage, loadEvents, refreshKeyOverview]);

  const handleAutoRefreshError = useCallback((nextError: unknown) => {
    if (nextError instanceof ApiError && nextError.status === 401) {
      onAuthRequired?.();
      return;
    }
    if (nextError instanceof ApiError && nextError.status === 429) {
      setError('KEY_OVERVIEW_RATE_LIMITED');
      return;
    }
    setError('KEY_OVERVIEW_LOAD_FAILED');
  }, [onAuthRequired]);

  useEffect(() => scheduleKeyOverviewAutoRefresh({
    refreshOverview: () => refreshAutoRefreshTab({ skipIfInFlight: true }),
    onRefreshError: handleAutoRefreshError,
    intervalMs: KEY_OVERVIEW_AUTO_REFRESH_INTERVAL_MS,
  }), [handleAutoRefreshError, refreshAutoRefreshTab]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_OVERVIEW_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore storage failures
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_OVERVIEW_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // ignore storage failures
    }
  }, [timeRange]);

  useEffect(() => {
    try {
      localStorage.setItem(OVERVIEW_REALTIME_WINDOW_STORAGE_KEY, realtimeWindow);
    } catch {
      // ignore storage failures
    }
  }, [realtimeWindow]);

  const overviewDisplayLoading = getOverviewDisplayLoading({ loading, hasUsage: Boolean(usage) });
  const currentOverviewUsage = getCurrentOverviewUsage(usage, timeRange, loadedUsageRange);
  const reserveDailyAveragePanel = isDailyAverageRange({ range: timeRange });
  const dailyAveragePanelUsage = getDailyAveragePanelUsage(currentOverviewUsage, usage, reserveDailyAveragePanel, loading);
  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    cachedRateSparkline,
    costSparkline,
  } = useSparklines({ usage, loading });

  const refreshDisabled = manualRefreshLoading || refreshThrottled;
  const handleManualRefresh = useCallback(async () => {
    if (refreshDisabled) return;
    setManualRefreshLoading(true);
    try {
      await refreshActiveTab();
      setRefreshThrottled(true);
      if (refreshThrottleTimerRef.current !== null) {
        window.clearTimeout(refreshThrottleTimerRef.current);
      }
      refreshThrottleTimerRef.current = window.setTimeout(() => {
        refreshThrottleTimerRef.current = null;
        setRefreshThrottled(false);
      }, REFRESH_THROTTLE_MS);
    } finally {
      setManualRefreshLoading(false);
    }
  }, [refreshActiveTab, refreshDisabled]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      onAuthRequired?.();
      setLoggingOut(false);
    }
  }, [onAuthRequired]);

  const identityLabel = apiKey?.display_key || t('key_overview.identity_unknown');
  const displayError = error === 'KEY_OVERVIEW_RATE_LIMITED'
    ? t('key_overview.rate_limited')
    : error === 'KEY_OVERVIEW_LOAD_FAILED'
      ? t('key_overview.load_failed')
      : error;
  const displayRealtimeError = realtimeError
    ? realtimeError === 'KEY_OVERVIEW_RATE_LIMITED'
      ? t('key_overview.rate_limited')
      : t('usage_stats.overview_realtime_load_failed')
    : '';
  const displayEventsError = eventsError === 'KEY_OVERVIEW_RATE_LIMITED'
    ? t('key_overview.rate_limited')
    : eventsError === 'KEY_OVERVIEW_EVENTS_LOAD_FAILED'
      ? t('usage_stats.request_events_load_failed', { defaultValue: 'Failed to load request events.' })
      : eventsError === 'KEY_OVERVIEW_EVENTS_EXPORT_FAILED'
        ? t('notification.download_failed')
        : eventsError;

  return (
    <div className={styles.pageShell} data-keeper-page="key-overview">
      <div className={styles.pageFrame}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <BrandLink className={styles.eyebrow} />
          </div>
          <div className={styles.topBarActions}>
            <span className={styles.identityChip} title={identityLabel}>
              <span className={styles.identityDot} aria-hidden="true" />
              <span className={styles.identityText}>{identityLabel}</span>
            </span>
            <LanguageSwitcher />
            <div className={styles.themeSwitcher} role="tablist" aria-label={t('usage_stats.theme_switch')}>
              {themeOptions.map((option) => {
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${styles.themePill} ${active ? styles.themePillActive : ''}`.trim()}
                    onClick={() => setTheme(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className={styles.logoutSwitcher} role="group" aria-label={t('common.logout')}>
              <button
                type="button"
                className={`${styles.logoutPill} ${styles.logoutPillActive}`.trim()}
                onClick={() => void handleLogout()}
                disabled={loggingOut}
              >
                <span className={styles.logoutPillInner}>{loggingOut ? t('common.loading') : t('common.logout')}</span>
              </button>
            </div>
          </div>
        </header>

        <main className={styles.contentColumn}>
          <div className={styles.container}>
            {loading && !usage && (
              <div className={styles.loadingOverlay} aria-busy="true">
                <div className={styles.loadingOverlayContent}>
                  <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
                  <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
                </div>
              </div>
            )}

            {lastRefreshedAt && (
              <div className={styles.toolbarMetaRow}>
                <span className={styles.lastRefreshed}>
                  {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
                </span>
              </div>
            )}

            <div className={styles.toolbarRow}>
              <div className={styles.tabBar} role="tablist" aria-label={t('key_overview.tabs_aria_label')}>
                {KEY_OVERVIEW_TAB_OPTIONS.map((tab) => {
                  const active = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`${styles.tabPill} ${active ? styles.tabPillActive : ''}`.trim()}
                      onClick={() => setActiveTab(tab)}
                    >
                      {t(KEY_OVERVIEW_TAB_LABEL_KEYS[tab])}
                    </button>
                  );
                })}
              </div>

              <div className={styles.toolbarActionsRight}>
                {activeTab !== 'auth-files' && (
                  <div className={styles.usageFilterBar}>
                    <div className={styles.timeRangeGroup}>
                      <label className={`${styles.usageFilterField} ${styles.rangeFilterField}`.trim()}>
                        <span className={styles.usageFilterLabel}>{t('usage_stats.range_filter')}</span>
                        <Select
                          value={timeRange}
                          options={rangeOptions}
                          onChange={(value) => setTimeRange(value as KeyOverviewTimeRange)}
                          className={styles.rangeSelectControl}
                          ariaLabel={t('usage_stats.range_filter')}
                          fullWidth
                        />
                      </label>
                    </div>
                  </div>
                )}
                <div className={styles.usageRefreshSlot}>
                  <div className={styles.usageFilterActions}>
                    <div className={styles.refreshSwitcher} role="group" aria-label={t('usage_stats.refresh')}>
                      <button
                        type="button"
                        className={`${styles.refreshPill} ${styles.refreshPillActive} ${manualRefreshLoading ? styles.refreshPillLoading : ''}`.trim()}
                        onClick={() => void handleManualRefresh()}
                        disabled={refreshDisabled}
                        aria-busy={manualRefreshLoading}
                      >
                        {manualRefreshLoading ? (
                          <span className={styles.refreshPillInner}>
                            <LoadingSpinner size={12} className={styles.refreshSpinner} />
                            <span>{t('common.loading')}</span>
                          </span>
                        ) : (
                          <span className={styles.refreshPillInner}>
                            <IconRefreshCw size={14} />
                            <span>{t('usage_stats.refresh')}</span>
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {activeTab === 'overview' && (
              <>
                {displayError && <div className={styles.errorBox}>{displayError}</div>}

                <DailyAveragePanel usage={dailyAveragePanelUsage} loading={overviewDisplayLoading} reserveVisible={reserveDailyAveragePanel} />

                <StatCards
                  usage={usage}
                  loading={overviewDisplayLoading}
                  sparklines={{
                    requests: requestsSparkline,
                    tokens: tokensSparkline,
                    rpm: rpmSparkline,
                    tpm: tpmSparkline,
                    cachedRate: cachedRateSparkline,
                    cost: costSparkline,
                  }}
                />

                <ServiceHealthCard usage={usage} loading={overviewDisplayLoading} />

                <OverviewRealtimePanel
                  realtime={realtime?.window === realtimeWindow ? realtime : undefined}
                  loading={realtimeLoading}
                  error={displayRealtimeError}
                  window={realtimeWindow}
                  onWindowChange={setRealtimeWindow}
                  isDark={isDark}
                  isMobile={isMobile}
                  timezone={realtime?.timezone ?? usage?.timezone}
                  visibleDimensions={KEY_OVERVIEW_REALTIME_VISIBLE_DIMENSIONS}
                />
              </>
            )}

            {activeTab === 'events' && (
              <>
                {displayEventsError && <div className={styles.errorBox}>{displayEventsError}</div>}
                <RequestEventsDetailsCard
                  events={eventsData}
                  loading={eventsLoading}
                  page={eventsPage}
                  pageSize={eventsPageSize}
                  pageSizeOptions={REQUEST_EVENTS_PAGE_SIZES}
                  totalCount={eventsTotalCount}
                  totalPages={eventsTotalPages}
                  modelOptions={eventsModelOptions}
                  sourceOptions={eventsSourceOptions}
                  modelFilter={eventsFilters.model}
                  sourceFilter={eventsFilters.source}
                  resultFilter={eventsFilters.result}
                  exportingFormat={eventsExportingFormat}
                  visibleColumnIds={eventsVisibleColumnIds}
                  onPageChange={setEventsPage}
                  onPageSizeChange={handleEventsPageSizeChange}
                  onModelFilterChange={handleEventsModelFilterChange}
                  onSourceFilterChange={handleEventsSourceFilterChange}
                  onResultFilterChange={handleEventsResultFilterChange}
                  onExport={handleEventsExport}
                  onVisibleColumnIdsChange={setEventsVisibleColumnIds}
                />
              </>
            )}

            {activeTab === 'auth-files' && (
              <>
                {credentialsData.error && <div className={styles.errorBox}>{credentialsData.error}</div>}
                <CredentialProviderFilterBar
                  scope="auth-files"
                  typeCounts={credentialsData.authFileTypeCounts}
                  value={credentialsData.authFileProviderFilter}
                  onChange={credentialsData.setAuthFileProviderFilter}
                />
                <div className={styles.credentialsSections}>
                  <AuthFileCredentialsSection
                    rows={credentialsData.authFileRows}
                    total={credentialsData.authFileTotal}
                    page={credentialsData.authFilePage}
                    totalPages={credentialsData.authFileTotalPages}
                    pageSize={credentialsData.authFilePageSize}
                    activeOnly={credentialsData.authFileActiveOnly}
                    sort={credentialsData.authFileSort}
                    loading={credentialsData.loading}
                    quotaRefreshing={credentialsData.quotaRefreshing}
                    quotaRefreshError={credentialsData.quotaRefreshError}
                    quotaAutoRefreshEnabled={false}
                    quotaInspectionStatus={credentialsData.quotaInspectionStatus}
                    quotaInspectionLoading={credentialsData.quotaInspectionLoading}
                    quotaInspectionStarting={credentialsData.quotaInspectionStarting}
                    quotaInspectionError={credentialsData.quotaInspectionError}
                    readOnly
                    onPageChange={credentialsData.setAuthFilePage}
                    onPageSizeChange={credentialsData.setAuthFilePageSize}
                    onActiveOnlyChange={credentialsData.setAuthFileActiveOnly}
                    onSortChange={credentialsData.setAuthFileSort}
                    onRefreshQuota={credentialsData.refreshQuotaForCurrentAuthFilePage}
                    onRefreshQuotaForAuthIndex={credentialsData.refreshQuotaForAuthIndex}
                    onResetQuotaForAuthIndex={credentialsData.resetQuotaForAuthIndex}
                    onRefreshInspectionStatus={credentialsData.refreshQuotaInspectionStatus}
                    onStartInspection={credentialsData.startQuotaInspection}
                  />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
