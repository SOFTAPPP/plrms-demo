import { useMemo, useState } from 'react';
import { convert, type Dimension } from '../../shared/sensors';
import { useUnits } from '../lib/units';
import { SurroundViews } from './Surround';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bell, Box, CalendarClock, ClipboardList, Fuel, Gauge, History, LayoutGrid, Plus, Rotate3d, Truck, Video, Weight } from 'lucide-react';
import { useBoot } from '../lib/app-store';
import { useMachine, useLive } from '../lib/live';
import { useQuery } from '../lib/hooks';
import { qs } from '../lib/api';
import { usePalette } from '../lib/palette';
import { dateTime, duration, num, tonnes } from '../lib/format';
import { NODE_BY_ID } from '../../shared/site';
import { CAMERA_LABEL, TYPE_LABEL, can, type AlertRow } from '../../shared/types';
import type { TelemetryPoint } from '../lib/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, EmptyState, ErrorState, SEVERITY_TONE, Skeleton, Stat, StatusPill } from '../components/ui/core';
import { Segmented, Select } from '../components/ui/form';
import { DataTable, type Col } from '../components/ui/table';
import { SensorPanel } from '../components/machine/SensorPanel';
import { SiteMap } from '../components/map/SiteMap';
import { CameraTile } from '../components/camera/CameraTile';
import { TYPE_ICON } from '../components/machine/glyphs';
import { EChart, axis } from '../components/charts/EChart';
import { WorkOrderDialog, WorkOrderTable, type WorkOrder } from './fleet/Maintenance';
import { DowntimeTable, type DowntimeRow } from './fleet/Downtime';


const TABS = ['overview', 'sensors', 'cameras', 'surround', 'production', 'fuel', 'maintenance', 'downtime', 'alerts'] as const;

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-0"><span className="text-muted">{label}</span><span className="text-right font-medium">{value}</span></div>;
}

const TELE_FIELDS: { key: keyof TelemetryPoint; label: string; dim: Dimension }[] = [
  { key: 'spd', label: 'Speed', dim: 'speed' }, { key: 'fuel', label: 'Fuel level', dim: 'percent' }, { key: 'e_temp', label: 'Engine temperature', dim: 'temp' },
  { key: 'rpm', label: 'Engine speed', dim: 'rpm' }, { key: 'e_load', label: 'Engine load', dim: 'percent' }, { key: 'fuel_rate', label: 'Fuel consumption', dim: 'flow' },
  { key: 'pay', label: 'Payload', dim: 'mass' }, { key: 'brk', label: 'Brake temperature', dim: 'temp' }, { key: 'tyre_p', label: 'Lowest tyre pressure', dim: 'pressure_psi' },
  { key: 'hyd', label: 'Hydraulic pressure', dim: 'pressure_bar' }, { key: 'vib', label: 'Vibration', dim: 'vibration' }, { key: 'bat', label: 'Battery', dim: 'voltage' },
];

export function TelemetryChart({ machineId, initialKey = 'spd', height = 480 }: { machineId: string; initialKey?: keyof TelemetryPoint; height?: number }) {
  const t = useLive((s) => Math.floor(s.t / 30_000) * 30_000);
  const [hours, setHours] = useState(2);
  const [key, setKey] = useState<keyof TelemetryPoint>(initialKey);
  const q = useQuery<{ rows: TelemetryPoint[] }>(`/telemetry/${machineId}${qs({ from: t - hours * 3_600_000, to: t + 1, fields: String(key), max: 900 })}`, { refreshMs: 30_000 });
  const field = TELE_FIELDS.find((f) => f.key === key)!;
  const units = useBoot().settings.units;
  const unit = convert(0, field.dim, units)[1];
  const rows = (q.data?.rows ?? []).filter((r) => r[key] !== null && r[key] !== undefined);
  const option = useMemo(() => (p: Parameters<typeof axis>[0]) => ({
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: 'time', ...axis(p), splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, ...axis(p), name: unit, nameTextStyle: { color: p.muted } },
    series: [{ type: 'line', showSymbol: false, data: rows.map((r) => [r.ts, convert(Number(r[key]), field.dim, units)[0]]), lineStyle: { color: p.accent, width: 1.6 }, areaStyle: { color: p.accent, opacity: 0.08 } }],
  }), [rows, key, field.dim, unit, units]);
  return (
    <Card title="Sensor history" subtitle="From recorded telemetry" actions={
      <div className="flex gap-2">
        <Select aria-label="Sensor" value={String(key)} onChange={(e) => setKey(e.target.value as keyof TelemetryPoint)} className="w-48">
          {TELE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <Segmented size="sm" value={hours} onChange={setHours} options={[{ value: 2, label: '2 h' }, { value: 12, label: '12 h' }, { value: 48, label: '48 h' }]} />
      </div>
    }>
      {q.loading && !q.data ? (
        <div style={{ height: `${height}px` }}><Skeleton className="h-full w-full" /></div>
      ) : rows.length < 2 ? (
        <EmptyState title="No readings for this sensor" message="This machine does not report this value." />
      ) : (
        <EChart option={option} height={height} />
      )}
    </Card>
  );
}

