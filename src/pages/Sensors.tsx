import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Grid3x3, LineChart } from 'lucide-react';
import { useBoot } from '../lib/app-store';
import { useLive } from '../lib/live';
import { usePalette } from '../lib/palette';
import { sensorText } from '../lib/format';
import { useStoredState } from '../lib/hooks';
import { sensorState, type SensorDef } from '../../shared/sensors';
import { MACHINE_TYPES, TYPE_LABEL, type MachineLive, type MachineType } from '../../shared/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Card, cn, PageHeader, StatusPill } from '../components/ui/core';
import { SearchInput, Select } from '../components/ui/form';
import { DataTable, type Col } from '../components/ui/table';
import { SensorPanel } from '../components/machine/SensorPanel';
import { TYPE_ICON } from '../components/machine/glyphs';
import { TelemetryChart } from './MachineDetail';

const MATRIX_KEYS = ['engine_temp', 'rpm', 'fuel_level', 'battery', 'payload_pct', 'tyre_pressure', 'tyre_temp', 'brake_temp', 'hyd_pressure', 'vibration'];

function MachinePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const machines = useLive((s) => s.machines);
  const p = usePalette();
  const [q, setQ] = useState('');
  const list = Object.values(machines).filter((m) => !q || m.id.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="panel flex max-h-[calc(100vh-230px)] flex-col">
      <div className="border-b border-line p-2.5"><SearchInput value={q} onChange={setQ} placeholder="Find machine" /></div>
      <ul className="scroll-thin flex-1 overflow-y-auto p-1.5">
        {MACHINE_TYPES.map((t) => {
          const ms = list.filter((m) => m.type === t);
          if (!ms.length) return null;
          return (
            <li key={t}>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{TYPE_LABEL[t]}</p>
              {ms.map((m) => {
                const Icon = TYPE_ICON[m.type];
                return (
                  <button key={m.id} type="button" onClick={() => onChange(m.id)}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-fg/[0.04]', value === m.id && 'bg-accent/[0.12]')}>
                    <Icon className="h-4 w-4" style={{ color: p.status[m.st] }} />
                    <span className="flex-1 font-medium">{m.id}</span>
                    {m.al > 0 && <Badge tone="crit">{m.al}</Badge>}
                  </button>
                );
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cell({ def, m }: { def: SensorDef | undefined; m: MachineLive }) {
  const units = useBoot().settings.units;
  if (!def || m.s[def.key] === undefined || !def.types.includes(m.type)) return <span className="text-faint">·</span>;
  const v = m.s[def.key];
  const st = sensorState(def, v);
  const { value } = sensorText(v, def.dimension, units, Math.min(def.decimals, 1));
  return (
    <span className={cn('tnum inline-block min-w-14 rounded-md px-1.5 py-0.5 text-right text-xs font-medium',
      st === 'critical' ? 'bg-crit/20 text-crit' : st === 'warning' ? 'bg-warn/20 text-warn' : 'text-fg')}>{value}</span>
  );
}

function Matrix() {
  const boot = useBoot();
  const machines = useLive((s) => s.machines);
  const navigate = useNavigate();
  const [type, setType] = useState<MachineType | ''>('');
  const defs = useMemo(() => MATRIX_KEYS.map((k) => boot.sensorDefs.find((d) => d.key === k)).filter((d): d is SensorDef => Boolean(d) && d!.enabled), [boot.sensorDefs]);
  const rows = Object.values(machines).filter((m) => !type || m.type === type);
  const units = boot.settings.units;
  const cols: Col<MachineLive>[] = [
    { key: 'id', header: 'Machine', width: '150px', sort: (m) => m.id, cell: (m) => <div className="flex items-center gap-2"><span className="font-medium">{m.id}</span><StatusPill status={m.st} /></div> },
    ...defs.map((d) => ({
      key: d.key, header: <span title={d.label}>{d.label.replace(/ \(.*\)/, '').replace('temperature', 'temp')} <span className="normal-case text-faint">{sensorText(0, d.dimension, units, 0).unit}</span></span>,
      width: 'minmax(96px,1fr)', align: 'right' as const, sort: (m: MachineLive) => m.s[d.key], cell: (m: MachineLive) => <Cell def={d} m={m} />,
    })),
  ];
  const warnCount = rows.reduce((n, m) => n + defs.filter((d) => d.types.includes(m.type) && sensorState(d, m.s[d.key]) !== 'normal').length, 0);
  return (
    <Card flush title="Fleet sensor matrix" subtitle="Every machine, key sensors, coloured by threshold state"
      actions={<div className="flex items-center gap-2">{warnCount > 0 && <Badge tone="warn">{warnCount} readings outside limits</Badge>}
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as MachineType | '')} className="w-40">
          <option value="">All types</option>{MACHINE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select></div>}>
      <DataTable columns={cols} rows={rows} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/fleet/${m.id}?tab=sensors`)} height="calc(100vh - 300px)" initialSort={{ key: 'id', dir: 'asc' }} />
    </Card>
  );
}

export default function Sensors() {
  const [tab, setTab] = useTabParam(['live', 'matrix', 'history'] as const, 'live');
  const first = useLive((s) => s.ids[0] ?? '');
  const [sel, setSel] = useStoredState('sensors-machine', 'TRK-101');
  const exists = useLive((s) => Boolean(s.machines[sel]));
  const machineId = exists ? sel : first;
  const m = useLive((s) => s.machines[machineId]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sensor monitoring" subtitle="Live readings with warning and critical thresholds (set them in Admin)" icon={<Activity className="h-5 w-5" />} />
      <Tabs id="sensors" value={tab} onChange={setTab} items={[
        { value: 'live', label: 'Live panel', icon: <Activity className="h-4 w-4" /> },
        { value: 'matrix', label: 'Fleet matrix', icon: <Grid3x3 className="h-4 w-4" /> },
        { value: 'history', label: 'History', icon: <LineChart className="h-4 w-4" /> },
      ]} />
      {tab === 'matrix' ? <Matrix /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <MachinePicker value={machineId} onChange={setSel} />
          <div className="min-w-0">
            {m && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-semibold">{m.id}</h2><StatusPill status={m.st} />
                <span className="text-sm text-muted">{m.act} · {m.zone} · {m.op || 'no operator'}</span>
              </div>
            )}
            {tab === 'live' ? <SensorPanel machineId={machineId} /> : <TelemetryChart key={machineId} machineId={machineId} initialKey="e_temp" height={520} />}
          </div>
        </div>
      )}
    </div>
  );
}
