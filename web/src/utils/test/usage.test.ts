import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateCacheReadRate, calculateDisplayInputTokens, resolveUsageFilterWindow } from '@/utils/usage';

describe('resolveUsageFilterWindow', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('resolves today from Tokyo day start through the refresh anchor', () => {
    const nowMs = Date.parse('2026-04-23T12:34:56.000Z');
    const expectedStart = Date.parse('2026-04-23T00:00:00+09:00');

    const window = resolveUsageFilterWindow(null, 'today', { nowMs });

    expect(window).toEqual({
      startMs: expectedStart,
      endMs: nowMs,
      windowMinutes: Math.max((nowMs - expectedStart) / 60000, 1),
    });
  });

  it('resolves yesterday as the previous Tokyo day boundary', () => {
    const nowMs = Date.parse('2026-04-23T12:34:56.000Z');
    const expectedStart = Date.parse('2026-04-22T00:00:00+09:00');
    const expectedEnd = Date.parse('2026-04-22T23:59:59.999+09:00');

    const window = resolveUsageFilterWindow(null, 'yesterday', { nowMs });

    expect(window).toEqual({
      startMs: expectedStart,
      endMs: expectedEnd,
      windowMinutes: 24 * 60,
    });
  });

  it.each(['UTC', 'America/Los_Angeles'])('uses Tokyo midnight while the browser timezone is %s', (timezone) => {
    vi.stubEnv('TZ', timezone);
    const nowMs = Date.parse('2026-04-23T15:00:30Z');
    expect(resolveUsageFilterWindow(null, 'today', { nowMs })).toEqual({
      startMs: Date.parse('2026-04-24T00:00:00+09:00'),
      endMs: nowMs,
      windowMinutes: 1,
    });
    expect(resolveUsageFilterWindow(null, 'yesterday', { nowMs })).toEqual({
      startMs: Date.parse('2026-04-23T00:00:00+09:00'),
      endMs: Date.parse('2026-04-23T23:59:59.999+09:00'),
      windowMinutes: 1440,
    });
  });

  it('resolves 30d as a rolling thirty-day window', () => {
    const nowMs = Date.parse('2026-04-23T12:34:56.000Z');

    const window = resolveUsageFilterWindow(null, '30d', { nowMs });

    expect(window).toEqual({
      startMs: nowMs - 30 * 24 * 60 * 60 * 1000,
      endMs: nowMs,
      windowMinutes: 30 * 24 * 60,
    });
  });
});

describe('calculateCacheReadRate', () => {
  it('uses normalized input tokens as the denominator', () => {
    expect(calculateCacheReadRate({ inputTokens: 1000, cacheReadTokens: 250 })).toBe(25);
  });

  it('does not apply provider-specific token math in the frontend', () => {
    expect(calculateCacheReadRate({ inputTokens: 400, cacheReadTokens: 600 })).toBe(150);
  });

  it('returns null when there is no cacheable input', () => {
    expect(calculateCacheReadRate({ inputTokens: 0, cacheReadTokens: 0 })).toBeNull();
  });
});

describe('calculateDisplayInputTokens', () => {
  it('subtracts both cache read and cache write tokens from normalized input', () => {
    expect(calculateDisplayInputTokens({
      inputTokens: 1000,
      cacheReadTokens: 250,
      cacheCreationTokens: 100,
    })).toBe(650);
  });
});