export default function MachineDetail() {
  const { id = '' } = useParams();
  const boot = useBoot();
  const navigate = useNavigate();
  const meta = boot.machines.find((m) => m.id === id);
  const m = useMachine(id);
  const p = usePalette();
  const [tab, setTab] = useTabParam(TABS, 'overview');
  if (!meta) return <EmptyState title="Machine not found" message={`There is no machine with ID ${id}.`} action={<Button onClick={() => navigate('/fleet')}>Back to fleet</Button>} />;
  const Icon = TYPE_ICON[meta.type];
  const cams = boot.cameras.filter((c) => c.machineId === id);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="grid h-12 w-12 place-items-center rounded-xl border" style={{ borderColor: `${p.status[m?.st ?? 'offline']}55`, background: `${p.status[m?.st ?? 'offline']}18`, color: p.status[m?.st ?? 'offline'] }}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold">{meta.id}</h1>
            {m && <StatusPill status={m.st} />}
            {!meta.inService && <Badge tone="neutral">Out of service</Badge>}
            {m?.al ? <Badge tone="crit">{m.al} open alert{m.al > 1 ? 's' : ''}</Badge> : null}
          </div>
          <p className="truncate text-sm text-muted">{meta.make} {meta.model} · {TYPE_LABEL[meta.type]} · {m?.act ?? '—'}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" icon={<Video className="h-3.5 w-3.5" />} onClick={() => setTab('cameras')}>Cameras</Button>
          <Button size="sm" icon={<History className="h-3.5 w-3.5" />} onClick={() => navigate(`/cameras?tab=playback&machine=${id}`)}>Playback</Button>
          <Button size="sm" variant="primary" icon={<Rotate3d className="h-3.5 w-3.5" />} onClick={() => setTab('surround')}>360° view</Button>
        </div>
      </div>
      <Tabs id="machine" value={tab} onChange={setTab} items={[
        { value: 'overview', label: 'Overview', icon: <LayoutGrid className="h-4 w-4" /> },
        { value: 'sensors', label: 'Sensors', icon: <Gauge className="h-4 w-4" /> },
        { value: 'cameras', label: 'Cameras', icon: <Video className="h-4 w-4" />, count: cams.length },
        { value: 'surround', label: '360°', icon: <Rotate3d className="h-4 w-4" /> },
        { value: 'production', label: 'Production', icon: <Weight className="h-4 w-4" /> },
        { value: 'fuel', label: 'Fuel', icon: <Fuel className="h-4 w-4" /> },
        { value: 'maintenance', label: 'Maintenance', icon: <CalendarClock className="h-4 w-4" /> },
        { value: 'downtime', label: 'Downtime', icon: <ClipboardList className="h-4 w-4" /> },
        { value: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" />, count: m?.al },
      ]} />
      {tab === 'overview' && <Overview id={id} />}
      {tab === 'sensors' && <div className="flex flex-col gap-4"><SensorPanel machineId={id} /><TelemetryChart machineId={id} /></div>}
      {tab === 'cameras' && (
        cams.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {cams.map((c) => (
              <div key={c.id}>
                <CameraTile machineId={id} position={c.position} fps={12} maxW={640} onExpand={() => navigate(`/cameras?machine=${id}&cam=${c.position}`)} />
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                  <span>{CAMERA_LABEL[c.position]} · {c.resolution} · {c.fps} fps</span>
                  <Link to={`/cameras?tab=playback&machine=${id}&cam=${c.position}`} className="hover:text-accent">Playback</Link>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No cameras fitted" message="Add cameras in Admin > Machines & cameras." />
      )}
      {tab === 'surround' && <SurroundViews machineId={id} height={520} />}
      {tab === 'production' && <ProductionTab id={id} />}
      {tab === 'fuel' && <FuelTab id={id} />}
      {tab === 'maintenance' && <MaintTab id={id} />}
      {tab === 'downtime' && <DownTab id={id} />}
      {tab === 'alerts' && <AlertsTab id={id} />}
    </div>
  );
}

function Overview({ id }: { id: string }) {
  const boot = useBoot();
  const meta = boot.machines.find((m) => m.id === id)!;
  const m = useMachine(id);
  const U = useUnits();
  const q = useQuery<{ roster: { shift: string; name: string | null; employeeNo: string | null }[]; today: Record<string, number>; nextMaintenance: WorkOrder | null }>(`/machines/${id}`, { refreshMs: 30_000 });
  const route = boot.routes.find((r) => r.id === m?.route);
  const today = q.data?.today;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="panel p-4"><Stat label="Speed" value={U.speedParts(m?.spd)[0]} unit={U.speedParts(m?.spd)[1]} hint={m?.zone} /></div>
          <div className="panel p-4"><Stat label="Fuel" value={num(m?.s.fuel_level, 1)} unit="%" hint={`${U.flow(m?.s.fuel_rate)} now`} tone={(m?.s.fuel_level ?? 100) < 15 ? 'crit' : undefined} /></div>
          {meta.type === 'truck'
            ? <div className="panel p-4"><Stat label="Payload" value={U.massParts(m?.s.payload)[0]} unit={U.massParts(m?.s.payload)[1]} hint={`${m?.s.payload_pct ?? 0}% of ${U.mass(meta.capacity)} rated`} tone={(m?.s.payload_pct ?? 0) > 105 ? 'warn' : undefined} /></div>
            : <div className="panel p-4"><Stat label="Engine temp" value={U.tempParts(m?.s.engine_temp, 1)[0]} unit={U.tempParts(m?.s.engine_temp, 1)[1]} hint={`${num(m?.s.rpm)} rpm`} /></div>}
          <div className="panel p-4"><Stat label="Cycles this shift" value={num(m?.s.load_cycles ?? 0)} hint={meta.type === 'truck' ? 'loads delivered' : meta.type === 'drill' ? 'holes drilled' : 'bucket passes'} /></div>
        </div>
        <Card title="Location" subtitle={m?.zone} flush bodyClassName="h-[360px]"><SiteMap compact selectedId={id} focusId={id} showLegend={false} /></Card>
        <TelemetryChart machineId={id} initialKey={meta.type === 'truck' ? 'pay' : 'e_load'} />
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Today" subtitle="Since the start of the mine day">
          {today ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Operating" value={duration(today.op * 1000)} />
              <Stat label="Idle" value={duration(today.idle * 1000)} />
              <Stat label="Down / service" value={duration((today.down + today.maint) * 1000)} tone={today.down > 0 ? 'crit' : undefined} />
              <Stat label="Fuel used" value={U.volumeParts(today.fuel)[0]} unit={U.volumeParts(today.fuel)[1]} />
              <Stat label={meta.type === 'truck' ? 'Tonnes hauled' : 'Tonnes loaded'} value={tonnes(today.tonnes)} />
              <Stat label="Distance" value={num(today.km, 1)} unit="km" />
            </div>
          ) : <Skeleton className="h-32" />}
        </Card>
        {meta.type === 'truck' && (
          <Card title="Assignment">
            <SpecRow label="Loading unit" value={<Link className="hover:text-accent" to={`/fleet/${m?.loader}`}>{m?.loader ?? '—'}</Link>} />
            <SpecRow label="Route" value={route ? `${route.id} · ${route.name}` : '—'} />
            <SpecRow label="Destination" value={route ? NODE_BY_ID[route.destNode]?.zone : '—'} />
            <SpecRow label="Haul distance" value={route ? `${route.distanceKm} km` : '—'} />
            <Link to="/fleet/dispatch" className="mt-2 inline-block text-xs text-accent">Change in Dispatch →</Link>
          </Card>
        )}
        <Card title="Crew">
          {q.data?.roster.map((r) => <SpecRow key={r.shift} label={`Shift ${r.shift} · ${boot.settings.shifts.names[r.shift as 'A']}`} value={r.name ?? 'Unassigned'} />)}
          <p className="mt-2 text-xs text-muted">On duty now: <span className="text-fg">{m?.op || '—'}</span></p>
        </Card>
        <Card title="Specification">
          <SpecRow label="Make / model" value={`${meta.make} ${meta.model}`} />
          <SpecRow label="Year · serial" value={`${meta.year} · ${meta.serial}`} />
          <SpecRow label={meta.type === 'truck' ? 'Rated payload' : 'Capacity'} value={`${meta.capacity} ${meta.type === 'water' ? 'kL' : meta.type === 'drill' ? 'm' : 't'}`} />
          <SpecRow label="Fuel tank" value={`${num(meta.fuelCapacity)} L`} />
          <SpecRow label="Engine hours" value={num(m?.s.engine_hours ?? meta.engineHours, 1)} />
          <SpecRow label="Next maintenance" value={q.data?.nextMaintenance ? `${dateTime(q.data.nextMaintenance.dueAt)}` : 'None scheduled'} />
        </Card>
      </div>
    </div>
  );
}

interface ProdEvent { id: number; ts: number; truck_id: string; loader_id: string; route_id: string; tonnes: number; passes: number; cycle_sec: number; queue_sec: number; material: string; operator: string | null }

function ProductionTab({ id }: { id: string }) {
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const q = useQuery<ProdEvent[]>(`/production/events${qs({ machineId: id, from: t - 48 * 3_600_000, to: t + 60_000, limit: 500 })}`, { refreshMs: 30_000 });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.tonnes, 0);
  const cols: Col<ProdEvent>[] = [
    { key: 'ts', header: 'Tipped', width: '140px', sort: (r) => r.ts, cell: (r) => dateTime(r.ts) },
    { key: 'truck', header: 'Truck', width: '90px', cell: (r) => r.truck_id },
    { key: 'loader', header: 'Loader', width: '90px', cell: (r) => r.loader_id },
    { key: 'route', header: 'Route', width: '70px', cell: (r) => r.route_id },
    { key: 'mat', header: 'Material', width: '80px', cell: (r) => <Badge tone={r.material === 'ore' ? 'accent' : 'neutral'}>{r.material}</Badge> },
    { key: 't', header: 'Tonnes', width: '90px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum">{num(r.tonnes, 1)}</span> },
    { key: 'p', header: 'Passes', width: '70px', align: 'right', cell: (r) => r.passes },
    { key: 'c', header: 'Cycle', width: '90px', align: 'right', sort: (r) => r.cycle_sec, cell: (r) => <span className="tnum">{(r.cycle_sec / 60).toFixed(1)} min</span> },
    { key: 'q', header: 'Queue', width: '80px', align: 'right', cell: (r) => <span className="tnum text-muted">{(r.queue_sec / 60).toFixed(1)} min</span> },
    { key: 'o', header: 'Operator', width: 'minmax(120px,1fr)', cell: (r) => <span className="text-muted">{r.operator ?? '—'}</span> },
  ];
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="panel p-4"><Stat label="Loads (48 h)" value={num(rows.length)} /></div>
        <div className="panel p-4"><Stat label="Tonnes (48 h)" value={tonnes(total)} /></div>
        <div className="panel p-4"><Stat label="Avg payload" value={num(rows.length ? total / rows.length : 0, 1)} unit="t" /></div>
        <div className="panel p-4"><Stat label="Avg cycle" value={num(rows.length ? rows.reduce((s, r) => s + r.cycle_sec, 0) / rows.length / 60 : 0, 1)} unit="min" /></div>
      </div>
      <Card flush title="Load events" subtitle="Last 48 hours"><DataTable columns={cols} rows={rows} rowKey={(r) => r.id} loading={q.loading} height={480} initialSort={{ key: 'ts', dir: 'desc' }}
        empty={<EmptyState title="No loads" message="This machine has not hauled or loaded in the last 48 hours." icon={<Truck className="h-5 w-5" />} />} /></Card>
    </div>
  );
}

