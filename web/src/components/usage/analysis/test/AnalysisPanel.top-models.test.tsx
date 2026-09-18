// @vitest-environment happy-dom

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BasicPlatform, Chart } from 'chart.js/auto';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChartData, ChartOptions, Plugin } from 'chart.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisResponse, AnalysisTokenUsageBucket } from '@/lib/types';

type CapturedBar = {
  data: ChartData<'bar', Array<number | null>, string>;
  options: ChartOptions<'bar'>;
  plugins?: Plugin<'bar'>[];
};

type RecordedGradient = {
  readonly [Symbol.toStringTag]: 'CanvasGradient';
  stops: Array<[number, string]>;
  addColorStop: (offset: number, color: string) => void;
};

const chartCapture = vi.hoisted(() => ({
  bars: [] as CapturedBar[],
}));

vi.mock('react-chartjs-2', () => ({
  Bar: (props: CapturedBar) => {
    chartCapture.bars.push(props);
    return React.createElement('div');
  },
  Doughnut: () => React.createElement('div'),
  Scatter: () => React.createElement('div'),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { AnalysisTestPanel, emptyAnalysis } from './analysisFixtures';

const tokenBucket = (bucket: string, totalTokens: number): AnalysisTokenUsageBucket => ({
  bucket,
  input_tokens: totalTokens,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: totalTokens,
  requests: 1,
  cost_usd: 0,
  cost_available: true,
});

const baseAnalysis = (granularity: AnalysisResponse['granularity'], buckets: string[]): AnalysisResponse => ({
  ...emptyAnalysis,
  granularity,
  timezone: 'Asia/Shanghai',
  token_usage: buckets.map((bucket) => tokenBucket(bucket, 1)),
  model_usage: {
    buckets,
    series: [],
  },
});

const findTopModelsBar = () => chartCapture.bars.findLast((bar) =>
  bar.data.datasets.some((dataset) => dataset.label === 'model-alpha'),
)!;

const createFakeChartCanvas = (): HTMLCanvasElement => {
  const canvas = {
    width: 500,
    height: 310,
    style: {},
    clientWidth: 500,
    clientHeight: 310,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => context,
  };
  const contextTarget: Record<PropertyKey, unknown> = {
    canvas,
    measureText: (text: unknown) => ({
      width: String(text).length * 6,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: String(text).length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    createLinearGradient: (): RecordedGradient => {
      const stops: Array<[number, string]> = [];
      return {
        [Symbol.toStringTag]: 'CanvasGradient',
        stops,
        addColorStop: (offset, color) => stops.push([offset, color]),
      };
    },
    getLineDash: () => [],
  };
  const context = new Proxy(contextTarget, {
    get: (target, property) => Reflect.has(target, property) ? Reflect.get(target, property) : () => {},
  }) as unknown as CanvasRenderingContext2D;
  return canvas as unknown as HTMLCanvasElement;
};

describe('AnalysisPanel Top Models card', () => {
  beforeEach(() => {
    chartCapture.bars = [];
  });

  it('builds a stable whole-range Top 5 and merges every remaining model into Others', () => {
    const buckets = ['2026-08-01T01:00:00Z', '2026-08-01T02:00:00Z'];
    const analysis = baseAnalysis('hourly', buckets);
    analysis.model_usage.series = [
      { model: 'model-gamma', total_tokens: [40, 40], requests: [1, 1] },
      { model: 'model-eta', total_tokens: [0, 40], requests: [0, 1] },
      { model: 'model-alpha', total_tokens: [100, 0], requests: [1, 0] },
      { model: 'model-zeta', total_tokens: [50, 0], requests: [1, 0] },
      { model: 'model-beta', total_tokens: [0, 90], requests: [0, 1] },
      { model: 'model-delta', total_tokens: [70, 0], requests: [1, 0] },
      { model: 'model-epsilon', total_tokens: [0, 60], requests: [0, 1] },
    ];

    const markup = renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} />,
    );

    const topModelsStart = markup.indexOf('usage_stats.analysis_top_models_title');
    const latencyStart = markup.indexOf('usage_stats.analysis_latency_title');
    expect(topModelsStart).toBeGreaterThan(markup.indexOf('usage_stats.analysis_composition_title'));
    expect(topModelsStart).toBeLessThan(latencyStart);

    const topModelsBar = findTopModelsBar();
    expect(topModelsBar.data.labels).toEqual(['09:00', '10:00']);
    expect(topModelsBar.data.datasets.map((dataset) => dataset.label)).toEqual([
      'model-alpha',
      'model-beta',
      'model-gamma',
      'model-delta',
      'model-epsilon',
      'usage_stats.analysis_others',
    ]);
    expect(topModelsBar.data.datasets[0]?.data).toEqual([100, null]);
    expect(topModelsBar.data.datasets.at(-1)?.data).toEqual([50, 40]);
    expect(topModelsBar.options.scales?.x?.stacked).toBe(true);
    expect(topModelsBar.options.scales?.tokens?.stacked).toBe(true);

    const cardMarkup = markup.slice(topModelsStart, latencyStart);
    expect(cardMarkup).toContain('<button');
    expect(cardMarkup).toContain('aria-label="1. model-alpha');
    expect(cardMarkup).toContain('aria-label="6. usage_stats.analysis_others');
    expect(cardMarkup).not.toContain('model-zeta');
    expect(cardMarkup).not.toContain('model-eta');
  });

  it('uses response timezone for daily labels and reports model share plus bucket total in tooltip', () => {
    const buckets = ['2026-07-31T16:00:00Z', '2026-08-01T16:00:00Z'];
    const analysis = baseAnalysis('daily', buckets);
    analysis.model_usage.series = [
      { model: 'model-alpha', total_tokens: [75, 25], requests: [2, 1] },
      { model: 'model-beta', total_tokens: [25, 75], requests: [1, 2] },
    ];
    renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} isDark />,
    );

    const topModelsBar = findTopModelsBar();
    expect(topModelsBar.data.labels).toEqual(['8/1', '8/2']);
    const tooltip = topModelsBar.options.plugins?.tooltip;
    const label = tooltip?.callbacks?.label as (context: unknown) => string;
    const footer = tooltip?.callbacks?.footer as (items: unknown[]) => string;
    const filter = tooltip?.filter as (context: unknown) => boolean;
    expect(label({ dataset: { label: 'model-alpha' }, dataIndex: 0, parsed: { y: 75 } })).toContain('75.00%');
    expect(footer([{ dataIndex: 0 }])).toContain('100');
    expect(filter({ parsed: { y: 0 } })).toBe(false);
  });

  it('sorts each tooltip by that bucket token usage', () => {
    const buckets = ['2026-08-01T01:00:00Z'];
    const analysis = baseAnalysis('hourly', buckets);
    analysis.model_usage.series = [
      { model: 'model-alpha', total_tokens: [843.43], requests: [1] },
      { model: 'model-beta', total_tokens: [26.19], requests: [1] },
      { model: 'model-gamma', total_tokens: [171.04], requests: [1] },
    ];
    renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} />,
    );

    const topModelsTooltip = findTopModelsBar().options.plugins?.tooltip;
    const itemSort = topModelsTooltip?.itemSort as (left: unknown, right: unknown, data: unknown) => number;
    const items = [
      { label: 'model-beta', datasetIndex: 1, parsed: { y: 26.19 } },
      { label: 'model-gamma', datasetIndex: 2, parsed: { y: 171.04 } },
      { label: 'model-alpha', datasetIndex: 0, parsed: { y: 843.43 } },
    ];
    expect(items.sort((left, right) => itemSort(left, right, {})).map((item) => item.label)).toEqual([
      'model-alpha',
      'model-gamma',
      'model-beta',
    ]);
  });

  it('keeps every non-zero stacked segment visible after Chart.js clipping', () => {
    const buckets = ['2026-08-01T01:00:00Z'];
    const analysis = baseAnalysis('hourly', buckets);
    analysis.token_usage = [tokenBucket(buckets[0], 1_000)];
    analysis.model_usage.series = [
      { model: 'model-alpha', total_tokens: [995], requests: [1] },
      { model: 'model-beta', total_tokens: [1], requests: [1] },
      { model: 'model-gamma', total_tokens: [1], requests: [1] },
      { model: 'model-delta', total_tokens: [1], requests: [1] },
      { model: 'model-epsilon', total_tokens: [1], requests: [1] },
      { model: 'model-zeta', total_tokens: [1], requests: [1] },
    ];
    renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} />,
    );

    const topModelsBar = findTopModelsBar();
    const chart = new Chart(createFakeChartCanvas(), {
      type: 'bar',
      data: topModelsBar.data,
      platform: BasicPlatform,
      options: {
        ...topModelsBar.options,
        responsive: false,
        animation: false,
      },
    });
    try {
      const visibleHeights = chart.data.datasets.map((_, index) => {
        const element = chart.getDatasetMeta(index).data[0] as unknown as { y: number; base: number };
        const visibleTop = Math.max(element.y, chart.chartArea.top);
        const visibleBottom = Math.min(element.base, chart.chartArea.bottom);
        return Math.max(0, visibleBottom - visibleTop);
      });
      expect(visibleHeights).toHaveLength(6);
      expect(visibleHeights.every((height) => height >= 3.99)).toBe(true);
    } finally {
      chart.destroy();
    }
  });

  it('shows card-local loading and empty states', () => {
    const analysis = baseAnalysis('hourly', []);
    const loadingMarkup = renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} loading isMobile />,
    );
    const loadingStart = loadingMarkup.indexOf('usage_stats.analysis_top_models_title');
    const loadingEnd = loadingMarkup.indexOf('usage_stats.analysis_latency_title');
    expect(loadingMarkup.slice(loadingStart, loadingEnd)).toContain('common.loading');

    const emptyMarkup = renderToStaticMarkup(
      <AnalysisTestPanel analysis={analysis} isMobile />,
    );
    const emptyStart = emptyMarkup.indexOf('usage_stats.analysis_top_models_title');
    const emptyEnd = emptyMarkup.indexOf('usage_stats.analysis_latency_title');
    expect(emptyMarkup.slice(emptyStart, emptyEnd)).toContain('usage_stats.no_data');
  });

  it('prioritizes keyboard focus over another hovered ranking item', () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const buckets = ['2026-08-01T01:00:00Z'];
    const analysis = baseAnalysis('hourly', buckets);
    analysis.model_usage.series = [
      { model: 'model-alpha', total_tokens: [100], requests: [1] },
      { model: 'model-beta', total_tokens: [50], requests: [1] },
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <AnalysisTestPanel analysis={analysis} />,
      ));
      const buttons = Array.from(container.querySelectorAll('button'));
      const alphaButton = buttons.find((item) => item.getAttribute('aria-label')?.startsWith('1. model-alpha'));
      const betaButton = buttons.find((item) => item.getAttribute('aria-label')?.startsWith('2. model-beta'));

      act(() => alphaButton!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      act(() => betaButton!.focus());
      expect(document.activeElement).toBe(betaButton);
      expect(findTopModelsBar().data.datasets[0]?.borderWidth).toBe(0);
      expect(findTopModelsBar().data.datasets[1]?.borderWidth).toBeGreaterThan(0);

      act(() => alphaButton!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
      expect(document.activeElement).toBe(betaButton);
      expect(findTopModelsBar().data.datasets[1]?.borderWidth).toBeGreaterThan(0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }

    const panelStyles = readFileSync(resolve(process.cwd(), 'src/components/usage/analysis/AnalysisPanel.module.scss'), 'utf8');
    expect(panelStyles).toMatch(/\.topModelsRankItem:focus-visible/);
    expect(panelStyles).toContain('outline: 2px solid var(--text-primary);');
    expect(panelStyles).not.toMatch(/\[data-muted='true'\]\s*\{\s*opacity:/);
    expect(panelStyles).toMatch(/\.topModelsRankItem\[data-muted='true'\] \.topModelsColor/);
    expect(panelStyles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps non-focused datasets muted while the chart bucket is active', () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const buckets = ['2026-08-01T01:00:00Z'];
    const analysis = baseAnalysis('hourly', buckets);
    analysis.model_usage.series = [
      { model: 'model-alpha', total_tokens: [100], requests: [1] },
      { model: 'model-beta', total_tokens: [50], requests: [1] },
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let chart: Chart<'bar', Array<number | null>, string> | undefined;
    try {
      act(() => root.render(
        <AnalysisTestPanel analysis={analysis} />,
      ));
      const betaButton = Array.from(container.querySelectorAll('button'))
        .find((item) => item.getAttribute('aria-label')?.startsWith('2. model-beta'));
      act(() => betaButton!.focus());

      const topModelsBar = findTopModelsBar();
      chart = new Chart(createFakeChartCanvas(), {
        type: 'bar',
        data: topModelsBar.data,
        platform: BasicPlatform,
        options: {
          ...topModelsBar.options,
          responsive: false,
          animation: false,
        },
      });
      chart.setActiveElements([
        { datasetIndex: 0, index: 0 },
        { datasetIndex: 1, index: 0 },
      ]);

      const alphaElement = chart.getDatasetMeta(0).data[0] as unknown as { options: { backgroundColor?: unknown } };
      const mutedStops = (alphaElement.options.backgroundColor as RecordedGradient).stops;
      expect(mutedStops.map(([, color]) => color.slice(-2))).toEqual(['33', '33']);
    } finally {
      chart?.destroy();
      act(() => root.unmount());
      container.remove();
    }
  });
});
