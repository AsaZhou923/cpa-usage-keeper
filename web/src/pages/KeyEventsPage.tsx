import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeRangeControl } from '@/components/usage';
import {
  RequestEventsDetailsCard,
  REQUEST_EVENT_COLUMN_IDS,
  normalizeRequestEventVisibleColumnIds,
  type RequestEventColumnId,
} from '@/components/usage/RequestEventsDetailsCard';
import { useRequestEventsFeed } from '@/components/usage/useRequestEventsFeed';
import { KeyViewerShell } from '@/features/key-viewer/KeyViewerShell';
import type { KeyViewerPath } from '@/features/key-viewer/navigation';
import { loadKeyViewerTimeRange, persistKeyViewerTimeRange } from '@/features/key-viewer/timeRange';
import {
  ApiError,
  exportKeyOverviewUsageEvents,
  fetchKeyOverviewUsageEventModelFilterOptions,
  fetchKeyOverviewUsageEventSourceFilterOptions,
  isUsageRangeBoundsConflict,
  type UsageEventsExportFormat,
} from '@/lib/api';
import type {
  AuthSessionAPIKeySummary,
  UsageCustomRange,
  UsageSourceFilterOption,
  UsageTimeRange,
} from '@/lib/types';
import {
  clampStoredUsageRangeStateToCurrentBounds,
  resolveUsageRangeRecoveryTimeZone,
  type StoredUsageRangeState,
} from '@/utils/usage/customRange';
import { buildUsageRangeQuery } from '@/utils/usage/rangeQuery';
import { MONITORING_TIME_ZONE } from '@/utils/time';
import styles from '@/features/key-viewer/KeyViewerShell.module.scss';

const REQUEST_EVENTS_PAGE_SIZE = 50;
const ALL_REQUEST_EVENTS_FILTER = '__all__';
const KEY_REQUEST_EVENT_COLUMN_IDS = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'api_key');

const triggerBrowserFileDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export interface KeyEventsPageProps {
  apiKey?: AuthSessionAPIKeySummary;
  onNavigate: (path: KeyViewerPath) => void;
  onAuthRequired?: () => void;
}

