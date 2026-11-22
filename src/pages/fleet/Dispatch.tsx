import { toast } from 'sonner';
import { ArrowRightLeft, Info, Shuffle, Truck } from 'lucide-react';
import { useQuery } from '../../lib/hooks';
import { post } from '../../lib/api';
import { useBoot } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { usePalette } from '../../lib/palette';
import { NODE_BY_ID } from '../../../shared/site';
import { can, type MachineStatus } from '../../../shared/types';
import type { RouteMeta } from '../../lib/types';
import { Badge, Card, ErrorState, Skeleton, StatusPill } from '../../components/ui/core';
import { Select, Switch } from '../../components/ui/form';
import { Tip } from '../../components/ui/overlay';
import { TYPE_ICON } from '../../components/machine/glyphs';

interface TruckRow { id: string; st: MachineStatus; act: string; routeId: string | null; homeLoaderId: string | null; capacity: number; model: string }
interface LoaderRow {
  id: string; type: 'shovel' | 'excavator' | 'loader'; model: string; st: MachineStatus; act: string; node: string; capacity: number; queue: number;
  routes: RouteMeta[]; trucks: TruckRow[]; loadMin: number; matchNeeded: number; matchFactor: number;
}

export function DispatchTab() {
  const boot = useBoot();
  const live = useLive((s) => s.machines);
  const p = usePalette();
  const q = useQuery<{ loaders: LoaderRow[]; unassigned: TruckRow[]; autoBalance: boolean }>('/dispatch', { refreshMs: 3000 });
  const canManage = can(boot.user.role, 'manage');

  const assign = async (truckId: string, loaderId: string, routeId?: string) => {
    try {
      await post('/dispatch/assign', { truckId, loaderId, routeId });
      toast.success(`${truckId} dispatched to ${loaderId}`);
      q.reload();
    } catch (err) { toast.error((err as Error).message); }
  };
  const setAuto = async (v: boolean) => {
    try {
      await post('/dispatch/autobalance', { enabled: v });
      toast.success(v ? 'Auto-dispatch on: trucks are re-routed when a loader goes down' : 'Auto-dispatch off');
      q.reload();
    } catch (err) { toast.error((err as Error).message); }
  };

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64" />)}</div>;

  const loaders = q.data.loaders;
  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-wrap items-center gap-4 p-3">
        <div className="flex items-center gap-2 text-sm"><Shuffle className="h-4 w-4 text-accent" /><span className="font-medium">Auto-dispatch</span></div>
        <Switch checked={q.data.autoBalance} onChange={setAuto} disabled={!canManage} label={q.data.autoBalance ? 'On' : 'Off'} />
        <p className="flex items-center gap-1.5 text-xs text-muted"><Info className="h-3.5 w-3.5" /> When a loading unit breaks down, its trucks move to the least-busy unit with the same material, and return when it is repaired.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {loaders.map((l) => {
          const Icon = TYPE_ICON[l.type];
          const mf = l.matchFactor;
          const tone = mf >= 0.85 && mf <= 1.25 ? 'ok' : mf < 0.85 ? 'warn' : 'info';
          const st = live[l.id]?.st ?? l.st;
          return (
            <Card key={l.id} title={<span className="flex items-center gap-2"><Icon className="h-4 w-4" style={{ color: p.status[st] }} />{l.id} <span className="font-normal text-muted">· {l.model}</span></span>}
              subtitle={`${NODE_BY_ID[l.node]?.zone ?? l.node} · ${l.capacity} t bucket · ${l.loadMin} min per truck`}
              actions={<Tip content={`Match factor: ${l.trucks.length} trucks for ${l.matchNeeded} needed`}><span><Badge tone={tone}>MF {mf.toFixed(2)}</Badge></span></Tip>}>
              <div className="mb-3 flex items-center gap-2"><StatusPill status={st} /><span className="truncate text-xs text-muted">{live[l.id]?.act ?? l.act}</span></div>
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-faint">
                <span>Assigned trucks ({l.trucks.length})</span><span>Queue {live[l.id]?.queue ?? l.queue}</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {l.trucks.length === 0 && <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">No trucks assigned</li>}
                {l.trucks.map((t) => {
                  const tl = live[t.id];
                  return (
                    <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/60 px-2.5 py-1.5">
                      <Truck className="h-3.5 w-3.5 shrink-0" style={{ color: p.status[tl?.st ?? t.st] }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{t.id} <span className="text-xs font-normal text-muted">{t.model}</span>
                          {t.homeLoaderId !== l.id && <Badge tone="info" className="ml-1.5">temp from {t.homeLoaderId}</Badge>}</p>
                        <p className="truncate text-[11px] text-muted">{tl?.act ?? t.act} · {t.routeId}</p>
                      </div>
                      {canManage && (
                        <Select aria-label={`Reassign ${t.id}`} value="" className="w-[104px] shrink-0" onChange={(e) => { if (e.target.value) void assign(t.id, e.target.value); }}>
                          <option value="">Move…</option>
                          {loaders.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                        </Select>
                      )}
                    </li>
                  );
                })}
              </ul>
              {l.routes.length > 1 && canManage && l.trucks.length > 0 && (
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-muted" />
                  <span className="text-xs text-muted">Send all to</span>
                  <Select aria-label="Route for all trucks" className="flex-1" value={l.trucks[0].routeId ?? ''} onChange={(e) => l.trucks.forEach((t) => void assign(t.id, l.id, e.target.value))}>
                    {l.routes.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                  </Select>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {q.data.unassigned.length > 0 && (
        <Card title="Unassigned trucks">
          <div className="flex flex-wrap gap-2">
            {q.data.unassigned.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                <span className="text-sm font-medium">{t.id}</span>
                {canManage && (
                  <Select aria-label={`Assign ${t.id}`} value="" onChange={(e) => e.target.value && void assign(t.id, e.target.value)} className="w-28">
                    <option value="">Assign…</option>
                    {loaders.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                  </Select>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
