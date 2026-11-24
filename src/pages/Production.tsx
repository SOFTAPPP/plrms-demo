import { useMemo, useState } from 'react';
import { BarChart3, Download, Layers, Route as RouteIcon, Timer, Truck, Users } from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { qs } from '../lib/api';
import { useLive } from '../lib/live';
import { useBoot } from '../lib/app-store';
import { usePalette, type Palette } from '../lib/palette';
import { compact, dateTime, dayLabel, num, time, tonnes } from '../lib/format';
import { exportCsv } from '../lib/export';
import { mineDayStart } from '../../shared/time';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton, Stat } from '../components/ui/core';
import { Segmented } from '../components/ui/form';
import { DataTable, type Col } from '../components/ui/table';
import { EChart, axis } from '../components/charts/EChart';
import { Meter } from '../components/ui/viz';

export interface ProdSummary {
  from: number; to: number; bucketMs: number; targetTph: number; targetDaily: number; targetCycleMin: number;
  series: { ts: number; tonnes: number; loads: number; ore: number; waste: number }[];
  totals: { tonnes: number; loads: number; ore: number; waste: number; avgPayload: number; avgCycleMin: number; avgQueueMin: number; avgPasses: number; distanceKm: number };
  byLoader: { id: string; model: string; tonnes: number; loads: number; passes: number; avgLoadMin: number; avgPasses: number; avgQueueMin: number }[];
  byTruck: { id: string; model: string; tonnes: number; loads: number; avgCycleMin: number; avgPayload: number; payloadPct: number; km: number }[];
  byRoute: { id: string; name: string; distanceKm: number; targetCycleMin: number; tonnes: number; loads: number; avgCycleMin: number; breakdown: Record<'queue' | 'spot' | 'load' | 'haul' | 'dump' | 'return', number> }[];
  byShift: { day: string; shift: string; tonnes: number; loads: number; avgCycleMin: number }[];
  histogram: { fromMin: number; count: number }[];
  passes: { passes: number; count: number }[];
  payloadBands: { band: string; count: number }[];
  topOperators: { id: number; name: string; tonnes: number; loads: number; avgCycleMin: number }[];
}

const TABS = ['overview', 'loaders', 'routes', 'trucks', 'shifts', 'cycle'] as const;

export default function Production() {
  const boot = useBoot();
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const [range, setRange] = useState<'today' | '24h' | '7d'>('today');
  const from = range === 'today' ? mineDayStart(t, boot.settings.shifts.aStartHour) : range === '24h' ? t - 24 * 3_600_000 : t - 7 * 86_400_000;
  const q = useQuery<ProdSummary>(`/production/summary${qs({ from, to: t + 60_000 })}`, { refreshMs: 30_000 });
  const p = usePalette();
  const hours = Math.max(0.1, (t - from) / 3_600_000);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Production monitoring" subtitle="Tonnes, TPH, loads and cycle times by loader, route, truck and shift" icon={<BarChart3 className="h-5 w-5" />}
        actions={<Segmented value={range} onChange={setRange} options={[{ value: 'today', label: 'Mine day' }, { value: '24h', label: 'Last 24 h' }, { value: '7d', label: 'Last 7 days' }]} />} />
      <Tabs id="production" value={tab} onChange={setTab} items={[
        { value: 'overview', label: 'Overview', icon: <BarChart3 className="h-4 w-4" /> },
        { value: 'loaders', label: 'Loaders', icon: <Layers className="h-4 w-4" /> },
        { value: 'routes', label: 'Routes', icon: <RouteIcon className="h-4 w-4" /> },
        { value: 'trucks', label: 'Trucks', icon: <Truck className="h-4 w-4" /> },
        { value: 'shifts', label: 'Shifts & crews', icon: <Users className="h-4 w-4" /> },
        { value: 'cycle', label: 'Cycle analysis', icon: <Timer className="h-4 w-4" /> },
      ]} />
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data ? <Skeleton className="h-[480px]" /> : (
        <>
          {tab === 'overview' && <Overview d={q.data} hours={hours} p={p} range={range} />}
          {tab === 'loaders' && <Loaders d={q.data} hours={hours} p={p} />}
          {tab === 'routes' && <Routes d={q.data} p={p} />}
          {tab === 'trucks' && <Trucks d={q.data} />}
          {tab === 'shifts' && <Shifts d={q.data} p={p} />}
          {tab === 'cycle' && <Cycle d={q.data} p={p} />}
        </>
      )}
    </div>
  );
}

