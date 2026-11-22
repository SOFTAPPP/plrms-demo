import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Database, History, MapPinned, Moon, MoreHorizontal, Palette as PaletteIcon, Pencil, Plus, RefreshCcw, Settings2, Sliders, Sun, Target, Trash2, Truck, Users,
} from 'lucide-react';
import { useApp, useBoot } from '../lib/app-store';
import { useQuery } from '../lib/hooks';
import { del, patch, post, put } from '../lib/api';
import { bytes, dateTime, num } from '../lib/format';
import { useLive } from '../lib/live';
import type { CameraMeta, MachineMeta, RouteMeta, Settings } from '../lib/types';
import { DIMENSIONS, GROUP_LABEL, type SensorDef, type SensorGroup, type UnitPrefs } from '../../shared/sensors';
import { CAMERA_LABEL, MACHINE_TYPES, ROLE_LABEL, TYPE_LABEL, can, type CameraPosition, type Role } from '../../shared/types';
import { NODE_BY_ID, NODES } from '../../shared/site';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, cn, ErrorState, PageHeader, Skeleton, Stat } from '../components/ui/core';
import { Checkbox, Field, Input, SearchInput, Select, Switch } from '../components/ui/form';
import { Dialog, Menu, MenuItem, MenuSeparator, confirmAction } from '../components/ui/overlay';
import { DataTable, type Col } from '../components/ui/table';
import { MachineForm } from '../components/machine/MachineForm';

// ---------------------------------------------------------------- users

interface UserRow { id: number; email: string; name: string; role: Role; active: boolean; createdAt: number; lastLoginAt: number | null }

function UserDialog({ open, onOpenChange, user, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; user: UserRow | null; onSaved: () => void }) {
  const [f, setF] = useState({ email: '', name: '', role: 'viewer' as Role, password: '', active: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF(user ? { email: user.email, name: user.name, role: user.role, password: '', active: user.active } : { email: '', name: '', role: 'viewer', password: '', active: true });
  }, [open, user]);
  const save = async () => {
    setBusy(true);
    try {
      if (user) await patch(`/users/${user.id}`, { name: f.name, role: f.role, active: f.active, password: f.password || undefined });
      else await post('/users', f);
      toast.success(user ? 'User updated' : 'User created');
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={user ? `Edit ${user.name}` : 'Add user'}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}
        disabled={!f.name || (!user && (!f.email || f.password.length < 8)) || (Boolean(user) && f.password.length > 0 && f.password.length < 8)}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" className="col-span-2"><Input type="email" value={f.email} disabled={Boolean(user)} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        <Field label={user ? 'Reset password' : 'Password'} hint={user ? 'Leave empty to keep the current password' : 'At least 8 characters'} className="col-span-2">
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        {user && <div className="col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Account active" /></div>}
      </div>
      <div className="mt-4 rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted">
        <p><b className="text-fg">Administrator</b> — everything, including users, setup and demo reset.</p>
        <p><b className="text-fg">Supervisor</b> — dispatch, crews, maintenance, alerts and demo scenarios.</p>
        <p><b className="text-fg">Operator</b> — acknowledge alerts, log refuels and downtime, take snapshots.</p>
        <p><b className="text-fg">Viewer</b> — read-only access to every screen.</p>
      </div>
    </Dialog>
  );
}

function UsersTab() {
  const me = useBoot().user;
  const q = useQuery<UserRow[]>('/users');
  const [dlg, setDlg] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const remove = async (u: UserRow) => {
    if (!(await confirmAction({ title: `Delete ${u.name}?`, message: u.email, danger: true, confirmLabel: 'Delete' }))) return;
    try { await del(`/users/${u.id}`); toast.success('User deleted'); q.reload(); } catch (err) { toast.error((err as Error).message); }
  };
  const cols: Col<UserRow>[] = [
    { key: 'name', header: 'User', width: 'minmax(220px,2fr)', sort: (u) => u.name, cell: (u) => (
      <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{u.name.split(' ').map((s) => s[0]).join('').slice(0, 2)}</span>
        <div><p className="font-medium">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></div></div>
    ) },
    { key: 'role', header: 'Role', width: '140px', sort: (u) => u.role, cell: (u) => <Badge tone={u.role === 'admin' ? 'accent' : u.role === 'supervisor' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge> },
    { key: 'active', header: 'Status', width: '100px', cell: (u) => <Badge tone={u.active ? 'ok' : 'neutral'} dot>{u.active ? 'Active' : 'Disabled'}</Badge> },
    { key: 'last', header: 'Last sign-in', width: '160px', sort: (u) => u.lastLoginAt, cell: (u) => <span className="text-muted">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</span> },
    { key: 'm', header: '', width: '44px', cell: (u) => (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="User actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setDlg({ open: true, user: u })}>Edit / reset password</MenuItem>
        {u.id !== me.id && <><MenuSeparator /><MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => remove(u)}>Delete</MenuItem></>}
      </Menu>
    ) },
  ];
  return (
    <Card flush title="Users & roles" subtitle="Passwords are stored hashed with bcrypt" actions={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg({ open: true, user: null })}>Add user</Button>}>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : <DataTable columns={cols} rows={q.data ?? []} rowKey={(u) => u.id} loading={q.loading} />}
      <UserDialog open={dlg.open} user={dlg.user} onOpenChange={(v) => setDlg({ open: v, user: v ? dlg.user : null })} onSaved={q.reload} />
    </Card>
  );
}

