import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, CalendarRange, Clock, Download, FileBarChart, FileText, Printer } from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { qs } from '../lib/api';
import { useBoot } from '../lib/app-store';
import { useLive } from '../lib/live';
import { compact, dateTime, dayLabel, num, time, titleCase, tonnes } from '../lib/format';
import { exportCsv, exportPdf, type PdfSection } from '../lib/export';
import { addDays, mineDayOf } from '../../shared/time';
import { TYPE_LABEL, type MachineType, type ShiftCode } from '../../shared/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton, Stat } from '../components/ui/core';
import { Input, Segmented } from '../components/ui/form';
import { Menu, MenuItem, MenuLabel } from '../components/ui/overlay';
import { DataTable, type Col } from '../components/ui/table';
import { EChart, axis, type EChartHandle } from '../components/charts/EChart';
import type { Palette } from '../lib/palette';

interface Report {
  kind: 'shift' | 'daily' | 'weekly'; days: string[]; shifts: ShiftCode[]; from: number; to: number; generatedAt: number;
  totals: { tonnes: number; loads: number; ore: number; waste: number; avgPayload: number; avgCycleMin: number; avgQueueMin: number; avgPasses: number; target: number; achievement: number;
    availability: number; utilisation: number; fuelL: number; lPerTonne: number; alerts: number; criticalAlerts: number; breakdowns: number; downtimeH: number };
  targets: { dailyTonnes: number; availability: number; utilisation: number; fuelLPerTonne: number; cycleMin: number };
  hourly: { ts: number; tonnes: number; ore: number; waste: number }[];
  daily: { day: string; tonnes: number; loads: number; fuelL: number; availability: number; utilisation: number; alerts: number; target: number }[];
  byLoader: { id: string; model: string; tonnes: number; loads: number; passes: number; avgLoadMin: number }[];
  byTruck: { id: string; model: string; tonnes: number; loads: number; avgCycleMin: number; avgPayload: number; payloadPct: number }[];
  byRoute: { id: string; name: string; tonnes: number; loads: number; avgCycleMin: number; targetCycleMin: number }[];
  byShift: { day: string; shift: string; tonnes: number; loads: number }[];
  topOperators: { name: string; tonnes: number; loads: number; avgCycleMin: number }[];
  machines: { id: string; type: MachineType; model: string; operatingH: number; idleH: number; downH: number; maintH: number; availability: number; utilisation: number; fuelL: number; km: number }[];
  byType: { type: MachineType; count: number; availability: number; utilisation: number; operatingH: number }[];
  downtime: { category: string; hours: number; count: number }[];
  alerts: { type: string; title: string; count: number; critical: number }[];
}

