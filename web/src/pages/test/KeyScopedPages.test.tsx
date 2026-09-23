// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const api = vi.hoisted(() => ({
  fetchKeyOverviewUsageEvents: vi.fn(),
  fetchKeyOverviewUsageEventModelFilterOptions: vi.fn(),
  fetchKeyOverviewUsageEventSourceFilterOptions: vi.fn(),
  fetchKeyOverviewUsageIdentitiesPage: vi.fn(),
  fetchKeyOverviewUsageQuotaCache: vi.fn(),
  fetchUsageEvents: vi.fn(),
  fetchUsageIdentitiesPage: vi.fn(),
  fetchUsageQuotaCache: vi.fn(),
  fetchUsageQuotaInspectionStatus: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(), ...api,
}));

import { KeyAuthFilesPage } from '../KeyAuthFilesPage';
import { KeyEventsPage } from '../KeyEventsPage';

describe('scoped viewer pages with the shared dashboard toolbar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage('en');
    localStorage.clear();
    vi.resetAllMocks();
    api.fetchKeyOverviewUsageEvents.mockResolvedValue({ events: [], total_count: 0, has_more: false });
    api.fetchKeyOverviewUsageEventModelFilterOptions.mockResolvedValue({ models: [] });
    api.fetchKeyOverviewUsageEventSourceFilterOptions.mockResolvedValue({ sources: [] });
    api.fetchKeyOverviewUsageIdentitiesPage.mockResolvedValue({ identities: [], total_count: 0, total_pages: 1 });
    api.fetchKeyOverviewUsageQuotaCache.mockResolvedValue({ items: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each(['events', 'auth-files'] as const)('refreshes %s through scoped APIs', async (page) => {
    await act(async () => root.render(page === 'events'
      ? <KeyEventsPage onNavigate={() => undefined} />
      : <KeyAuthFilesPage onNavigate={() => undefined} />));
    const scopedFetch = page === 'events' ? api.fetchKeyOverviewUsageEvents : api.fetchKeyOverviewUsageIdentitiesPage;
    expect(scopedFetch).toHaveBeenCalledOnce();
    const refresh = container.querySelector<HTMLButtonElement>('[data-dashboard-refresh]');
    expect(refresh).not.toBeNull();
    expect(refresh!.disabled).toBe(false);
    await act(async () => refresh!.click());
    expect(scopedFetch).toHaveBeenCalledTimes(2);
    expect(api.fetchUsageEvents).not.toHaveBeenCalled();
    expect(api.fetchUsageIdentitiesPage).not.toHaveBeenCalled();
    expect(api.fetchUsageQuotaCache).not.toHaveBeenCalled();
    expect(api.fetchUsageQuotaInspectionStatus).not.toHaveBeenCalled();
  });
});
