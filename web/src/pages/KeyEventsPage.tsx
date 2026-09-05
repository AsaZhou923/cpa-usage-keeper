import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MainActionButton } from '@/components/ui/MainActionButton';
import { IconRefreshCw } from '@/components/ui/icons';
import { TimeRangeControl } from '@/components/usage';
import {
  RequestEventsDetailsCard,
  REQUEST_EVENT_COLUMN_IDS,
  normalizeRequestEventVisibleColumnIds,
  type RequestEventColumnId,
} from '@/components/usage/RequestEventsDetailsCard';
import { KeyViewerShell } from '@/features/key-viewer/KeyViewerShell';
import type { KeyViewerPath } from '@/features/key-viewer/navigation';
import { loadKeyViewerTimeRange, persistKeyViewerTimeRange } from '@/features/key-viewer/timeRange';
import {
  ApiError,
  exportKeyOverviewUsageEvents,
  fetchKeyOverviewUsageEventModelFilterOptions,
  fetchKeyOverviewUsageEventSourceFilterOptions,
  fetchKeyOverviewUsageEvents,
  isUsageRangeBoundsConflict,
  type UsageEventsExportFormat,
} from '@/lib/api';
import type {
  AuthSessionAPIKeySummary,
  UsageCustomRange,
  UsageEvent,
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

const appendUniqueUsageEvents = (
  currentEvents: readonly UsageEvent[],
  incomingEvents: readonly UsageEvent[],
): UsageEvent[] => {
  const seenEventIds = new Set(
    currentEvents
      .map((event) => String(event.id ?? '').trim())
      .filter(Boolean),
  );
  const merged = [...currentEvents];
  for (const event of incomingEvents) {
    const eventId = String(event.id ?? '').trim();
    if (eventId && seenEventIds.has(eventId)) continue;
    if (eventId) seenEventIds.add(eventId);
    merged.push(event);
  }
  return merged;
};

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
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [autoLoadMore, setAutoLoadMore] = useState(true);
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
  const requestControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const filterOptionsControllerRef = useRef<AbortController | null>(null);

  const usageRangeQuery = useMemo(() => buildUsageRangeQuery({
    range: timeRange,
    customUnit: customRange?.unit,
    customStart: customRange?.start,
    customEnd: customRange?.end,
  }), [customRange?.end, customRange?.start, customRange?.unit, timeRange]);
  const rangeTimeZone = timeRangeState.timeZone ?? MONITORING_TIME_ZONE;

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

  const loadEvents = useCallback(async () => {
    if (!usageRangeQuery.valid) return;
    requestControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setLoadingMore(false);
    setAutoLoadMore(true);
    setError('');
    try {
      const response = await fetchKeyOverviewUsageEvents(usageRangeQuery, controller.signal, {
        pageSize: REQUEST_EVENTS_PAGE_SIZE,
        cursorMode: true,
        ...eventFilters,
      });
      if (requestControllerRef.current !== controller) return;
      setEvents(response.events ?? []);
      setTotalCount(Math.max(response.total_count ?? 0, 0));
      setNextCursor(response.has_more === true ? response.next_cursor?.trim() || null : null);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setEvents([]);
      setTotalCount(0);
      setNextCursor(null);
      if (recoverRangeBoundsConflict(loadError)) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onAuthRequired?.();
        return;
      }
      setError(loadError instanceof ApiError && loadError.status === 429
        ? 'KEY_OVERVIEW_RATE_LIMITED'
        : 'KEY_OVERVIEW_EVENTS_LOAD_FAILED');
    } finally {
      if (requestControllerRef.current === controller) {
        setLoading(false);
        requestControllerRef.current = null;
      }
    }
  }, [eventFilters, onAuthRequired, recoverRangeBoundsConflict, usageRangeQuery]);

  const loadMoreEvents = useCallback(async () => {
    const cursor = nextCursor?.trim();
    if (!cursor || loadMoreControllerRef.current || !usageRangeQuery.valid) return;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      const response = await fetchKeyOverviewUsageEvents(usageRangeQuery, controller.signal, {
        pageSize: REQUEST_EVENTS_PAGE_SIZE,
        cursorMode: true,
        cursor,
        ...eventFilters,
      });
      if (loadMoreControllerRef.current !== controller) return;
      setEvents((currentEvents) => appendUniqueUsageEvents(currentEvents, response.events ?? []));
      if (response.total_count >= 0) setTotalCount(response.total_count);
      setNextCursor(response.has_more === true ? response.next_cursor?.trim() || null : null);
      setAutoLoadMore(true);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setAutoLoadMore(false);
      if (recoverRangeBoundsConflict(loadError)) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onAuthRequired?.();
        return;
      }
      setError(loadError instanceof ApiError && loadError.status === 429
        ? 'KEY_OVERVIEW_RATE_LIMITED'
        : 'KEY_OVERVIEW_EVENTS_LOAD_FAILED');
    } finally {
      if (loadMoreControllerRef.current === controller) {
        setLoadingMore(false);
        loadMoreControllerRef.current = null;
      }
    }
  }, [eventFilters, nextCursor, onAuthRequired, recoverRangeBoundsConflict, usageRangeQuery]);

  useEffect(() => {
    void loadFilterOptions();
    return () => {
      filterOptionsControllerRef.current?.abort();
      filterOptionsControllerRef.current = null;
    };
  }, [loadFilterOptions]);

  useEffect(() => {
    void loadEvents();
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
    };
  }, [loadEvents]);

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
      await Promise.all([loadFilterOptions(), loadEvents()]);
    } finally {
      setManualRefreshLoading(false);
    }
  }, [loadEvents, loadFilterOptions, manualRefreshLoading]);

  const displayError = error === 'KEY_OVERVIEW_RATE_LIMITED'
    ? t('key_overview.rate_limited')
    : error === 'KEY_OVERVIEW_EVENTS_LOAD_FAILED'
      ? t('usage_stats.request_events_load_failed', { defaultValue: 'Failed to load request events.' })
      : error === 'KEY_OVERVIEW_EVENTS_EXPORT_FAILED'
        ? t('notification.download_failed')
        : error;
  const toolbar = (
    <>
      <div className={styles.usageFilterBar}>
        <TimeRangeControl
          value={timeRange}
          customRange={customRange}
          timeZone={rangeTimeZone}
          onChange={handleTimeRangeChange}
          ariaLabel={t('usage_stats.range_filter')}
        />
      </div>
      <div className={styles.usageRefreshSlot}>
        <div className={styles.usageFilterActions}>
          <MainActionButton
            type="button"
            shellClassName={styles.refreshMainActionShell}
            className={styles.refreshMainActionButton}
            onClick={() => void handleManualRefresh()}
            disabled={manualRefreshLoading}
            loading={manualRefreshLoading}
          >
            {manualRefreshLoading ? t('common.loading') : (
              <>
                <IconRefreshCw size={14} />
                <span>{t('usage_stats.refresh')}</span>
              </>
            )}
          </MainActionButton>
        </div>
      </div>
    </>
  );

  return (
    <KeyViewerShell
      activePage="events"
      apiKey={apiKey}
      loading={loading && events.length === 0}
      toolbar={toolbar}
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
        hasMore={Boolean(nextCursor)}
        loadingMore={loadingMore}
        autoLoadMore={autoLoadMore}
        visibleColumnIds={visibleColumnIds}
        columnOrder={columnOrder}
        onModelFilterChange={setModelFilter}
        onSourceFilterChange={setSourceFilter}
        onResultFilterChange={setResultFilter}
        onExport={handleExport}
        onLoadMore={loadMoreEvents}
        onVisibleColumnIdsChange={setVisibleColumnIds}
        onColumnOrderChange={setColumnOrder}
      />
    </KeyViewerShell>
  );
}
