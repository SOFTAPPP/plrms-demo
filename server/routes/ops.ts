// Operations data: telemetry, production, fuel, alerts, downtime, maintenance, reports, snapshots, recordings.
import { Router } from 'express';
import { sqlite } from '../db/client';
import { runtime } from '../runtime';
import { audit, requireRole } from '../auth';
import { ah, HttpError, num, oneOf, range, str } from './util';
import { alertFromDb } from '../sim/alerts';
import { addDays, mineDayOf, shiftWindow, mineDayToTs, SHIFTS } from '../../shared/time';
import type { ShiftCode } from '../../shared/types';

export const ops = Router();

const now = () => runtime.engine.t;
const aStart = () => runtime.engine.settings.aStartHour;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- telemetry

const TELEMETRY_FIELDS = ['st', 'act', 'x', 'y', 'h', 'spd', 'pay', 'fuel', 'e_temp', 'rpm', 'e_load', 'fuel_rate', 'brk', 'tyre_p', 'tyre_t', 'hyd', 'vib', 'bat', 'swing', 'boom', 'stick', 'arm', 'b_fill', 'water', 'depth'];

ops.get('/telemetry/:machineId', ah((req, res) => {
  const { from, to } = range(req, now(), 2);
  const max = Math.min(5000, Math.max(10, Number(req.query.max) || 1500));
  const wanted = req.query.fields ? String(req.query.fields).split(',').filter((f) => TELEMETRY_FIELDS.includes(f)) : TELEMETRY_FIELDS;
  const count = (sqlite.prepare('select count(*) as n from telemetry where machine_id = ? and ts >= ? and ts < ?').get(req.params.machineId, from, to) as { n: number }).n;
  const cols = ['ts', ...wanted].join(', ');
  let rows: unknown[];
  if (count <= max) {
    rows = sqlite.prepare(`select ${cols} from telemetry where machine_id = ? and ts >= ? and ts < ? order by ts`).all(req.params.machineId, from, to);
  } else {
    const bucket = Math.ceil((to - from) / max);
    rows = sqlite.prepare(`select ${cols} from telemetry where id in (select min(id) from telemetry where machine_id = ? and ts >= ? and ts < ? group by (ts - ?) / ?) order by ts`)
      .all(req.params.machineId, from, to, from, bucket);
  }
  res.json({ from, to, count, rows });
}));

/** Latest telemetry rows of the whole fleet around one moment (for playback of nearby machines). */
ops.get('/telemetry-at', ah((req, res) => {
  const ts = num(req.query.ts, 'ts');
  const rows = sqlite.prepare(`select t.machine_id as id, t.ts, t.x, t.y, t.h, t.spd, t.st from telemetry t
    join (select machine_id, max(ts) as mts from telemetry where ts <= ? and ts > ? group by machine_id) l on l.machine_id = t.machine_id and l.mts = t.ts`)
    .all(ts, ts - 10 * 60_000);
  res.json(rows);
}));

// ---------------------------------------------------------------- production

interface ProdRow {
  ts: number; mine_day: string; shift: string; truck_id: string; loader_id: string; route_id: string; operator_id: number | null;
  material: string; tonnes: number; passes: number; cycle_sec: number; queue_sec: number; spot_sec: number; load_sec: number;
  haul_sec: number; dump_sec: number; return_sec: number; distance_km: number;
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}
const sum = (rows: ProdRow[], f: (r: ProdRow) => number) => rows.reduce((s, r) => s + f(r), 0);
const avg = (rows: ProdRow[], f: (r: ProdRow) => number) => (rows.length ? sum(rows, f) / rows.length : 0);

