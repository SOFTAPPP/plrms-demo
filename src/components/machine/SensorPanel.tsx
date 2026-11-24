import { memo, useMemo, useState } from 'react';
import { Activity, Layers, LayoutGrid } from 'lucide-react';
import { useBoot } from '../../lib/app-store';
import { history, useLive, useMachine } from '../../lib/live';
import { sensorText } from '../../lib/format';
import { GROUP_LABEL, sensorState, type SensorDef, type SensorGroup } from '../../../shared/sensors';
import type { MachineLive } from '../../../shared/types';
import { Gauge, STATE_COLOR, Sparkline } from '../ui/viz';
import { Badge, cn, EmptyState } from '../ui/core';

const GAUGE_KEYS = ['engine_temp', 'fuel_level', 'rpm', 'payload_pct', 'hyd_pressure', 'tyre_pressure', 'brake_temp', 'bucket_fill', 'vibration', 'battery', 'water_level'];

export function useMachineDefs(m: MachineLive | undefined): SensorDef[] {
  const defs = useBoot().sensorDefs;
  return useMemo(() => (m ? defs.filter((d) => d.enabled && d.types.includes(m.type)) : []), [defs, m?.type]); // eslint-disable-line react-hooks/exhaustive-deps
}

const SensorTile = memo(function SensorTile({
  def,
  m,
  showGroup,
}: {
  def: SensorDef;
  m: MachineLive;
  showGroup?: boolean;
}) {
  const units = useBoot().settings.units;
  useLive((s) => s.frameNo);
  const v = m.s[def.key];
  const state = sensorState(def, v);
  const { value, unit } = sensorText(v, def.dimension, units, def.decimals);
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-lg border bg-panel-2/60 p-3 min-h-[102px]',
        state === 'critical' ? 'border-crit/40' : state === 'warning' ? 'border-warn/40' : 'border-line'
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-1.5">
          <p className="truncate text-xs text-muted" title={def.label}>{def.label}</p>
          {state !== 'normal' ? (
            <Badge tone={state === 'critical' ? 'crit' : 'warn'}>{state}</Badge>
          ) : showGroup ? (
            <span className="text-[10px] uppercase font-semibold text-faint tracking-wider">{GROUP_LABEL[def.group]}</span>
          ) : null}
        </div>
        <p className="tnum mt-1 font-display text-lg font-semibold" style={{ color: state === 'normal' ? undefined : STATE_COLOR[state] }}>
          {v === undefined ? <span className="text-sm font-normal text-faint">awaiting data</span> : <>{value}<span className="ml-1 text-xs font-medium text-muted">{unit}</span></>}
        </p>
      </div>
      <Sparkline values={history(`${m.id}:${def.key}`)} color={state === 'normal' ? 'var(--accent)' : STATE_COLOR[state]} height={26} className="mt-1" />
    </div>
  );
});

export function SensorGauges({ m, defs }: { m: MachineLive; defs: SensorDef[] }) {
  const units = useBoot().settings.units;
  const gauges = GAUGE_KEYS.map((k) => defs.find((d) => d.key === k)).filter((d): d is SensorDef => Boolean(d) && m.s[d!.key] !== undefined).slice(0, 6);
  return (
    <div className="grid grid-cols-2 justify-items-center gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {gauges.map((d) => {
        const { value, unit } = sensorText(m.s[d.key], d.dimension, units, d.key === 'rpm' ? 0 : Math.min(1, d.decimals));
        return <Gauge key={d.key} value={m.s[d.key]} min={d.min} max={d.max} warn={d.warn} crit={d.crit} dir={d.dir} label={d.label} display={value} unit={unit} />;
      })}
    </div>
  );
}

