// Fleet: machines, operators and roster, haul routes, dispatch, cameras.
import { Router } from 'express';
import { sqlite } from '../db/client';
import { runtime } from '../runtime';
import { audit, requireRole } from '../auth';
import { ah, HttpError, num, oneOf, str } from './util';
import { CAMERA_LAYOUT } from '../db/seed';
import { MACHINE_TYPES, type CameraPosition, type MachineType } from '../../shared/types';
import { NODE_BY_ID, pathLength, shortestPath } from '../../shared/site';

export const fleet = Router();

const MACHINE_COLS = `id, name, type, make, model, year, serial, capacity, fuel_capacity as fuelCapacity, home_node as homeNode,
  route_id as routeId, loader_id as loaderId, in_service as inService, engine_hours as engineHours, notes, created_at as createdAt`;

export function listMachines() {
  return (sqlite.prepare(`select ${MACHINE_COLS} from machines order by type, id`).all() as Record<string, unknown>[])
    .map((m) => ({ ...m, inService: Boolean(m.inService) }));
}

fleet.get('/machines', ah((_req, res) => res.json(listMachines())));

fleet.get('/machines/:id', ah((req, res) => {
  const m = sqlite.prepare(`select ${MACHINE_COLS} from machines where id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
  if (!m) throw new HttpError(404, 'Machine not found');
  const roster = sqlite.prepare(`select r.shift, o.id, o.name, o.employee_no as employeeNo from roster r left join operators o on o.id = r.operator_id where r.machine_id = ?`).all(req.params.id);
  const cams = sqlite.prepare('select * from cameras where machine_id = ? order by position').all(req.params.id);
  const e = runtime.engine;
  const day = e.currentShift.mineDay;
  const stats = sqlite.prepare(`select coalesce(sum(operating_sec),0) as op, coalesce(sum(idle_sec),0) as idle, coalesce(sum(down_sec),0) as down,
    coalesce(sum(maint_sec),0) as maint, coalesce(sum(fuel_l),0) as fuel, coalesce(sum(distance_km),0) as km, coalesce(sum(loads),0) as loads,
    coalesce(sum(tonnes),0) as tonnes, coalesce(sum(passes),0) as passes from machine_shift_stats where machine_id = ? and mine_day = ?`).get(req.params.id, day);
  const nextPm = sqlite.prepare(`select * from maintenance where machine_id = ? and status in ('scheduled','in_progress') order by due_at limit 1`).get(req.params.id);
  res.json({ ...m, inService: Boolean(m.inService), roster, cameras: cams, today: stats, nextMaintenance: nextPm ?? null });
}));

fleet.post('/machines', requireRole('admin'), ah((req, res) => {
  const b = req.body ?? {};
  const id = str(b.id, 'Machine ID', { max: 16 }).toUpperCase();
  if (!/^[A-Z0-9-]{2,16}$/.test(id)) throw new HttpError(400, 'Machine ID may only use letters, digits and dashes');
  if (sqlite.prepare('select 1 from machines where id = ?').get(id)) throw new HttpError(409, 'That machine ID already exists');
  const type = oneOf(b.type, 'Type', MACHINE_TYPES) as MachineType;
  let homeNode = str(b.homeNode, 'Home location', { optional: true }) || 'AD';
  let loaderId: string | null = null;
  let routeId: string | null = null;
  if (type === 'truck') {
    loaderId = str(b.loaderId, 'Loading unit');
    routeId = str(b.routeId, 'Haul route');
    const route = sqlite.prepare('select loader_node as n from routes where id = ?').get(routeId) as { n: string } | undefined;
    if (!route) throw new HttpError(400, 'Unknown route');
    homeNode = route.n;
  }
  if (!NODE_BY_ID[homeNode]) throw new HttpError(400, 'Unknown home location');
  const capacity = num(b.capacity, 'Capacity', { min: 0.1, max: 1000 });
  const fuelCapacity = num(b.fuelCapacity, 'Fuel tank', { min: 10, max: 30000 });
  const now = runtime.engine.t;
  sqlite.transaction(() => {
    sqlite.prepare(`insert into machines (id, name, type, make, model, year, serial, capacity, fuel_capacity, home_node, route_id, loader_id, in_service, fuel_l, engine_hours, notes, created_at)
      values (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(
      id, str(b.name, 'Name', { max: 60 }), type, str(b.make, 'Make', { max: 40 }), str(b.model, 'Model', { max: 40 }),
      num(b.year, 'Year', { min: 1980, max: 2035 }), `NEW${Math.floor(Math.random() * 900000 + 100000)}`, capacity, fuelCapacity,
      homeNode, routeId, loaderId, fuelCapacity * 0.9, num(b.engineHours ?? 0, 'Engine hours', { min: 0 }), str(b.notes, 'Notes', { optional: true, max: 500 }) || null, now);
    for (const pos of CAMERA_LAYOUT[type]) {
      sqlite.prepare('insert into cameras (id, machine_id, position, label, resolution, fps, enabled, recording, created_at) values (?,?,?,?,?,?,1,1,?)')
        .run(`${id}-${pos}`, id, pos, `${id} ${pos}`, '1920x1080', 25, now);
    }
    for (const s of ['A', 'B', 'C']) sqlite.prepare('insert into roster (machine_id, shift, operator_id) values (?,?,null)').run(id, s);
  })();
  const row = sqlite.prepare('select * from machines where id = ?').get(id) as Record<string, unknown>;
  runtime.engine.addMachine(row);
  runtime.engine.loadRoster();
  audit(req.user!.name, 'machine.create', `${id} (${type})`, now);
  res.status(201).json({ id });
}));