function productionAggregates(rows: ProdRow[]) {
  const routes = new Map((sqlite.prepare('select id, name, target_cycle_min as t, distance_km as km from routes').all() as { id: string; name: string; t: number; km: number }[]).map((r) => [r.id, r]));
  const opNames = new Map((sqlite.prepare('select id, name from operators').all() as { id: number; name: string }[]).map((o) => [o.id, o.name]));
  const caps = new Map((sqlite.prepare('select id, capacity, model from machines').all() as { id: string; capacity: number; model: string }[]).map((m) => [m.id, m]));
  const totals = {
    tonnes: Math.round(sum(rows, (r) => r.tonnes)), loads: rows.length,
    ore: Math.round(sum(rows.filter((r) => r.material === 'ore'), (r) => r.tonnes)),
    waste: Math.round(sum(rows.filter((r) => r.material === 'waste'), (r) => r.tonnes)),
    avgPayload: round(avg(rows, (r) => r.tonnes)), avgCycleMin: round(avg(rows, (r) => r.cycle_sec) / 60),
    avgQueueMin: round(avg(rows, (r) => r.queue_sec) / 60), avgPasses: round(avg(rows, (r) => r.passes)),
    distanceKm: round(sum(rows, (r) => r.distance_km)),
  };
  const byLoader = [...groupBy(rows, (r) => r.loader_id)].map(([id, rs]) => ({
    id, model: caps.get(id)?.model ?? '', tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length, passes: sum(rs, (r) => r.passes),
    avgLoadMin: round(avg(rs, (r) => r.load_sec) / 60), avgPasses: round(avg(rs, (r) => r.passes)), avgQueueMin: round(avg(rs, (r) => r.queue_sec) / 60),
  })).sort((a, b) => b.tonnes - a.tonnes);
  const byTruck = [...groupBy(rows, (r) => r.truck_id)].map(([id, rs]) => ({
    id, model: caps.get(id)?.model ?? '', tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length, avgCycleMin: round(avg(rs, (r) => r.cycle_sec) / 60),
    avgPayload: round(avg(rs, (r) => r.tonnes)), payloadPct: Math.round((avg(rs, (r) => r.tonnes) / (caps.get(id)?.capacity ?? 1)) * 100),
    km: round(sum(rs, (r) => r.distance_km)),
  })).sort((a, b) => b.tonnes - a.tonnes);
  const byRoute = [...groupBy(rows, (r) => r.route_id)].map(([id, rs]) => ({
    id, name: routes.get(id)?.name ?? id, distanceKm: routes.get(id)?.km ?? 0, targetCycleMin: routes.get(id)?.t ?? 0,
    tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length, avgCycleMin: round(avg(rs, (r) => r.cycle_sec) / 60),
    breakdown: {
      queue: round(avg(rs, (r) => r.queue_sec) / 60), spot: round(avg(rs, (r) => r.spot_sec) / 60), load: round(avg(rs, (r) => r.load_sec) / 60),
      haul: round(avg(rs, (r) => r.haul_sec) / 60), dump: round(avg(rs, (r) => r.dump_sec) / 60), return: round(avg(rs, (r) => r.return_sec) / 60),
    },
  })).sort((a, b) => a.id.localeCompare(b.id));
  const byShift = [...groupBy(rows, (r) => `${r.mine_day}|${r.shift}`)].map(([k, rs]) => {
    const [day, shift] = k.split('|');
    return { day, shift, tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length, avgCycleMin: round(avg(rs, (r) => r.cycle_sec) / 60) };
  }).sort((a, b) => (a.day + a.shift).localeCompare(b.day + b.shift));
  const histogram = Array.from({ length: 20 }, (_, i) => ({ fromMin: i * 3, count: 0 }));
  for (const r of rows) histogram[Math.min(19, Math.floor(r.cycle_sec / 180))].count++;
  const passes = [...groupBy(rows, (r) => String(r.passes))].map(([p, rs]) => ({ passes: Number(p), count: rs.length })).sort((a, b) => a.passes - b.passes);
  const payloadBands = [
    { band: '< 90 %', count: 0 }, { band: '90-100 %', count: 0 }, { band: '100-105 %', count: 0 }, { band: '105-110 %', count: 0 }, { band: '> 110 %', count: 0 },
  ];
  for (const r of rows) {
    const p = (r.tonnes / (caps.get(r.truck_id)?.capacity ?? r.tonnes)) * 100;
    payloadBands[p < 90 ? 0 : p < 100 ? 1 : p < 105 ? 2 : p <= 110 ? 3 : 4].count++;
  }
  const topOperators = [...groupBy(rows.filter((r) => r.operator_id), (r) => String(r.operator_id))].map(([id, rs]) => ({
    id: Number(id), name: opNames.get(Number(id)) ?? `#${id}`, tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length,
    avgCycleMin: round(avg(rs, (r) => r.cycle_sec) / 60),
  })).sort((a, b) => b.tonnes - a.tonnes).slice(0, 10);
  return { totals, byLoader, byTruck, byRoute, byShift, histogram, passes, payloadBands, topOperators };
}

function series(rows: ProdRow[], from: number, to: number, bucketMs: number) {
  const n = Math.max(1, Math.ceil((to - from) / bucketMs));
  const out = Array.from({ length: n }, (_, i) => ({ ts: from + i * bucketMs, tonnes: 0, loads: 0, ore: 0, waste: 0 }));
  for (const r of rows) {
    const i = Math.floor((r.ts - from) / bucketMs);
    if (i < 0 || i >= n) continue;
    out[i].tonnes += r.tonnes;
    out[i].loads++;
    if (r.material === 'ore') out[i].ore += r.tonnes; else out[i].waste += r.tonnes;
  }
  for (const b of out) { b.tonnes = Math.round(b.tonnes); b.ore = Math.round(b.ore); b.waste = Math.round(b.waste); }
  return out;
}