export function TyreDiagram({ m }: { m: MachineLive }) {
  if (!m.tp || !m.tt) return null;
  const pos: [number, number][] = [[118, 38], [118, 132], [32, 26], [32, 50], [32, 120], [32, 144]];
  const color = (i: number) => (m.tp![i] < 78 || m.tt![i] > 95 ? 'var(--crit)' : m.tp![i] < 88 || m.tt![i] > 85 ? 'var(--warn)' : 'var(--ok)');
  return (
    <svg viewBox="0 0 220 170" className="h-auto w-full max-w-[340px]" role="img" aria-label="Tyre pressures and temperatures">
      <rect x="20" y="58" width="130" height="54" rx="8" fill="var(--panel-2)" stroke="var(--line-strong)" />
      <rect x="128" y="62" width="34" height="46" rx="6" fill="var(--panel-2)" stroke="var(--line-strong)" />
      <text x="85" y="89" textAnchor="middle" fill="var(--muted)" style={{ font: '600 10px var(--font-mono)' }}>{m.id}</text>
      {pos.map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 12} y={y - 9} width="24" height="18" rx="4" fill="var(--bg)" stroke={color(i)} strokeWidth="2" />
          <text x={x + 18} y={y - 1} fill="var(--fg)" style={{ font: '600 9px var(--font-mono)' }} textAnchor="start">{m.tp![i].toFixed(0)} psi</text>
          <text x={x + 18} y={y + 9} fill="var(--muted)" style={{ font: '500 8.5px var(--font-mono)' }} textAnchor="start">{m.tt![i].toFixed(0)}°C</text>
        </g>
      ))}
    </svg>
  );
}

export function DiggerDiagram({ m }: { m: MachineLive }) {
  const boom = ((m.s.boom_angle ?? 25) * Math.PI) / 180;
  const stick = ((m.s.stick_angle ?? -50) * Math.PI) / 180;
  const swing = m.s.swing_angle ?? 0;
  const fill = Math.min(1.1, (m.s.bucket_fill ?? 0) / 100);
  const bx = 70 + Math.cos(boom) * 90;
  const by = 110 - Math.sin(boom) * 90;
  const sx = bx + Math.cos(boom + stick) * 60;
  const sy = by - Math.sin(boom + stick) * 60;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 260 160" className="h-auto w-full max-w-[460px]" role="img" aria-label="Boom, stick and bucket position">
        <line x1="0" y1="140" x2="260" y2="140" stroke="var(--line-strong)" />
        <rect x="20" y="118" width="90" height="20" rx="8" fill="var(--panel-2)" stroke="var(--line-strong)" />
        <rect x="30" y="86" width="70" height="32" rx="4" fill="var(--accent)" opacity="0.9" />
        <line x1="70" y1="110" x2={bx} y2={by} stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" style={{ transition: 'all 400ms' }} />
        <line x1={bx} y1={by} x2={sx} y2={sy} stroke="var(--fg)" strokeOpacity="0.7" strokeWidth="6" strokeLinecap="round" style={{ transition: 'all 400ms' }} />
        <g transform={`translate(${sx},${sy})`} style={{ transition: 'all 400ms' }}>
          <path d="M-10,-8 L12,-8 L10,10 L-8,10 Z" fill="var(--muted)" />
          {fill > 0.05 && <path d={`M-8,${-8 - fill * 8} Q1,${-14 - fill * 10} 10,${-8 - fill * 8} L10,-8 L-8,-8 Z`} fill="#8b6b4a" />}
        </g>
        <text x="8" y="16" fill="var(--muted)" style={{ font: '500 10px var(--font-mono)' }}>BOOM {(m.s.boom_angle ?? 0).toFixed(0)}° · STICK {(m.s.stick_angle ?? 0).toFixed(0)}° · ARM {(m.s.arm_angle ?? 0).toFixed(0)}°</text>
      </svg>
      {m.type !== 'loader' && (
        <svg viewBox="0 0 100 100" className="h-24 w-24" role="img" aria-label={`Swing ${swing} degrees`}>
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
          {[0, 90, 180, 270].map((a) => <line key={a} x1={50 + Math.cos((a * Math.PI) / 180) * 34} y1={50 + Math.sin((a * Math.PI) / 180) * 34} x2={50 + Math.cos((a * Math.PI) / 180) * 40} y2={50 + Math.sin((a * Math.PI) / 180) * 40} stroke="var(--faint)" />)}
          <line x1="50" y1="50" x2={50 + Math.sin((swing * Math.PI) / 180) * 34} y2={50 - Math.cos((swing * Math.PI) / 180) * 34} stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" style={{ transition: 'all 400ms' }} />
          <circle cx="50" cy="50" r="6" fill="var(--accent)" />
          <text x="50" y="96" textAnchor="middle" fill="var(--muted)" style={{ font: '600 9px var(--font-mono)' }}>SWING {swing}°</text>
        </svg>
      )}
    </div>
  );
}