function Overview({ d, hours, p, range }: { d: ProdSummary; hours: number; p: Palette; range: string }) {
  const target = range === '7d' ? d.targetDaily * 7 : range === 'today' ? d.targetTph * hours : d.targetDaily;
  const achievement = target ? (d.totals.tonnes / target) * 100 : 0;
  const daily = d.bucketMs > 3_600_000;
  const option = useMemo(() => (pp: Palette) => ({
    legend: { data: ['Ore', 'Waste', 'Target'] },
    xAxis: { type: 'category', data: d.series.map((s) => (daily ? `${dateTime(s.ts).split(',')[0]} ${time(s.ts)}` : time(s.ts))), ...axis(pp) },
    yAxis: { type: 'value', ...axis(pp), axisLabel: { color: pp.muted, formatter: (v: number) => compact(v) } },
    series: [
      { name: 'Ore', type: 'bar', stack: 't', data: d.series.map((s) => s.ore), itemStyle: { color: pp.accent } },
      { name: 'Waste', type: 'bar', stack: 't', data: d.series.map((s) => s.waste), itemStyle: { color: pp.faint, borderRadius: [3, 3, 0, 0] } },
      { name: 'Target', type: 'line', symbol: 'none', data: d.series.map(() => Math.round(d.targetTph * (d.bucketMs / 3_600_000))), lineStyle: { color: pp.ok, type: 'dashed' } },
    ],
  }), [d, daily]);
  const loaderOpt = useMemo(() => (pp: Palette) => ({
    grid: { left: 8, right: 40, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', ...axis(pp), axisLabel: { color: pp.muted, formatter: (v: number) => compact(v) } },
    yAxis: { type: 'category', data: [...d.byLoader].reverse().map((l) => l.id), ...axis(pp) },
    series: [{ type: 'bar', data: [...d.byLoader].reverse().map((l) => Math.round(l.tonnes / hours)), barWidth: 14, itemStyle: { color: pp.cyan, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: pp.muted, formatter: '{c} t/h' } }],
  }), [d, hours]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="panel p-4"><Stat label="Tonnes moved" value={tonnes(d.totals.tonnes)} hint={`${num(achievement)}% of target`} tone={achievement >= 95 ? 'ok' : achievement > 80 ? 'warn' : 'crit'} /></div>
        <div className="panel p-4"><Stat label="Average TPH" value={compact(d.totals.tonnes / hours, 1)} unit="t/h" hint={`target ${compact(d.targetTph)} t/h`} /></div>
        <div className="panel p-4"><Stat label="Loads" value={num(d.totals.loads)} hint={`${num(d.totals.avgPasses, 1)} passes per load`} /></div>
        <div className="panel p-4"><Stat label="Ore / waste" value={`${num((d.totals.ore / Math.max(1, d.totals.tonnes)) * 100)}%`} hint={`${tonnes(d.totals.ore)} ore · ${tonnes(d.totals.waste)} waste`} /></div>
        <div className="panel p-4"><Stat label="Avg payload" value={num(d.totals.avgPayload, 1)} unit="t" /></div>
        <div className="panel p-4"><Stat label="Avg cycle" value={num(d.totals.avgCycleMin, 1)} unit="min" hint={`target ${d.targetCycleMin} min · queue ${num(d.totals.avgQueueMin, 1)}`} tone={d.totals.avgCycleMin <= d.targetCycleMin ? 'ok' : 'warn'} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={daily ? 'Tonnes per 6 hours' : 'Tonnes per hour'} subtitle="Delivered to crusher, ROM and dumps" className="xl:col-span-2"><EChart option={option} height={320} /></Card>
        <Card title="TPH by loading unit"><EChart option={loaderOpt} height={320} /></Card>
      </div>
      <Card title="Target vs actual by route">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {d.byRoute.map((r) => {
            const share = r.tonnes / Math.max(1, d.totals.tonnes);
            return (
              <div key={r.id}>
                <div className="mb-1 flex items-center justify-between text-sm"><span><span className="font-medium">{r.id}</span> <span className="text-muted">{r.name}</span></span>
                  <span className="tnum text-xs text-muted">{tonnes(r.tonnes)} · cycle {r.avgCycleMin} / {r.targetCycleMin} min</span></div>
                <Meter value={share * 100} max={Math.max(30, share * 100)} color={r.avgCycleMin <= r.targetCycleMin ? p.ok : p.warn} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Loaders({ d, hours, p }: { d: ProdSummary; hours: number; p: Palette }) {
  const cols: Col<ProdSummary['byLoader'][number]>[] = [
    { key: 'id', header: 'Loader', width: '150px', sort: (r) => r.id, cell: (r) => <div><p className="font-medium">{r.id}</p><p className="text-xs text-muted">{r.model}</p></div> },
    { key: 'tonnes', header: 'Tonnes', width: '110px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum">{num(r.tonnes)}</span> },
    { key: 'tph', header: 'TPH', width: '90px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum font-medium">{num(r.tonnes / hours)}</span> },
    { key: 'loads', header: 'Trucks loaded', width: '120px', align: 'right', sort: (r) => r.loads, cell: (r) => <span className="tnum">{num(r.loads)}</span> },
    { key: 'passes', header: 'Bucket passes', width: '120px', align: 'right', sort: (r) => r.passes, cell: (r) => <span className="tnum">{num(r.passes)}</span> },
    { key: 'pp', header: 'Passes / truck', width: '120px', align: 'right', sort: (r) => r.avgPasses, cell: (r) => <span className="tnum">{r.avgPasses}</span> },
    { key: 'lt', header: 'Load time', width: '100px', align: 'right', sort: (r) => r.avgLoadMin, cell: (r) => <span className="tnum">{r.avgLoadMin} min</span> },
    { key: 'q', header: 'Truck queue', width: '110px', align: 'right', sort: (r) => r.avgQueueMin, cell: (r) => <span className="tnum text-muted">{r.avgQueueMin} min</span> },
  ];
  const opt = (pp: Palette) => ({
    legend: { data: ['Trucks loaded', 'Bucket passes'] },
    xAxis: { type: 'category', data: d.byLoader.map((l) => l.id), ...axis(pp) },
    yAxis: [{ type: 'value', ...axis(pp) }, { type: 'value', ...axis(pp), splitLine: { show: false } }],
    series: [
      { name: 'Trucks loaded', type: 'bar', data: d.byLoader.map((l) => l.loads), itemStyle: { color: pp.accent, borderRadius: [4, 4, 0, 0] }, barWidth: 18 },
      { name: 'Bucket passes', type: 'line', yAxisIndex: 1, data: d.byLoader.map((l) => l.passes), itemStyle: { color: pp.cyan } },
    ],
  });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Truck loads and bucket passes per loader"><EChart option={opt} height={280} key={p.bg} /></Card>
      <Card flush title="Loading units" actions={<ExportBtn name="loaders" rows={d.byLoader} />}><DataTable columns={cols} rows={d.byLoader} rowKey={(r) => r.id} initialSort={{ key: 'tonnes', dir: 'desc' }} /></Card>
    </div>
  );
}

function Routes({ d, p }: { d: ProdSummary; p: Palette }) {
  const parts = ['queue', 'spot', 'load', 'haul', 'dump', 'return'] as const;
  const colors = [p.crit, p.violet, p.cyan, p.accent, p.blue, p.ok];
  const opt = (pp: Palette) => ({
    legend: { data: parts.map((x) => x[0].toUpperCase() + x.slice(1)) },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', ...axis(pp), axisLabel: { color: pp.muted, formatter: '{value} min' } },
    yAxis: { type: 'category', data: d.byRoute.map((r) => r.id), ...axis(pp) },
    series: [
      ...parts.map((k, i) => ({ name: k[0].toUpperCase() + k.slice(1), type: 'bar', stack: 'c', data: d.byRoute.map((r) => r.breakdown[k]), itemStyle: { color: colors[i] }, barWidth: 16 })),
      { name: 'Target', type: 'scatter', data: d.byRoute.map((r) => r.targetCycleMin), symbol: 'diamond', symbolSize: 12, itemStyle: { color: pp.fg } },
    ],
  });
  const cols: Col<ProdSummary['byRoute'][number]>[] = [
    { key: 'id', header: 'Route', width: 'minmax(220px,2fr)', sort: (r) => r.id, cell: (r) => <div><p className="font-medium">{r.id}</p><p className="text-xs text-muted">{r.name}</p></div> },
    { key: 'km', header: 'Distance', width: '90px', align: 'right', sort: (r) => r.distanceKm, cell: (r) => <span className="tnum">{r.distanceKm} km</span> },
    { key: 't', header: 'Tonnes', width: '100px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum">{num(r.tonnes)}</span> },
    { key: 'l', header: 'Loads', width: '80px', align: 'right', sort: (r) => r.loads, cell: (r) => <span className="tnum">{r.loads}</span> },
    { key: 'c', header: 'Cycle vs target', width: '170px', align: 'right', sort: (r) => r.avgCycleMin - r.targetCycleMin, cell: (r) => (
      <span className="tnum">{r.avgCycleMin} / {r.targetCycleMin} min <Badge tone={r.avgCycleMin <= r.targetCycleMin ? 'ok' : 'warn'}>{r.avgCycleMin <= r.targetCycleMin ? 'on target' : `+${(r.avgCycleMin - r.targetCycleMin).toFixed(1)}`}</Badge></span>
    ) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Cycle-time breakdown by route" subtitle="Average minutes per stage, diamond = target cycle"><EChart option={opt} height={Math.max(240, d.byRoute.length * 46)} /></Card>
      <Card flush title="Haul routes" actions={<ExportBtn name="routes" rows={d.byRoute} />}><DataTable columns={cols} rows={d.byRoute} rowKey={(r) => r.id} /></Card>
    </div>
  );
}

function Trucks({ d }: { d: ProdSummary }) {
  const cols: Col<ProdSummary['byTruck'][number]>[] = [
    { key: 'id', header: 'Truck', width: '150px', sort: (r) => r.id, cell: (r) => <div><p className="font-medium">{r.id}</p><p className="text-xs text-muted">{r.model}</p></div> },
    { key: 't', header: 'Tonnes', width: '110px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum">{num(r.tonnes)}</span> },
    { key: 'l', header: 'Loads', width: '80px', align: 'right', sort: (r) => r.loads, cell: (r) => <span className="tnum">{r.loads}</span> },
    { key: 'p', header: 'Avg payload', width: '120px', align: 'right', sort: (r) => r.avgPayload, cell: (r) => <span className="tnum">{r.avgPayload} t</span> },
    { key: 'pp', header: 'Payload vs rated', width: '160px', sort: (r) => r.payloadPct, cell: (r) => (
      <div className="flex items-center gap-2"><Meter value={r.payloadPct} max={120} warnAt={100} className="w-20" color={r.payloadPct > 105 ? 'var(--warn)' : r.payloadPct < 90 ? 'var(--info)' : 'var(--ok)'} /><span className="tnum text-xs">{r.payloadPct}%</span></div>
    ) },
    { key: 'c', header: 'Avg cycle', width: '100px', align: 'right', sort: (r) => r.avgCycleMin, cell: (r) => <span className="tnum">{r.avgCycleMin} min</span> },
    { key: 'km', header: 'Distance', width: '100px', align: 'right', sort: (r) => r.km, cell: (r) => <span className="tnum text-muted">{num(r.km)} km</span> },
  ];
  return <Card flush title="Haul truck performance" actions={<ExportBtn name="trucks" rows={d.byTruck} />}><DataTable columns={cols} rows={d.byTruck} rowKey={(r) => r.id} initialSort={{ key: 't', dir: 'desc' }} height="calc(100vh - 330px)" /></Card>;
}

function Shifts({ d, p }: { d: ProdSummary; p: Palette }) {
  const days = [...new Set(d.byShift.map((s) => s.day))];
  const opt = (pp: Palette) => ({
    legend: { data: ['A', 'B', 'C'].map((s) => `Shift ${s}`) },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: days.map(dayLabel), ...axis(pp) },
    yAxis: { type: 'value', ...axis(pp), axisLabel: { color: pp.muted, formatter: (v: number) => compact(v) } },
    series: ['A', 'B', 'C'].map((s, i) => ({
      name: `Shift ${s}`, type: 'bar', data: days.map((dd) => d.byShift.find((x) => x.day === dd && x.shift === s)?.tonnes ?? 0),
      itemStyle: { color: [pp.accent, pp.cyan, pp.violet][i], borderRadius: [3, 3, 0, 0] },
      markLine: i === 0 ? { symbol: 'none', data: [{ yAxis: Math.round(d.targetDaily / 3) }], lineStyle: { color: pp.ok, type: 'dashed' }, label: { formatter: 'shift target', color: pp.muted } } : undefined,
    })),
  });
  const cols: Col<ProdSummary['topOperators'][number]>[] = [
    { key: 'n', header: 'Operator', width: 'minmax(180px,2fr)', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 't', header: 'Tonnes', width: '110px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum">{num(r.tonnes)}</span> },
    { key: 'l', header: 'Loads', width: '90px', align: 'right', sort: (r) => r.loads, cell: (r) => <span className="tnum">{r.loads}</span> },
    { key: 'c', header: 'Avg cycle', width: '100px', align: 'right', sort: (r) => r.avgCycleMin, cell: (r) => <span className="tnum">{r.avgCycleMin} min</span> },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Tonnes by shift" subtitle="Per mine day" className="xl:col-span-2"><EChart option={opt} height={340} key={p.bg} /></Card>
      <Card flush title="Top truck operators" subtitle="By tonnes hauled" actions={<ExportBtn name="operators" rows={d.topOperators} />}><DataTable columns={cols} rows={d.topOperators} rowKey={(r) => r.id} /></Card>
    </div>
  );
}

function Cycle({ d, p }: { d: ProdSummary; p: Palette }) {
  const hist = (pp: Palette) => ({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: d.histogram.map((h) => `${h.fromMin}-${h.fromMin + 3}`), name: 'minutes', nameLocation: 'middle', nameGap: 26, ...axis(pp) },
    yAxis: { type: 'value', name: 'loads', ...axis(pp) },
    series: [{ type: 'bar', data: d.histogram.map((h) => ({ value: h.count, itemStyle: { color: h.fromMin + 3 <= d.targetCycleMin ? pp.ok : h.fromMin < d.targetCycleMin * 1.3 ? pp.warn : pp.crit, borderRadius: [3, 3, 0, 0] } })), barWidth: '70%' }],
  });
  const passes = (pp: Palette) => ({
    tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['50%', '78%'], padAngle: 2, itemStyle: { borderRadius: 4 }, label: { color: pp.muted, formatter: '{b} passes\n{d}%' },
      data: d.passes.map((x, i) => ({ name: String(x.passes), value: x.count, itemStyle: { color: pp.series[i % pp.series.length] } })) }],
  });
  const bands = (pp: Palette) => ({
    xAxis: { type: 'category', data: d.payloadBands.map((b) => b.band), ...axis(pp) },
    yAxis: { type: 'value', ...axis(pp) },
    series: [{ type: 'bar', data: d.payloadBands.map((b, i) => ({ value: b.count, itemStyle: { color: [pp.info, pp.ok, pp.ok, pp.warn, pp.crit][i], borderRadius: [3, 3, 0, 0] } })), barWidth: '55%' }],
  });
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Cycle time distribution" subtitle={`Green = at or under the ${d.targetCycleMin} min target`} className="xl:col-span-2"><EChart option={hist} height={300} key={p.bg} /></Card>
      <Card title="Bucket passes per load"><EChart option={passes} height={300} /></Card>
      <Card title="Payload vs rated capacity" subtitle="Overloads above 110 % raise an alert" className="xl:col-span-2"><EChart option={bands} height={260} /></Card>
      <Card title="Cycle summary">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Average cycle" value={num(d.totals.avgCycleMin, 1)} unit="min" />
          <Stat label="Average queue" value={num(d.totals.avgQueueMin, 1)} unit="min" tone={d.totals.avgQueueMin > 2 ? 'warn' : 'ok'} />
          <Stat label="Passes / load" value={num(d.totals.avgPasses, 1)} />
          <Stat label="Haul distance" value={num(d.totals.distanceKm)} unit="km" />
        </div>
      </Card>
    </div>
  );
}

function ExportBtn<T extends object>({ name, rows }: { name: string; rows: T[] }) {
  return (
    <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => {
      const keys = rows.length ? Object.keys(rows[0]).filter((k) => typeof (rows[0] as Record<string, unknown>)[k] !== 'object') : [];
      exportCsv(name, keys.map((k) => ({ key: k, label: k, value: (r: T) => (r as Record<string, string | number>)[k] })), rows);
    }}>CSV</Button>
  );
}