ops.get('/production/summary', ah((req, res) => {
  const { from, to } = range(req, now(), 24);
  const rows = sqlite.prepare('select * from production_events where ts >= ? and ts < ? order by ts').all(from, to) as ProdRow[];
  const hours = (to - from) / 3_600_000;
  const bucketMs = hours <= 48 ? 3_600_000 : 86_400_000 / 4;
  const k = runtime.engine.settings.targets;
  res.json({ from, to, bucketMs, series: series(rows, from, to, bucketMs), targetTph: k.tph, targetDaily: k.dailyTonnes, targetCycleMin: k.cycleMin, ...productionAggregates(rows) });
}));

ops.get('/production/events', ah((req, res) => {
  const { from, to } = range(req, now(), 24);
  const limit = Math.min(2000, Number(req.query.limit) || 300);
  const where = ['ts >= ?', 'ts < ?'];
  const args: unknown[] = [from, to];
  if (req.query.machineId) { where.push('(truck_id = ? or loader_id = ?)'); args.push(String(req.query.machineId), String(req.query.machineId)); }
  const rows = sqlite.prepare(`select p.*, o.name as operator from production_events p left join operators o on o.id = p.operator_id where ${where.join(' and ')} order by ts desc limit ?`).all(...args, limit);
  res.json(rows);
}));

// ---------------------------------------------------------------- fuel

function daysBetween(from: number, to: number): string[] {
  const days: string[] = [];
  let d = mineDayOf(from, aStart());
  const last = mineDayOf(to - 1, aStart());
  for (let i = 0; i < 40 && d <= last; i++) { days.push(d); d = addDays(d, 1); }
  return days;
}

ops.get('/fuel/summary', ah((req, res) => {
  const { from, to } = range(req, now(), 24 * 7);
  const days = daysBetween(from, to);
  const ph = days.map(() => '?').join(',');
  const stats = sqlite.prepare(`select s.machine_id as id, m.type, m.model, sum(s.fuel_l) as fuel, sum(s.operating_sec) as op, sum(s.idle_sec) as idle, sum(s.tonnes) as tonnes, sum(s.distance_km) as km
    from machine_shift_stats s join machines m on m.id = s.machine_id where s.mine_day in (${ph}) group by s.machine_id`).all(...days) as
    { id: string; type: string; model: string; fuel: number; op: number; idle: number; tonnes: number; km: number }[];
  const daily = sqlite.prepare(`select s.mine_day as day, m.type, sum(s.fuel_l) as fuel from machine_shift_stats s join machines m on m.id = s.machine_id
    where s.mine_day in (${ph}) group by s.mine_day, m.type order by s.mine_day`).all(...days) as { day: string; type: string; fuel: number }[];
  const moved = sqlite.prepare('select coalesce(sum(tonnes),0) as t from production_events where ts >= ? and ts < ?').get(from, to) as { t: number };
  const events = sqlite.prepare('select type, count(*) as n, coalesce(sum(litres),0) as l from fuel_events where ts >= ? and ts < ? group by type').all(from, to) as { type: string; n: number; l: number }[];
  const totalFuel = stats.reduce((s, r) => s + r.fuel, 0);
  const idleFuel = stats.reduce((s, r) => {
    const rates: Record<string, number> = { truck: 20, shovel: 55, excavator: 40, loader: 22, dozer: 12, drill: 14, water: 16, lv: 1.2 };
    return s + (r.idle / 3600) * (rates[r.type] ?? 10);
  }, 0);
  res.json({
    from, to, days,
    totals: {
      litres: Math.round(totalFuel), tonnesMoved: Math.round(moved.t), lPerTonne: moved.t ? round(totalFuel / moved.t, 3) : 0,
      idleLitres: Math.round(idleFuel), refuels: events.find((e) => e.type === 'refuel')?.n ?? 0,
      refuelLitres: Math.round(events.filter((e) => e.type !== 'anomaly').reduce((s, e) => s + e.l, 0)),
      anomalies: events.find((e) => e.type === 'anomaly')?.n ?? 0, anomalyLitres: Math.round(Math.abs(events.find((e) => e.type === 'anomaly')?.l ?? 0)),
      target: runtime.engine.settings.targets.fuelLPerTonne,
    },
    machines: stats.map((r) => ({
      id: r.id, type: r.type, model: r.model, litres: Math.round(r.fuel), operatingH: round(r.op / 3600), idleH: round(r.idle / 3600),
      lPerHour: r.op + r.idle ? round(r.fuel / ((r.op + r.idle) / 3600)) : 0, tonnes: Math.round(r.tonnes),
      lPerTonne: r.tonnes ? round(r.fuel / r.tonnes, 3) : null, km: round(r.km),
    })).sort((a, b) => b.litres - a.litres),
    daily: daily.map((d) => ({ ...d, fuel: Math.round(d.fuel) })),
  });
}));

