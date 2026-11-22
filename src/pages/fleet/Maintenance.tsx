import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, MoreHorizontal, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { useQuery } from '../../lib/hooks';
import { del, patch, post, qs } from '../../lib/api';
import { useBoot } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { dateTime, duration, num, toInput } from '../../lib/format';
import { can } from '../../../shared/types';
import { DataTable, type Col } from '../../components/ui/table';
import { Badge, Button, Card, ErrorState, Stat, type Tone } from '../../components/ui/core';
import { Field, Input, Segmented, Select, Textarea } from '../../components/ui/form';
import { Dialog, Menu, MenuItem, MenuSeparator, confirmAction } from '../../components/ui/overlay';

export interface WorkOrder {
  id: number; machineId: string; title: string; type: string; status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'; priority: 'low' | 'medium' | 'high';
  dueAt: number; durationH: number; startedAt: number | null; completedAt: number | null; technician: string | null; cost: number | null; notes: string | null;
  source: string; createdBy: string; overdue: boolean;
}

const STATUS_TONE: Record<WorkOrder['status'], Tone> = { scheduled: 'info', in_progress: 'accent', completed: 'ok', cancelled: 'neutral' };

export function WorkOrderDialog({ open, onOpenChange, machineId, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; machineId?: string; onSaved: () => void }) {
  const boot = useBoot();
  const t = useLive((s) => s.t);
  const [f, setF] = useState({ machineId: machineId ?? boot.machines[0]?.id ?? '', title: '', type: 'preventive', priority: 'medium', dueAt: toInput(t + 86_400_000), durationH: 4, technician: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post('/maintenance', { ...f, machineId: machineId ?? f.machineId, dueAt: new Date(f.dueAt).getTime() });
      toast.success('Work order scheduled');
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Schedule maintenance" description="When it is due, the machine is taken out of production for the planned duration."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.title} onClick={save}>Schedule</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        {!machineId && (
          <Field label="Machine" className="col-span-2">
            <Select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>{boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.model}</option>)}</Select>
          </Field>
        )}
        <Field label="Work" className="col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="500 h service - hydraulics" /></Field>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="preventive">Preventive</option><option value="corrective">Corrective</option><option value="inspection">Inspection</option></Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Field>
        <Field label="Due"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
        <Field label="Planned hours"><Input type="number" min={0.25} step={0.25} value={f.durationH} onChange={(e) => setF({ ...f, durationH: Number(e.target.value) })} /></Field>
        <Field label="Technician" className="col-span-2"><Input value={f.technician} onChange={(e) => setF({ ...f, technician: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export function WorkOrderTable({ rows, loading, reload, compact }: { rows: WorkOrder[]; loading?: boolean; reload: () => void; compact?: boolean }) {
  const boot = useBoot();
  const t = useLive((s) => s.t);
  const canManage = can(boot.user.role, 'manage');
  const setStatus = async (w: WorkOrder, status: WorkOrder['status']) => {
    try { await patch(`/maintenance/${w.id}`, { status }); toast.success(`Work order ${status.replace('_', ' ')}`); reload(); } catch (err) { toast.error((err as Error).message); }
  };
  const remove = async (w: WorkOrder) => {
    if (!(await confirmAction({ title: 'Delete this work order?', message: w.title, danger: true, confirmLabel: 'Delete' }))) return;
    try { await del(`/maintenance/${w.id}`); reload(); } catch (err) { toast.error((err as Error).message); }
  };
  const cols: Col<WorkOrder>[] = [
    ...(compact ? [] : [{ key: 'machine', header: 'Machine', width: '100px', sort: (w: WorkOrder) => w.machineId, cell: (w: WorkOrder) => <span className="font-medium">{w.machineId}</span> }]),
    { key: 'title', header: 'Work', width: 'minmax(220px,2fr)', sort: (w) => w.title, cell: (w) => (
      <div className="min-w-0"><p className="truncate font-medium">{w.title}</p><p className="truncate text-xs text-muted">{w.type} · {w.source === 'system' ? 'raised automatically' : `by ${w.createdBy}`}</p></div>
    ) },
    { key: 'status', header: 'Status', width: '120px', sort: (w) => w.status, cell: (w) => <Badge tone={w.overdue ? 'crit' : STATUS_TONE[w.status]}>{w.overdue ? 'overdue' : w.status.replace('_', ' ')}</Badge> },
    { key: 'priority', header: 'Priority', width: '80px', sort: (w) => w.priority, cell: (w) => <span className={w.priority === 'high' ? 'text-crit' : 'text-muted'}>{w.priority}</span> },
    { key: 'due', header: 'Due / started', width: '150px', sort: (w) => w.dueAt, cell: (w) => <span className="text-muted">{dateTime(w.startedAt ?? w.dueAt)}</span> },
    { key: 'dur', header: 'Duration', width: '100px', sort: (w) => w.durationH, cell: (w) => <span className="tnum text-muted">{w.completedAt && w.startedAt ? duration(w.completedAt - w.startedAt) : w.status === 'in_progress' && w.startedAt ? `${duration(t - w.startedAt)} so far` : `${w.durationH} h planned`}</span> },
    { key: 'tech', header: 'Technician', width: '120px', cell: (w) => <span className="text-muted">{w.technician ?? '—'}</span> },
    { key: 'cost', header: 'Cost', width: '100px', align: 'right', sort: (w) => w.cost, cell: (w) => <span className="tnum text-muted">{w.cost ? `₹${num(w.cost)}` : '—'}</span> },
    { key: 'm', header: '', width: '44px', cell: (w) => canManage && w.status !== 'completed' && w.status !== 'cancelled' && (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Work order actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        {w.status === 'scheduled' && <MenuItem icon={<Play className="h-4 w-4" />} onSelect={() => setStatus(w, 'in_progress')}>Mark in progress</MenuItem>}
        <MenuItem icon={<CheckCircle2 className="h-4 w-4" />} onSelect={() => setStatus(w, 'completed')}>Complete</MenuItem>
        <MenuItem icon={<XCircle className="h-4 w-4" />} onSelect={() => setStatus(w, 'cancelled')}>Cancel</MenuItem>
        {w.status === 'scheduled' && <><MenuSeparator /><MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => remove(w)}>Delete</MenuItem></>}
      </Menu>
    ) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(w) => w.id} loading={loading} height={compact ? 420 : 'calc(100vh - 420px)'} />;
}

export function MaintenanceTab() {
  const boot = useBoot();
  const [status, setStatus] = useState<'open' | 'scheduled' | 'in_progress' | 'completed' | 'all'>('open');
  const [machine, setMachine] = useState('');
  const [dlg, setDlg] = useState(false);
  const q = useQuery<WorkOrder[]>(`/maintenance${qs({ machineId: machine, status: status === 'open' || status === 'all' ? undefined : status })}`, { refreshMs: 15000 });
  const all = q.data ?? [];
  const rows = status === 'open' ? all.filter((w) => w.status === 'scheduled' || w.status === 'in_progress') : all;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const inProgress = all.filter((w) => w.status === 'in_progress').length;
  const overdue = all.filter((w) => w.overdue).length;
  const done = all.filter((w) => w.status === 'completed');
  const cost = done.reduce((s, w) => s + (w.cost ?? 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel p-4"><Stat label="In workshop now" value={inProgress} tone="accent" hint="Jobs in progress" /></div>
        <div className="panel p-4"><Stat label="Scheduled" value={all.filter((w) => w.status === 'scheduled').length} tone="info" hint="Upcoming planned work" /></div>
        <div className="panel p-4"><Stat label="Overdue" value={overdue} tone={overdue ? 'crit' : 'ok'} hint={overdue ? 'Needs attention' : 'Nothing overdue'} /></div>
        <div className="panel p-4"><Stat label="Completed cost" value={`₹${num(cost / 100000, 1)} L`} hint={`${done.length} jobs on record`} /></div>
      </div>
      <Card flush title="Work orders" actions={can(boot.user.role, 'manage') && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg(true)}>Schedule work</Button>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Segmented size="sm" value={status} onChange={setStatus} options={[
            { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'History' }, { value: 'all', label: 'All' },
          ]} />
          <Select aria-label="Machine" value={machine} onChange={(e) => setMachine(e.target.value)} className="w-48">
            <option value="">All machines</option>
            {boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </Select>
        </div>
        <WorkOrderTable rows={rows} loading={q.loading} reload={q.reload} />
      </Card>
      <WorkOrderDialog open={dlg} onOpenChange={setDlg} onSaved={q.reload} />
    </div>
  );
}
