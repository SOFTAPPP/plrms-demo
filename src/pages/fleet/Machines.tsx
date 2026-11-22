import { useMemo, useState } from 'react';
import { useUnits } from '../../lib/units';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, MoreHorizontal, Pencil, Plus, Power, Trash2, Video } from 'lucide-react';
import { useApp, useBoot } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { del, patch } from '../../lib/api';
import { num } from '../../lib/format';
import { exportCsv } from '../../lib/export';
import type { MachineMeta } from '../../lib/types';
import { MACHINE_TYPES, STATUS_LABEL, TYPE_LABEL, can, type MachineLive, type MachineStatus, type MachineType } from '../../../shared/types';
import { DataTable, type Col } from '../../components/ui/table';
import { Badge, Button, Card, StatusPill } from '../../components/ui/core';
import { SearchInput, Select } from '../../components/ui/form';
import { Menu, MenuItem, MenuSeparator, confirmAction } from '../../components/ui/overlay';
import { Meter } from '../../components/ui/viz';
import { TYPE_ICON } from '../../components/machine/glyphs';
import { MachineForm } from '../../components/machine/MachineForm';
import { usePalette } from '../../lib/palette';

type Row = MachineMeta & { live?: MachineLive };

export function MachinesTab() {
  const boot = useBoot();
  const refresh = useApp((s) => s.refresh);
  const machines = useLive((s) => s.machines);
  const navigate = useNavigate();
  const p = usePalette();
  const U = useUnits();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState<MachineType | ''>('');
  const status = (sp.get('status') ?? '') as MachineStatus | '';
  const [form, setForm] = useState<{ open: boolean; m: MachineMeta | null }>({ open: false, m: null });
  const isAdmin = can(boot.user.role, 'admin');

  const rows: Row[] = useMemo(() => boot.machines.map((m) => ({ ...m, live: machines[m.id] }))
    .filter((r) => (!type || r.type === type) && (!status || r.live?.st === status))
    .filter((r) => !q || `${r.id} ${r.name} ${r.make} ${r.model} ${r.live?.op ?? ''} ${r.live?.zone ?? ''}`.toLowerCase().includes(q.toLowerCase())), [boot.machines, machines, q, type, status]);

  const toggleService = async (m: MachineMeta) => {
    const ok = await confirmAction({ title: m.inService ? `Take ${m.id} out of service?` : `Return ${m.id} to service?`,
      message: m.inService ? 'It stops in place and shows as offline until returned.' : 'It rejoins the simulation immediately.', confirmLabel: m.inService ? 'Take out' : 'Return' });
    if (!ok) return;
    try {
      await patch(`/machines/${m.id}`, { inService: !m.inService });
      await refresh();
      toast.success(`${m.id} ${m.inService ? 'taken out of service' : 'returned to service'}`);
    } catch (err) { toast.error((err as Error).message); }
  };
  const remove = async (m: MachineMeta) => {
    const ok = await confirmAction({ title: `Delete ${m.id}?`, message: 'The machine, its cameras and roster entries are removed. History stays in reports.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await del(`/machines/${m.id}`);
      await refresh();
      toast.success(`${m.id} deleted`);
    } catch (err) { toast.error((err as Error).message); }
  };

  const cols: Col<Row>[] = [
    { key: 'id', header: 'Machine', width: 'minmax(170px,1.2fr)', sort: (r) => r.id, cell: (r) => {
      const Icon = TYPE_ICON[r.type];
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${p.status[r.live?.st ?? 'offline']}1f`, color: p.status[r.live?.st ?? 'offline'] }}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0"><p className="font-medium">{r.id}</p><p className="truncate text-xs text-muted">{r.make} {r.model}</p></div>
        </div>
      );
    } },
    { key: 'type', header: 'Type', width: '110px', sort: (r) => r.type, cell: (r) => <span className="text-muted">{TYPE_LABEL[r.type]}</span> },
    { key: 'status', header: 'Status', width: '120px', sort: (r) => r.live?.st, cell: (r) => (r.live ? <StatusPill status={r.live.st} /> : <Badge>No data</Badge>) },
    { key: 'act', header: 'Activity', width: 'minmax(180px,1.4fr)', cell: (r) => <span className="truncate text-muted">{r.live?.act}</span> },
    { key: 'op', header: 'Operator', width: 'minmax(130px,1fr)', sort: (r) => r.live?.op, cell: (r) => <span className="truncate">{r.live?.op || <span className="text-faint">—</span>}</span> },
    { key: 'zone', header: 'Location', width: 'minmax(120px,1fr)', sort: (r) => r.live?.zone, cell: (r) => <span className="truncate text-muted">{r.live?.zone}</span> },
    { key: 'spd', header: 'Speed', width: '80px', align: 'right', sort: (r) => r.live?.spd, cell: (r) => <span className="tnum">{U.speed(r.live?.spd)}</span> },
    { key: 'fuel', header: 'Fuel', width: '110px', sort: (r) => r.live?.s.fuel_level, cell: (r) => {
      const f = r.live?.s.fuel_level ?? 0;
      return <div className="flex items-center gap-2"><Meter value={f} max={100} className="w-14" color={f < 15 ? 'var(--crit)' : f < 25 ? 'var(--warn)' : 'var(--ok)'} /><span className="tnum text-xs">{num(f)}%</span></div>;
    } },
    { key: 'hrs', header: 'Engine h', width: '90px', align: 'right', sort: (r) => r.live?.s.engine_hours, cell: (r) => <span className="tnum text-muted">{num(r.live?.s.engine_hours ?? r.engineHours)}</span> },
    { key: 'al', header: 'Alerts', width: '70px', align: 'center', sort: (r) => r.live?.al, cell: (r) => (r.live?.al ? <Badge tone="crit">{r.live.al}</Badge> : <span className="text-faint">0</span>) },
    { key: 'menu', header: '', width: '44px', cell: (r) => (
      <div onClick={(e) => e.stopPropagation()}>
        <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${r.id}`}><MoreHorizontal className="h-4 w-4" /></Button>}>
          <MenuItem icon={<Video className="h-4 w-4" />} onSelect={() => navigate(`/cameras?machine=${r.id}`)}>Cameras</MenuItem>
          {isAdmin && <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setForm({ open: true, m: r })}>Edit</MenuItem>}
          {isAdmin && <MenuItem icon={<Power className="h-4 w-4" />} onSelect={() => toggleService(r)}>{r.inService ? 'Take out of service' : 'Return to service'}</MenuItem>}
          {isAdmin && <><MenuSeparator /><MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => remove(r)}>Delete</MenuItem></>}
        </Menu>
      </div>
    ) },
  ];

  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search ID, model, operator, location" className="w-full sm:w-72" />
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as MachineType | '')} className="w-40">
          <option value="">All types</option>
          {MACHINE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set('status', e.target.value); else n.delete('status'); setSp(n, { replace: true }); }} className="w-40">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as MachineStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <span className="text-xs text-muted">{rows.length} of {boot.machines.length}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportCsv('fleet', [
            { key: 'id', label: 'Machine', value: (r: Row) => r.id }, { key: 'type', label: 'Type', value: (r) => TYPE_LABEL[r.type] },
            { key: 'model', label: 'Model', value: (r) => `${r.make} ${r.model}` }, { key: 'st', label: 'Status', value: (r) => r.live?.st },
            { key: 'act', label: 'Activity', value: (r) => r.live?.act }, { key: 'op', label: 'Operator', value: (r) => r.live?.op },
            { key: 'zone', label: 'Location', value: (r) => r.live?.zone }, { key: 'fuel', label: 'Fuel %', value: (r) => r.live?.s.fuel_level },
            { key: 'hrs', label: 'Engine hours', value: (r) => r.live?.s.engine_hours },
          ], rows)}>Export</Button>
          {isAdmin && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setForm({ open: true, m: null })}>Add machine</Button>}
        </div>
      </div>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/fleet/${r.id}`)} height="calc(100vh - 330px)" initialSort={{ key: 'id', dir: 'asc' }} />
      <MachineForm open={form.open} onOpenChange={(o) => setForm({ open: o, m: o ? form.m : null })} machine={form.m} />
    </Card>
  );
}