export function SensorPanel({ machineId }: { machineId: string }) {
  const m = useMachine(machineId);
  const defs = useMachineDefs(m);
  const [selectedGroup, setSelectedGroup] = useState<'all' | SensorGroup>('all');
  const [viewMode, setViewMode] = useState<'grouped' | 'grid'>('grouped');

  const groups = useMemo(() => [...new Set(defs.map((d) => d.group))] as SensorGroup[], [defs]);

  const filteredDefs = useMemo(() => {
    if (selectedGroup === 'all') return defs;
    return defs.filter((d) => d.group === selectedGroup);
  }, [defs, selectedGroup]);

  if (!m) return <EmptyState title="Machine not reporting" message="Waiting for live data from this machine." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel p-4"><SensorGauges m={m} defs={defs} /></div>
      {(m.tp || m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader') && (
        <div className="panel p-4">
          <p className="mb-2 font-display text-sm font-semibold">{m.tp ? 'Tyre monitoring' : 'Work equipment position'}</p>
          {m.tp ? <TyreDiagram m={m} /> : <DiggerDiagram m={m} />}
        </div>
      )}

      <div className="panel flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5">
          <div className="flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-accent" />
            <h3 className="font-display text-sm font-semibold text-fg">Telemetry & Subsystems</h3>
            <Badge tone="neutral">{filteredDefs.length} {filteredDefs.length === 1 ? 'sensor' : 'sensors'}</Badge>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-panel-2/70 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
                viewMode === 'grouped' ? 'bg-elev text-fg shadow-sm' : 'text-muted hover:text-fg'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Grouped</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
                viewMode === 'grid' ? 'bg-elev text-fg shadow-sm' : 'text-muted hover:text-fg'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Uniform Grid</span>
            </button>
          </div>
        </div>

        {/* System Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedGroup('all')}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border',
              selectedGroup === 'all'
                ? 'border-accent/40 bg-accent/15 text-accent font-semibold'
                : 'border-line bg-panel-2/50 text-muted hover:border-line-strong hover:text-fg'
            )}
          >
            All systems <span className="ml-1 text-[11px] opacity-70">({defs.length})</span>
          </button>
          {groups.map((g) => {
            const count = defs.filter((d) => d.group === g).length;
            const hasAlert = defs.some((d) => d.group === g && sensorState(d, m.s[d.key]) !== 'normal');
            return (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGroup(g)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border',
                  selectedGroup === g
                    ? 'border-accent/40 bg-accent/15 text-accent font-semibold'
                    : 'border-line bg-panel-2/50 text-muted hover:border-line-strong hover:text-fg'
                )}
              >
                {hasAlert && <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />}
                <span>{GROUP_LABEL[g]}</span>
                <span className="text-[11px] opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Telemetry Display */}
        {viewMode === 'grid' || selectedGroup !== 'all' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-4">
            {filteredDefs.map((d) => (
              <SensorTile key={d.key} def={d} m={m} showGroup={selectedGroup === 'all'} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
            {groups.map((g) => {
              const groupDefs = defs.filter((d) => d.group === g);
              const hasCrit = groupDefs.some((d) => sensorState(d, m.s[d.key]) === 'critical');
              const hasWarn = groupDefs.some((d) => sensorState(d, m.s[d.key]) === 'warning');
              return (
                <div key={g} className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2/40 p-3.5">
                  <div className="flex items-center justify-between border-b border-line/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-xs font-semibold uppercase tracking-wider text-fg">{GROUP_LABEL[g]}</span>
                      {(hasCrit || hasWarn) && (
                        <Badge tone={hasCrit ? 'crit' : 'warn'} dot>{hasCrit ? 'Critical' : 'Warning'}</Badge>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-faint">{groupDefs.length} {groupDefs.length === 1 ? 'sensor' : 'sensors'}</span>
                  </div>
                  <div className={cn('grid gap-2.5', groupDefs.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
                    {groupDefs.map((d) => (
                      <SensorTile key={d.key} def={d} m={m} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