ops.get('/fuel/events', ah((req, res) => {
  const { from, to } = range(req, now(), 24 * 7);
  const where = ['ts >= ?', 'ts < ?'];
  const args: unknown[] = [from, to];
  if (req.query.type) { where.push('type = ?'); args.push(String(req.query.type)); }
  if (req.query.machineId) { where.push('machine_id = ?'); args.push(String(req.query.machineId)); }
  res.json(sqlite.prepare(`select id, ts, machine_id as machineId, type, litres, level_before as levelBefore, level_after as levelAfter, location, note, recorded_by as recordedBy
    from fuel_events where ${where.join(' and ')} order by ts desc limit 500`).all(...args));
}));

ops.post('/fuel/events', requireRole('operate'), ah((req, res) => {
  const e = runtime.engine;
  const m = e.machines.get(str(req.body?.machineId, 'Machine'));
  if (!m) throw new HttpError(404, 'Machine not found');
  const litres = num(req.body?.litres, 'Litres', { min: 1, max: m.fuelCap });
  const before = m.fuelL;
  m.fuelL = Math.min(m.fuelCap, m.fuelL + litres);
  const added = m.fuelL - before;
  e.rec.fuel(e.t, m.id, 'manual', round(added), round((before / m.fuelCap) * 100), round((m.fuelL / m.fuelCap) * 100),
    str(req.body?.location, 'Location', { optional: true, max: 60 }) || 'Fuel bay', str(req.body?.note, 'Note', { optional: true, max: 200 }) || null, req.user!.name);
  audit(req.user!.name, 'fuel.log', `${m.id} +${added.toFixed(0)} L`, e.t);
  res.status(201).json({ ok: true, added: round(added) });
}));

// ---------------------------------------------------------------- alerts

ops.get('/alerts', ah((req, res) => {
  const where: string[] = [];
  const args: unknown[] = [];
  const status = String(req.query.status ?? 'open');
  if (status === 'open') where.push("status != 'resolved'");
  else if (status !== 'all') { where.push('status = ?'); args.push(status); }
  if (req.query.severity) { where.push('severity = ?'); args.push(String(req.query.severity)); }
  if (req.query.machineId) { where.push('machine_id = ?'); args.push(String(req.query.machineId)); }
  if (req.query.type) { where.push('type = ?'); args.push(String(req.query.type)); }
  if (req.query.from) { where.push('last_ts >= ?'); args.push(Number(req.query.from)); }
  if (req.query.to) { where.push('ts < ?'); args.push(Number(req.query.to)); }
  if (req.query.q) { where.push('(message like ? or machine_id like ? or title like ?)'); const q = `%${String(req.query.q)}%`; args.push(q, q, q); }
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const limit = Math.min(1000, Number(req.query.limit) || 200);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const total = (sqlite.prepare(`select count(*) as n from alerts ${w}`).get(...args) as { n: number }).n;
  const rows = (sqlite.prepare(`select * from alerts ${w} order by case status when 'active' then 0 when 'acknowledged' then 1 else 2 end, last_ts desc limit ? offset ?`).all(...args, limit, offset) as Record<string, unknown>[]).map(alertFromDb);
  res.json({ total, rows });
}));

ops.get('/alerts/stats', ah((req, res) => {
  const { from, to } = range(req, now(), 24 * 7);
  const byType = sqlite.prepare('select type, title, count(*) as n, sum(case when severity = \'critical\' then 1 else 0 end) as critical from alerts where ts >= ? and ts < ? group by type order by n desc').all(from, to);
  const bySeverity = sqlite.prepare('select severity, count(*) as n from alerts where ts >= ? and ts < ? group by severity').all(from, to);
  const byMachine = sqlite.prepare('select machine_id as id, count(*) as n from alerts where ts >= ? and ts < ? group by machine_id order by n desc limit 10').all(from, to);
  const rows = sqlite.prepare('select ts, severity from alerts where ts >= ? and ts < ?').all(from, to) as { ts: number; severity: string }[];
  const days = daysBetween(from, to);
  const byDay = days.map((d) => ({ day: d, info: 0, warning: 0, critical: 0 }));
  for (const r of rows) {
    const i = days.indexOf(mineDayOf(r.ts, aStart()));
    if (i >= 0) byDay[i][r.severity as 'info' | 'warning' | 'critical']++;
  }
  const resp = sqlite.prepare("select avg(ack_at - ts) as ms from alerts where ts >= ? and ts < ? and ack_at is not null and ack_by not like 'system%'").get(from, to) as { ms: number | null };
  res.json({ byType, bySeverity, byMachine, byDay, avgAckMin: resp.ms ? round(resp.ms / 60_000) : null });
}));

ops.post('/alerts/:id/ack', requireRole('operate'), ah((req, res) => {
  const a = runtime.engine.alerts.acknowledge(Number(req.params.id), req.user!.name, runtime.engine.t, str(req.body?.note, 'Note', { optional: true, max: 300 }) || null);
  if (!a) throw new HttpError(404, 'Alert is not open');
  res.json(a);
}));

