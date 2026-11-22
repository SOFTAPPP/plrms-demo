import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { patch, post } from '../../lib/api';
import { useApp, useBoot } from '../../lib/app-store';
import type { MachineMeta } from '../../lib/types';
import { MACHINE_TYPES, TYPE_LABEL, type MachineType } from '../../../shared/types';
import { NODES } from '../../../shared/site';
import { Dialog } from '../ui/overlay';
import { Button } from '../ui/core';
import { Field, Input, Select, Switch, Textarea } from '../ui/form';

const DEFAULTS: Record<MachineType, { make: string; model: string; capacity: number; fuel: number }> = {
  truck: { make: 'Caterpillar', model: '793F', capacity: 227, fuel: 4540 },
  shovel: { make: 'Liebherr', model: 'R 9800', capacity: 75, fuel: 11000 },
  excavator: { make: 'Komatsu', model: 'PC4000-11', capacity: 40, fuel: 6700 },
  loader: { make: 'Caterpillar', model: '994K', capacity: 34, fuel: 4040 },
  dozer: { make: 'Caterpillar', model: 'D10T2', capacity: 35, fuel: 1000 },
  drill: { make: 'Epiroc', model: 'Pit Viper 271', capacity: 15, fuel: 1500 },
  water: { make: 'Caterpillar', model: '777G Water', capacity: 75, fuel: 1136 },
  lv: { make: 'Toyota', model: 'Land Cruiser 79', capacity: 1, fuel: 130 },
};

export function MachineForm({ open, onOpenChange, machine }: { open: boolean; onOpenChange: (v: boolean) => void; machine?: MachineMeta | null }) {
  const boot = useBoot();
  const refresh = useApp((s) => s.refresh);
  const editing = Boolean(machine);
  const [f, setF] = useState({ id: '', name: '', type: 'truck' as MachineType, make: '', model: '', year: 2024, capacity: 0, fuelCapacity: 0, homeNode: 'AD', loaderId: '', routeId: '', notes: '', inService: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (machine) {
      setF({ id: machine.id, name: machine.name, type: machine.type, make: machine.make, model: machine.model, year: machine.year, capacity: machine.capacity,
        fuelCapacity: machine.fuelCapacity, homeNode: machine.homeNode, loaderId: machine.loaderId ?? '', routeId: machine.routeId ?? '', notes: machine.notes ?? '', inService: machine.inService });
    } else {
      const d = DEFAULTS.truck;
      setF({ id: '', name: '', type: 'truck', make: d.make, model: d.model, year: 2025, capacity: d.capacity, fuelCapacity: d.fuel, homeNode: 'AD', loaderId: '', routeId: '', notes: '', inService: true });
    }
  }, [open, machine]);
  const loaders = boot.machines.filter((m) => m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader');
  const loaderNode = loaders.find((l) => l.id === f.loaderId)?.homeNode;
  const routes = boot.routes.filter((r) => r.active && (!loaderNode || r.loaderNode === loaderNode));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setType = (t: MachineType) => {
    const d = DEFAULTS[t];
    setF((x) => ({ ...x, type: t, make: d.make, model: d.model, capacity: d.capacity, fuelCapacity: d.fuel }));
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (editing) {
        await patch(`/machines/${machine!.id}`, { name: f.name, make: f.make, model: f.model, year: f.year, capacity: f.capacity, fuelCapacity: f.fuelCapacity, notes: f.notes, inService: f.inService });
        toast.success(`${machine!.id} updated`);
      } else {
        await post('/machines', { ...f, loaderId: f.type === 'truck' ? f.loaderId : undefined, routeId: f.type === 'truck' ? f.routeId : undefined });
        toast.success(`${f.id.toUpperCase()} added to the fleet`, { description: 'Default cameras and sensors were created.' });
      }
      await refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={editing ? `Edit ${machine!.id}` : 'Add machine'}
      description={editing ? 'Update the machine record.' : 'The machine joins the live simulation as soon as it is saved.'}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}
        disabled={!f.name || !f.id || (!editing && f.type === 'truck' && (!f.loaderId || !f.routeId))}>{editing ? 'Save changes' : 'Add machine'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Machine ID" hint="e.g. TRK-108"><Input value={f.id} disabled={editing} onChange={(e) => set('id', e.target.value.toUpperCase())} maxLength={16} /></Field>
        <Field label="Display name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Haul truck 108" /></Field>
        <Field label="Type">
          <Select value={f.type} disabled={editing} onChange={(e) => setType(e.target.value as MachineType)}>
            {MACHINE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Year"><Input type="number" value={f.year} onChange={(e) => set('year', Number(e.target.value))} /></Field>
        <Field label="Make"><Input value={f.make} onChange={(e) => set('make', e.target.value)} /></Field>
        <Field label="Model"><Input value={f.model} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label={f.type === 'truck' ? 'Rated payload (t)' : f.type === 'water' ? 'Tank (kL)' : f.type === 'drill' ? 'Max hole depth (m)' : 'Bucket / capacity (t)'}>
          <Input type="number" value={f.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />
        </Field>
        <Field label="Fuel tank (L)"><Input type="number" value={f.fuelCapacity} onChange={(e) => set('fuelCapacity', Number(e.target.value))} /></Field>
        {!editing && f.type === 'truck' && (
          <>
            <Field label="Loading unit">
              <Select value={f.loaderId} onChange={(e) => { set('loaderId', e.target.value); set('routeId', ''); }}>
                <option value="">Choose…</option>
                {loaders.map((l) => <option key={l.id} value={l.id}>{l.id} · {l.model}</option>)}
              </Select>
            </Field>
            <Field label="Haul route">
              <Select value={f.routeId} onChange={(e) => set('routeId', e.target.value)} disabled={!f.loaderId}>
                <option value="">Choose…</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
              </Select>
            </Field>
          </>
        )}
        {!editing && f.type !== 'truck' && (
          <Field label="Home location" className="sm:col-span-2">
            <Select value={f.homeNode} onChange={(e) => set('homeNode', e.target.value)}>
              {NODES.filter((n) => n.kind !== 'junction' || n.id === 'N40').map((n) => <option key={n.id} value={n.id}>{n.zone} ({n.id})</option>)}
            </Select>
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
        {editing && <div className="sm:col-span-2"><Switch checked={f.inService} onChange={(v) => set('inService', v)} label="In service (off = parked and offline)" /></div>}
      </div>
    </Dialog>
  );
}
