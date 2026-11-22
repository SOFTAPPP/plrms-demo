import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Square } from 'lucide-react';
import { useQuery } from '../../lib/hooks';
import { patch, post, qs } from '../../lib/api';
import { useBoot } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { dateTime, duration, toInput } from '../../lib/format';
import { can } from '../../../shared/types';
import { DataTable, type Col } from '../../components/ui/table';
import { Badge, Button, Card, ErrorState, Skeleton } from '../../components/ui/core';
import { Field, Input, Segmented, Select, Textarea } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { EChart, axis } from '../../components/charts/EChart';

export interface DowntimeRow { id: number; machineId: string; start: number; end: number | null; category: string; reason: string; notes: string | null; source: string; createdBy: string }
interface DowntimeResp { rows: DowntimeRow[]; categories: string[]; summary: { category: string; hours: number; count: number }[] }

function LogDialog({ open, onOpenChange, categories, onSaved, machineId }: { open: boolean; onOpenChange: (v: boolean) => void; categories: string[]; onSaved: () => void; machineId?: string }) {
  const boot = useBoot();
  const t = useLive((s) => s.t);
  const [f, setF] = useState({ machineId: machineId ?? boot.machines[0]?.id ?? '', category: 'Weather', reason: '', start: toInput(t - 3_600_000), end: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post('/downtime', { ...f, start: new Date(f.start).getTime(), end: f.end ? new Date(f.end).getTime() : undefined });
      toast.success('Downtime logged');
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Log downtime" footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.reason} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Machine"><Select value={f.machineId} disabled={Boolean(machineId)} onChange={(e) => setF({ ...f, machineId: e.target.value })}>{boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</Select></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Reason" className="col-span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Heavy rain - haul roads closed" /></Field>
        <Field label="Start"><Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="End" hint="Leave empty if still ongoing"><Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export function DowntimeTable({ rows, loading, onClose }: { rows: DowntimeRow[]; loading?: boolean; onClose?: (r: DowntimeRow) => void }) {
  const t = useLive((s) => s.t);
  const cols: Col<DowntimeRow>[] = [
    { key: 'machine', header: 'Machine', width: '100px', sort: (r) => r.machineId, cell: (r) => <span className="font-medium">{r.machineId}</span> },
    { key: 'cat', header: 'Category', width: '170px', sort: (r) => r.category, cell: (r) => <Badge tone={r.category === 'Breakdown' ? 'crit' : r.category === 'Planned maintenance' ? 'violet' : r.category === 'Waiting on trucks' ? 'warn' : 'neutral'}>{r.category}</Badge> },
    { key: 'reason', header: 'Reason', width: 'minmax(200px,2fr)', cell: (r) => <span className="truncate">{r.reason}</span> },
    { key: 'start', header: 'Start', width: '140px', sort: (r) => r.start, cell: (r) => <span className="text-muted">{dateTime(r.start)}</span> },
    { key: 'dur', header: 'Duration', width: '120px', sort: (r) => (r.end ?? t) - r.start, cell: (r) => r.end ? <span className="tnum">{duration(r.end - r.start)}</span> : <Badge tone="accent" dot>ongoing · {duration(t - r.start)}</Badge> },
    { key: 'src', header: 'Logged by', width: '110px', cell: (r) => <span className="text-muted">{r.source === 'system' ? 'System' : r.createdBy}</span> },
    { key: 'a', header: '', width: '90px', cell: (r) => !r.end && onClose && r.source === 'manual' && <Button size="xs" icon={<Square className="h-3 w-3" />} onClick={() => onClose(r)}>End now</Button> },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} loading={loading} height="calc(100vh - 470px)" initialSort={{ key: 'start', dir: 'desc' }} />;
}

export function DowntimeTab() {
  const boot = useBoot();
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const [hours, setHours] = useState(24);
  const [category, setCategory] = useState('');
  const [machine, setMachine] = useState('');
  const [dlg, setDlg] = useState(false);
  const q = useQuery<DowntimeResp>(`/downtime${qs({ from: t - hours * 3_600_000, to: t + 60_000, category, machineId: machine })}`, { refreshMs: 30000 });
  const option = useMemo(() => q.data && ((p: Parameters<typeof axis>[0]) => ({
    grid: { left: 8, right: 30, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', ...axis(p), axisLabel: { color: p.muted, formatter: '{value} h' } },
    yAxis: { type: 'category', data: [...q.data!.summary].reverse().map((s) => s.category), ...axis(p) },
    series: [{ type: 'bar', data: [...q.data!.summary].reverse().map((s) => ({ value: s.hours, itemStyle: { color: s.category === 'Breakdown' ? p.crit : s.category === 'Planned maintenance' ? p.violet : s.category === 'Waiting on trucks' ? p.warn : p.faint, borderRadius: [0, 4, 4, 0] } })),
      barWidth: 14, label: { show: true, position: 'right', color: p.muted, formatter: '{c} h' } }],
  })), [q.data]);
  const close = async (r: DowntimeRow) => {
    try { await patch(`/downtime/${r.id}`, { end: useLive.getState().t }); q.reload(); toast.success('Downtime closed'); } catch (err) { toast.error((err as Error).message); }
  };
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Lost time by reason" subtitle={`Machine hours in the last ${hours} h`}>
        {option ? <EChart option={option} height={Math.max(160, (q.data?.summary.length ?? 4) * 30)} /> : <Skeleton className="h-40" />}
      </Card>
      <Card flush title="Downtime log" actions={can(boot.user.role, 'operate') && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg(true)}>Log downtime</Button>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Segmented size="sm" value={hours} onChange={setHours} options={[{ value: 8, label: '8 h' }, { value: 24, label: '24 h' }, { value: 72, label: '3 days' }, { value: 168, label: '7 days' }]} />
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-52">
            <option value="">All reasons</option>
            {q.data?.categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select aria-label="Machine" value={machine} onChange={(e) => setMachine(e.target.value)} className="w-40">
            <option value="">All machines</option>
            {boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </Select>
          <span className="text-xs text-muted">{q.data?.rows.length ?? 0} records</span>
        </div>
        <DowntimeTable rows={q.data?.rows ?? []} loading={q.loading} onClose={close} />
      </Card>
      {q.data && <LogDialog open={dlg} onOpenChange={setDlg} categories={q.data.categories} onSaved={q.reload} />}
    </div>
  );
}