interface FuelEvent { id: number; ts: number; machineId: string; type: string; litres: number; levelBefore: number; levelAfter: number; location: string; note: string | null; recordedBy: string }

function FuelTab({ id }: { id: string }) {
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const q = useQuery<FuelEvent[]>(`/fuel/events${qs({ machineId: id, from: t - 7 * 86_400_000, to: t + 60_000 })}`);
  const cols: Col<FuelEvent>[] = [
    { key: 'ts', header: 'Time', width: '140px', sort: (r) => r.ts, cell: (r) => dateTime(r.ts) },
    { key: 'type', header: 'Event', width: '110px', cell: (r) => <Badge tone={r.type === 'anomaly' ? 'crit' : 'ok'}>{r.type}</Badge> },
    { key: 'l', header: 'Litres', width: '90px', align: 'right', cell: (r) => <span className="tnum">{num(r.litres)}</span> },
    { key: 'lv', header: 'Level', width: '130px', cell: (r) => <span className="tnum text-muted">{num(r.levelBefore)}% → {num(r.levelAfter)}%</span> },
    { key: 'loc', header: 'Location', width: '130px', cell: (r) => r.location },
    { key: 'by', header: 'Recorded by', width: 'minmax(120px,1fr)', cell: (r) => <span className="text-muted">{r.note ?? r.recordedBy}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <TelemetryChart machineId={id} initialKey="fuel" />
      <Card flush title="Refuels and anomalies" subtitle="Last 7 days"><DataTable columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} loading={q.loading} height={360} /></Card>
    </div>
  );
}

