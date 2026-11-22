import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MoreHorizontal, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useQuery } from '../../lib/hooks';
import { del, patch, post, put } from '../../lib/api';
import { useApp, useBoot } from '../../lib/app-store';
import { useKpi, useLive } from '../../lib/live';
import { num } from '../../lib/format';
import { can, TYPE_LABEL, type ShiftCode } from '../../../shared/types';
import { DataTable, type Col } from '../../components/ui/table';
import { Badge, Button, Card, ErrorState, Stat } from '../../components/ui/core';
import { Field, Input, SearchInput, Segmented, Select } from '../../components/ui/form';
import { Dialog, Menu, MenuItem, confirmAction } from '../../components/ui/overlay';

interface Operator {
  id: number; name: string; employeeNo: string; shift: ShiftCode; phone: string; licence: string; status: 'active' | 'leave' | 'training';
  experienceYears: number; safetyScore: number; machines: string[]; loads7d: number; tonnes7d: number; avgCycleMin: number | null; events7d: number;
}

function OperatorDialog({ open, onOpenChange, op, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; op: Operator | null; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', shift: 'A' as ShiftCode, phone: '', licence: 'HME-A', status: 'active', experienceYears: 3, safetyScore: 90 });
  const [busy, setBusy] = useState(false);
  const [initFor, setInitFor] = useState<number | null | undefined>(undefined);
  if (open && initFor !== (op?.id ?? null)) {
    setInitFor(op?.id ?? null);
    setF(op ? { name: op.name, shift: op.shift, phone: op.phone, licence: op.licence, status: op.status, experienceYears: op.experienceYears, safetyScore: op.safetyScore }
      : { name: '', shift: 'A', phone: '', licence: 'HME-A', status: 'active', experienceYears: 3, safetyScore: 90 });
  }
  const save = async () => {
    setBusy(true);
    try {
      if (op) await patch(`/operators/${op.id}`, f); else await post('/operators', f);
      toast.success(op ? 'Operator updated' : 'Operator added');
      onSaved();
      onOpenChange(false);
      setInitFor(undefined);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setInitFor(undefined); }} title={op ? `Edit ${op.name}` : 'Add operator'}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.length < 2} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Shift crew"><Select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value as ShiftCode })}>{['A', 'B', 'C'].map((s) => <option key={s} value={s}>Crew {s}</option>)}</Select></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="leave">On leave</option><option value="training">Training</option></Select></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Licence classes"><Input value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })} /></Field>
        <Field label="Experience (years)"><Input type="number" value={f.experienceYears} onChange={(e) => setF({ ...f, experienceYears: Number(e.target.value) })} /></Field>
        <Field label="Safety score"><Input type="number" min={0} max={100} value={f.safetyScore} onChange={(e) => setF({ ...f, safetyScore: Number(e.target.value) })} /></Field>
      </div>
    </Dialog>
  );
}

