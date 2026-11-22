import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart3, Check, CheckCheck, Download, History, MapPin, Play, Siren, Truck } from 'lucide-react';
import { useLive } from '../lib/live';
import { useBoot } from '../lib/app-store';
import { useDebounced, useQuery } from '../lib/hooks';
import { post, qs } from '../lib/api';
import { ago, dateTime, dayLabel, duration, num, titleCase } from '../lib/format';
import { exportCsv } from '../lib/export';
import { usePalette, type Palette } from '../lib/palette';
import { CAMERA_LABEL, can, type AlertRow, type Severity } from '../../shared/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, cn, EmptyState, ErrorState, PageHeader, SEVERITY_TONE, Skeleton, Stat } from '../components/ui/core';
import { Checkbox, Field, SearchInput, Segmented, Select, Textarea } from '../components/ui/form';
import { Drawer } from '../components/ui/overlay';
import { DataTable, type Col } from '../components/ui/table';
import { EChart, axis } from '../components/charts/EChart';

function AlertDrawer({ alert, onClose }: { alert: AlertRow | null; onClose: () => void }) {
  const boot = useBoot();
  const navigate = useNavigate();
  const now = useLive((s) => s.t);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const liveCopy = useLive((s) => (alert ? s.openAlerts.find((a) => a.id === alert.id) : undefined));
  const a = liveCopy ?? alert;
  const canAct = can(boot.user.role, 'operate');
  useEffect(() => setNote(''), [alert?.id]);
  const act = async (kind: 'ack' | 'resolve') => {
    if (!a) return;
    setBusy(kind);
    try {
      await post(`/alerts/${a.id}/${kind}`, { note: note || undefined });
      toast.success(kind === 'ack' ? 'Alert acknowledged' : 'Alert resolved');
      if (kind === 'resolve') onClose();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(null); }
  };
  const hasCam = a?.camera && boot.cameras.some((c) => c.machineId === a.machineId && c.position === a.camera);
  return (
    <Drawer open={Boolean(alert)} onOpenChange={(o) => !o && onClose()} width="max-w-lg"
      title={a ? <span className="flex items-center gap-2"><Siren className={cn('h-4 w-4', a.severity === 'critical' ? 'text-crit' : 'text-warn')} />{a.title}</span> : ''}
      description={a ? `${a.machineId} · raised ${dateTime(a.ts, true)}` : undefined}
      footer={a && a.status !== 'resolved' && canAct && <>
        {a.status === 'active' && <Button loading={busy === 'ack'} icon={<Check className="h-4 w-4" />} onClick={() => act('ack')}>Acknowledge</Button>}
        <Button variant="primary" loading={busy === 'resolve'} icon={<CheckCheck className="h-4 w-4" />} onClick={() => act('resolve')}>Resolve</Button>
      </>}>
      {a && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={SEVERITY_TONE[a.severity]} dot>{a.severity}</Badge>
            <Badge tone={a.status === 'active' ? 'crit' : a.status === 'acknowledged' ? 'warn' : 'ok'}>{a.status}</Badge>
            {a.count > 1 && <Badge>{a.count} occurrences</Badge>}
            <Badge>{titleCase(a.type.replace('sensor.', ''))}</Badge>
          </div>
          <p className="rounded-xl border border-line bg-panel-2 p-3 text-sm">{a.message}</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Machine" value={a.machineId} />
            <Stat label="Operator" value={a.operatorName || '—'} />
            {a.value !== null && <Stat label="Reading" value={num(a.value, 1)} />}
            {a.threshold !== null && <Stat label="Limit" value={num(a.threshold, 1)} />}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Timeline</p>
            <ol className="relative ml-2 border-l border-line pl-4 text-sm">
              <li className="mb-3"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-crit" /><p className="font-medium">Raised</p><p className="text-xs text-muted">{dateTime(a.ts, true)} · {ago(a.ts, now)}</p></li>
              {a.count > 1 && <li className="mb-3"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-warn" /><p className="font-medium">Repeated {a.count - 1}×</p><p className="text-xs text-muted">last {dateTime(a.lastTs, true)}</p></li>}
              {a.ackAt && <li className="mb-3"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-info" /><p className="font-medium">Acknowledged by {a.ackBy}</p><p className="text-xs text-muted">{dateTime(a.ackAt, true)} · {duration(a.ackAt - a.ts)} after raised</p></li>}
              {a.resolvedAt && <li><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-ok" /><p className="font-medium">Resolved by {a.resolvedBy}</p><p className="text-xs text-muted">{dateTime(a.resolvedAt, true)}</p></li>}
            </ol>
          </div>
          {a.note && <Field label="Note"><p className="text-sm">{a.note}</p></Field>}
          <div className="flex flex-wrap gap-2">
            {hasCam && <Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />} onClick={() => navigate(`/cameras?tab=playback&machine=${a.machineId}&cam=${a.camera}&at=${a.ts - 15_000}`)}>
              Event clip · {CAMERA_LABEL[a.camera!]}</Button>}
            <Button size="sm" icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => navigate(`/map?focus=${a.machineId}`)}>Locate</Button>
            <Button size="sm" icon={<Truck className="h-3.5 w-3.5" />} onClick={() => navigate(`/fleet/${a.machineId}`)}>Machine</Button>
          </div>
          {a.status !== 'resolved' && canAct && <Field label="Add a note (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spoke to operator, machine parked for check…" /></Field>}
        </div>
      )}
    </Drawer>
  );
}