// ---------------------------------------------------------------- sensors & thresholds

function SensorDialog({ open, onOpenChange, def, catalogue, existing, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; def: SensorDef | null; catalogue: SensorDef[]; existing: string[]; onSaved: () => void;
}) {
  const blank: SensorDef = { key: '', label: '', dimension: 'percent', group: 'engine', types: ['truck'], min: 0, max: 100, dir: 'high', warn: null, crit: null, decimals: 1, enabled: true };
  const [f, setF] = useState<SensorDef>(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(def ?? blank); }, [open, def]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = catalogue.filter((c) => !existing.includes(c.key));
  const save = async () => {
    setBusy(true);
    try {
      if (def) await put(`/sensor-defs/${def.key}`, f); else await post('/sensor-defs', f);
      toast.success(def ? 'Sensor updated — new limits apply immediately' : 'Sensor added');
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  const numOrNull = (v: string) => (v === '' ? null : Number(v));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={def ? `Edit ${def.label}` : 'Add sensor'} description="Values are stored in base units (°C, psi, bar, km/h, t, L). Display units are set under KPI targets & units."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.key || !f.label || !f.types.length} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!def && (
          <Field label="Signal" className="col-span-2 md:col-span-4" hint="Pick a telemetry signal from the catalogue, or type a new key for a custom sensor">
            <div className="flex gap-2">
              <Select value="" onChange={(e) => { const c = catalogue.find((x) => x.key === e.target.value); if (c) setF(c); }} className="w-64">
                <option value="">From catalogue…</option>
                {available.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
              </Select>
              <Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="custom_key" />
            </div>
          </Field>
        )}
        <Field label="Label" className="col-span-2"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Unit type"><Select value={f.dimension} onChange={(e) => setF({ ...f, dimension: e.target.value as SensorDef['dimension'] })}>{DIMENSIONS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Group"><Select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value as SensorGroup })}>{(Object.keys(GROUP_LABEL) as SensorGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</Select></Field>
        <Field label="Scale min"><Input type="number" value={f.min} onChange={(e) => setF({ ...f, min: Number(e.target.value) })} /></Field>
        <Field label="Scale max"><Input type="number" value={f.max} onChange={(e) => setF({ ...f, max: Number(e.target.value) })} /></Field>
        <Field label="Alert when"><Select value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value as SensorDef['dir'] })}><option value="high">Above limit</option><option value="low">Below limit</option><option value="none">Never (display only)</option></Select></Field>
        <Field label="Decimals"><Input type="number" min={0} max={3} value={f.decimals} onChange={(e) => setF({ ...f, decimals: Number(e.target.value) })} /></Field>
        <Field label="Warning limit"><Input type="number" value={f.warn ?? ''} disabled={f.dir === 'none'} onChange={(e) => setF({ ...f, warn: numOrNull(e.target.value) })} /></Field>
        <Field label="Critical limit"><Input type="number" value={f.crit ?? ''} disabled={f.dir === 'none'} onChange={(e) => setF({ ...f, crit: numOrNull(e.target.value) })} /></Field>
        <div className="col-span-2 flex items-end pb-1.5"><Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Enabled" /></div>
        <Field label="Applies to" className="col-span-2 md:col-span-4">
          <div className="flex flex-wrap gap-3">
            {MACHINE_TYPES.map((t) => <Checkbox key={t} label={TYPE_LABEL[t]} checked={f.types.includes(t)} onChange={(v) => setF({ ...f, types: v ? [...f.types, t] : f.types.filter((x) => x !== t) })} />)}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

