// Thin ECharts wrapper: one instance per chart, option updates without re-creating, theme-aware.
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, HeatmapChart, ScatterChart, CustomChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, VisualMapComponent, DataZoomComponent, DatasetComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { usePalette, type Palette } from '../../lib/palette';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart, ScatterChart, CustomChart, GridComponent, TooltipComponent, LegendComponent,
  MarkLineComponent, MarkAreaComponent, VisualMapComponent, DataZoomComponent, DatasetComponent, CanvasRenderer,
]);

export type ChartOption = EChartsCoreOption;
export interface EChartHandle {
  image: () => string | null;
}

export function baseOption(p: Palette): ChartOption {
  return {
    backgroundColor: 'transparent',
    color: p.series,
    textStyle: { fontFamily: 'Inter Variable, system-ui, sans-serif', color: p.muted },
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', backgroundColor: p.panel2, borderColor: p.lineStrong, textStyle: { color: p.fg, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: p.lineStrong } }, confine: true,
    },
    legend: { top: 0, right: 0, textStyle: { color: p.muted, fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 6 },
  };
}

export function axis(p: Palette, extra: Record<string, unknown> = {}) {
  return {
    axisLine: { lineStyle: { color: p.lineStrong } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: p.line } },
    ...extra,
  };
}

interface Props {
  option: ChartOption | ((p: Palette) => ChartOption);
  height?: number | string;
  className?: string;
  onClick?: (params: { name?: string; seriesName?: string; dataIndex?: number; data?: unknown }) => void;
}

export const EChart = memo(forwardRef<EChartHandle, Props>(function EChart({ option, height = 260, className, onClick }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const p = usePalette();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (params) => clickRef.current?.(params as never));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const opt = typeof option === 'function' ? option(p) : option;
    c.setOption({ ...baseOption(p), ...opt }, { notMerge: true, lazyUpdate: true });
  }, [option, p]);

  useImperativeHandle(ref, () => ({
    image: () => chart.current?.getDataURL({ type: 'jpeg', pixelRatio: 1.5, backgroundColor: '#ffffff' }) ?? null,
  }), []);

  return <div ref={el} className={className} style={{ height, width: '100%' }} />;
}));
