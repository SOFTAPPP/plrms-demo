// Sign-in, users, settings, sensor definitions, preferences, audit, data info and demo control.
import fs from 'node:fs';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { sqlite } from '../db/client';
import { runtime } from '../runtime';
import { audit, COOKIE, cookieOptions, requireAuth, requireRole, signSession, userFromToken } from '../auth';
import { ah, HttpError, num, oneOf, str } from './util';
import { config } from '../config';
import { listMachines } from './fleet';
import { DEFAULT_SENSORS, DIMENSIONS, type SensorDef } from '../../shared/sensors';
import { MACHINE_TYPES, type Role, type SessionUser } from '../../shared/types';
import { NODES, ZONES } from '../../shared/site';

export const publicApi = Router();
export const admin = Router();

const ROLES: Role[] = ['admin', 'supervisor', 'operator', 'viewer'];
const attempts = new Map<string, { n: number; until: number }>();

publicApi.post('/auth/login', ah(async (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 120 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { max: 200 });
  const key = `${req.ip}|${email}`;
  const a = attempts.get(key);
  if (a && a.n >= 6 && a.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
  const row = sqlite.prepare('select id, email, name, role, password_hash as hash, active from users where email = ?').get(email) as
    { id: number; email: string; name: string; role: Role; hash: string; active: number } | undefined;
  const ok = row && row.active && (await bcrypt.compare(password, row.hash));
  if (!ok) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 60_000 });
    // 200 with an error body: a mistyped password is an expected outcome, not a failed request
    return res.json({ error: 'Email or password is incorrect' });
  }
  attempts.delete(key);
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role };
  sqlite.prepare('update users set last_login_at = ? where id = ?').run(Date.now(), row.id);
  res.cookie(COOKIE, await signSession(user), cookieOptions());
  audit(user.name, 'auth.login', user.email, runtime.ready ? runtime.engine.t : undefined);
  res.json(user);
}));

publicApi.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

publicApi.get('/health', (_req, res) => res.json({ ok: true, busy: runtime.busy }));

/** Whether the simulator has finished catching up on the time since the app was last open. */
publicApi.get('/status', (_req, res) => res.json({ ready: runtime.ready, progress: runtime.progress }));

/** Who is signed in (200 with user: null when nobody is), so the first page load logs no errors. */
publicApi.get('/auth/session', ah(async (req, res) => {
  res.json({ user: await userFromToken(req.cookies?.[COOKIE]) });
}));

admin.use(requireAuth);

admin.get('/auth/me', (req, res) => res.json(req.user));