export function KeyEventsPage({ apiKey, onNavigate, onAuthRequired }: KeyEventsPageProps) {
  const { t } = useTranslation();
  const [timeRangeState, setTimeRangeState] = useState<StoredUsageRangeState>(loadKeyViewerTimeRange);
  const { range: timeRange, customRange } = timeRangeState;
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<UsageSourceFilterOption[]>([]);
  const [modelFilter, setModelFilter] = useState(ALL_REQUEST_EVENTS_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_REQUEST_EVENTS_FILTER);
  const [resultFilter, setResultFilter] = useState(ALL_REQUEST_EVENTS_FILTER);
  const [exportingFormat, setExportingFormat] = useState<UsageEventsExportFormat | null>(null);
  const [visibleColumnIds, setVisibleColumnIds] = useState<RequestEventColumnId[]>(() => (
    normalizeRequestEventVisibleColumnIds(KEY_REQUEST_EVENT_COLUMN_IDS, KEY_REQUEST_EVENT_COLUMN_IDS)
  ));
  const [columnOrder, setColumnOrder] = useState<RequestEventColumnId[]>(KEY_REQUEST_EVENT_COLUMN_IDS);
  const filterOptionsControllerRef = useRef<AbortController | null>(null);

  const usageRangeQuery = useMemo(() => buildUsageRangeQuery({
    range: timeRange,
    customUnit: customRange?.unit,
    customStart: customRange?.start,
    customEnd: customRange?.end,
  }), [customRange?.end, customRange?.start, customRange?.unit, timeRange]);
  const rangeTimeZone = MONITORING_TIME_ZONE;

  const recoverRangeBoundsConflict = useCallback((loadError: unknown) => {
    if (!isUsageRangeBoundsConflict(loadError)) return false;
    const timeZone = resolveUsageRangeRecoveryTimeZone(timeRangeState, MONITORING_TIME_ZONE)?.trim();
    if (!timeZone) return false;
    const nextState = clampStoredUsageRangeStateToCurrentBounds(timeRangeState, {
      nowMs: Date.now(),
      timeZone,
    });
    if (nextState === timeRangeState) return false;
    setTimeRangeState(nextState);
    persistKeyViewerTimeRange(nextState);
    return true;
  }, [timeRangeState]);

  const handleTimeRangeChange = useCallback((range: UsageTimeRange, nextCustomRange?: UsageCustomRange) => {
    const nextState: StoredUsageRangeState = range === 'custom' && nextCustomRange
      ? { range, customRange: nextCustomRange, timeZone: rangeTimeZone }
      : { ...timeRangeState, range };
    setTimeRangeState(nextState);
    persistKeyViewerTimeRange(nextState);
  }, [rangeTimeZone, timeRangeState]);

  const eventFilters = useMemo(() => ({
    model: modelFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : modelFilter,
    source: sourceFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : sourceFilter,
    result: resultFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : resultFilter,
  }), [modelFilter, resultFilter, sourceFilter]);

  const loadFilterOptions = useCallback(async () => {
    filterOptionsControllerRef.current?.abort();
    const controller = new AbortController();
    filterOptionsControllerRef.current = controller;
    try {
      const [modelResponse, sourceResponse] = await Promise.all([
        fetchKeyOverviewUsageEventModelFilterOptions(controller.signal),
        fetchKeyOverviewUsageEventSourceFilterOptions(controller.signal),
      ]);
      if (filterOptionsControllerRef.current !== controller) return;
      setModelOptions(modelResponse.models ?? []);
      setSourceOptions(sourceResponse.sources ?? []);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onAuthRequired?.();
      }
    } finally {
      if (filterOptionsControllerRef.current === controller) {
        filterOptionsControllerRef.current = null;
      }
    }
  }, [onAuthRequired]);

  const feed = useRequestEventsFeed({
    enabled: usageRangeQuery.valid,
    request: usageRangeQuery,
    options: { pageSize: REQUEST_EVENTS_PAGE_SIZE, cursorMode: true, ...eventFilters },
    keyViewer: true,
    onAuthRequired,
    onRangeBoundsConflict: recoverRangeBoundsConflict,
  });
  const { events, loading, loadingMore, totalCount, autoLoadMore } = feed;

  useEffect(() => {
    void loadFilterOptions();
    return () => {
      filterOptionsControllerRef.current?.abort();
      filterOptionsControllerRef.current = null;
    };
  }, [loadFilterOptions]);

  useEffect(() => {
    persistKeyViewerTimeRange(timeRangeState);
  }, [timeRangeState]);

  const handleExport = useCallback(async (format: UsageEventsExportFormat) => {
    if (!usageRangeQuery.valid) return;
    setExportingFormat(format);
    setError('');
    try {
      const file = await exportKeyOverviewUsageEvents(usageRangeQuery, format, eventFilters);
      triggerBrowserFileDownload(file.blob, file.filename);
    } catch (exportError) {
      if (recoverRangeBoundsConflict(exportError)) return;
      if (exportError instanceof ApiError && exportError.status === 401) {
        onAuthRequired?.();
        return;
      }
      setError(exportError instanceof ApiError && exportError.status === 429
        ? 'KEY_OVERVIEW_RATE_LIMITED'
        : 'KEY_OVERVIEW_EVENTS_EXPORT_FAILED');
    } finally {
      setExportingFormat(null);
    }
  }, [eventFilters, onAuthRequired, recoverRangeBoundsConflict, usageRangeQuery]);

  const handleManualRefresh = useCallback(async () => {
    if (manualRefreshLoading) return;
    setManualRefreshLoading(true);
    try {
      await Promise.all([loadFilterOptions(), feed.refresh()]);
    } finally {
      setManualRefreshLoading(false);
    }
  }, [feed, loadFilterOptions, manualRefreshLoading]);

  const currentError = error || feed.error;
  const displayError = currentError === 'COSTS_BUSY'
    ? t('key_overview.costs_busy')
    : currentError === 'KEY_OVERVIEW_RATE_LIMITED'
    ? t('key_overview.rate_limited')
    : currentError === 'KEY_OVERVIEW_EVENTS_LOAD_FAILED'
      ? t('usage_stats.request_events_load_failed', { defaultValue: 'Failed to load request events.' })
      : currentError === 'KEY_OVERVIEW_EVENTS_EXPORT_FAILED'
        ? t('notification.download_failed')
        : currentError;
  return (
    <KeyViewerShell
      activePage="events"
      apiKey={apiKey}
      loading={loading && events.length === 0}
      filters={[<TimeRangeControl key="range" value={timeRange} customRange={customRange} timeZone={rangeTimeZone} onChange={handleTimeRangeChange} ariaLabel={t('usage_stats.range_filter')} labelInsideTrigger />]}
      onRefresh={() => void handleManualRefresh()}
      refreshing={manualRefreshLoading}
      refreshDisabled={manualRefreshLoading}
      onNavigate={onNavigate}
      onAuthRequired={onAuthRequired}
    >
      {displayError && <div className={styles.errorBox}>{displayError}</div>}
      <RequestEventsDetailsCard
        events={events}
        loading={loading}
        totalCount={totalCount}
        modelOptions={modelOptions}
        sourceOptions={sourceOptions}
        modelFilter={modelFilter}
        sourceFilter={sourceFilter}
        resultFilter={resultFilter}
        exportingFormat={exportingFormat}
        hasMore={Boolean(feed.historyCursor)}
        loadingMore={loadingMore}
        autoLoadMore={autoLoadMore}
        visibleColumnIds={visibleColumnIds}
        columnOrder={columnOrder}
        onModelFilterChange={setModelFilter}
        onSourceFilterChange={setSourceFilter}
        onResultFilterChange={setResultFilter}
        onExport={handleExport}
        onLoadMore={feed.loadMore}
        reading={feed.reading}
        restoring={feed.restoring}
        onStartReading={feed.startReading}
        onTablePositionChange={feed.setAtTop}
        onReturnToTop={feed.returnToTop}
        onVisibleColumnIdsChange={setVisibleColumnIds}
        onColumnOrderChange={setColumnOrder}
      />
    </KeyViewerShell>
  );
}