function SensorsTab() {
  const refresh = useApp((s) => s.refresh);
  const q = useQuery<{ defs: SensorDef[]; catalogue: SensorDef[] }>('/sensor-defs');
  const [dlg, setDlg] = useState<{ open: boolean; def: SensorDef | null }>({ open: false, def: null });
  const saved = () => { q.reload(); void refresh(); };
  const toggle = async (d: SensorDef) => {
    try { await put(`/sensor-defs/${d.key}`, { ...d, enabled: !d.enabled }); saved(); } catch (err) { toast.error((err as Error).message); }
  };
  const remove = async (d: SensorDef) => {
    if (!(await confirmAction({ title: `Remove ${d.label}?`, message: 'It disappears from panels and stops raising alerts. You can add it back from the catalogue.', danger: true, confirmLabel: 'Remove' }))) return;
    try { await del(`/sensor-defs/${d.key}`); saved(); } catch (err) { toast.error((err as Error).message); }
  };
  const cols: Col<SensorDef>[] = [
    { key: 'label', header: 'Sensor', width: 'minmax(200px,1.6fr)', sort: (d) => d.label, cell: (d) => <div><p className="font-medium">{d.label}</p><p className="font-mono text-[11px] text-muted">{d.key}</p></div> },
    { key: 'group', header: 'Group', width: '120px', sort: (d) => d.group, cell: (d) => <span className="text-muted">{GROUP_LABEL[d.group]}</span> },
    { key: 'dim', header: 'Unit', width: '100px', cell: (d) => <span className="text-muted">{d.dimension.replace('_', ' ')}</span> },
    { key: 'types', header: 'Machines', width: 'minmax(160px,1.4fr)', cell: (d) => <span className="truncate text-xs text-muted">{d.types.length === 8 ? 'All machines' : d.types.map((t) => TYPE_LABEL[t]).join(', ')}</span> },
    { key: 'rule', header: 'Alert rule', width: '200px', cell: (d) => d.dir === 'none' ? <span className="text-faint">Display only</span> : (
      <span className="text-xs">{d.dir === 'high' ? '≥' : '≤'} <Badge tone="warn">{d.warn ?? '—'}</Badge> warn · <Badge tone="crit">{d.crit ?? '—'}</Badge> crit</span>
    ) },
    { key: 'en', header: 'Enabled', width: '90px', cell: (d) => <Switch size="sm" checked={d.enabled} onChange={() => toggle(d)} label={`Enable ${d.label}`} /> },
    { key: 'm', header: '', width: '44px', cell: (d) => (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Sensor actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setDlg({ open: true, def: d })}>Edit thresholds</MenuItem>
        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => remove(d)}>Remove</MenuItem>
      </Menu>
    ) },
  ];
  return (
    <Card flush title="Sensor definitions & alert thresholds" subtitle="Changes apply to the live fleet immediately"
      actions={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg({ open: true, def: null })}>Add sensor</Button>}>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : <DataTable columns={cols} rows={q.data?.defs ?? []} rowKey={(d) => d.key} loading={q.loading} height="calc(100vh - 330px)" />}
      <SensorDialog open={dlg.open} def={dlg.def} catalogue={q.data?.catalogue ?? []} existing={(q.data?.defs ?? []).map((d) => d.key)}
        onOpenChange={(v) => setDlg({ open: v, def: v ? dlg.def : null })} onSaved={saved} />
    </Card>
  );
}

// ---------------------------------------------------------------- targets, alerts and units