function MaintTab({ id }: { id: string }) {
  const boot = useBoot();
  const [dlg, setDlg] = useState(false);
  const q = useQuery<WorkOrder[]>(`/maintenance${qs({ machineId: id })}`);
  return (
    <Card flush title="Work orders" actions={can(boot.user.role, 'manage') && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg(true)}>Schedule work</Button>}>
      <WorkOrderTable rows={q.data ?? []} loading={q.loading} reload={q.reload} compact />
      <WorkOrderDialog open={dlg} onOpenChange={setDlg} machineId={id} onSaved={q.reload} />
    </Card>
  );
}

function DownTab({ id }: { id: string }) {
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const q = useQuery<{ rows: DowntimeRow[] }>(`/downtime${qs({ machineId: id, from: t - 7 * 86_400_000, to: t + 60_000 })}`);
  return <Card flush title="Downtime" subtitle="Last 7 days"><DowntimeTable rows={q.data?.rows ?? []} loading={q.loading} /></Card>;
}

function AlertsTab({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = useQuery<{ rows: AlertRow[] }>(`/alerts${qs({ machineId: id, status: 'all', limit: 300 })}`, { refreshMs: 15_000 });
  const cols: Col<AlertRow>[] = [
    { key: 'ts', header: 'Time', width: '140px', sort: (a) => a.ts, cell: (a) => dateTime(a.ts) },
    { key: 'sev', header: 'Severity', width: '100px', cell: (a) => <Badge tone={SEVERITY_TONE[a.severity]} dot>{a.severity}</Badge> },
    { key: 'title', header: 'Alert', width: 'minmax(200px,2fr)', cell: (a) => <div className="min-w-0"><p className="truncate font-medium">{a.title}</p><p className="truncate text-xs text-muted">{a.message}</p></div> },
    { key: 'st', header: 'Status', width: '110px', cell: (a) => <Badge tone={a.status === 'active' ? 'crit' : a.status === 'acknowledged' ? 'warn' : 'ok'}>{a.status}</Badge> },
    { key: 'clip', header: '', width: '110px', cell: (a) => a.camera && <Button size="xs" icon={<Box className="h-3 w-3" />} onClick={() => navigate(`/cameras?tab=playback&machine=${a.machineId}&cam=${a.camera}&at=${a.ts - 15_000}`)}>Event clip</Button> },
  ];
  return <Card flush title="Alert history" subtitle="Every alert raised for this machine"><DataTable columns={cols} rows={q.data?.rows ?? []} rowKey={(a) => a.id} loading={q.loading} height={520} /></Card>;
}
