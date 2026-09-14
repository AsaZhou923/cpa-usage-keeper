// @vitest-environment happy-dom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisResponse } from '@/lib/types';

vi.mock('react-chartjs-2', () => ({
  Bar: () => React.createElement('div'),
  Doughnut: () => React.createElement('div'),
  Scatter: () => React.createElement('div'),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { emptyAnalysis, renderAnalysisPanel } from './analysisFixtures';

const analysis: AnalysisResponse = {
  ...emptyAnalysis,
  token_usage: [
    {
      bucket: '2026-07-14T08:00:00Z',
      input_tokens: 1_200_000,
      output_tokens: 300_000,
      cache_read_tokens: 400_000,
      cache_creation_tokens: 100_000,
      reasoning_tokens: 0,
      total_tokens: 2_000_000,
      requests: 6,
      cost_usd: 4,
      cost_available: true,
    },
    {
      bucket: '2026-07-14T09:00:00Z',
      input_tokens: 800_000,
      output_tokens: 200_000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 1_000_000,
      requests: 4,
      cost_usd: 2,
      cost_available: true,
    },
  ],
  cost_breakdown: {
    uncached_input_cost_usd: 1,
    cache_read_cost_usd: 1.5,
    cache_write_cost_usd: 0.5,
    output_cost_usd: 3,
    total_cost_usd: 6,
    cost_available: true,
  },
};

describe('AnalysisPanel cost breakdown summary', () => {
  it('shows total tokens, total cost, and blended cost in order', () => {
    const container = renderAnalysisPanel({ analysis });
    const summary = container.querySelector('[class*="costRatePanel"]')!;
    expect([...summary.children].map((metric) => metric.textContent)).toEqual([
      'usage_stats.total_tokens3.00M',
      'usage_stats.total_cost$6.00',
      'usage_stats.analysis_cost_per_million_tokens$2.00usage_stats.analysis_blended_rate',
    ]);
  });
});
