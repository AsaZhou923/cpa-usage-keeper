import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchKeyOverviewUsageEvents, openKeyOverviewUsageEventsLive } from '../api';

describe('scoped viewer request event transports', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses the scoped stream and history paths with the same filters and authentication', async () => {
    vi.stubGlobal('window', { __APP_BASE_PATH__: '/keeper' });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('event: snapshot\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(Response.json({ events: [] }));
    const signal = new AbortController().signal;
    const options = { cursorMode: true, pageSize: 50, model: 'gpt-5', source: 'scoped-source', result: 'success' };
    await openKeyOverviewUsageEventsLive({ range: 'today' }, options, signal);
    await fetchKeyOverviewUsageEvents({ range: 'today' }, signal, { ...options, cursor: 'older' });
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    expect(urls.map((url) => url.pathname)).toEqual([
      '/keeper/api/v1/key-overview/events/live', '/keeper/api/v1/key-overview/events',
    ]);
    for (const url of urls) {
      expect(url.searchParams.get('model')).toBe('gpt-5');
      expect(url.searchParams.get('source')).toBe('scoped-source');
      expect(url.searchParams.get('api_key_id')).toBeNull();
    }
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal, credentials: 'include', cache: 'no-store' });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Accept')).toBe('text/event-stream');
    expect(urls[1].searchParams.get('cursor')).toBe('older');
  });

  it('keeps the upstream Retry-After handling on scoped streams', async () => {
    vi.stubGlobal('window', { __APP_BASE_PATH__: undefined });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '9' } }));
    await expect(openKeyOverviewUsageEventsLive({ range: 'today' }, {}, new AbortController().signal))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 9000 } satisfies Partial<ApiError>);
  });
});