function useSettingForm<K extends keyof Settings>(key: K) {
  const boot = useBoot();
  const refresh = useApp((s) => s.refresh);
  const [v, setV] = useState<Settings[K]>(boot.settings[key]);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(boot.settings[key]), [boot.settings, key]);
  const save = async () => {
    setBusy(true);
    try { await put(`/settings/${key}`, { value: v }); await refresh(); toast.success('Saved'); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return { v, setV, save, busy, dirty: JSON.stringify(v) !== JSON.stringify(boot.settings[key]) };
}

function TargetsTab() {
  const k = useSettingForm('kpiTargets');
  const a = useSettingForm('alerts');
  const u = useSettingForm('units');
  const kf = (name: keyof Settings['kpiTargets'], label: string, hint?: string) => (
    <Field label={label} hint={hint}><Input type="number" value={k.v[name]} onChange={(e) => k.setV({ ...k.v, [name]: Number(e.target.value) })} /></Field>
  );
  const unit = <K extends keyof UnitPrefs>(name: K, label: string, opts: [UnitPrefs[K], string][]) => (
    <Field label={label}><Select value={u.v[name]} onChange={(e) => u.setV({ ...u.v, [name]: e.target.value as UnitPrefs[K] })}>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</Select></Field>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="KPI targets" subtitle="Used by dashboards, production and reports" className="xl:row-span-2"
        actions={<Button size="sm" variant="primary" disabled={!k.dirty} loading={k.busy} onClick={k.save}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3">
          {kf('dailyTonnes', 'Daily tonnes', 'Mine day, all material')}
          {kf('tph', 'Throughput (t/h)')}
          {kf('availability', 'Availability %')}
          {kf('utilisation', 'Utilisation %')}
          {kf('cycleMin', 'Target cycle (min)')}
          {kf('maxQueueMin', 'Max truck queue (min)')}
          {kf('fuelLPerTonne', 'Fuel per tonne (L/t)')}
        </div>
      </Card>
      <Card title="Alert behaviour" actions={<Button size="sm" variant="primary" disabled={!a.dirty} loading={a.busy} onClick={a.save}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Overspeed margin (km/h)" hint="Above the zone limit"><Input type="number" value={a.v.overspeedMargin} onChange={(e) => a.setV({ ...a.v, overspeedMargin: Number(e.target.value) })} /></Field>
          <Field label="Proximity distance (m)" hint="Light vehicle to heavy equipment"><Input type="number" value={a.v.proximityM} onChange={(e) => a.setV({ ...a.v, proximityM: Number(e.target.value) })} /></Field>
          <Field label="Auto-close after (min)" hint="Warnings without new events"><Input type="number" value={a.v.autoCloseMin} onChange={(e) => a.setV({ ...a.v, autoCloseMin: Number(e.target.value) })} /></Field>
          <div className="flex items-end pb-1.5"><Switch checked={a.v.fatigueEnabled} onChange={(v) => a.setV({ ...a.v, fatigueEnabled: v })} label="Fatigue & distraction detection" /></div>
        </div>
      </Card>
      <Card title="Display units" subtitle="Sensors are converted on screen and in reports" actions={<Button size="sm" variant="primary" disabled={!u.dirty} loading={u.busy} onClick={u.save}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {unit('temp', 'Temperature', [['C', '°C'], ['F', '°F']])}
          {unit('pressure', 'Pressure', [['psi', 'psi'], ['bar', 'bar'], ['kPa', 'kPa']])}
          {unit('speed', 'Speed', [['kmh', 'km/h'], ['mph', 'mph']])}
          {unit('mass', 'Mass', [['t', 'tonnes'], ['st', 'short tons']])}
          {unit('volume', 'Volume', [['L', 'litres'], ['gal', 'US gallons']])}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- site, shifts and routes

function RouteDialog({ open, onOpenChange, route, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; route: RouteMeta | null; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', loaderNode: 'F-N1', destNode: 'CR', material: 'ore', targetCycleMin: 18, active: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF(route ? { name: route.name, loaderNode: route.loaderNode, destNode: route.destNode, material: route.material, targetCycleMin: route.targetCycleMin, active: route.active }
      : { name: '', loaderNode: 'F-N1', destNode: 'CR', material: 'ore', targetCycleMin: 18, active: true });
  }, [open, route]);
  const save = async () => {
    setBusy(true);
    try {
      if (route) await patch(`/routes/${route.id}`, f); else await post('/routes', f);
      toast.success('Route saved');
      onSaved();
      onOpenChange(false);
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  const loadPoints = NODES.filter((n) => n.kind === 'face' || n.kind === 'rom');
  const dests = NODES.filter((n) => n.kind === 'crusher' || n.kind === 'dump' || n.kind === 'rom');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={route ? `Edit ${route.id}` : 'New haul route'} description="Distance is calculated along the haul-road network."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.name} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Loading point"><Select value={f.loaderNode} disabled={Boolean(route)} onChange={(e) => setF({ ...f, loaderNode: e.target.value })}>{loadPoints.map((n) => <option key={n.id} value={n.id}>{n.zone}</option>)}</Select></Field>
        <Field label="Destination"><Select value={f.destNode} disabled={Boolean(route)} onChange={(e) => setF({ ...f, destNode: e.target.value })}>{dests.map((n) => <option key={n.id} value={n.id}>{n.zone}</option>)}</Select></Field>
        <Field label="Material"><Select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}><option value="ore">Ore</option><option value="waste">Waste</option></Select></Field>
        <Field label="Target cycle (min)"><Input type="number" value={f.targetCycleMin} onChange={(e) => setF({ ...f, targetCycleMin: Number(e.target.value) })} /></Field>
        {route && <div className="col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>}
      </div>
    </Dialog>
  );
}

function SiteTab() {
  const boot = useBoot();
  const refresh = useApp((s) => s.refresh);
  const site = useSettingForm('site');
  const shifts = useSettingForm('shifts');
  const [dlg, setDlg] = useState<{ open: boolean; route: RouteMeta | null }>({ open: false, route: null });
  const removeRoute = async (r: RouteMeta) => {
    if (!(await confirmAction({ title: `Delete ${r.id}?`, message: r.name, danger: true, confirmLabel: 'Delete' }))) return;
    try { await del(`/routes/${r.id}`); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const cols: Col<RouteMeta>[] = [
    { key: 'id', header: 'Route', width: 'minmax(220px,2fr)', sort: (r) => r.id, cell: (r) => <div><p className="font-medium">{r.id} · {r.name}</p><p className="text-xs text-muted">{NODE_BY_ID[r.loaderNode]?.zone} → {NODE_BY_ID[r.destNode]?.zone}</p></div> },
    { key: 'mat', header: 'Material', width: '90px', cell: (r) => <Badge tone={r.material === 'ore' ? 'accent' : 'neutral'}>{r.material}</Badge> },
    { key: 'km', header: 'Distance', width: '90px', align: 'right', cell: (r) => <span className="tnum">{r.distanceKm} km</span> },
    { key: 'c', header: 'Target cycle', width: '110px', align: 'right', cell: (r) => <span className="tnum">{r.targetCycleMin} min</span> },
    { key: 'a', header: 'Status', width: '90px', cell: (r) => <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Active' : 'Closed'}</Badge> },
    { key: 'm', header: '', width: '44px', cell: (r) => (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Route actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setDlg({ open: true, route: r })}>Edit</MenuItem>
        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => removeRoute(r)}>Delete</MenuItem>
      </Menu>
    ) },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Site details" actions={<Button size="sm" variant="primary" disabled={!site.dirty} loading={site.busy} onClick={site.save}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site name"><Input value={site.v.name} onChange={(e) => site.setV({ ...site.v, name: e.target.value })} /></Field>
          <Field label="Company"><Input value={site.v.company} onChange={(e) => site.setV({ ...site.v, company: e.target.value })} /></Field>
          <Field label="Location"><Input value={site.v.location} onChange={(e) => site.setV({ ...site.v, location: e.target.value })} /></Field>
          <Field label="Commodity"><Input value={site.v.commodity} onChange={(e) => site.setV({ ...site.v, commodity: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Shift pattern" subtitle="Three 8-hour shifts" actions={<Button size="sm" variant="primary" disabled={!shifts.dirty} loading={shifts.busy} onClick={shifts.save}>Save</Button>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Shift A starts" hint="Hour of day"><Select value={shifts.v.aStartHour} onChange={(e) => shifts.setV({ ...shifts.v, aStartHour: Number(e.target.value) })}>
            {Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</Select></Field>
          {(['A', 'B', 'C'] as const).map((s) => (
            <Field key={s} label={`Shift ${s} name`}><Input value={shifts.v.names[s]} onChange={(e) => shifts.setV({ ...shifts.v, names: { ...shifts.v.names, [s]: e.target.value } })} /></Field>
          ))}
        </div>
      </Card>
      <Card flush title="Haul routes" className="xl:col-span-2" actions={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDlg({ open: true, route: null })}>Add route</Button>}>
        <DataTable columns={cols} rows={boot.routes} rowKey={(r) => r.id} />
      </Card>
      <RouteDialog open={dlg.open} route={dlg.route} onOpenChange={(v) => setDlg({ open: v, route: v ? dlg.route : null })} onSaved={() => void refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------- machines & cameras

function CameraDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const boot = useBoot();
  const [f, setF] = useState({ machineId: boot.machines[0]?.id ?? '', position: 'front' as CameraPosition, label: '', resolution: '1920x1080', fps: 25 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await post('/cameras', f); toast.success('Camera added'); onSaved(); onOpenChange(false); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add camera" footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Machine"><Select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>{boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}</Select></Field>
        <Field label="Position"><Select value={f.position} onChange={(e) => setF({ ...f, position: e.target.value as CameraPosition })}>{(Object.keys(CAMERA_LABEL) as CameraPosition[]).map((p) => <option key={p} value={p}>{CAMERA_LABEL[p]}</option>)}</Select></Field>
        <Field label="Label" className="col-span-2"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Optional" /></Field>
        <Field label="Resolution"><Select value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })}><option>1280x720</option><option>1920x1080</option><option>2560x1440</option></Select></Field>
        <Field label="Frame rate"><Input type="number" min={5} max={30} value={f.fps} onChange={(e) => setF({ ...f, fps: Number(e.target.value) })} /></Field>
      </div>
    </Dialog>
  );
}

function EquipmentTab() {
  const boot = useBoot();
  const refresh = useApp((s) => s.refresh);
  const live = useLive((s) => s.machines);
  const [form, setForm] = useState<{ open: boolean; m: MachineMeta | null }>({ open: false, m: null });
  const [camDlg, setCamDlg] = useState(false);
  const [camFilter, setCamFilter] = useState('');
  const [q, setQ] = useState('');
  const cams = boot.cameras.filter((c) => !camFilter || c.machineId === camFilter);
  const updateCam = async (c: CameraMeta, body: Partial<CameraMeta>) => {
    try { await patch(`/cameras/${c.id}`, body); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const removeCam = async (c: CameraMeta) => {
    if (!(await confirmAction({ title: `Remove camera ${c.id}?`, message: 'The feed disappears from the camera wall.', danger: true, confirmLabel: 'Remove' }))) return;
    try { await del(`/cameras/${c.id}`); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const removeMachine = async (m: MachineMeta) => {
    if (!(await confirmAction({ title: `Delete ${m.id}?`, message: 'The machine, its cameras and roster entries are removed.', danger: true, confirmLabel: 'Delete' }))) return;
    try { await del(`/machines/${m.id}`); await refresh(); toast.success(`${m.id} deleted`); } catch (err) { toast.error((err as Error).message); }
  };
  const mCols: Col<MachineMeta>[] = [
    { key: 'id', header: 'Machine', width: 'minmax(160px,1.4fr)', sort: (m) => m.id, cell: (m) => <div><p className="font-medium">{m.id} <span className="font-normal text-muted">· {m.name}</span></p><p className="text-xs text-muted">{m.make} {m.model} ({m.year})</p></div> },
    { key: 'type', header: 'Type', width: '120px', sort: (m) => m.type, cell: (m) => <span className="text-muted">{TYPE_LABEL[m.type]}</span> },
    { key: 'cap', header: 'Capacity', width: '100px', align: 'right', cell: (m) => <span className="tnum">{m.capacity}</span> },
    { key: 'fuel', header: 'Tank', width: '90px', align: 'right', cell: (m) => <span className="tnum text-muted">{num(m.fuelCapacity)} L</span> },
    { key: 'svc', header: 'Service', width: '110px', cell: (m) => <Badge tone={m.inService ? 'ok' : 'neutral'}>{m.inService ? 'In service' : 'Out of service'}</Badge> },
    { key: 'cams', header: 'Cameras', width: '80px', align: 'right', cell: (m) => boot.cameras.filter((c) => c.machineId === m.id).length },
    { key: 'm', header: '', width: '44px', cell: (m) => (
      <Menu trigger={<Button size="icon-sm" variant="ghost" aria-label="Machine actions"><MoreHorizontal className="h-4 w-4" /></Button>}>
        <MenuItem icon={<Pencil className="h-4 w-4" />} onSelect={() => setForm({ open: true, m })}>Edit</MenuItem>
        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => removeMachine(m)}>Delete</MenuItem>
      </Menu>
    ) },
  ];
  const cCols: Col<CameraMeta>[] = [
    { key: 'id', header: 'Camera', width: 'minmax(170px,1.4fr)', sort: (c) => c.id, cell: (c) => <div><p className="font-medium">{c.machineId} · {CAMERA_LABEL[c.position]}</p><p className="text-xs text-muted">{c.label}</p></div> },
    { key: 'res', header: 'Stream', width: '140px', cell: (c) => <span className="text-muted">{c.resolution} · {c.fps} fps</span> },
    { key: 'st', header: 'Signal', width: '90px', cell: (c) => live[c.machineId]?.camOff?.includes(c.id) ? <Badge tone="crit">Lost</Badge> : <Badge tone="ok" dot>OK</Badge> },
    { key: 'en', header: 'Enabled', width: '80px', cell: (c) => <Switch size="sm" checked={c.enabled} onChange={(v) => updateCam(c, { enabled: v })} label={`Enable ${c.id}`} /> },
    { key: 'rec', header: 'Recording', width: '90px', cell: (c) => <Switch size="sm" checked={c.recording} onChange={(v) => updateCam(c, { recording: v })} label={`Record ${c.id}`} /> },
    { key: 'm', header: '', width: '44px', cell: (c) => <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c.id}`} onClick={() => removeCam(c)}><Trash2 className="h-3.5 w-3.5" /></Button> },
  ];
  const machines = boot.machines.filter((m) => !q || `${m.id} ${m.name} ${m.model}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <Card flush title="Machines" subtitle={`${boot.machines.length} in the fleet`} actions={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setForm({ open: true, m: null })}>Add machine</Button>}>
        <div className="border-b border-line p-3"><SearchInput value={q} onChange={setQ} placeholder="Search machines" className="max-w-xs" /></div>
        <DataTable columns={mCols} rows={machines} rowKey={(m) => m.id} height={520} />
      </Card>
      <Card flush title="Cameras" subtitle={`${boot.cameras.length} cameras`} actions={<div className="flex gap-2">
        <Select aria-label="Filter by machine" value={camFilter} onChange={(e) => setCamFilter(e.target.value)} className="w-36"><option value="">All machines</option>{boot.machines.map((m) => <option key={m.id}>{m.id}</option>)}</Select>
        <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCamDlg(true)}>Add camera</Button>
      </div>}>
        <DataTable columns={cCols} rows={cams} rowKey={(c) => c.id} height={572} />
      </Card>
      <MachineForm open={form.open} onOpenChange={(o) => setForm({ open: o, m: o ? form.m : null })} machine={form.m} />
      <CameraDialog open={camDlg} onOpenChange={setCamDlg} onSaved={() => void refresh()} />
    </div>
  );
}

// ---------------------------------------------------------------- appearance, audit, data

function AppearanceTab() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const muted = useApp((s) => s.muted);
  const setMuted = useApp((s) => s.setMuted);
  const saveLayout = useApp((s) => s.saveLayout);
  const options: { v: 'dark' | 'light'; label: string; icon: typeof Sun; bg: string; panel: string; fg: string }[] = [
    { v: 'dark', label: 'Control room (dark)', icon: Moon, bg: '#131313', panel: '#1b1b1b', fg: '#ededed' },
    { v: 'light', label: 'Daylight (light)', icon: Sun, bg: '#eef1f5', panel: '#ffffff', fg: '#0e1726' },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Theme" subtitle="Saved to your account">
        <div className="grid grid-cols-2 gap-3">
          {options.map((o) => (
            <button key={o.v} type="button" onClick={() => setTheme(o.v)} aria-pressed={theme === o.v}
              className={cn('overflow-hidden rounded-xl border-2 text-left transition-colors', theme === o.v ? 'border-accent' : 'border-line hover:border-line-strong')}>
              <div className="flex h-28 gap-2 p-3" style={{ background: o.bg }}>
                <div className="w-1/4 rounded-md" style={{ background: o.panel }} />
                <div className="flex flex-1 flex-col gap-2"><div className="h-6 rounded-md" style={{ background: o.panel }} /><div className="flex-1 rounded-md" style={{ background: o.panel }}><div className="m-2 h-2 w-1/2 rounded bg-[#f5a524]" /></div></div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium"><o.icon className="h-4 w-4" />{o.label}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Behaviour">
        <div className="flex flex-col gap-4">
          <Switch checked={!muted} onChange={(v) => setMuted(!v)} label="Show alert pop-ups" />
          <div>
            <p className="text-sm">Dashboard layout</p>
            <p className="mb-2 text-xs text-muted">Widgets can be rearranged with Customise on the Command page.</p>
            <Button size="sm" icon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={() => { saveLayout([]); toast.success('Dashboard layout reset'); }}>Reset dashboard layout</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AuditTab() {
  const q = useQuery<{ id: number; ts: number; userName: string; action: string; detail: string }[]>('/audit?limit=500', { refreshMs: 15_000 });
  const cols: Col<{ id: number; ts: number; userName: string; action: string; detail: string }>[] = [
    { key: 'ts', header: 'Time', width: '160px', sort: (r) => r.ts, cell: (r) => <span className="text-muted">{dateTime(r.ts, true)}</span> },
    { key: 'u', header: 'User', width: '160px', sort: (r) => r.userName, cell: (r) => r.userName },
    { key: 'a', header: 'Action', width: '170px', sort: (r) => r.action, cell: (r) => <Badge>{r.action}</Badge> },
    { key: 'd', header: 'Detail', width: 'minmax(240px,3fr)', cell: (r) => <span className="truncate text-muted">{r.detail}</span> },
  ];
  return <Card flush title="Audit log" subtitle="Every change made through the app"><DataTable columns={cols} rows={q.data ?? []} rowKey={(r) => r.id} loading={q.loading} height="calc(100vh - 320px)" /></Card>;
}

function DataTab() {
  const q = useQuery<{ dbPath: string; sizeBytes: number; counts: Record<string, number>; telemetryFrom: number | null; telemetryTo: number | null; historyDays: number }>('/data-info', { refreshMs: 30_000 });
  const setDemo = useApp((s) => s.setDemoOpen);
  if (!q.data) return <Skeleton className="h-64" />;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Database" subtitle={q.data.dbPath}>
        <div className="mb-4 grid grid-cols-3 gap-4">
          <Stat label="Size on disk" value={bytes(q.data.sizeBytes)} />
          <Stat label="History kept" value={`${q.data.historyDays} days`} />
          <Stat label="Telemetry from" value={q.data.telemetryFrom ? dateTime(q.data.telemetryFrom) : '—'} />
        </div>
        {Object.entries(q.data.counts).map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0"><span className="text-muted">{k.replace(/_/g, ' ')}</span><span className="tnum">{num(v)}</span></div>
        ))}
      </Card>
      <Card title="Retention & downsampling">
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li>• Telemetry is recorded every 10 s, thinned to 1 per minute after 2 hours and 1 per 5 minutes after 48 hours.</li>
          <li>• Telemetry older than the history window is deleted; events, alerts and fuel records are kept 35 days.</li>
          <li>• The 300 most recent snapshots are kept. Recorded clips live in the recording browser.</li>
          <li>• When the app has been closed, the missing hours are simulated on start-up so reports have no gaps.</li>
        </ul>
        <Button className="mt-4" variant="danger" icon={<RefreshCcw className="h-4 w-4" />} onClick={() => setDemo(true)}>Open demo control to reset data</Button>
      </Card>
    </div>
  );
}

const ADMIN_TABS = ['users', 'sensors', 'targets', 'site', 'equipment', 'appearance', 'audit', 'data'] as const;

export default function Admin() {
  const boot = useBoot();
  const isAdmin = can(boot.user.role, 'admin');
  const [tab, setTab] = useTabParam(ADMIN_TABS, isAdmin ? 'users' : 'appearance');
  const items = useMemo(() => [
    { value: 'users' as const, label: 'Users & roles', icon: <Users className="h-4 w-4" />, admin: true },
    { value: 'sensors' as const, label: 'Sensors & thresholds', icon: <Sliders className="h-4 w-4" />, admin: true },
    { value: 'targets' as const, label: 'KPI targets & units', icon: <Target className="h-4 w-4" />, admin: true },
    { value: 'site' as const, label: 'Site & routes', icon: <MapPinned className="h-4 w-4" />, admin: true },
    { value: 'equipment' as const, label: 'Machines & cameras', icon: <Truck className="h-4 w-4" />, admin: true },
    { value: 'appearance' as const, label: 'Appearance', icon: <PaletteIcon className="h-4 w-4" />, admin: false },
    { value: 'audit' as const, label: 'Audit log', icon: <History className="h-4 w-4" />, admin: true },
    { value: 'data' as const, label: 'Data & system', icon: <Database className="h-4 w-4" />, admin: true },
  ].filter((i) => isAdmin || !i.admin), [isAdmin]);
  const effective = items.some((i) => i.value === tab) ? tab : 'appearance';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Administration" subtitle={isAdmin ? 'Users, thresholds, targets, site configuration and equipment' : 'Personal preferences — other settings need an administrator'} icon={<Settings2 className="h-5 w-5" />} />
      <Tabs id="admin" value={effective} onChange={setTab} items={items} />
      {effective === 'users' && <UsersTab />}
      {effective === 'sensors' && <SensorsTab />}
      {effective === 'targets' && <TargetsTab />}
      {effective === 'site' && <SiteTab />}
      {effective === 'equipment' && <EquipmentTab />}
      {effective === 'appearance' && <AppearanceTab />}
      {effective === 'audit' && <AuditTab />}
      {effective === 'data' && <DataTab />}
    </div>
  );
}