fleet.patch('/machines/:id', requireRole('admin'), ah((req, res) => {
  const id = req.params.id;
  const cur = sqlite.prepare('select * from machines where id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new HttpError(404, 'Machine not found');
  const b = req.body ?? {};
  const name = b.name !== undefined ? str(b.name, 'Name', { max: 60 }) : (cur.name as string);
  const make = b.make !== undefined ? str(b.make, 'Make', { max: 40 }) : (cur.make as string);
  const model = b.model !== undefined ? str(b.model, 'Model', { max: 40 }) : (cur.model as string);
  const year = b.year !== undefined ? num(b.year, 'Year', { min: 1980, max: 2035 }) : (cur.year as number);
  const capacity = b.capacity !== undefined ? num(b.capacity, 'Capacity', { min: 0.1, max: 1000 }) : (cur.capacity as number);
  const fuelCapacity = b.fuelCapacity !== undefined ? num(b.fuelCapacity, 'Fuel tank', { min: 10, max: 30000 }) : (cur.fuel_capacity as number);
  const notes = b.notes !== undefined ? str(b.notes, 'Notes', { optional: true, max: 500 }) || null : (cur.notes as string | null);
  const inService = b.inService !== undefined ? Boolean(b.inService) : Boolean(cur.in_service);
  sqlite.prepare('update machines set name=?, make=?, model=?, year=?, capacity=?, fuel_capacity=?, notes=?, in_service=? where id=?')
    .run(name, make, model, year, capacity, fuelCapacity, notes, inService ? 1 : 0, id);
  runtime.engine.updateMachineMeta(id, { name, model, capacity, fuelCapacity });
  if (inService !== Boolean(cur.in_service)) runtime.engine.setInService(id, inService);
  audit(req.user!.name, 'machine.update', `${id}${inService !== Boolean(cur.in_service) ? (inService ? ' returned to service' : ' taken out of service') : ''}`, runtime.engine.t);
  res.json({ ok: true });
}));

fleet.delete('/machines/:id', requireRole('admin'), ah((req, res) => {
  const id = req.params.id;
  if (!sqlite.prepare('select 1 from machines where id = ?').get(id)) throw new HttpError(404, 'Machine not found');
  const trucks = sqlite.prepare('select count(*) as n from machines where loader_id = ?').get(id) as { n: number };
  if (trucks.n > 0) throw new HttpError(409, `Reassign the ${trucks.n} truck(s) loaded by ${id} first (Fleet > Dispatch)`);
  sqlite.transaction(() => {
    sqlite.prepare('delete from machines where id = ?').run(id);
    sqlite.prepare('delete from cameras where machine_id = ?').run(id);
    sqlite.prepare('delete from roster where machine_id = ?').run(id);
  })();
  runtime.engine.removeMachine(id);
  audit(req.user!.name, 'machine.delete', id, runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- operators & roster

fleet.get('/operators', ah((_req, res) => {
  const ops = sqlite.prepare(`select id, name, employee_no as employeeNo, shift, phone, licence, status, experience_years as experienceYears,
    safety_score as safetyScore from operators order by shift, name`).all() as Record<string, unknown>[];
  const assign = sqlite.prepare('select machine_id as machineId, shift, operator_id as operatorId from roster').all() as { machineId: string; shift: string; operatorId: number | null }[];
  const byOp = new Map<number, string[]>();
  for (const a of assign) if (a.operatorId) byOp.set(a.operatorId, [...(byOp.get(a.operatorId) ?? []), a.machineId]);
  const since = runtime.engine.t - 7 * 86_400_000;
  const perf = sqlite.prepare(`select operator_id as id, count(*) as loads, sum(tonnes) as tonnes, avg(cycle_sec) as cyc from production_events where ts > ? and operator_id is not null group by operator_id`).all(since) as { id: number; loads: number; tonnes: number; cyc: number }[];
  const alertsBy = sqlite.prepare(`select operator_name as name, count(*) as n from alerts where ts > ? and operator_name is not null and type in ('fatigue','distraction','overspeed','sensor.payload_pct') group by operator_name`).all(since) as { name: string; n: number }[];
  const pm = new Map(perf.map((p) => [p.id, p]));
  const am = new Map(alertsBy.map((a) => [a.name, a.n]));
  res.json({
    operators: ops.map((o) => ({ ...o, machines: byOp.get(o.id as number) ?? [], loads7d: pm.get(o.id as number)?.loads ?? 0, tonnes7d: Math.round(pm.get(o.id as number)?.tonnes ?? 0), avgCycleMin: pm.get(o.id as number) ? Math.round((pm.get(o.id as number)!.cyc / 60) * 10) / 10 : null, events7d: am.get(o.name as string) ?? 0 })),
    roster: assign,
  });
}));

function operatorBody(b: Record<string, unknown>) {
  return {
    name: str(b.name, 'Name', { min: 2, max: 60 }),
    shift: oneOf(b.shift, 'Shift', ['A', 'B', 'C'] as const),
    phone: str(b.phone, 'Phone', { optional: true, max: 30 }),
    licence: str(b.licence, 'Licence', { optional: true, max: 60 }) || 'HME-A',
    status: oneOf(b.status ?? 'active', 'Status', ['active', 'leave', 'training'] as const),
    experienceYears: num(b.experienceYears ?? 0, 'Experience', { min: 0, max: 50 }),
    safetyScore: num(b.safetyScore ?? 90, 'Safety score', { min: 0, max: 100 }),
  };
}

fleet.post('/operators', requireRole('manage'), ah((req, res) => {
  const o = operatorBody(req.body ?? {});
  const max = sqlite.prepare("select max(cast(substr(employee_no, 5) as integer)) as n from operators").get() as { n: number | null };
  const emp = `EMP-${(max.n ?? 1000) + 1}`;
  const r = sqlite.prepare('insert into operators (name, employee_no, shift, phone, licence, status, experience_years, safety_score, created_at) values (?,?,?,?,?,?,?,?,?)')
    .run(o.name, emp, o.shift, o.phone, o.licence, o.status, o.experienceYears, o.safetyScore, Date.now());
  runtime.engine.loadRoster();
  audit(req.user!.name, 'operator.create', `${o.name} (${emp})`, runtime.engine.t);
  res.status(201).json({ id: Number(r.lastInsertRowid), employeeNo: emp });
}));

fleet.patch('/operators/:id', requireRole('manage'), ah((req, res) => {
  const o = operatorBody(req.body ?? {});
  const r = sqlite.prepare('update operators set name=?, shift=?, phone=?, licence=?, status=?, experience_years=?, safety_score=? where id=?')
    .run(o.name, o.shift, o.phone, o.licence, o.status, o.experienceYears, o.safetyScore, Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Operator not found');
  runtime.engine.loadRoster();
  res.json({ ok: true });
}));

fleet.delete('/operators/:id', requireRole('manage'), ah((req, res) => {
  const id = Number(req.params.id);
  sqlite.transaction(() => {
    sqlite.prepare('update roster set operator_id = null where operator_id = ?').run(id);
    sqlite.prepare('delete from operators where id = ?').run(id);
  })();
  runtime.engine.loadRoster();
  audit(req.user!.name, 'operator.delete', `#${id}`, runtime.engine.t);
  res.json({ ok: true });
}));

fleet.put('/roster', requireRole('manage'), ah((req, res) => {
  const machineId = str(req.body?.machineId, 'Machine');
  const shift = oneOf(req.body?.shift, 'Shift', ['A', 'B', 'C'] as const);
  const operatorId = req.body?.operatorId ? Number(req.body.operatorId) : null;
  sqlite.prepare('insert into roster (machine_id, shift, operator_id) values (?,?,?) on conflict(machine_id, shift) do update set operator_id = excluded.operator_id')
    .run(machineId, shift, operatorId);
  runtime.engine.loadRoster();
  audit(req.user!.name, 'roster.update', `${machineId} shift ${shift} → ${operatorId ?? 'unassigned'}`, runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- haul routes

fleet.get('/routes', ah((_req, res) => {
  res.json(sqlite.prepare('select id, name, loader_node as loaderNode, dest_node as destNode, material, distance_km as distanceKm, target_cycle_min as targetCycleMin, active from routes order by id').all()
    .map((r) => ({ ...(r as object), active: Boolean((r as { active: number }).active) })));
}));

fleet.post('/routes', requireRole('admin'), ah((req, res) => {
  const b = req.body ?? {};
  const loaderNode = str(b.loaderNode, 'Loading point');
  const destNode = str(b.destNode, 'Destination');
  if (!NODE_BY_ID[loaderNode] || !NODE_BY_ID[destNode]) throw new HttpError(400, 'Unknown location');
  const ids = (sqlite.prepare('select id from routes').all() as { id: string }[]).map((r) => Number(r.id.slice(2)));
  const id = `R-${String(Math.max(0, ...ids) + 1).padStart(2, '0')}`;
  const km = Math.round((pathLength(shortestPath(loaderNode, destNode)) / 1000) * 100) / 100;
  sqlite.prepare('insert into routes (id, name, loader_node, dest_node, material, distance_km, target_cycle_min, active) values (?,?,?,?,?,?,?,1)')
    .run(id, str(b.name, 'Name', { max: 60 }), loaderNode, destNode, oneOf(b.material, 'Material', ['ore', 'waste'] as const), km,
      num(b.targetCycleMin ?? Math.round(8 + km * 4.2), 'Target cycle', { min: 3, max: 120 }));
  runtime.engine.loadRoutes();
  audit(req.user!.name, 'route.create', id, runtime.engine.t);
  res.status(201).json({ id });
}));

fleet.patch('/routes/:id', requireRole('admin'), ah((req, res) => {
  const b = req.body ?? {};
  const cur = sqlite.prepare('select * from routes where id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!cur) throw new HttpError(404, 'Route not found');
  sqlite.prepare('update routes set name=?, material=?, target_cycle_min=?, active=? where id=?').run(
    b.name !== undefined ? str(b.name, 'Name', { max: 60 }) : cur.name,
    b.material !== undefined ? oneOf(b.material, 'Material', ['ore', 'waste'] as const) : cur.material,
    b.targetCycleMin !== undefined ? num(b.targetCycleMin, 'Target cycle', { min: 3, max: 120 }) : cur.target_cycle_min,
    b.active !== undefined ? (b.active ? 1 : 0) : cur.active, req.params.id);
  runtime.engine.loadRoutes();
  audit(req.user!.name, 'route.update', String(req.params.id), runtime.engine.t);
  res.json({ ok: true });
}));

fleet.delete('/routes/:id', requireRole('admin'), ah((req, res) => {
  const used = sqlite.prepare('select count(*) as n from machines where route_id = ?').get(req.params.id) as { n: number };
  if (used.n) throw new HttpError(409, `${used.n} truck(s) still use this route`);
  sqlite.prepare('delete from routes where id = ?').run(req.params.id);
  runtime.engine.loadRoutes();
  audit(req.user!.name, 'route.delete', String(req.params.id), runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- dispatch

fleet.get('/dispatch', ah((_req, res) => {
  const e = runtime.engine;
  const loaders = [...e.loaders.keys()].map((id) => {
    const m = e.machines.get(id)!;
    const trucks = [...e.machines.values()].filter((t) => t.type === 'truck' && t.loaderId === id);
    const route = [...e.routes.values()].find((r) => r.loaderNode === m.homeNode && r.active);
    const passSec = m.type === 'shovel' ? 32 : m.type === 'excavator' ? 27 : 36;
    const avgCap = trucks.length ? trucks.reduce((s, t) => s + t.capacity, 0) / trucks.length : 200;
    const loadMin = (Math.ceil(avgCap / m.capacity) * passSec + 25) / 60;
    const cycleMin = route?.targetCycleMin ?? 20;
    const needed = Math.max(1, Math.round(cycleMin / loadMin));
    return {
      id, type: m.type, model: m.model, st: m.st, act: m.act, node: m.homeNode, capacity: m.capacity,
      queue: e.loaders.get(id)!.queue.length, routes: [...e.routes.values()].filter((r) => r.loaderNode === m.homeNode),
      trucks: trucks.map((t) => ({ id: t.id, st: t.st, act: t.act, routeId: t.routeId, homeLoaderId: t.homeLoaderId, capacity: t.capacity, model: t.model })),
      loadMin: Math.round(loadMin * 10) / 10, matchNeeded: needed, matchFactor: Math.round((trucks.length / needed) * 100) / 100,
    };
  });
  const unassigned = [...e.machines.values()].filter((t) => t.type === 'truck' && !t.loaderId)
    .map((t) => ({ id: t.id, st: t.st, act: t.act, routeId: t.routeId, homeLoaderId: t.homeLoaderId, capacity: t.capacity, model: t.model }));
  res.json({ loaders, unassigned, autoBalance: e.settings.autoBalance });
}));

fleet.post('/dispatch/assign', requireRole('manage'), ah((req, res) => {
  const truckId = str(req.body?.truckId, 'Truck');
  const loaderId = str(req.body?.loaderId, 'Loading unit');
  const e = runtime.engine;
  const loader = e.machines.get(loaderId);
  if (!loader || !e.loaders.has(loaderId)) throw new HttpError(400, 'Unknown loading unit');
  let routeId = str(req.body?.routeId, 'Route', { optional: true });
  const route = routeId ? e.routes.get(routeId) : [...e.routes.values()].find((r) => r.loaderNode === loader.homeNode && r.active);
  if (!route || route.loaderNode !== loader.homeNode) throw new HttpError(400, 'That route does not start at this loading unit');
  routeId = route.id;
  sqlite.prepare('update machines set loader_id = ?, route_id = ?, home_node = ? where id = ?').run(loaderId, routeId, route.loaderNode, truckId);
  e.assignTruck(truckId, loaderId, routeId);
  audit(req.user!.name, 'dispatch.assign', `${truckId} → ${loaderId} via ${routeId}`, e.t);
  res.json({ ok: true });
}));

fleet.post('/dispatch/autobalance', requireRole('manage'), ah((req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const cur = sqlite.prepare("select value from settings where key = 'dispatch'").get() as { value: string };
  sqlite.prepare("update settings set value = ? where key = 'dispatch'").run(JSON.stringify({ ...JSON.parse(cur.value), autoBalance: enabled }));
  runtime.engine.loadSettings();
  audit(req.user!.name, 'dispatch.autobalance', enabled ? 'on' : 'off', runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- cameras

fleet.get('/cameras', ah((req, res) => {
  const rows = req.query.machineId
    ? sqlite.prepare('select * from cameras where machine_id = ? order by position').all(String(req.query.machineId))
    : sqlite.prepare('select * from cameras order by machine_id, position').all();
  res.json((rows as Record<string, unknown>[]).map((c) => ({
    id: c.id, machineId: c.machine_id, position: c.position, label: c.label, resolution: c.resolution, fps: c.fps,
    enabled: Boolean(c.enabled), recording: Boolean(c.recording),
  })));
}));

const POSITIONS: CameraPosition[] = ['front', 'rear', 'left', 'right', 'cabin', 'bucket', 'tray'];

fleet.post('/cameras', requireRole('admin'), ah((req, res) => {
  const machineId = str(req.body?.machineId, 'Machine');
  const position = oneOf(req.body?.position, 'Position', POSITIONS);
  const id = `${machineId}-${position}`;
  if (sqlite.prepare('select 1 from cameras where id = ?').get(id)) throw new HttpError(409, `${machineId} already has a ${position} camera`);
  sqlite.prepare('insert into cameras (id, machine_id, position, label, resolution, fps, enabled, recording, created_at) values (?,?,?,?,?,?,1,1,?)')
    .run(id, machineId, position, str(req.body?.label, 'Label', { optional: true, max: 60 }) || `${machineId} ${position}`,
      oneOf(req.body?.resolution ?? '1920x1080', 'Resolution', ['1280x720', '1920x1080', '2560x1440'] as const),
      num(req.body?.fps ?? 25, 'FPS', { min: 5, max: 30 }), Date.now());
  audit(req.user!.name, 'camera.create', id, runtime.engine.t);
  res.status(201).json({ id });
}));

fleet.patch('/cameras/:id', requireRole('admin'), ah((req, res) => {
  const c = sqlite.prepare('select * from cameras where id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!c) throw new HttpError(404, 'Camera not found');
  const b = req.body ?? {};
  sqlite.prepare('update cameras set label=?, resolution=?, fps=?, enabled=?, recording=? where id=?').run(
    b.label !== undefined ? str(b.label, 'Label', { max: 60 }) : c.label,
    b.resolution !== undefined ? oneOf(b.resolution, 'Resolution', ['1280x720', '1920x1080', '2560x1440'] as const) : c.resolution,
    b.fps !== undefined ? num(b.fps, 'FPS', { min: 5, max: 30 }) : c.fps,
    b.enabled !== undefined ? (b.enabled ? 1 : 0) : c.enabled,
    b.recording !== undefined ? (b.recording ? 1 : 0) : c.recording, req.params.id);
  audit(req.user!.name, 'camera.update', String(req.params.id), runtime.engine.t);
  res.json({ ok: true });
}));

fleet.delete('/cameras/:id', requireRole('admin'), ah((req, res) => {
  sqlite.prepare('delete from cameras where id = ?').run(req.params.id);
  audit(req.user!.name, 'camera.delete', String(req.params.id), runtime.engine.t);
  res.json({ ok: true });
}));