function settingsObject() {
  const rows = sqlite.prepare('select key, value from settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

function sensorDefs(): SensorDef[] {
  return (sqlite.prepare('select def from sensor_defs order by sort').all() as { def: string }[]).map((r) => JSON.parse(r.def));
}

/** Everything the app needs once at start-up. */
admin.get('/bootstrap', ah((req, res) => {
  const prefs = sqlite.prepare('select layout, theme from user_prefs where user_id = ?').get(req.user!.id) as { layout: string | null; theme: string | null } | undefined;
  const e = runtime.engine;
  res.json({
    user: req.user,
    settings: settingsObject(),
    sensorDefs: sensorDefs(),
    machines: listMachines(),
    routes: sqlite.prepare('select id, name, loader_node as loaderNode, dest_node as destNode, material, distance_km as distanceKm, target_cycle_min as targetCycleMin, active from routes order by id').all()
      .map((r) => ({ ...(r as object), active: Boolean((r as { active: number }).active) })),
    cameras: (sqlite.prepare('select * from cameras order by machine_id, position').all() as Record<string, unknown>[]).map((c) => ({
      id: c.id, machineId: c.machine_id, position: c.position, label: c.label, resolution: c.resolution, fps: c.fps, enabled: Boolean(c.enabled), recording: Boolean(c.recording),
    })),
    operators: sqlite.prepare('select id, name, employee_no as employeeNo, shift from operators order by name').all(),
    prefs: { layout: prefs?.layout ? JSON.parse(prefs.layout) : null, theme: prefs?.theme ?? null },
    sim: { t: e.t, speed: e.speed, paused: e.paused, historyDays: config.historyDays },
    site: { nodes: NODES, zones: ZONES },
  });
}));

admin.put('/prefs', ah((req, res) => {
  const layout = req.body?.layout !== undefined ? JSON.stringify(req.body.layout) : undefined;
  const theme = req.body?.theme !== undefined ? oneOf(req.body.theme, 'Theme', ['dark', 'light'] as const) : undefined;
  const cur = sqlite.prepare('select layout, theme from user_prefs where user_id = ?').get(req.user!.id) as { layout: string | null; theme: string | null } | undefined;
  sqlite.prepare('insert into user_prefs (user_id, layout, theme) values (?,?,?) on conflict(user_id) do update set layout = excluded.layout, theme = excluded.theme')
    .run(req.user!.id, layout ?? cur?.layout ?? null, theme ?? cur?.theme ?? null);
  res.json({ ok: true });
}));

admin.post('/auth/password', ah(async (req, res) => {
  const current = str(req.body?.current, 'Current password', { max: 200 });
  const next = str(req.body?.next, 'New password', { min: 8, max: 200 });
  const row = sqlite.prepare('select password_hash as hash from users where id = ?').get(req.user!.id) as { hash: string };
  if (!(await bcrypt.compare(current, row.hash))) throw new HttpError(400, 'Current password is incorrect');
  sqlite.prepare('update users set password_hash = ? where id = ?').run(await bcrypt.hash(next, 10), req.user!.id);
  audit(req.user!.name, 'auth.password', 'Changed own password', runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- users

admin.get('/users', requireRole('admin'), ah((_req, res) => {
  res.json(sqlite.prepare('select id, email, name, role, active, created_at as createdAt, last_login_at as lastLoginAt from users order by id').all()
    .map((u) => ({ ...(u as object), active: Boolean((u as { active: number }).active) })));
}));

admin.post('/users', requireRole('admin'), ah(async (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (sqlite.prepare('select 1 from users where email = ?').get(email)) throw new HttpError(409, 'A user with this email already exists');
  const password = str(req.body?.password, 'Password', { min: 8, max: 200 });
  const r = sqlite.prepare('insert into users (email, name, password_hash, role, active, created_at) values (?,?,?,?,1,?)').run(
    email, str(req.body?.name, 'Name', { min: 2, max: 60 }), await bcrypt.hash(password, 10), oneOf(req.body?.role, 'Role', ROLES), Date.now());
  audit(req.user!.name, 'user.create', `${email} (${req.body?.role})`, runtime.engine.t);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

function adminCount(exceptId?: number) {
  return (sqlite.prepare("select count(*) as n from users where role = 'admin' and active = 1 and id != ?").get(exceptId ?? -1) as { n: number }).n;
}

admin.patch('/users/:id', requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const cur = sqlite.prepare('select * from users where id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new HttpError(404, 'User not found');
  const b = req.body ?? {};
  const role = b.role !== undefined ? oneOf(b.role, 'Role', ROLES) : (cur.role as Role);
  const active = b.active !== undefined ? Boolean(b.active) : Boolean(cur.active);
  if (cur.role === 'admin' && (role !== 'admin' || !active) && adminCount(id) === 0) throw new HttpError(409, 'At least one active administrator is required');
  const name = b.name !== undefined ? str(b.name, 'Name', { min: 2, max: 60 }) : cur.name;
  let hash = cur.password_hash as string;
  if (b.password) hash = await bcrypt.hash(str(b.password, 'Password', { min: 8, max: 200 }), 10);
  sqlite.prepare('update users set name=?, role=?, active=?, password_hash=? where id=?').run(name, role, active ? 1 : 0, hash, id);
  audit(req.user!.name, 'user.update', `${cur.email}${b.password ? ' (password reset)' : ''}${b.role ? ` role=${role}` : ''}`, runtime.engine.t);
  res.json({ ok: true });
}));

admin.delete('/users/:id', requireRole('admin'), ah((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw new HttpError(409, 'You cannot delete your own account');
  const cur = sqlite.prepare('select email, role from users where id = ?').get(id) as { email: string; role: string } | undefined;
  if (!cur) throw new HttpError(404, 'User not found');
  if (cur.role === 'admin' && adminCount(id) === 0) throw new HttpError(409, 'At least one active administrator is required');
  sqlite.prepare('delete from users where id = ?').run(id);
  sqlite.prepare('delete from user_prefs where user_id = ?').run(id);
  audit(req.user!.name, 'user.delete', cur.email, runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- settings & sensors

const SETTING_KEYS = ['site', 'shifts', 'kpiTargets', 'units', 'dispatch', 'alerts'] as const;

admin.get('/settings', ah((_req, res) => res.json(settingsObject())));

admin.put('/settings/:key', requireRole('admin'), ah((req, res) => {
  const key = oneOf(req.params.key, 'Setting', SETTING_KEYS);
  const value = req.body?.value;
  if (!value || typeof value !== 'object') throw new HttpError(400, 'Value must be an object');
  if (key === 'kpiTargets') {
    for (const f of ['dailyTonnes', 'tph', 'availability', 'utilisation', 'maxQueueMin', 'fuelLPerTonne', 'cycleMin']) num(value[f], f, { min: 0 });
  }
  if (key === 'shifts') {
    num(value.aStartHour, 'Shift A start', { min: 0, max: 12 });
    for (const s of ['A', 'B', 'C']) str(value.names?.[s], `Shift ${s} name`, { max: 30 });
  }
  if (key === 'alerts') {
    num(value.overspeedMargin, 'Overspeed margin', { min: 0, max: 30 });
    num(value.proximityM, 'Proximity distance', { min: 3, max: 60 });
    num(value.autoCloseMin, 'Auto-close', { min: 5, max: 1440 });
  }
  if (key === 'site') for (const f of ['name', 'company', 'location', 'commodity']) str(value[f], f, { max: 80 });
  sqlite.prepare('update settings set value = ? where key = ?').run(JSON.stringify(value), key);
  runtime.engine.loadSettings();
  audit(req.user!.name, 'settings.update', key, runtime.engine.t);
  res.json({ ok: true });
}));

admin.get('/sensor-defs', ah((_req, res) => res.json({ defs: sensorDefs(), catalogue: DEFAULT_SENSORS })));

function sensorBody(b: Record<string, unknown>, key: string): SensorDef {
  const dir = oneOf(b.dir, 'Alert direction', ['high', 'low', 'none'] as const);
  const warn = b.warn === null || b.warn === '' || b.warn === undefined ? null : num(b.warn, 'Warning');
  const crit = b.crit === null || b.crit === '' || b.crit === undefined ? null : num(b.crit, 'Critical');
  if (dir === 'high' && warn !== null && crit !== null && crit < warn) throw new HttpError(400, 'Critical must be above warning for high alerts');
  if (dir === 'low' && warn !== null && crit !== null && crit > warn) throw new HttpError(400, 'Critical must be below warning for low alerts');
  const types = Array.isArray(b.types) ? b.types.filter((x): x is (typeof MACHINE_TYPES)[number] => MACHINE_TYPES.includes(x as never)) : [];
  if (!types.length) throw new HttpError(400, 'Choose at least one machine type');
  return {
    key, label: str(b.label, 'Label', { max: 60 }), dimension: oneOf(b.dimension, 'Unit type', DIMENSIONS),
    group: oneOf(b.group, 'Group', ['engine', 'fuel', 'load', 'motion', 'hydraulics', 'tyres', 'electrical', 'work'] as const),
    types, min: num(b.min, 'Min'), max: num(b.max, 'Max'), dir, warn, crit, decimals: num(b.decimals ?? 1, 'Decimals', { min: 0, max: 3 }),
    enabled: b.enabled !== false,
  };
}

admin.put('/sensor-defs/:key', requireRole('admin'), ah((req, res) => {
  const key = String(req.params.key);
  if (!sqlite.prepare('select 1 from sensor_defs where key = ?').get(key)) throw new HttpError(404, 'Sensor not found');
  const def = sensorBody(req.body ?? {}, key);
  sqlite.prepare('update sensor_defs set def = ? where key = ?').run(JSON.stringify(def), key);
  runtime.engine.loadSensorDefs();
  audit(req.user!.name, 'sensor.update', key, runtime.engine.t);
  res.json(def);
}));

admin.post('/sensor-defs', requireRole('admin'), ah((req, res) => {
  const key = str(req.body?.key, 'Signal key', { max: 40 }).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (sqlite.prepare('select 1 from sensor_defs where key = ?').get(key)) throw new HttpError(409, 'A sensor with this key already exists');
  const def = sensorBody(req.body ?? {}, key);
  const max = sqlite.prepare('select coalesce(max(sort), 0) as s from sensor_defs').get() as { s: number };
  sqlite.prepare('insert into sensor_defs (key, def, sort) values (?,?,?)').run(key, JSON.stringify(def), max.s + 1);
  runtime.engine.loadSensorDefs();
  audit(req.user!.name, 'sensor.create', key, runtime.engine.t);
  res.status(201).json(def);
}));

admin.delete('/sensor-defs/:key', requireRole('admin'), ah((req, res) => {
  sqlite.prepare('delete from sensor_defs where key = ?').run(String(req.params.key));
  runtime.engine.loadSensorDefs();
  audit(req.user!.name, 'sensor.delete', String(req.params.key), runtime.engine.t);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- audit, data, demo control

admin.get('/audit', requireRole('admin'), ah((req, res) => {
  const limit = Math.min(1000, Number(req.query.limit) || 300);
  res.json(sqlite.prepare('select id, ts, user_name as userName, action, detail from audit_log order by id desc limit ?').all(limit));
}));

admin.get('/data-info', requireRole('admin'), ah((_req, res) => {
  const tables = ['telemetry', 'production_events', 'alerts', 'downtime', 'maintenance', 'fuel_events', 'machine_shift_stats', 'snapshots', 'recordings', 'audit_log'];
  const counts = Object.fromEntries(tables.map((t) => [t, (sqlite.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n]));
  let size = 0;
  for (const f of [config.dbPath, `${config.dbPath}-wal`]) {
    try { size += fs.statSync(f).size; } catch { /* missing wal */ }
  }
  const range = sqlite.prepare('select min(ts) as a, max(ts) as b from telemetry').get() as { a: number | null; b: number | null };
  res.json({ dbPath: config.dbPath, sizeBytes: size, counts, telemetryFrom: range.a, telemetryTo: range.b, historyDays: config.historyDays });
}));

admin.get('/demo', requireRole('manage'), (_req, res) => {
  const e = runtime.engine;
  res.json({ t: e.t, speed: e.speed, paused: e.paused, wallClock: Date.now() });
});

admin.post('/demo/speed', requireRole('manage'), ah((req, res) => {
  runtime.setSpeed(num(req.body?.speed, 'Speed', { min: 1, max: 60 }));
  audit(req.user!.name, 'demo.speed', `${req.body.speed}x`, runtime.engine.t);
  res.json({ speed: runtime.engine.speed });
}));

admin.post('/demo/pause', requireRole('manage'), ah((req, res) => {
  runtime.setPaused(Boolean(req.body?.paused));
  res.json({ paused: runtime.engine.paused });
}));

admin.post('/demo/scenario', requireRole('manage'), ah((req, res) => {
  const kind = str(req.body?.kind, 'Scenario', { max: 30 });
  const machineId = str(req.body?.machineId, 'Machine', { optional: true }) || undefined;
  const text = runtime.engine.scenario(kind, machineId);
  audit(req.user!.name, 'demo.scenario', `${kind}: ${text}`, runtime.engine.t);
  runtime.broadcast({ type: 'event', kind: 'info', text: `Scenario: ${text}`, t: runtime.engine.t });
  res.json({ text });
}));

admin.post('/demo/reset', requireRole('admin'), ah(async (req, res) => {
  const who = req.user!.name;
  await runtime.reset();
  audit(who, 'demo.reset', 'All data regenerated', runtime.engine.t);
  res.json({ ok: true });
}));