ops.post('/alerts/:id/resolve', requireRole('operate'), ah((req, res) => {
  const a = runtime.engine.alerts.resolve(Number(req.params.id), req.user!.name, runtime.engine.t, str(req.body?.note, 'Note', { optional: true, max: 300 }) || null);
  if (!a) throw new HttpError(404, 'Alert is not open');
  res.json(a);
}));

ops.post('/alerts/bulk', requireRole('operate'), ah((req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).slice(0, 500) : [];
  const action = oneOf(req.body?.action, 'Action', ['ack', 'resolve'] as const);
  let n = 0;
  for (const id of ids) {
    const r = action === 'ack'
      ? runtime.engine.alerts.acknowledge(id, req.user!.name, runtime.engine.t, null)
      : runtime.engine.alerts.resolve(id, req.user!.name, runtime.engine.t, null);
    if (r) n++;
  }
  audit(req.user!.name, `alerts.${action}`, `${n} alert(s)`, runtime.engine.t);
  res.json({ updated: n });
}));

// ---------------------------------------------------------------- downtime

const DOWNTIME_CATEGORIES = ['Breakdown', 'Planned maintenance', 'Refuelling', 'Shift change', 'Crib break', 'Waiting on trucks', 'Weather', 'Blasting', 'No operator', 'Other'] as const;

ops.get('/downtime', ah((req, res) => {
  const { from, to } = range(req, now(), 24 * 3);
  const where = ['start < ?', '(end is null or end > ?)'];
  const args: unknown[] = [to, from];
  if (req.query.machineId) { where.push('machine_id = ?'); args.push(String(req.query.machineId)); }
  if (req.query.category) { where.push('category = ?'); args.push(String(req.query.category)); }
  if (req.query.open === '1') where.push('end is null');
  const rows = sqlite.prepare(`select id, machine_id as machineId, start, end, category, reason, notes, source, created_by as createdBy from downtime where ${where.join(' and ')} order by start desc limit 1000`).all(...args) as
    { id: number; machineId: string; start: number; end: number | null; category: string }[];
  const t = now();
  const byCat = new Map<string, { hours: number; count: number }>();
  for (const r of rows) {
    const h = (Math.min(r.end ?? t, to) - Math.max(r.start, from)) / 3_600_000;
    const c = byCat.get(r.category) ?? { hours: 0, count: 0 };
    c.hours += Math.max(0, h);
    c.count++;
    byCat.set(r.category, c);
  }
  res.json({ rows, categories: DOWNTIME_CATEGORIES, summary: [...byCat].map(([category, v]) => ({ category, hours: round(v.hours), count: v.count })).sort((a, b) => b.hours - a.hours) });
}));

ops.post('/downtime', requireRole('operate'), ah((req, res) => {
  const b = req.body ?? {};
  const machineId = str(b.machineId, 'Machine');
  if (!runtime.engine.machines.has(machineId)) throw new HttpError(404, 'Machine not found');
  const start = num(b.start, 'Start');
  const end = b.end ? num(b.end, 'End') : null;
  if (end !== null && end <= start) throw new HttpError(400, 'End must be after start');
  const r = sqlite.prepare('insert into downtime (machine_id, start, end, category, reason, notes, source, created_by) values (?,?,?,?,?,?,?,?)')
    .run(machineId, start, end, oneOf(b.category, 'Category', DOWNTIME_CATEGORIES), str(b.reason, 'Reason', { max: 120 }),
      str(b.notes, 'Notes', { optional: true, max: 500 }) || null, 'manual', req.user!.name);
  const id = Number(r.lastInsertRowid);
  // an ongoing delay that has already started takes the machine out of production until it is closed
  if (end === null && start <= runtime.engine.t) runtime.engine.manualDelay(machineId, id, b.category, str(b.reason, 'Reason', { max: 120 }));
  audit(req.user!.name, 'downtime.create', `${machineId} ${b.category}`, runtime.engine.t);
  res.status(201).json({ id });
}));