function alertCols(now: number, sel?: { set: Set<number>; toggle: (id: number) => void }): Col<AlertRow>[] {
  return [
    ...(sel ? [{ key: 'sel', header: '', width: '36px', cell: (a: AlertRow) => <div onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.set.has(a.id)} onChange={() => sel.toggle(a.id)} label={`Select alert ${a.id}`} hideLabel /></div> }] : []),
    { key: 'sev', header: 'Severity', width: '100px', sort: (a) => ({ critical: 0, warning: 1, info: 2 })[a.severity], cell: (a) => <Badge tone={SEVERITY_TONE[a.severity]} dot>{a.severity}</Badge> },
    { key: 'title', header: 'Alert', width: 'minmax(240px,2.4fr)', sort: (a) => a.title, cell: (a) => <div className="min-w-0"><p className="truncate font-medium">{a.title}{a.count > 1 && <span className="ml-1.5 text-xs text-muted">×{a.count}</span>}</p><p className="truncate text-xs text-muted">{a.message}</p></div> },
    { key: 'm', header: 'Machine', width: '100px', sort: (a) => a.machineId, cell: (a) => <span className="font-medium">{a.machineId}</span> },
    { key: 'op', header: 'Operator', width: 'minmax(120px,1fr)', cell: (a) => <span className="truncate text-muted">{a.operatorName || '—'}</span> },
    { key: 'ts', header: 'Raised', width: '130px', sort: (a) => a.ts, cell: (a) => <span className="text-muted" title={dateTime(a.ts, true)}>{ago(a.ts, now)}</span> },
    { key: 'st', header: 'Status', width: '120px', sort: (a) => a.status, cell: (a) => <Badge tone={a.status === 'active' ? 'crit' : a.status === 'acknowledged' ? 'warn' : 'ok'}>{a.status}</Badge> },
    { key: 'by', header: 'Handled by', width: 'minmax(120px,1fr)', cell: (a) => <span className="truncate text-muted">{a.resolvedBy ?? a.ackBy ?? '—'}</span> },
  ];
}