export default function Reports() {
  const boot = useBoot();
  const t = useLive((s) => s.t);
  const a = boot.settings.shifts.aStartHour;
  const today = mineDayOf(t, a);
  const [kind, setKind] = useTabParam(['shift', 'daily', 'weekly'] as const, 'daily');
  const [day, setDay] = useState(kind === 'daily' ? addDays(today, -1) : today);
  const [shift, setShift] = useState<ShiftCode>('A');
  const q = useQuery<Report>(`/reports/${kind}${qs({ day, shift: kind === 'shift' ? shift : undefined })}`);
  const charts = useRef<Record<string, EChartHandle | null>>({});
  const [busy, setBusy] = useState(false);
  const r = q.data;
  const names = boot.settings.shifts.names;
  const title = kind === 'shift' ? `Shift ${shift} (${names[shift]}) report` : kind === 'daily' ? 'Daily production report' : 'Weekly production report';
  const period = r ? (kind === 'weekly' ? `${dayLabel(r.days[0])} – ${dayLabel(r.days[r.days.length - 1])}` : `${dayLabel(day)}${kind === 'shift' ? ` · ${time(r.from)}–${time(r.to)}` : ''}`) : '';
  const fileBase = `strata-${kind}-${day}${kind === 'shift' ? `-${shift}` : ''}`;

  const pdf = async () => {
    if (!r) return;
    setBusy(true);
    try {
      const sections: PdfSection[] = [
        { title: 'Summary', kpis: [
          { label: 'Tonnes moved', value: tonnes(r.totals.tonnes) }, { label: 'Target achieved', value: `${r.totals.achievement}%` },
          { label: 'Loads', value: num(r.totals.loads) }, { label: 'Avg cycle', value: `${r.totals.avgCycleMin} min` },
          { label: 'Availability', value: `${r.totals.availability}%` }, { label: 'Utilisation', value: `${r.totals.utilisation}%` },
          { label: 'Fuel used', value: `${compact(r.totals.fuelL)} L` }, { label: 'Fuel / tonne', value: `${r.totals.lPerTonne} L/t` },
          { label: 'Alerts', value: `${r.totals.alerts} (${r.totals.criticalAlerts} critical)` }, { label: 'Breakdowns', value: String(r.totals.breakdowns) },
          { label: 'Downtime', value: `${r.totals.downtimeH} h` }, { label: 'Ore / waste', value: `${compact(r.totals.ore)} / ${compact(r.totals.waste)} t` },
        ] },
        { title: kind === 'weekly' ? 'Daily production' : 'Hourly production', image: charts.current.prod?.image() ?? undefined },
        { title: 'Loading units', table: { head: ['Loader', 'Model', 'Tonnes', 'Trucks', 'Passes', 'Load min'], body: r.byLoader.map((x) => [x.id, x.model, num(x.tonnes), x.loads, x.passes, x.avgLoadMin]) } },
        { title: 'Haul trucks', table: { head: ['Truck', 'Model', 'Tonnes', 'Loads', 'Avg payload', 'Payload %', 'Cycle min'], body: r.byTruck.map((x) => [x.id, x.model, num(x.tonnes), x.loads, x.avgPayload, `${x.payloadPct}%`, x.avgCycleMin]) } },
        { title: 'Routes', table: { head: ['Route', 'Name', 'Tonnes', 'Loads', 'Cycle', 'Target'], body: r.byRoute.map((x) => [x.id, x.name, num(x.tonnes), x.loads, x.avgCycleMin, x.targetCycleMin]) } },
        { title: 'Equipment utilisation', image: charts.current.util?.image() ?? undefined, table: { head: ['Machine', 'Type', 'Operating h', 'Idle h', 'Down h', 'Avail %', 'Util %', 'Fuel L'], body: r.machines.map((x) => [x.id, TYPE_LABEL[x.type], x.operatingH, x.idleH, x.downH + x.maintH, x.availability, x.utilisation, num(x.fuelL)]) } },
        { title: 'Downtime', table: { head: ['Reason', 'Hours', 'Events'], body: r.downtime.map((x) => [x.category, x.hours, x.count]) } },
        { title: 'Alerts', table: { head: ['Alert', 'Count', 'Critical'], body: r.alerts.map((x) => [x.title, x.count, x.critical]) } },
        { title: 'Top operators', table: { head: ['Operator', 'Tonnes', 'Loads', 'Avg cycle'], body: r.topOperators.map((x) => [x.name, num(x.tonnes), x.loads, x.avgCycleMin]) } },
      ];
      await exportPdf(fileBase, title, `${boot.settings.site.name} · ${period}`, sections);
      toast.success('PDF report downloaded');
    } catch (err) {
      toast.error('Could not create the PDF', { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const csv = (section: string) => {
    if (!r) return;
    const map: Record<string, () => void> = {
      trucks: () => exportCsv(`${fileBase}-trucks`, [{ key: 'id', label: 'Truck', value: (x: Report['byTruck'][number]) => x.id }, { key: 'm', label: 'Model', value: (x) => x.model }, { key: 't', label: 'Tonnes', value: (x) => x.tonnes }, { key: 'l', label: 'Loads', value: (x) => x.loads }, { key: 'p', label: 'Avg payload t', value: (x) => x.avgPayload }, { key: 'pp', label: 'Payload %', value: (x) => x.payloadPct }, { key: 'c', label: 'Avg cycle min', value: (x) => x.avgCycleMin }], r.byTruck),
      loaders: () => exportCsv(`${fileBase}-loaders`, [{ key: 'id', label: 'Loader', value: (x: Report['byLoader'][number]) => x.id }, { key: 'm', label: 'Model', value: (x) => x.model }, { key: 't', label: 'Tonnes', value: (x) => x.tonnes }, { key: 'l', label: 'Trucks loaded', value: (x) => x.loads }, { key: 'p', label: 'Passes', value: (x) => x.passes }, { key: 'lm', label: 'Avg load min', value: (x) => x.avgLoadMin }], r.byLoader),
      machines: () => exportCsv(`${fileBase}-utilisation`, [{ key: 'id', label: 'Machine', value: (x: Report['machines'][number]) => x.id }, { key: 'ty', label: 'Type', value: (x) => TYPE_LABEL[x.type] }, { key: 'o', label: 'Operating h', value: (x) => x.operatingH }, { key: 'i', label: 'Idle h', value: (x) => x.idleH }, { key: 'd', label: 'Down h', value: (x) => x.downH }, { key: 'mt', label: 'Maintenance h', value: (x) => x.maintH }, { key: 'a', label: 'Availability %', value: (x) => x.availability }, { key: 'u', label: 'Utilisation %', value: (x) => x.utilisation }, { key: 'f', label: 'Fuel L', value: (x) => x.fuelL }], r.machines),
      downtime: () => exportCsv(`${fileBase}-downtime`, [{ key: 'c', label: 'Reason', value: (x: Report['downtime'][number]) => x.category }, { key: 'h', label: 'Hours', value: (x) => x.hours }, { key: 'n', label: 'Events', value: (x) => x.count }], r.downtime),
      production: () => kind === 'weekly'
        ? exportCsv(`${fileBase}-daily`, [{ key: 'd', label: 'Day', value: (x: Report['daily'][number]) => x.day }, { key: 't', label: 'Tonnes', value: (x) => x.tonnes }, { key: 'l', label: 'Loads', value: (x) => x.loads }, { key: 'f', label: 'Fuel L', value: (x) => x.fuelL }, { key: 'a', label: 'Availability %', value: (x) => x.availability }, { key: 'u', label: 'Utilisation %', value: (x) => x.utilisation }, { key: 'al', label: 'Alerts', value: (x) => x.alerts }], r.daily)
        : exportCsv(`${fileBase}-hourly`, [{ key: 'ts', label: 'Hour', value: (x: Report['hourly'][number]) => dateTime(x.ts) }, { key: 't', label: 'Tonnes', value: (x) => x.tonnes }, { key: 'o', label: 'Ore', value: (x) => x.ore }, { key: 'w', label: 'Waste', value: (x) => x.waste }], r.hourly),
    };
    map[section]();
  };

  const prodOpt = useMemo(() => r && ((p: Palette) => kind === 'weekly' ? {
    legend: { data: ['Tonnes', 'Target'] },
    xAxis: { type: 'category', data: r.daily.map((d) => dayLabel(d.day)), ...axis(p) },
    yAxis: { type: 'value', ...axis(p), axisLabel: { color: p.muted, formatter: (v: number) => compact(v) } },
    series: [
      { name: 'Tonnes', type: 'bar', data: r.daily.map((d) => ({ value: d.tonnes, itemStyle: { color: d.tonnes >= d.target ? p.ok : p.accent, borderRadius: [4, 4, 0, 0] } })), barWidth: '50%' },
      { name: 'Target', type: 'line', symbol: 'none', data: r.daily.map((d) => d.target), lineStyle: { color: p.fg, type: 'dashed' } },
    ],
  } : {
    legend: { data: ['Ore', 'Waste', 'Target'] },
    xAxis: { type: 'category', data: r.hourly.map((h) => time(h.ts)), ...axis(p) },
    yAxis: { type: 'value', ...axis(p), axisLabel: { color: p.muted, formatter: (v: number) => compact(v) } },
    series: [
      { name: 'Ore', type: 'bar', stack: 't', data: r.hourly.map((h) => h.ore), itemStyle: { color: p.accent } },
      { name: 'Waste', type: 'bar', stack: 't', data: r.hourly.map((h) => h.waste), itemStyle: { color: p.faint, borderRadius: [3, 3, 0, 0] } },
      { name: 'Target', type: 'line', symbol: 'none', data: r.hourly.map(() => Math.round(r.targets.dailyTonnes / 24)), lineStyle: { color: p.ok, type: 'dashed' } },
    ],
  }), [r, kind]);
  const utilOpt = useMemo(() => r && ((p: Palette) => ({
    legend: { data: ['Availability', 'Utilisation'] },
    xAxis: { type: 'category', data: r.byType.map((x) => TYPE_LABEL[x.type]), ...axis(p) },
    yAxis: { type: 'value', max: 100, ...axis(p), axisLabel: { color: p.muted, formatter: '{value}%' } },
    series: [
      { name: 'Availability', type: 'bar', data: r.byType.map((x) => x.availability), itemStyle: { color: p.ok, borderRadius: [3, 3, 0, 0] }, markLine: { symbol: 'none', data: [{ yAxis: r.targets.availability }], lineStyle: { color: p.ok, type: 'dashed' }, label: { show: false } } },
      { name: 'Utilisation', type: 'bar', data: r.byType.map((x) => x.utilisation), itemStyle: { color: p.blue, borderRadius: [3, 3, 0, 0] } },
    ],
  })), [r]);

  const machineCols: Col<Report['machines'][number]>[] = [
    { key: 'id', header: 'Machine', width: '130px', sort: (x) => x.id, cell: (x) => <div><p className="font-medium">{x.id}</p><p className="text-xs text-muted">{TYPE_LABEL[x.type]}</p></div> },
    { key: 'o', header: 'Operating', width: '100px', align: 'right', sort: (x) => x.operatingH, cell: (x) => <span className="tnum">{x.operatingH} h</span> },
    { key: 'i', header: 'Idle', width: '80px', align: 'right', sort: (x) => x.idleH, cell: (x) => <span className="tnum text-muted">{x.idleH} h</span> },
    { key: 'd', header: 'Down', width: '80px', align: 'right', sort: (x) => x.downH + x.maintH, cell: (x) => <span className={x.downH > 0 ? 'tnum text-crit' : 'tnum text-muted'}>{num(x.downH + x.maintH, 1)} h</span> },
    { key: 'a', header: 'Availability', width: '110px', align: 'right', sort: (x) => x.availability, cell: (x) => <span className="tnum">{x.availability}%</span> },
    { key: 'u', header: 'Utilisation', width: '110px', align: 'right', sort: (x) => x.utilisation, cell: (x) => <span className="tnum">{x.utilisation}%</span> },
    { key: 'f', header: 'Fuel', width: '100px', align: 'right', sort: (x) => x.fuelL, cell: (x) => <span className="tnum text-muted">{num(x.fuelL)} L</span> },
  ];
  const truckCols: Col<Report['byTruck'][number]>[] = [
    { key: 'id', header: 'Truck', width: '120px', sort: (x) => x.id, cell: (x) => <span className="font-medium">{x.id}</span> },
    { key: 't', header: 'Tonnes', width: '100px', align: 'right', sort: (x) => x.tonnes, cell: (x) => <span className="tnum">{num(x.tonnes)}</span> },
    { key: 'l', header: 'Loads', width: '70px', align: 'right', sort: (x) => x.loads, cell: (x) => x.loads },
    { key: 'p', header: 'Payload', width: '100px', align: 'right', sort: (x) => x.payloadPct, cell: (x) => <span className="tnum">{x.payloadPct}%</span> },
    { key: 'c', header: 'Cycle', width: '90px', align: 'right', sort: (x) => x.avgCycleMin, cell: (x) => <span className="tnum">{x.avgCycleMin} min</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports & analytics" subtitle="Generate shift, daily and weekly reports — export to CSV or PDF" icon={<FileBarChart className="h-5 w-5" />}
        actions={<>
          <Menu trigger={<Button icon={<Download className="h-4 w-4" />} disabled={!r}>CSV</Button>}>
            <MenuLabel>Export section</MenuLabel>
            <MenuItem onSelect={() => csv('production')}>{kind === 'weekly' ? 'Daily production' : 'Hourly production'}</MenuItem>
            <MenuItem onSelect={() => csv('trucks')}>Haul trucks</MenuItem>
            <MenuItem onSelect={() => csv('loaders')}>Loading units</MenuItem>
            <MenuItem onSelect={() => csv('machines')}>Equipment utilisation</MenuItem>
            <MenuItem onSelect={() => csv('downtime')}>Downtime</MenuItem>
          </Menu>
          <Button variant="primary" icon={<FileText className="h-4 w-4" />} loading={busy} disabled={!r} onClick={pdf}>PDF report</Button>
          <Button variant="ghost" size="icon" aria-label="Print" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </>} />
      <Tabs id="reports" value={kind} onChange={(k) => { setKind(k); if (k === 'daily' && day === today) setDay(addDays(today, -1)); }} items={[
        { value: 'shift', label: 'Shift report', icon: <Clock className="h-4 w-4" /> },
        { value: 'daily', label: 'Daily report', icon: <CalendarDays className="h-4 w-4" /> },
        { value: 'weekly', label: 'Weekly report', icon: <CalendarRange className="h-4 w-4" /> },
      ]} />
      <div data-noprint className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">{kind === 'weekly' ? 'Week ending' : 'Mine day'}
          <Input type="date" value={day} max={today} min={addDays(today, -boot.sim.historyDays)} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" />
        </label>
        {kind === 'shift' && <Segmented value={shift} onChange={setShift} options={(['A', 'B', 'C'] as ShiftCode[]).map((s) => ({ value: s, label: `${s} · ${names[s]}` }))} />}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, kind === 'weekly' ? -7 : -1))}>← Previous</Button>
          <Button size="sm" variant="ghost" disabled={day >= today} onClick={() => setDay(addDays(day, kind === 'weekly' ? 7 : 1) > today ? today : addDays(day, kind === 'weekly' ? 7 : 1))}>Next →</Button>
        </div>
      </div>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !r ? <Skeleton className="h-[600px]" /> : (
        <>
          <div className="panel hairline-top p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-display text-lg font-semibold">{title}</p>
                <p className="text-sm text-muted">{boot.settings.site.name} · {period}</p>
              </div>
              <Badge tone={r.totals.achievement >= 100 ? 'ok' : r.totals.achievement >= 85 ? 'warn' : 'crit'}>{r.totals.achievement}% of {tonnes(r.totals.target)} target</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="Tonnes" value={tonnes(r.totals.tonnes)} />
              <Stat label="Loads" value={num(r.totals.loads)} />
              <Stat label="Avg cycle" value={r.totals.avgCycleMin} unit="min" tone={r.totals.avgCycleMin <= r.targets.cycleMin ? 'ok' : 'warn'} />
              <Stat label="Availability" value={r.totals.availability} unit="%" tone={r.totals.availability >= r.targets.availability ? 'ok' : 'warn'} />
              <Stat label="Utilisation" value={r.totals.utilisation} unit="%" />
              <Stat label="Fuel" value={compact(r.totals.fuelL)} unit="L" hint={`${r.totals.lPerTonne} L/t`} />
              <Stat label="Alerts" value={r.totals.alerts} hint={`${r.totals.criticalAlerts} critical`} />
              <Stat label="Downtime" value={r.totals.downtimeH} unit="h" hint={`${r.totals.breakdowns} breakdowns`} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={kind === 'weekly' ? 'Tonnes per day' : 'Tonnes per hour'}>{prodOpt && <EChart ref={(h) => { charts.current.prod = h; }} option={prodOpt} height={300} />}</Card>
            <Card title="Availability and utilisation by equipment type">{utilOpt && <EChart ref={(h) => { charts.current.util = h; }} option={utilOpt} height={300} />}</Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card flush title="Haul trucks" className="xl:col-span-1"><DataTable columns={truckCols} rows={r.byTruck} rowKey={(x) => x.id} height={360} initialSort={{ key: 't', dir: 'desc' }} /></Card>
            <Card flush title="Equipment utilisation" className="xl:col-span-2"><DataTable columns={machineCols} rows={r.machines} rowKey={(x) => x.id} height={360} /></Card>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Downtime by reason">
              {r.downtime.length ? r.downtime.map((d) => (
                <div key={d.category} className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0"><span>{d.category}</span><span className="tnum text-muted">{d.hours} h · {d.count}</span></div>
              )) : <p className="text-sm text-muted">No downtime recorded.</p>}
            </Card>
            <Card title="Alerts by type">
              {r.alerts.length ? r.alerts.map((d) => (
                <div key={d.type} className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0"><span>{d.title || titleCase(d.type)}</span><span className="tnum text-muted">{d.count}{d.critical ? <span className="text-crit"> · {d.critical} crit</span> : null}</span></div>
              )) : <p className="text-sm text-muted">No alerts.</p>}
            </Card>
            <Card title="Top operators">
              {r.topOperators.map((o, i) => (
                <div key={o.name} className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0"><span><span className="mr-2 text-faint">{i + 1}.</span>{o.name}</span><span className="tnum text-muted">{tonnes(o.tonnes)} · {o.loads} loads</span></div>
              ))}
            </Card>
          </div>
          <p className="text-xs text-faint">Generated {dateTime(r.generatedAt, true)} from simulated operating data.</p>
        </>
      )}
    </div>
  );
}
