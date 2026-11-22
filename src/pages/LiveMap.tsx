import { useMemo, useState } from 'react';
import { useUnits } from '../lib/units';
import { useSearchParams } from 'react-router-dom';
import { Filter } from 'lucide-react';
import { SiteMap } from '../components/map/SiteMap';
import { useLive } from '../lib/live';
import { usePalette } from '../lib/palette';
import { MACHINE_TYPES, STATUS_LABEL, TYPE_LABEL, type MachineStatus, type MachineType } from '../../shared/types';
import { SearchInput } from '../components/ui/form';
import { cn, StatusPill } from '../components/ui/core';
import { TYPE_ICON } from '../components/machine/glyphs';

export default function LiveMap() {
  const machines = useLive((s) => s.machines);
  const p = usePalette();
  const U = useUnits();
  const [sp] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(sp.get('focus'));
  const [focus, setFocus] = useState<string | null>(sp.get('focus'));
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<MachineType[]>([]);
  const [statuses, setStatuses] = useState<MachineStatus[]>([]);
  const list = useMemo(() => Object.values(machines)
    .filter((m) => (!types.length || types.includes(m.type)) && (!statuses.length || statuses.includes(m.st)))
    .filter((m) => !q || `${m.id} ${m.op} ${m.zone} ${m.act}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.id.localeCompare(b.id)), [machines, types, statuses, q]);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[560px] flex-col gap-3 lg:flex-row">
      <div className="panel relative min-h-[420px] flex-1 overflow-hidden">
        <SiteMap selectedId={selected} onSelect={setSelected} focusId={focus} typeFilter={types} statusFilter={statuses} />
      </div>
      <aside className="panel flex w-full flex-col lg:w-80">
        <div className="space-y-3 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Find machine, operator, area" />
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted"><Filter className="h-3 w-3" /> Type</p>
            <div className="flex flex-wrap gap-1">
              {MACHINE_TYPES.map((t) => {
                const Icon = TYPE_ICON[t];
                const on = types.includes(t);
                return (
                  <button key={t} type="button" onClick={() => setTypes(toggle(types, t))} aria-pressed={on}
                    className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px]', on ? 'border-accent/50 bg-accent/12 text-fg' : 'border-line text-muted hover:text-fg')}>
                    <Icon className="h-3 w-3" />{TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Status</p>
            <div className="flex flex-wrap gap-1">
              {(['running', 'loading', 'hauling', 'idle', 'breakdown', 'maintenance'] as MachineStatus[]).map((s) => {
                const on = statuses.includes(s);
                return (
                  <button key={s} type="button" onClick={() => setStatuses(toggle(statuses, s))} aria-pressed={on}
                    className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px]', on ? 'border-accent/50 bg-accent/12 text-fg' : 'border-line text-muted hover:text-fg')}>
                    <span className="h-2 w-2 rounded-full" style={{ background: p.status[s] }} />{STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="px-3 pt-2 text-[11px] text-faint">{list.length} machines shown</p>
        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {list.map((m) => {
            const Icon = TYPE_ICON[m.type];
            return (
              <li key={m.id}>
                <button type="button" onClick={() => { setSelected(m.id); setFocus(m.id); setTimeout(() => setFocus(null), 50); }}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-fg/[0.04]', selected === m.id && 'bg-accent/10')}>
                  <Icon className="h-4 w-4 shrink-0" style={{ color: p.status[m.st] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-sm font-medium">{m.id}</span><StatusPill status={m.st} /></div>
                    <p className="truncate text-[11px] text-muted">{m.act} · {m.zone}</p>
                  </div>
                  <span className="tnum text-xs text-muted">{U.speed(m.spd)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