export function CrewsTab() {
  const boot = useBoot();
  const refreshBoot = useApp((s) => s.refresh);
  const kpi = useKpi();
  const live = useLive((s) => s.machines);
  const q = useQuery<{ operators: Operator[]; roster: { machineId: string; shift: ShiftCode; operatorId: number | null }[] }>('/operators');
  const [sp] = useSearchParams();
  const [shift, setShift] = useState<ShiftCode>(kpi?.shift ?? 'A');
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [dlg, setDlg] = useState<{ open: boolean; op: Operator | null }>({ open: false, op: null });
  const canManage = can(boot.user.role, 'manage');
  const names = boot.settings.shifts.names;

  const opsById = useMemo(() => new Map((q.data?.operators ?? []).map((o) => [o.id, o])), [q.data]);
  const rosterFor = (machineId: string) => q.data?.roster.find((r) => r.machineId === machineId && r.shift === shift)?.operatorId ?? null;

  const setRoster = async (machineId: string, operatorId: number | null) => {
    try {
      await put('/roster', { machineId, shift, operatorId });
      toast.success(`Roster updated for ${machineId}`);
      q.reload();
    } catch (err) { toast.error((err as Error).message); }
  };
  const remove = async (o: Operator) => {
    if (!(await confirmAction({ title: `Remove ${o.name}?`, message: 'They are unassigned from every machine.', danger: true, confirmLabel: 'Remove' }))) return;
    try { await del(`/operators/${o.id}`); toast.success('Operator removed'); q.reload(); void refreshBoot(); } catch (err) { toast.error((err as Error).message); }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const ops = (q.data?.operators ?? []).filter((o) => !search || `${o.name} ${o.employeeNo}`.toLowerCase().includes(search.toLowerCase()));
  const crew = (q.data?.operators ?? []).filter((o) => o.shift === shift);

  const cols: Col<Operator>[] = [
    { key: 'name', header: 'Operator', width: 'minmax(190px,1.4fr)', sort: (o) => o.name, cell: (o) => (
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-fg/[0.06] text-xs font-semibold">{o.name.split(' ').map((s) => s[0]).join('')}</span>
        <div><p className="font-medium">{o.name}</p><p className="text-xs text-muted">{o.employeeNo} · {o.licence}</p></div>
      </div>
    ) },
    { key: 'shift', header: 'Crew', width: '80px', sort: (o) => o.shift, cell: (o) => <Badge tone={o.shift === kpi?.shift ? 'accent' : 'neutral'}>Crew {o.shift}</Badge> },
    { key: 'status', header: 'Status', width: '90px', sort: (o) => o.status, cell: (o) => <Badge tone={o.status === 'active' ? 'ok' : o.status === 'leave' ? 'warn' : 'info'}>{o.status}</Badge> },
    { key: 'machines', header: 'Machines', width: 'minmax(110px,1fr)', cell: (o) => <span className="text-muted">{o.machines.join(', ') || '—'}</span> },
    { key: 'loads', header: 'Loads 7d', width: '90px', align: 'right', sort: (o) => o.loads7d, cell: (o) => <span className="tnum">{num(o.loads7d)}</span> },
    { key: 'tonnes', header: 'Tonnes 7d', width: '100px', align: 'right', sort: (o) => o.tonnes7d, cell: (o) => <span className="tnum">{num(o.tonnes7d)}</span> },
    { key: 'cyc', header: 'Avg cycle', width: '90px', align: 'right', sort: (o) => o.avgCycleMin, cell: (o) => <span className="tnum text-muted">{o.avgCycleMin ? `${o.avgCycleMin} min` : '—'}</span> },
    { key: 'events', header: 'Safety events', width: '110px', align: 'right', sort: (o) => o.events7d, cell: (o) => <span className={o.events7d > 3 ? 'tnum text-warn' : 'tnum text-muted'}>{o.events7d}</span> },
    { key: 'score', header: 'Score', width: '70px', align: 'right', sort: (o) => o.safetyScore, cell: (o) => <span className={o.safetyScore < 80 ? 'tnum text-warn' : 'tnum'}>{o.safetyScore}</span> },
    { key: 'm', header: '', width: '44px', cell: (o) => canManage && (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Operator actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setDlg({ open: true, op: o })}>Edit</MenuItem>
        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => remove(o)}>Remove</MenuItem>
      </Menu>
    ) },
  ];

  const operated = boot.machines.filter((m) => m.type !== 'lv' || true);
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_480px]">
      <Card title="Operators" subtitle={`${q.data?.operators.length ?? 0} people across three crews`} flush
        actions={canManage && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg({ open: true, op: null })}>Add operator</Button>}>
        <div className="border-b border-line p-3"><SearchInput value={search} onChange={setSearch} placeholder="Search by name or employee number" className="max-w-sm" /></div>
        <DataTable columns={cols} rows={ops} rowKey={(o) => o.id} loading={q.loading} height="calc(100vh - 360px)" initialSort={{ key: 'tonnes', dir: 'desc' }} />
      </Card>
      <Card title="Shift roster" subtitle="Who operates which machine on each shift"
        actions={<Segmented size="sm" value={shift} onChange={setShift} options={(['A', 'B', 'C'] as ShiftCode[]).map((s) => ({ value: s, label: `${s} · ${names[s]}` }))} />}>
        <div className="mb-3 grid grid-cols-3 gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
          <Stat label="Crew size" value={crew.length} />
          <Stat label="On leave" value={crew.filter((o) => o.status === 'leave').length} tone="warn" />
          <Stat label="Now on shift" value={kpi?.shift === shift ? 'Yes' : 'No'} tone={kpi?.shift === shift ? 'ok' : 'neutral'} />
        </div>
        <ul className="scroll-thin flex max-h-[calc(100vh-430px)] flex-col gap-1 overflow-y-auto pr-1">
          {operated.map((m) => {
            const opId = rosterFor(m.id);
            return (
              <li key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/[0.03]">
                <div className="w-28 shrink-0"><p className="text-sm font-medium">{m.id}</p><p className="text-[11px] text-muted">{TYPE_LABEL[m.type]}</p></div>
                {canManage ? (
                  <Select aria-label={`Operator for ${m.id}`} value={opId ?? ''} className="flex-1" onChange={(e) => setRoster(m.id, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Unassigned</option>
                    {crew.filter((o) => o.status !== 'leave' || o.id === opId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                ) : <span className="flex-1 text-sm">{opId ? opsById.get(opId)?.name : '—'}</span>}
                {kpi?.shift === shift && live[m.id]?.op && <UserRound className="h-3.5 w-3.5 text-ok" aria-label="On duty now" />}
              </li>
            );
          })}
        </ul>
      </Card>
      <OperatorDialog open={dlg.open} op={dlg.op} onOpenChange={(v) => setDlg({ open: v, op: v ? dlg.op : null })} onSaved={() => { q.reload(); void refreshBoot(); }} />
    </div>
  );
}