ops.patch('/downtime/:id', requireRole('operate'), ah((req, res) => {
  const cur = sqlite.prepare('select * from downtime where id = ?').get(Number(req.params.id)) as Record<string, unknown> | undefined;
  if (!cur) throw new HttpError(404, 'Record not found');
  const b = req.body ?? {};
  const end = b.end === null ? null : b.end !== undefined ? num(b.end, 'End') : (cur.end as number | null);
  if (end !== null && end <= (cur.start as number)) throw new HttpError(400, 'End must be after start');
  sqlite.prepare('update downtime set end=?, category=?, reason=?, notes=? where id=?').run(
    end, b.category ? oneOf(b.category, 'Category', DOWNTIME_CATEGORIES) : cur.category,
    b.reason ? str(b.reason, 'Reason', { max: 120 }) : cur.reason, b.notes !== undefined ? str(b.notes, 'Notes', { optional: true, max: 500 }) || null : cur.notes,
    Number(req.params.id));
  if (end !== null) runtime.engine.endDelay(Number(req.params.id));
  audit(req.user!.name, 'downtime.update', `#${req.params.id}`, runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- maintenance

ops.get('/maintenance', ah((req, res) => {
  const where: string[] = [];
  const args: unknown[] = [];
  if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  if (req.query.machineId) { where.push('machine_id = ?'); args.push(String(req.query.machineId)); }
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const t = now();
  const rows = (sqlite.prepare(`select id, machine_id as machineId, title, type, status, priority, due_at as dueAt, duration_h as durationH, started_at as startedAt,
    completed_at as completedAt, technician, cost, notes, source, created_by as createdBy from maintenance ${w} order by case status when 'in_progress' then 0 when 'scheduled' then 1 else 2 end, due_at desc limit 500`).all(...args) as
    { status: string; dueAt: number }[]).map((r) => ({ ...r, overdue: r.status === 'scheduled' && r.dueAt < t }));
  res.json(rows);
}));

ops.post('/maintenance', requireRole('manage'), ah((req, res) => {
  const b = req.body ?? {};
  const machineId = str(b.machineId, 'Machine');
  if (!runtime.engine.machines.has(machineId)) throw new HttpError(404, 'Machine not found');
  const r = sqlite.prepare(`insert into maintenance (machine_id, title, type, status, priority, due_at, duration_h, technician, notes, source, created_by)
    values (?,?,?,'scheduled',?,?,?,?,?,'manual',?)`).run(
    machineId, str(b.title, 'Title', { max: 120 }), oneOf(b.type ?? 'preventive', 'Type', ['preventive', 'corrective', 'inspection'] as const),
    oneOf(b.priority ?? 'medium', 'Priority', ['low', 'medium', 'high'] as const), num(b.dueAt, 'Due date'), num(b.durationH, 'Duration', { min: 0.25, max: 72 }),
    str(b.technician, 'Technician', { optional: true, max: 60 }) || null, str(b.notes, 'Notes', { optional: true, max: 500 }) || null, req.user!.name);
  audit(req.user!.name, 'maintenance.create', `${machineId}: ${b.title}`, runtime.engine.t);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

ops.patch('/maintenance/:id', requireRole('manage'), ah((req, res) => {
  const id = Number(req.params.id);
  const cur = sqlite.prepare('select * from maintenance where id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new HttpError(404, 'Work order not found');
  const b = req.body ?? {};
  const e = runtime.engine;
  const status = b.status ? oneOf(b.status, 'Status', ['scheduled', 'in_progress', 'completed', 'cancelled'] as const) : (cur.status as string);
  sqlite.prepare('update maintenance set title=?, priority=?, due_at=?, duration_h=?, technician=?, notes=?, cost=?, status=?, completed_at=? where id=?').run(
    b.title ? str(b.title, 'Title', { max: 120 }) : cur.title, b.priority ? oneOf(b.priority, 'Priority', ['low', 'medium', 'high'] as const) : cur.priority,
    b.dueAt ? num(b.dueAt, 'Due date') : cur.due_at, b.durationH ? num(b.durationH, 'Duration', { min: 0.25, max: 72 }) : cur.duration_h,
    b.technician !== undefined ? str(b.technician, 'Technician', { optional: true, max: 60 }) || null : cur.technician,
    b.notes !== undefined ? str(b.notes, 'Notes', { optional: true, max: 500 }) || null : cur.notes,
    b.cost !== undefined && b.cost !== '' ? num(b.cost, 'Cost', { min: 0 }) : cur.cost, status,
    status === 'completed' ? (cur.completed_at ?? e.t) : null, id);
  if (status === 'in_progress' && cur.status === 'scheduled') {
    sqlite.prepare('update maintenance set started_at = ? where id = ?').run(e.t, id);
    e.beginWorkOrder({ id, machineId: cur.machine_id as string, title: cur.title as string, durationH: cur.duration_h as number });
  }
  if (status === 'completed' || status === 'cancelled') {
    const m = e.machines.get(cur.machine_id as string);
    if (m?.hold?.workOrderId === id) m.hold.until = e.t;
    if (m?.pendingWorkOrder?.id === id) m.pendingWorkOrder = null;
  }
  audit(req.user!.name, 'maintenance.update', `#${id} → ${status}`, e.t);
  res.json({ ok: true });
}));

ops.delete('/maintenance/:id', requireRole('manage'), ah((req, res) => {
  const r = sqlite.prepare("delete from maintenance where id = ? and status = 'scheduled'").run(Number(req.params.id));
  if (!r.changes) throw new HttpError(409, 'Only scheduled work orders can be deleted');
  audit(req.user!.name, 'maintenance.delete', `#${req.params.id}`, runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- reports

function utilisation(days: string[], shifts: string[]) {
  const ph = days.map(() => '?').join(',');
  const sh = shifts.map(() => '?').join(',');
  return sqlite.prepare(`select s.machine_id as id, m.type, m.model, sum(s.operating_sec) as op, sum(s.idle_sec) as idle, sum(s.down_sec) as down, sum(s.maint_sec) as maint,
    sum(s.fuel_l) as fuel, sum(s.distance_km) as km, sum(s.passes) as passes from machine_shift_stats s join machines m on m.id = s.machine_id
    where s.mine_day in (${ph}) and s.shift in (${sh}) group by s.machine_id order by m.type, s.machine_id`).all(...days, ...shifts) as
    { id: string; type: string; model: string; op: number; idle: number; down: number; maint: number; fuel: number; km: number; passes: number }[];
}

function buildReport(kind: 'shift' | 'daily' | 'weekly', days: string[], shifts: ShiftCode[], from: number, to: number) {
  const dph = days.map(() => '?').join(',');
  const sph = shifts.map(() => '?').join(',');
  const rows = sqlite.prepare(`select * from production_events where mine_day in (${dph}) and shift in (${sph}) order by ts`).all(...days, ...shifts) as ProdRow[];
  const agg = productionAggregates(rows);
  const util = utilisation(days, shifts);
  const machines = util.map((u) => {
    const total = u.op + u.idle + u.down + u.maint || 1;
    const avail = total - u.down - u.maint;
    return {
      id: u.id, type: u.type, model: u.model, operatingH: round(u.op / 3600), idleH: round(u.idle / 3600), downH: round(u.down / 3600), maintH: round(u.maint / 3600),
      availability: round((avail / total) * 100), utilisation: round(avail ? (u.op / avail) * 100 : 0), fuelL: Math.round(u.fuel), km: round(u.km),
    };
  });
  const byType = [...new Set(machines.map((m) => m.type))].map((type) => {
    const ms = util.filter((u) => u.type === type);
    const tot = ms.reduce((s, u) => s + u.op + u.idle + u.down + u.maint, 0) || 1;
    const down = ms.reduce((s, u) => s + u.down + u.maint, 0);
    const op = ms.reduce((s, u) => s + u.op, 0);
    return { type, count: ms.length, availability: round(((tot - down) / tot) * 100), utilisation: round(tot - down ? (op / (tot - down)) * 100 : 0), operatingH: round(op / 3600) };
  });
  const allT = util.reduce((s, u) => s + u.op + u.idle + u.down + u.maint, 0) || 1;
  const allDown = util.reduce((s, u) => s + u.down + u.maint, 0);
  const allOp = util.reduce((s, u) => s + u.op, 0);
  const fuel = util.reduce((s, u) => s + u.fuel, 0);
  const down = sqlite.prepare('select category, start, end from downtime where start < ? and (end is null or end > ?)').all(to, from) as { category: string; start: number; end: number | null }[];
  const t = now();
  const dcat = new Map<string, { hours: number; count: number }>();
  for (const d of down) {
    const c = dcat.get(d.category) ?? { hours: 0, count: 0 };
    c.hours += Math.max(0, (Math.min(d.end ?? t, to) - Math.max(d.start, from)) / 3_600_000);
    c.count++;
    dcat.set(d.category, c);
  }
  const alerts = sqlite.prepare('select type, title, count(*) as count, sum(case when severity = \'critical\' then 1 else 0 end) as critical from alerts where ts >= ? and ts < ? group by type order by count desc').all(from, to) as { count: number; critical: number }[];
  const k = runtime.engine.settings.targets;
  const target = kind === 'shift' ? k.dailyTonnes / 3 : kind === 'daily' ? k.dailyTonnes : k.dailyTonnes * days.length;
  const hourly = kind === 'weekly' ? [] : series(rows, from, to, 3_600_000);
  const daily = kind === 'weekly' ? days.map((d) => {
    const rs = rows.filter((r) => r.mine_day === d);
    const u = utilisation([d], shifts);
    const tt = u.reduce((s, x) => s + x.op + x.idle + x.down + x.maint, 0) || 1;
    const dn = u.reduce((s, x) => s + x.down + x.maint, 0);
    const op = u.reduce((s, x) => s + x.op, 0);
    const w = shiftWindow(d, 'A', aStart());
    const al = (sqlite.prepare('select count(*) as n from alerts where ts >= ? and ts < ?').get(w.start, w.start + 86_400_000) as { n: number }).n;
    return { day: d, tonnes: Math.round(sum(rs, (r) => r.tonnes)), loads: rs.length, fuelL: Math.round(u.reduce((s, x) => s + x.fuel, 0)),
      availability: round(((tt - dn) / tt) * 100), utilisation: round(tt - dn ? (op / (tt - dn)) * 100 : 0), alerts: al, target: k.dailyTonnes };
  }) : [];
  return {
    kind, days, shifts, from, to, generatedAt: t,
    totals: {
      ...agg.totals, target: Math.round(target), achievement: target ? round((agg.totals.tonnes / target) * 100) : 0,
      availability: round(((allT - allDown) / allT) * 100), utilisation: round(allT - allDown ? (allOp / (allT - allDown)) * 100 : 0),
      fuelL: Math.round(fuel), lPerTonne: agg.totals.tonnes ? round(fuel / agg.totals.tonnes, 3) : 0,
      alerts: alerts.reduce((s, a) => s + a.count, 0), criticalAlerts: alerts.reduce((s, a) => s + (a.critical ?? 0), 0),
      breakdowns: dcat.get('Breakdown')?.count ?? 0, downtimeH: round([...dcat.values()].reduce((s, c) => s + c.hours, 0)),
    },
    targets: k, hourly, daily, byLoader: agg.byLoader, byTruck: agg.byTruck, byRoute: agg.byRoute, byShift: agg.byShift,
    topOperators: agg.topOperators, histogram: agg.histogram, machines, byType,
    downtime: [...dcat].map(([category, v]) => ({ category, hours: round(v.hours), count: v.count })).sort((a, b) => b.hours - a.hours),
    alerts,
  };
}

ops.get('/reports/:kind', ah((req, res) => {
  const kind = oneOf(req.params.kind, 'Report', ['shift', 'daily', 'weekly'] as const);
  const a = aStart();
  const today = mineDayOf(now(), a);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day ?? '')) ? String(req.query.day) : today;
  if (kind === 'shift') {
    const shift = oneOf(req.query.shift ?? runtime.engine.currentShift.code, 'Shift', SHIFTS);
    const w = shiftWindow(day, shift, a);
    return res.json(buildReport('shift', [day], [shift], w.start, w.end));
  }
  if (kind === 'daily') {
    const start = mineDayToTs(day, a);
    return res.json(buildReport('daily', [day], SHIFTS, start, shiftWindow(day, 'C', a).end));
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
  res.json(buildReport('weekly', days, SHIFTS, mineDayToTs(days[0], a), shiftWindow(day, 'C', a).end));
}));

// ---------------------------------------------------------------- snapshots & recordings

ops.get('/snapshots', ah((req, res) => {
  const where = req.query.machineId ? 'where machine_id = ?' : '';
  const args = req.query.machineId ? [String(req.query.machineId)] : [];
  res.json(sqlite.prepare(`select id, ts, created_at as createdAt, machine_id as machineId, camera, user_name as userName, source from snapshots ${where} order by id desc limit 200`).all(...args));
}));

ops.get('/snapshots/:id/image', ah((req, res) => {
  const r = sqlite.prepare('select image from snapshots where id = ?').get(Number(req.params.id)) as { image: string } | undefined;
  if (!r) throw new HttpError(404, 'Snapshot not found');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(r.image);
  if (!m) throw new HttpError(500, 'Stored image is invalid');
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(m[2], 'base64'));
}));

ops.post('/snapshots', requireRole('operate'), ah((req, res) => {
  const image = str(req.body?.image, 'Image', { max: 3_000_000 });
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new HttpError(400, 'Image must be a JPEG, PNG or WebP data URL');
  const r = sqlite.prepare('insert into snapshots (ts, created_at, machine_id, camera, image, user_name, source) values (?,?,?,?,?,?,?)').run(
    num(req.body?.ts, 'Time'), Date.now(), str(req.body?.machineId, 'Machine'), str(req.body?.camera, 'Camera'), image, req.user!.name,
    oneOf(req.body?.source ?? 'live', 'Source', ['live', 'playback'] as const));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

ops.delete('/snapshots/:id', requireRole('operate'), ah((req, res) => {
  sqlite.prepare('delete from snapshots where id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

ops.get('/recordings', ah((_req, res) => {
  res.json(sqlite.prepare('select id, machine_id as machineId, camera, start_ts as startTs, end_ts as endTs, kind, size_bytes as sizeBytes, client_key as clientKey, user_name as userName, created_at as createdAt from recordings order by id desc limit 300').all());
}));

ops.post('/recordings', requireRole('operate'), ah((req, res) => {
  const b = req.body ?? {};
  const r = sqlite.prepare('insert into recordings (machine_id, camera, start_ts, end_ts, kind, size_bytes, client_key, user_name, created_at) values (?,?,?,?,?,?,?,?,?)').run(
    str(b.machineId, 'Machine'), str(b.camera, 'Camera'), num(b.startTs, 'Start'), num(b.endTs, 'End'),
    oneOf(b.kind ?? 'manual', 'Kind', ['manual', 'playback', 'event'] as const), num(b.sizeBytes ?? 0, 'Size', { min: 0 }),
    str(b.clientKey, 'Key', { max: 80 }), req.user!.name, Date.now());
  audit(req.user!.name, 'recording.save', `${b.machineId} ${b.camera}`, runtime.engine.t);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

ops.delete('/recordings/:id', requireRole('operate'), ah((req, res) => {
  sqlite.prepare('delete from recordings where id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));
