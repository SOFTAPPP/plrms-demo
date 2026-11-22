import { useMemo, useState } from 'react';
import { useUnits } from '../lib/units';
import { toast } from 'sonner';
import { AlertOctagon, Droplet, Fuel as FuelIcon, Gauge, ListOrdered, Plus } from 'lucide-react';
import { useQuery } from '../lib/hooks';
import { post, qs } from '../lib/api';
import { useBoot } from '../lib/app-store';
import { useLive } from '../lib/live';
import { usePalette, type Palette } from '../lib/palette';
import { compact, dateTime, dayLabel, num } from '../lib/format';
import { TYPE_LABEL, can, type MachineType } from '../../shared/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton, Stat } from '../components/ui/core';
import { Field, Input, Segmented, Select, Textarea } from '../components/ui/form';
import { Dialog } from '../components/ui/overlay';
import { DataTable, type Col } from '../components/ui/table';
import { Meter } from '../components/ui/viz';
import { EChart, axis } from '../components/charts/EChart';

interface FuelSummary {
  totals: { litres: number; tonnesMoved: number; lPerTonne: number; idleLitres: number; refuels: number; refuelLitres: number; anomalies: number; anomalyLitres: number; target: number };
  machines: { id: string; type: MachineType; model: string; litres: number; operatingH: number; idleH: number; lPerHour: number; tonnes: number; lPerTonne: number | null; km: number }[];
  daily: { day: string; type: MachineType; fuel: number }[];
  days: string[];
}
interface FuelEvent { id: number; ts: number; machineId: string; type: string; litres: number; levelBefore: number; levelAfter: number; location: string; note: string | null; recordedBy: string }

function RefuelDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const boot = useBoot();
  const [f, setF] = useState({ machineId: boot.machines[0]?.id ?? '', litres: 500, location: 'Fuel bay', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ added: number }>('/fuel/events', f);
      toast.success(`${f.machineId} refuelled with ${num(r.added)} L`);
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Log a refuel" description="Adds fuel to the machine’s tank in the live simulation."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Machine"><Select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>{boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</Select></Field>
        <Field label="Litres"><Input type="number" min={1} value={f.litres} onChange={(e) => setF({ ...f, litres: Number(e.target.value) })} /></Field>
        <Field label="Location" className="col-span-2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Note" className="col-span-2"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export default function FuelPage() {
  const boot = useBoot();
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const machines = useLive((s) => s.machines);
  const p = usePalette();
  const U = useUnits();
  const [tab, setTab] = useTabParam(['overview', 'efficiency', 'refuels', 'anomalies'] as const, 'overview');
  const [days, setDays] = useState(7);
  const [dlg, setDlg] = useState(false);
  const from = t - days * 86_400_000;
  const sum = useQuery<FuelSummary>(`/fuel/summary${qs({ from, to: t + 60_000 })}`, { refreshMs: 60_000 });
  const ev = useQuery<FuelEvent[]>(`/fuel/events${qs({ from, to: t + 60_000, type: tab === 'anomalies' ? 'anomaly' : undefined })}`, { refreshMs: 30_000 });
  const burn = Object.values(machines).reduce((s, m) => s + (m.s.fuel_rate ?? 0), 0);

  const dailyOpt = useMemo(() => sum.data && ((pp: Palette) => {
    const types = [...new Set(sum.data!.daily.map((d) => d.type))];
    return {
      legend: { data: types.map((x) => TYPE_LABEL[x]) },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: sum.data!.days.map(dayLabel), ...axis(pp) },
      yAxis: { type: 'value', ...axis(pp), axisLabel: { color: pp.muted, formatter: (v: number) => `${compact(v)} L` } },
      series: types.map((x, i) => ({ name: TYPE_LABEL[x], type: 'bar', stack: 'f', data: sum.data!.days.map((d) => sum.data!.daily.find((r) => r.day === d && r.type === x)?.fuel ?? 0), itemStyle: { color: pp.series[i % pp.series.length] } })),
    };
  }), [sum.data]);

  const effCols: Col<FuelSummary['machines'][number]>[] = [
    { key: 'id', header: 'Machine', width: '150px', sort: (r) => r.id, cell: (r) => <div><p className="font-medium">{r.id}</p><p className="text-xs text-muted">{r.model}</p></div> },
    { key: 'type', header: 'Type', width: '110px', sort: (r) => r.type, cell: (r) => <span className="text-muted">{TYPE_LABEL[r.type]}</span> },
    { key: 'l', header: 'Litres', width: '100px', align: 'right', sort: (r) => r.litres, cell: (r) => <span className="tnum">{num(r.litres)}</span> },
    { key: 'lph', header: 'L / engine hour', width: '120px', align: 'right', sort: (r) => r.lPerHour, cell: (r) => <span className="tnum">{r.lPerHour}</span> },
    { key: 't', header: 'Tonnes', width: '110px', align: 'right', sort: (r) => r.tonnes, cell: (r) => <span className="tnum text-muted">{r.tonnes ? num(r.tonnes) : '—'}</span> },
    { key: 'lpt', header: 'L / tonne', width: '140px', sort: (r) => r.lPerTonne, cell: (r) => r.lPerTonne === null ? <span className="text-faint">n/a</span> : (
      <div className="flex items-center gap-2"><Meter value={r.lPerTonne} max={Math.max(1, sum.data!.totals.target * 3)} warnAt={sum.data!.totals.target} className="w-16"
        color={r.lPerTonne <= sum.data!.totals.target ? 'var(--ok)' : 'var(--warn)'} /><span className="tnum text-xs">{r.lPerTonne}</span></div>
    ) },
    { key: 'idle', header: 'Idle share', width: '110px', align: 'right', sort: (r) => r.idleH / Math.max(0.1, r.operatingH + r.idleH), cell: (r) => {
      const share = (r.idleH / Math.max(0.1, r.operatingH + r.idleH)) * 100;
      return <span className={share > 30 ? 'tnum text-warn' : 'tnum text-muted'}>{num(share)}%</span>;
    } },
  ];
  const evCols: Col<FuelEvent>[] = [
    { key: 'ts', header: 'Time', width: '150px', sort: (r) => r.ts, cell: (r) => dateTime(r.ts) },
    { key: 'm', header: 'Machine', width: '100px', sort: (r) => r.machineId, cell: (r) => <span className="font-medium">{r.machineId}</span> },
    { key: 'type', header: 'Event', width: '110px', cell: (r) => <Badge tone={r.type === 'anomaly' ? 'crit' : r.type === 'manual' ? 'info' : 'ok'}>{r.type === 'anomaly' ? 'anomaly' : r.type === 'manual' ? 'manual log' : 'refuel'}</Badge> },
    { key: 'l', header: 'Litres', width: '90px', align: 'right', sort: (r) => r.litres, cell: (r) => <span className={r.litres < 0 ? 'tnum text-crit' : 'tnum'}>{num(r.litres)}</span> },
    { key: 'lv', header: 'Tank level', width: '130px', cell: (r) => <span className="tnum text-muted">{num(r.levelBefore)}% → {num(r.levelAfter)}%</span> },
    { key: 'loc', header: 'Location', width: '140px', cell: (r) => r.location },
    { key: 'n', header: 'Note / by', width: 'minmax(180px,2fr)', cell: (r) => <span className="truncate text-muted">{r.note ?? r.recordedBy}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Fuel management" subtitle="Levels, burn rate, refuelling, efficiency and theft detection" icon={<FuelIcon className="h-5 w-5" />}
        actions={<>
          <Segmented value={days} onChange={setDays} options={[{ value: 1, label: '24 h' }, { value: 7, label: '7 days' }]} />
          {can(boot.user.role, 'operate') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDlg(true)}>Log refuel</Button>}
        </>} />
      <Tabs id="fuel" value={tab} onChange={setTab} items={[
        { value: 'overview', label: 'Overview', icon: <Gauge className="h-4 w-4" /> },
        { value: 'efficiency', label: 'Efficiency', icon: <Droplet className="h-4 w-4" /> },
        { value: 'refuels', label: 'Refuel log', icon: <ListOrdered className="h-4 w-4" /> },
        { value: 'anomalies', label: 'Anomalies', icon: <AlertOctagon className="h-4 w-4" />, count: sum.data?.totals.anomalies },
      ]} />
      {sum.error ? <ErrorState message={sum.error} onRetry={sum.reload} /> : !sum.data ? <Skeleton className="h-96" /> : (
        <>
          {tab === 'overview' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <div className="panel p-4"><Stat label="Burn rate now" value={U.flowParts(burn)[0]} unit={U.flowParts(burn)[1]} hint="Whole fleet" /></div>
                <div className="panel p-4"><Stat label="Fuel used" value={U.volumeParts(sum.data.totals.litres)[0]} unit={U.volumeParts(sum.data.totals.litres)[1]} hint={`last ${days === 1 ? '24 h' : '7 days'}`} /></div>
                <div className="panel p-4"><Stat label="Fuel per tonne" value={num(sum.data.totals.lPerTonne, 3)} unit="L/t" hint={`target ${sum.data.totals.target}`} tone={sum.data.totals.lPerTonne <= sum.data.totals.target ? 'ok' : 'warn'} /></div>
                <div className="panel p-4"><Stat label="Idle fuel" value={U.volumeParts(sum.data.totals.idleLitres)[0]} unit={U.volumeParts(sum.data.totals.idleLitres)[1]} hint={`${num((sum.data.totals.idleLitres / Math.max(1, sum.data.totals.litres)) * 100)}% of total`} tone="warn" /></div>
                <div className="panel p-4"><Stat label="Refuels" value={num(sum.data.totals.refuels)} hint={`${compact(sum.data.totals.refuelLitres, 1)} L dispensed`} /></div>
                <div className="panel p-4"><Stat label="Anomalies" value={num(sum.data.totals.anomalies)} hint={`${num(sum.data.totals.anomalyLitres)} L unexplained`} tone={sum.data.totals.anomalies ? 'crit' : 'ok'} /></div>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <Card title="Daily consumption by machine type" className="xl:col-span-2">{dailyOpt && <EChart option={dailyOpt} height={320} />}</Card>
                <Card title="Live tank levels" flush bodyClassName="max-h-[372px] overflow-y-auto scroll-thin p-4">
                  <div className="flex flex-col gap-2.5">
                    {Object.values(machines).sort((a, b) => (a.s.fuel_level ?? 0) - (b.s.fuel_level ?? 0)).map((m) => {
                      const f = m.s.fuel_level ?? 0;
                      return (
                        <div key={m.id}>
                          <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{m.id}</span><span className="tnum text-muted">{num(f, 1)}% · {U.flow(m.s.fuel_rate)}</span></div>
                          <Meter value={f} max={100} warnAt={15} color={f < 15 ? p.crit : f < 25 ? p.warn : p.ok} />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </div>
          )}
          {tab === 'efficiency' && <Card flush title="Fuel efficiency by machine" subtitle="Litres per engine hour and per tonne moved"><DataTable columns={effCols} rows={sum.data.machines} rowKey={(r) => r.id} initialSort={{ key: 'l', dir: 'desc' }} height="calc(100vh - 330px)" /></Card>}
          {(tab === 'refuels' || tab === 'anomalies') && (
            <Card flush title={tab === 'anomalies' ? 'Fuel anomalies' : 'Refuel log'} subtitle={tab === 'anomalies' ? 'Level drops while the machine was stationary — possible theft or leaks' : 'Fuel bay, field service and manual entries'}>
              <DataTable columns={evCols} rows={(ev.data ?? []).filter((e) => tab === 'anomalies' ? e.type === 'anomaly' : e.type !== 'anomaly')} rowKey={(r) => r.id} loading={ev.loading} height="calc(100vh - 330px)" initialSort={{ key: 'ts', dir: 'desc' }} />
            </Card>
          )}
        </>
      )}
      <RefuelDialog open={dlg} onOpenChange={setDlg} onSaved={() => { sum.reload(); ev.reload(); }} />
    </div>
  );
}
