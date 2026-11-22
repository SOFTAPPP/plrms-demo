import { useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, BatteryLow, CameraOff, CircleGauge, Coffee, Flame, FlaskConical, Fuel, Gauge, Pause, Play, RefreshCcw, ShieldAlert, Smartphone, Truck, Users, Weight, Wrench,
} from 'lucide-react';
import { useApp } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { post } from '../../lib/api';
import { duration, time } from '../../lib/format';
import { Drawer, confirmAction } from '../ui/overlay';
import { Badge, Button } from '../ui/core';
import { Field, Segmented, Select } from '../ui/form';
import { can } from '../../../shared/types';

const SCENARIOS = [
  { kind: 'overload', label: 'Truck overload', icon: Weight, hint: 'Next load goes over 110 % of rated payload' },
  { kind: 'overheat', label: 'Engine overheat', icon: Flame, hint: 'Coolant temperature climbs past the limits' },
  { kind: 'breakdown', label: 'Breakdown', icon: Wrench, hint: 'Machine stops, work order and downtime raised' },
  { kind: 'low_fuel', label: 'Low fuel', icon: Fuel, hint: 'Tank drops to 6.5 %' },
  { kind: 'fuel_theft', label: 'Fuel theft', icon: BatteryLow, hint: 'Sudden level drop while parked' },
  { kind: 'fatigue', label: 'Operator fatigue', icon: Coffee, hint: 'Cabin camera detects eyes closed' },
  { kind: 'distraction', label: 'Phone use', icon: Smartphone, hint: 'Cabin camera detects phone use' },
  { kind: 'proximity', label: 'Collision risk', icon: ShieldAlert, hint: 'Light vehicle within 6 m of a truck' },
  { kind: 'overspeed', label: 'Overspeed', icon: Gauge, hint: 'Truck exceeds the zone speed limit' },
  { kind: 'tyre', label: 'Tyre leak', icon: CircleGauge, hint: 'One tyre slowly loses pressure' },
  { kind: 'camera', label: 'Camera offline', icon: CameraOff, hint: 'Front camera loses signal for 8 min' },
  { kind: 'shift_change', label: 'Shift change', icon: Users, hint: 'Crew handover now' },
];

export function DemoControl() {
  const open = useApp((s) => s.demoOpen);
  const boot = useApp((s) => s.boot);
  const setOpen = useApp((s) => s.setDemoOpen);
  const speed = useLive((s) => s.speed);
  const paused = useLive((s) => s.paused);
  const t = useLive((s) => s.t);
  const [machine, setMachine] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (!boot || !can(boot.user.role, 'manage')) return null;

  const run = async (kind: string) => {
    setBusy(kind);
    try {
      const r = await post<{ text: string }>('/demo/scenario', { kind, machineId: machine || undefined });
      toast.success(r.text);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    const ok = await confirmAction({
      title: 'Reset all demo data?',
      message: 'Every record is deleted and a fresh fleet with a new week of history is generated. This takes about 15 seconds.',
      confirmLabel: 'Reset data', danger: true,
    });
    if (!ok) return;
    setBusy('reset');
    const id = toast.loading('Regenerating a week of mine history…');
    try {
      await post('/demo/reset');
      toast.success('Demo data reset', { id });
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast.error((err as Error).message, { id });
    } finally {
      setBusy(null);
    }
  };

  const ahead = t - Date.now();
  return (
    <Drawer open={open} onOpenChange={setOpen} width="max-w-md"
      title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-accent" /> Demo control</span>}
      description="Hidden presenter panel · Ctrl+Shift+D">
      <div className="flex flex-col gap-5">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Simulation clock</p>
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="tnum font-mono text-xl font-semibold">{time(t, true)}</p>
                <p className="text-xs text-muted">{ahead > 60_000 ? `${duration(ahead)} ahead of real time` : 'In step with real time'}</p>
              </div>
              <Button variant={paused ? 'primary' : 'secondary'} icon={paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                onClick={() => post('/demo/pause', { paused: !paused }).catch((e) => toast.error(e.message))}>{paused ? 'Resume' : 'Pause'}</Button>
            </div>
            <div className="mt-3">
              <Segmented value={speed} onChange={(v) => post('/demo/speed', { speed: v }).catch((e) => toast.error(e.message))}
                options={[1, 2, 5, 10, 30, 60].map((s) => ({ value: s, label: `${s}×` }))} />
            </div>
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Trigger a scenario</p>
            <Badge tone="accent"><Activity className="h-3 w-3" /> live</Badge>
          </div>
          <Field label="Target machine" hint="Leave on automatic to pick a suitable machine" className="mb-3">
            <Select value={machine} onChange={(e) => setMachine(e.target.value)}>
              <option value="">Automatic</option>
              {boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.model}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {SCENARIOS.map((s) => (
              <button key={s.kind} type="button" disabled={busy !== null} onClick={() => run(s.kind)} title={s.hint}
                className="group flex items-start gap-2.5 rounded-xl border border-line bg-panel-2 p-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.06] disabled:opacity-50">
                <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-[11px] leading-tight text-muted">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
        {can(boot.user.role, 'admin') && (
          <section className="rounded-xl border border-crit/25 bg-crit/[0.05] p-3">
            <p className="text-sm font-medium">Reset demo data</p>
            <p className="mt-0.5 text-xs text-muted">Start over with a clean fleet and freshly simulated history.</p>
            <Button className="mt-3" variant="danger" size="sm" loading={busy === 'reset'} icon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={reset}>Reset data</Button>
          </section>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-faint"><Truck className="h-3 w-3" /> All machines, sensors and video are simulated on this computer.</p>
      </div>
    </Drawer>
  );
}
