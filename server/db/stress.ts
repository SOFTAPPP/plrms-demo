// Robustness check for the simulator: runs several simulated days with extra faults and reports anomalies.
// Usage: DB_PATH=./data/stress.db pnpm sim:stress [days]   (uses a separate database file)
import { runMigrations, truncateAll } from './client';
import { seedBase } from './seed';
import { Engine } from '../sim/engine';

if (!process.env.DB_PATH) {
  console.error('Set DB_PATH to a scratch database file: this test deletes all rows in the database it uses.');
  process.exit(1);
}
const days = Number(process.argv[2] || 3);
runMigrations();
truncateAll();
const start = Date.now() - days * 86_400_000;
seedBase(start);
const e = new Engine(start, 1);
e.loadAll();
e.backfilling = true;

const lastMove = new Map<string, { x: number; y: number; t: number; mode: string }>();
const loadingSince = new Map<string, number>();
const cyclesSeen = new Map<string, number>();
const hist = new Map<string, string[]>();
let dumped = 0;
const issues: string[] = [];
let tonnes = 0;
const t0 = Date.now();
let nextFault = start + 3 * 3_600_000;

while (e.t < start + days * 86_400_000) {
  e.rec.transaction(() => {
    for (let i = 0; i < 60; i++) {
      e.step(2);
      for (const m of e.machines.values()) {
        if (m.type !== 'truck') continue;
        if (m.mode !== 'loading' && m.mode !== 'spot') loadingSince.delete(m.id);
        else if (!loadingSince.has(m.id)) loadingSince.set(m.id, e.t);
      }
      for (const [id, ls] of e.loaders) {
        const L = e.machines.get(id)!;
        const tr = ls.current ? e.machines.get(ls.current) : undefined;
        const line = `${new Date(e.t).toISOString().slice(11, 19)} ${ls.phase} cur=${ls.current} hold=${L.hold?.kind ?? '-'} st=${L.st} tr=${tr?.mode}/${tr?.hold?.kind ?? '-'} pay=${tr?.payload.toFixed(0)}`;
        const h = hist.get(id) ?? [];
        if (h[h.length - 1]?.slice(9) !== line.slice(9)) h.push(line);
        if (h.length > 14) h.shift();
        hist.set(id, h);
      }
    }
  });
  if (e.t > nextFault) {
    // break a random loading unit and a random truck to exercise recovery paths
    const loaders = [...e.loaders.keys()];
    const l = e.machines.get(loaders[Math.floor(Math.random() * loaders.length)])!;
    e.breakdown(l, 'stress test');
    const trucks = [...e.machines.values()].filter((m) => m.type === 'truck' && !m.hold);
    if (trucks.length) e.breakdown(trucks[Math.floor(Math.random() * trucks.length)], 'stress test');
    nextFault = e.t + 4 * 3_600_000;
  }
  for (const m of e.machines.values()) {
    if (m.type !== 'truck') continue;
    const prev = lastMove.get(m.id);
    const moved = !prev || Math.hypot(prev.x - m.x, prev.y - m.y) > 5 || prev.mode !== m.mode;
    if (moved || m.hold) lastMove.set(m.id, { x: m.x, y: m.y, t: e.t, mode: m.mode });
    else if (e.t - prev.t > 45 * 60_000) {
      if (dumped++ < 3) {
        const ls = m.loaderId ? e.loaders.get(m.loaderId) : undefined;
        const L = e.machines.get(m.loaderId ?? '');
        console.log(`--- ${m.id} loaderId=${m.loaderId} home=${m.homeLoaderId} | loader hold=${L?.hold?.kind} until=${L?.hold ? ((L.hold.until - e.t) / 60000).toFixed(0) + 'min' : '-'} st=${L?.st} act="${L?.act}" inService=${L?.inService} | queue=${ls?.queue.join(',')} current=${ls?.current} phase=${ls?.phase}`);
        console.log((hist.get(m.loaderId ?? '') ?? []).slice(-6).join('\n'));
      }
      issues.push(`${new Date(e.t).toISOString()} ${m.id} has not moved for 45 min (mode ${m.mode}, act "${m.act}")`);
      lastMove.set(m.id, { x: m.x, y: m.y, t: e.t, mode: m.mode });
    }
    if (cyclesSeen.get(m.id) !== m.cycles) { cyclesSeen.set(m.id, m.cycles); loadingSince.delete(m.id); }
    if (m.mode === 'loading' || m.mode === 'spot') {
      if (!loadingSince.has(m.id)) loadingSince.set(m.id, e.t);
      else if (e.t - loadingSince.get(m.id)! > 20 * 60_000 && !m.hold) {
        const ls = m.loaderId ? e.loaders.get(m.loaderId) : undefined;
        const L = e.machines.get(m.loaderId ?? '');
        const end = m.path?.[m.path.length - 1];
        if (dumped++ < 2) console.log(`--- history of ${m.loaderId}\n` + (hist.get(m.loaderId ?? '') ?? []).join('\n'));
        issues.push(`${new Date(e.t).toISOString()} ${m.id} ${m.mode} 20+ min at ${m.loaderId} (current=${ls?.current}, loader hold=${L?.hold?.kind}, phase=${ls?.phase}, loader act="${L?.act}", pi=${m.pi}/${m.path?.length}, toEnd=${end ? Math.hypot(end.x - m.x, end.y - m.y).toFixed(1) : '-'}m, phaseEnd-t=${((m.phaseEnd - e.t) / 1000).toFixed(0)}s, v=${m.v.toFixed(2)})`);
        loadingSince.set(m.id, e.t);
      }
    } else loadingSince.delete(m.id);
    if (m.fuelL <= 0.5 && !m.hold) issues.push(`${new Date(e.t).toISOString()} ${m.id} empty tank without a hold`);
  }
}
e.flushStats();
const k = e.kpi();
tonnes = k.tonnesDay;
console.log(`simulated ${days} days in ${((Date.now() - t0) / 1000).toFixed(1)} s · last mine day so far ${tonnes} t · alerts open ${k.activeAlerts}`);
console.log(`${issues.length} anomalies`);
for (const i of issues.slice(0, 40)) console.log('  ' + i);
process.exit(0);
