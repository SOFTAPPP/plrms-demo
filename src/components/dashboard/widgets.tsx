import { memo, useEffect, useMemo, useState } from 'react';
import { useUnits } from '../../lib/units';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowUpRight, Clock, Fuel, Gauge, Layers3, Timer, TrendingUp, Truck } from 'lucide-react';
import { history, useKpi, useLive } from '../../lib/live';
import { useApp, useBoot } from '../../lib/app-store';
import { useQuery } from '../../lib/hooks';
import { usePalette } from '../../lib/palette';
import { ago, compact, num, pct, time, tonnes } from '../../lib/format';
import { qs } from '../../lib/api';
import { STATUS_LABEL, type MachineStatus } from '../../../shared/types';
import { Badge, Card, cn, EmptyState, SEVERITY_TONE, Skeleton, StatusPill } from '../ui/core';
import { Meter, Ring, Sparkline } from '../ui/viz';
import { EChart, axis } from '../charts/EChart';
import { SiteMap } from '../map/SiteMap';
import { CameraTile } from '../camera/CameraTile';
import { TYPE_ICON } from '../machine/glyphs';

// ---------------------------------------------------------------- KPI strip

function KpiTile({ label, value, unit, sub, spark, color, icon: Icon, to }: {
  label: string; value: string; unit?: string; sub?: React.ReactNode; spark?: number[]; color?: string; icon: typeof Gauge; to?: string;
}) {
  const body = (
    <div className="panel hairline-top group relative flex h-full min-w-0 flex-col overflow-hidden p-3.5 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <Icon className="h-4 w-4 text-faint transition-colors group-hover:text-accent" />
      </div>
      <p className="tnum mt-1.5 truncate font-display text-2xl font-semibold tracking-tight">
        {value}{unit && <span className="ml-1 text-sm font-medium text-muted">{unit}</span>}
      </p>
      <div className="mt-0.5 min-h-4 truncate text-xs text-muted">{sub}</div>
      {spark && <Sparkline values={spark} color={color} height={28} className="mt-2 -mb-1" />}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

export const KpiStrip = memo(function KpiStrip() {
  const k = useKpi();
  const U = useUnits();
  const tg = useApp((s) => s.boot?.settings.kpiTargets);
  useLive((s) => s.frameNo);
  const p = usePalette();
  if (!k) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  const dayPct = (k.tonnesDay / k.targetDay) * 100;
  const tphPct = (k.tph / k.targetTph) * 100;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <KpiTile label="Throughput" value={compact(k.tph, 1)} unit="t/h" icon={TrendingUp} to="/production" color={p.accent} spark={history('kpi:tph')}
        sub={<span className={tphPct >= 95 ? 'text-ok' : tphPct >= 80 ? 'text-warn' : 'text-crit'}>{num(tphPct)}% of {compact(k.targetTph)} t/h target</span>} />
      <KpiTile label="Moved today" value={tonnes(k.tonnesDay)} icon={Layers3} to="/production"
        sub={<span>{num(k.loadsDay)} loads · {num(dayPct)}% of day target</span>} color={p.cyan} spark={history('kpi:tonnesDay')} />
      <KpiTile label="Availability" value={num(k.availability, 1)} unit="%" icon={Activity} to="/fleet"
        sub={<span><span className={tg && k.availability < tg.availability ? 'text-warn' : 'text-ok'}>target {tg?.availability}%</span> · {k.statusCounts.breakdown} down · {k.statusCounts.maintenance} in bay</span>} color={p.ok} spark={history('kpi:availability')} />
      <KpiTile label="Utilisation" value={num(k.utilisation, 1)} unit="%" icon={Gauge} to="/fleet"
        sub={<span><span className={tg && k.utilisation < tg.utilisation ? 'text-warn' : 'text-ok'}>target {tg?.utilisation}%</span> · {k.statusCounts.running + k.statusCounts.loading + k.statusCounts.hauling} working</span>} color={p.blue} spark={history('kpi:utilisation')} />
      <KpiTile label="Fuel burn" value={U.flowParts(k.fuelBurnLph)[0]} unit={U.flowParts(k.fuelBurnLph)[1]} icon={Fuel} to="/fuel"
        sub={`${U.volume(k.fuelDayL)} used today`} color={p.violet} spark={history('kpi:fuelBurnLph')} />
      <KpiTile label="Avg cycle" value={num(k.avgCycleMin, 1)} unit="min" icon={Timer} to="/production?tab=cycle"
        sub={<span><span className={tg && k.avgCycleMin > tg.cycleMin ? 'text-warn' : 'text-ok'}>target {tg?.cycleMin} min</span> · <span className={tg && k.avgQueueMin > tg.maxQueueMin ? 'text-crit' : ''}>queue {num(k.avgQueueMin, 1)}/{tg?.maxQueueMin} min</span></span>} color={p.cyan} spark={history('kpi:avgCycleMin')} />
      <KpiTile label="Active alerts" value={String(k.activeAlerts)} icon={AlertTriangle} to="/alerts"
        sub={k.criticalAlerts ? <span className="text-crit">{k.criticalAlerts} critical</span> : 'No critical alerts'} color={k.criticalAlerts ? p.crit : p.warn} spark={history('kpi:activeAlerts')} />
    </div>
  );
});

// ---------------------------------------------------------------- map

export function MapWidget() {
  const navigate = useNavigate();
  return (
    <Card title="Live site map" subtitle="Machines update twice a second" flush className="h-full" bodyClassName="min-h-[440px] flex-1 flex flex-col"
      actions={<button type="button" onClick={() => navigate('/map')} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">Full map <ArrowUpRight className="h-3.5 w-3.5" /></button>}>
      <SiteMap compact className="flex-1 rounded-b-[14px]" />
    </Card>
  );
}

// ---------------------------------------------------------------- production trend

interface Summary { series: { ts: number; tonnes: number; ore: number; waste: number }[]; targetTph: number }

export function ProductionWidget() {
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const from = Math.floor((t - 24 * 3_600_000) / 3_600_000) * 3_600_000;
  const q = useQuery<Summary>(`/production/summary${qs({ from, to: t + 3_600_000 })}`, { refreshMs: 60_000 });
  const option = useMemo(() => (p: ReturnType<typeof usePalette>) => ({
    grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
    legend: { data: ['Ore', 'Waste', 'Target'] },
    xAxis: { type: 'category', data: q.data?.series.map((s) => time(s.ts)) ?? [], ...axis(p) },
    yAxis: { type: 'value', ...axis(p), axisLabel: { color: p.muted, formatter: (v: number) => compact(v) } },
    series: [
      { name: 'Ore', type: 'bar', stack: 't', data: q.data?.series.map((s) => s.ore) ?? [], itemStyle: { color: p.accent, borderRadius: [0, 0, 0, 0] }, barWidth: '58%' },
      { name: 'Waste', type: 'bar', stack: 't', data: q.data?.series.map((s) => s.waste) ?? [], itemStyle: { color: p.faint, borderRadius: [3, 3, 0, 0] } },
      { name: 'Target', type: 'line', data: q.data?.series.map(() => q.data!.targetTph) ?? [], symbol: 'none', lineStyle: { color: p.ok, type: 'dashed', width: 1.5 } },
    ],
  }), [q.data]);
  return (
    <Card title="Production · last 24 hours" subtitle="Tonnes delivered per hour" className="h-full" bodyClassName="flex flex-col justify-between" actions={<Link to="/production" className="text-xs text-muted hover:text-accent">Details</Link>}>
      {q.data ? <EChart option={option} height={300} /> : <Skeleton className="h-[300px]" />}
    </Card>
  );
}

// ---------------------------------------------------------------- fleet status

export function StatusWidget() {
  const k = useKpi();
  const p = usePalette();
  const navigate = useNavigate();
  const order: MachineStatus[] = ['running', 'loading', 'hauling', 'idle', 'breakdown', 'maintenance', 'offline'];
  const option = useMemo(() => k && ((pp: typeof p) => ({
    tooltip: { trigger: 'item', backgroundColor: pp.panel2, borderColor: pp.lineStrong, textStyle: { color: pp.fg } },
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['62%', '86%'], padAngle: 2, itemStyle: { borderRadius: 4 }, label: { show: false },
      data: order.filter((s) => k.statusCounts[s] > 0).map((s) => ({ name: STATUS_LABEL[s], value: k.statusCounts[s], itemStyle: { color: pp.status[s] } })),
    }],
  })), [k]);
  if (!k || !option) return <Card title="Fleet status" className="h-full"><Skeleton className="h-[300px]" /></Card>;
  const total = order.reduce((s, x) => s + k.statusCounts[x], 0);
  return (
    <Card title="Fleet status" subtitle={`${total} machines`} className="h-full" bodyClassName="flex flex-col justify-between">
      <div className="relative">
        <EChart option={option} height={190} onClick={() => navigate('/fleet')} />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center"><p className="tnum font-display text-3xl font-semibold">{num(k.availability, 0)}%</p><p className="text-xs text-muted">available</p></div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {order.map((s) => (
          <Link key={s} to={`/fleet?status=${s}`} className="flex items-center justify-between rounded-md px-1.5 py-0.5 text-sm hover:bg-fg/[0.04]">
            <span className="flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: p.status[s] }} />{STATUS_LABEL[s]}</span>
            <span className="tnum font-medium">{k.statusCounts[s]}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- alerts & activity

export function AlertsWidget() {
  const alerts = useLive((s) => s.openAlerts);
  const now = useLive((s) => s.t);
  const navigate = useNavigate();
  return (
    <Card title="Open alerts" subtitle={`${alerts.length} need attention`} flush className="h-full" bodyClassName="min-h-[440px] flex-1 overflow-y-auto scroll-thin"
      actions={<Link to="/alerts" className="text-xs text-muted hover:text-accent">All alerts</Link>}>
      {!alerts.length && <EmptyState title="All clear" message="No open alerts right now." icon={<AlertTriangle className="h-5 w-5" />} />}
      {alerts.slice(0, 30).map((a) => (
        <button key={a.id} type="button" onClick={() => navigate(`/alerts?focus=${a.id}`)}
          className="flex w-full items-start gap-3 border-b border-line px-4 py-2.5 text-left hover:bg-fg/[0.03]">
          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-crit shadow-[0_0_8px_var(--crit)]' : a.severity === 'warning' ? 'bg-warn' : 'bg-info')} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{a.title}</p>
              <Badge tone={SEVERITY_TONE[a.severity]}>{a.machineId}</Badge>
            </div>
            <p className="truncate text-xs text-muted">{a.message}</p>
          </div>
          <div className="shrink-0 text-right text-[11px] text-faint">
            <p>{ago(a.lastTs, now)}</p>
            {a.status === 'acknowledged' && <p className="text-ok">ack</p>}
          </div>
        </button>
      ))}
    </Card>
  );
}

export function ActivityWidget() {
  const feed = useLive((s) => s.feed);
  const now = useLive((s) => s.t);
  return (
    <Card title="Activity" subtitle="Dispatch, loads, shifts and safety events" flush className="h-full" bodyClassName="h-[356px] overflow-y-auto scroll-thin">
      {!feed.length && <EmptyState title="Listening for events" message="Loads, refuels and alerts will stream in here." icon={<Clock className="h-5 w-5" />} />}
      <ul>
        {feed.map((e) => (
          <li key={e.id} className="flex items-start gap-3 border-b border-line px-4 py-2 text-sm last:border-0">
            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', e.kind.includes('critical') || e.kind === 'breakdown' ? 'bg-crit' : e.kind.includes('warning') ? 'bg-warn' : e.kind === 'load' ? 'bg-accent' : 'bg-info')} />
            <p className="min-w-0 flex-1 truncate">{e.text}</p>
            <span className="shrink-0 text-[11px] text-faint">{ago(e.t, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- loaders

export function LoadersWidget() {
  const machines = useLive((s) => s.machines);
  const loaders = Object.values(machines).filter((m) => m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader');
  const p = usePalette();
  return (
    <Card title="Loading units" subtitle="Status, queue and passes this shift" flush className="h-full" bodyClassName="h-[300px] overflow-y-auto scroll-thin"
      actions={<Link to="/fleet/dispatch" className="text-xs text-muted hover:text-accent">Dispatch</Link>}>
      {loaders.map((m) => {
        const Icon = TYPE_ICON[m.type];
        return (
          <Link key={m.id} to={`/fleet/${m.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-fg/[0.03]">
            <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${p.status[m.st]}22`, color: p.status[m.st] }}><Icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><p className="text-sm font-medium">{m.id}</p><StatusPill status={m.st} /></div>
              <p className="truncate text-xs text-muted">{m.act}</p>
            </div>
            <div className="text-right">
              <p className="tnum text-sm font-semibold">{m.s.load_cycles ?? 0}</p>
              <p className="text-[11px] text-muted">passes · queue {m.queue ?? 0}</p>
            </div>
          </Link>
        );
      })}
    </Card>
  );
}

// ---------------------------------------------------------------- fuel

export function FuelWidget() {
  const machines = useLive((s) => s.machines);
  const U = useUnits();
  const list = Object.values(machines).sort((a, b) => (a.s.fuel_level ?? 100) - (b.s.fuel_level ?? 100)).slice(0, 8);
  return (
    <Card title="Lowest fuel levels" flush className="h-full" bodyClassName="h-[356px] overflow-y-auto scroll-thin px-4 py-2" actions={<Link to="/fuel" className="text-xs text-muted hover:text-accent">Fuel</Link>}>
      {list.map((m) => {
        const f = m.s.fuel_level ?? 0;
        const color = f < 15 ? 'var(--crit)' : f < 25 ? 'var(--warn)' : 'var(--ok)';
        return (
          <Link key={m.id} to={`/fleet/${m.id}?tab=fuel`} className="block rounded-md px-1 py-1.5 hover:bg-fg/[0.03]">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">{m.id}</span>
              <span className="tnum text-xs text-muted">{pct(f, 1)} · {U.flow(m.s.fuel_rate)}</span>
            </div>
            <Meter value={f} max={100} warnAt={15} color={color} />
          </Link>
        );
      })}
    </Card>
  );
}

// ---------------------------------------------------------------- camera spotlight

export function CameraWidget() {
  const boot = useBoot();
  const cams = useMemo(() => boot.cameras.filter((c) => c.enabled && (c.position === 'front' || c.position === 'cabin' || c.position === 'tray' || c.position === 'bucket')), [boot.cameras]);
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % Math.max(1, cams.length)), 12_000);
    return () => clearInterval(id);
  }, [cams.length]);
  const cam = cams[(i * 7) % Math.max(1, cams.length)];
  if (!cam) return <Card title="Camera spotlight" className="h-full"><EmptyState title="No cameras" /></Card>;
  return (
    <Card title="Camera spotlight" subtitle="Rotates every 12 seconds" className="h-full" bodyClassName="flex flex-col justify-between" actions={<Link to={`/cameras?machine=${cam.machineId}`} className="text-xs text-muted hover:text-accent">Open</Link>}>
      <div className="overflow-hidden rounded-lg">
        <CameraTile key={cam.id} machineId={cam.machineId} position={cam.position} fps={10} maxW={560} />
      </div>
      <p className="mt-2 text-xs text-muted">{cam.machineId} · {cam.position} camera · {cam.resolution}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- shift target

export function ShiftWidget() {
  const k = useKpi();
  if (!k) return <Card title="Shift target" className="h-full"><Skeleton className="h-[300px]" /></Card>;
  const frac = k.tonnesShift / k.targetShift;
  const expected = k.shiftProgress;
  const onPace = frac >= expected * 0.97;
  return (
    <Card title={`Shift ${k.shift} · ${k.shiftName}`} subtitle="Progress against the shift target" className="h-full" bodyClassName="flex flex-col justify-between">
      <div className="my-auto flex items-center gap-5 py-2">
        <Ring value={frac} size={132} stroke={11} color={onPace ? 'var(--ok)' : 'var(--warn)'}>
          <div className="text-center">
            <p className="tnum font-display text-2xl font-semibold">{num(frac * 100)}%</p>
            <p className="text-[11px] text-muted">of target</p>
          </div>
        </Ring>
        <div className="flex flex-col gap-2 text-sm">
          <div><p className="text-xs text-muted">Moved this shift</p><p className="tnum font-semibold">{tonnes(k.tonnesShift)}</p></div>
          <div><p className="text-xs text-muted">Shift target</p><p className="tnum font-semibold">{tonnes(k.targetShift)}</p></div>
          <Badge tone={onPace ? 'ok' : 'warn'}>{onPace ? 'On pace' : 'Behind pace'} · {num(expected * 100)}% of shift elapsed</Badge>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-line/60 pt-3 text-xs text-muted">
        <Truck className="h-3.5 w-3.5" /> {k.loadsDay} loads today · mine day {k.mineDay}
      </div>
    </Card>
  );
}

export const WIDGETS = {
  kpis: { title: 'KPI strip', render: KpiStrip, defaultSize: 'xl' as const },
  map: { title: 'Live site map', render: MapWidget, defaultSize: 'l' as const },
  alerts: { title: 'Open alerts', render: AlertsWidget, defaultSize: 'm' as const },
  production: { title: 'Production trend', render: ProductionWidget, defaultSize: 'l' as const },
  status: { title: 'Fleet status', render: StatusWidget, defaultSize: 'm' as const },
  loaders: { title: 'Loading units', render: LoadersWidget, defaultSize: 'm' as const },
  camera: { title: 'Camera spotlight', render: CameraWidget, defaultSize: 'm' as const },
  fuel: { title: 'Lowest fuel levels', render: FuelWidget, defaultSize: 'm' as const },
  shift: { title: 'Shift target', render: ShiftWidget, defaultSize: 'm' as const },
  activity: { title: 'Activity feed', render: ActivityWidget, defaultSize: 'm' as const },
};
export type WidgetKind = keyof typeof WIDGETS;