function OpenAlerts({ onOpen }: { onOpen: (a: AlertRow) => void }) {
  const boot = useBoot();
  const alerts = useLive((s) => s.openAlerts);
  const now = useLive((s) => s.t);
  const [sev, setSev] = useState<'all' | Severity>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const rows = alerts.filter((a) => (sev === 'all' || a.severity === sev) && (!q || `${a.title} ${a.machineId} ${a.message} ${a.operatorName ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (action: 'ack' | 'resolve') => {
    try {
      const r = await post<{ updated: number }>('/alerts/bulk', { ids: [...sel], action });
      toast.success(`${r.updated} alert(s) ${action === 'ack' ? 'acknowledged' : 'resolved'}`);
      setSel(new Set());
    } catch (err) { toast.error((err as Error).message); }
  };
  const counts = { critical: alerts.filter((a) => a.severity === 'critical').length, warning: alerts.filter((a) => a.severity === 'warning').length };
  const canAct = can(boot.user.role, 'operate');
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="panel p-4"><Stat label="Open alerts" value={alerts.length} /></div>
        <div className="panel p-4"><Stat label="Critical" value={counts.critical} tone={counts.critical ? 'crit' : 'ok'} /></div>
        <div className="panel p-4"><Stat label="Warnings" value={counts.warning} tone={counts.warning ? 'warn' : 'ok'} /></div>
        <div className="panel p-4"><Stat label="Unacknowledged" value={alerts.filter((a) => a.status === 'active').length} tone="accent" /></div>
      </div>
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Segmented size="sm" value={sev} onChange={setSev} options={[{ value: 'all', label: 'All' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }]} />
          <SearchInput value={q} onChange={setQ} placeholder="Search alerts" className="w-64" />
          {canAct && (
            <div className="ml-auto flex items-center gap-2">
              <Checkbox label="Select all" checked={rows.length > 0 && sel.size === rows.length} indeterminate={sel.size > 0 && sel.size < rows.length}
                onChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())} />
              <Button size="sm" disabled={!sel.size} icon={<Check className="h-3.5 w-3.5" />} onClick={() => bulk('ack')}>Acknowledge ({sel.size})</Button>
              <Button size="sm" variant="primary" disabled={!sel.size} icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => bulk('resolve')}>Resolve</Button>
            </div>
          )}
        </div>
        <DataTable columns={alertCols(now, canAct ? { set: sel, toggle } : undefined)} rows={rows} rowKey={(a) => a.id} onRowClick={onOpen} height="calc(100vh - 420px)"
          rowClassName={(a) => (a.severity === 'critical' && a.status === 'active' ? 'bg-crit/[0.04]' : undefined)}
          empty={<EmptyState title="All clear" message="There are no open alerts. New alerts appear here instantly." icon={<Siren className="h-5 w-5" />} />} />
      </Card>
    </div>
  );
}

function HistoryTab({ onOpen }: { onOpen: (a: AlertRow) => void }) {
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const now = useLive((s) => s.t);
  const boot = useBoot();
  const [hours, setHours] = useState(24);
  const [sev, setSev] = useState('');
  const [machine, setMachine] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const res = useQuery<{ total: number; rows: AlertRow[] }>(`/alerts${qs({ status: 'all', from: t - hours * 3_600_000, severity: sev, machineId: machine, q: dq, limit: 1000 })}`, { refreshMs: 30_000 });
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const rows = res.data?.rows ?? [];
  return (
    <Card flush title="Alert history" subtitle={`${res.data?.total ?? 0} alerts in the selected window`} actions={
      <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportCsv('alerts', [
        { key: 'ts', label: 'Raised', value: (a: AlertRow) => dateTime(a.ts, true) }, { key: 'm', label: 'Machine', value: (a) => a.machineId },
        { key: 'sev', label: 'Severity', value: (a) => a.severity }, { key: 't', label: 'Alert', value: (a) => a.title }, { key: 'msg', label: 'Message', value: (a) => a.message },
        { key: 'op', label: 'Operator', value: (a) => a.operatorName }, { key: 'st', label: 'Status', value: (a) => a.status }, { key: 'ack', label: 'Acknowledged by', value: (a) => a.ackBy },
        { key: 'res', label: 'Resolved by', value: (a) => a.resolvedBy }, { key: 'n', label: 'Note', value: (a) => a.note },
      ], rows)}>Export CSV</Button>
    }>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Segmented size="sm" value={hours} onChange={setHours} options={[{ value: 8, label: '8 h' }, { value: 24, label: '24 h' }, { value: 72, label: '3 days' }, { value: 168, label: '7 days' }]} />
        <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)} className="w-36"><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></Select>
        <Select aria-label="Machine" value={machine} onChange={(e) => setMachine(e.target.value)} className="w-36"><option value="">All machines</option>{boot.machines.map((m) => <option key={m.id}>{m.id}</option>)}</Select>
        <SearchInput value={q} onChange={setQ} placeholder="Search text" className="w-56" />
      </div>
      <DataTable columns={alertCols(now)} rows={rows} rowKey={(a) => a.id} onRowClick={onOpen} loading={res.loading} height="calc(100vh - 330px)" initialSort={{ key: 'ts', dir: 'desc' }} />
    </Card>
  );
}

interface Stats { byType: { type: string; title: string; n: number; critical: number }[]; bySeverity: { severity: string; n: number }[]; byMachine: { id: string; n: number }[]; byDay: { day: string; info: number; warning: number; critical: number }[]; avgAckMin: number | null }

function Analytics() {
  const t = useLive((s) => Math.floor(s.t / 300_000) * 300_000);
  const p = usePalette();
  const q = useQuery<Stats>(`/alerts/stats${qs({ from: t - 7 * 86_400_000, to: t + 300_000 })}`);
  const byDay = useMemo(() => q.data && ((pp: Palette) => ({
    legend: { data: ['Critical', 'Warning', 'Info'] },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: q.data!.byDay.map((d) => dayLabel(d.day)), ...axis(pp) },
    yAxis: { type: 'value', ...axis(pp) },
    series: (['critical', 'warning', 'info'] as const).map((s) => ({ name: titleCase(s), type: 'bar', stack: 'a', data: q.data!.byDay.map((d) => d[s]), itemStyle: { color: pp.severity[s] } })),
  })), [q.data]);
  const byType = useMemo(() => q.data && ((pp: Palette) => ({
    grid: { left: 8, right: 30, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', ...axis(pp) },
    yAxis: { type: 'category', data: [...q.data!.byType].reverse().map((x) => x.title), ...axis(pp) },
    series: [{ type: 'bar', data: [...q.data!.byType].reverse().map((x) => ({ value: x.n, itemStyle: { color: x.critical > x.n / 2 ? pp.crit : pp.warn, borderRadius: [0, 4, 4, 0] } })), barWidth: 12, label: { show: true, position: 'right', color: pp.muted } }],
  })), [q.data]);
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const total = q.data.bySeverity.reduce((s, x) => s + x.n, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="panel p-4"><Stat label="Alerts (7 days)" value={num(total)} /></div>
        <div className="panel p-4"><Stat label="Critical" value={num(q.data.bySeverity.find((s) => s.severity === 'critical')?.n ?? 0)} tone="crit" /></div>
        <div className="panel p-4"><Stat label="Avg time to acknowledge" value={q.data.avgAckMin !== null ? `${q.data.avgAckMin} min` : '—'} hint="By people, not auto-closed" /></div>
        <div className="panel p-4"><Stat label="Most alerts" value={q.data.byMachine[0]?.id ?? '—'} hint={q.data.byMachine[0] ? `${q.data.byMachine[0].n} alerts` : ''} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Alerts per day" subtitle="By severity">{byDay && <EChart option={byDay} height={300} key={p.bg} />}</Card>
        <Card title="Alerts by type">{byType && <EChart option={byType} height={Math.max(300, q.data.byType.length * 26)} />}</Card>
      </div>
    </div>
  );
}

export default function Alerts() {
  const [tab, setTab] = useTabParam(['open', 'history', 'analytics'] as const, 'open');
  const [sp, setSp] = useSearchParams();
  const open = useLive((s) => s.openAlerts);
  const [drawer, setDrawer] = useState<AlertRow | null>(null);
  const focus = Number(sp.get('focus'));
  useEffect(() => {
    if (!focus) return;
    const a = open.find((x) => x.id === focus);
    if (a) setDrawer(a);
    else void import('../lib/api').then(({ get }) => get<{ rows: AlertRow[] }>(`/alerts?status=all&limit=1000`).then((r) => {
      const f = r.rows.find((x) => x.id === focus);
      if (f) setDrawer(f);
    }).catch(() => {}));
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    setDrawer(null);
    if (sp.get('focus')) { const n = new URLSearchParams(sp); n.delete('focus'); setSp(n, { replace: true }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Alerts & events" subtitle="Overload, overspeed, fuel, temperature, proximity, fatigue and breakdown alarms" icon={<Siren className="h-5 w-5" />} />
      <Tabs id="alerts" value={tab} onChange={setTab} items={[
        { value: 'open', label: 'Open', icon: <Siren className="h-4 w-4" />, count: open.length },
        { value: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
        { value: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
      ]} />
      {tab === 'open' && <OpenAlerts onOpen={setDrawer} />}
      {tab === 'history' && <HistoryTab onOpen={setDrawer} />}
      {tab === 'analytics' && <Analytics />}
      <AlertDrawer alert={drawer} onClose={close} />
    </div>
  );
}
