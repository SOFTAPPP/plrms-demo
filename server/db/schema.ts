import { sqliteTable, integer, text, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import type { SensorDef } from '../../shared/sensors';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at'),
});

export const userPrefs = sqliteTable('user_prefs', {
  userId: integer('user_id').primaryKey(),
  layout: text('layout', { mode: 'json' }).$type<unknown>(),
  theme: text('theme'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});

export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  serial: text('serial').notNull(),
  capacity: real('capacity').notNull(),
  fuelCapacity: real('fuel_capacity').notNull(),
  homeNode: text('home_node').notNull(),
  routeId: text('route_id'),
  loaderId: text('loader_id'),
  inService: integer('in_service', { mode: 'boolean' }).notNull().default(true),
  fuelL: real('fuel_l').notNull(),
  engineHours: real('engine_hours').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
});

export const operators = sqliteTable('operators', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  employeeNo: text('employee_no').notNull().unique(),
  shift: text('shift').notNull(),
  phone: text('phone').notNull(),
  licence: text('licence').notNull(),
  status: text('status').notNull().default('active'),
  experienceYears: integer('experience_years').notNull(),
  safetyScore: integer('safety_score').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const roster = sqliteTable('roster', {
  machineId: text('machine_id').notNull(),
  shift: text('shift').notNull(),
  operatorId: integer('operator_id'),
}, (t) => [primaryKey({ columns: [t.machineId, t.shift] })]);

export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  loaderNode: text('loader_node').notNull(),
  destNode: text('dest_node').notNull(),
  material: text('material').notNull(),
  distanceKm: real('distance_km').notNull(),
  targetCycleMin: real('target_cycle_min').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const sensorDefs = sqliteTable('sensor_defs', {
  key: text('key').primaryKey(),
  def: text('def', { mode: 'json' }).$type<SensorDef>().notNull(),
  sort: integer('sort').notNull().default(0),
});

export const cameras = sqliteTable('cameras', {
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull(),
  position: text('position').notNull(),
  label: text('label').notNull(),
  resolution: text('resolution').notNull(),
  fps: integer('fps').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  recording: integer('recording', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('cameras_machine').on(t.machineId)]);

export const telemetry = sqliteTable('telemetry', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  machineId: text('machine_id').notNull(),
  ts: integer('ts').notNull(),
  st: text('st').notNull(),
  act: text('act'),
  x: real('x').notNull(),
  y: real('y').notNull(),
  h: real('h').notNull(),
  spd: real('spd').notNull(),
  pay: real('pay'),
  fuel: real('fuel'),
  eTemp: real('e_temp'),
  rpm: real('rpm'),
  eLoad: real('e_load'),
  fuelRate: real('fuel_rate'),
  brk: real('brk'),
  tyreP: real('tyre_p'),
  tyreT: real('tyre_t'),
  hyd: real('hyd'),
  vib: real('vib'),
  bat: real('bat'),
  swing: real('swing'),
  boom: real('boom'),
  stick: real('stick'),
  arm: real('arm'),
  bFill: real('b_fill'),
  water: real('water'),
  depth: real('depth'),
}, (t) => [index('telemetry_machine_ts').on(t.machineId, t.ts), index('telemetry_ts').on(t.ts)]);

export const productionEvents = sqliteTable('production_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  mineDay: text('mine_day').notNull(),
  shift: text('shift').notNull(),
  truckId: text('truck_id').notNull(),
  loaderId: text('loader_id').notNull(),
  routeId: text('route_id').notNull(),
  operatorId: integer('operator_id'),
  material: text('material').notNull(),
  tonnes: real('tonnes').notNull(),
  passes: integer('passes').notNull(),
  loadTs: integer('load_ts').notNull(),
  cycleSec: real('cycle_sec').notNull(),
  queueSec: real('queue_sec').notNull(),
  spotSec: real('spot_sec').notNull(),
  loadSec: real('load_sec').notNull(),
  haulSec: real('haul_sec').notNull(),
  dumpSec: real('dump_sec').notNull(),
  returnSec: real('return_sec').notNull(),
  distanceKm: real('distance_km').notNull(),
}, (t) => [
  index('prod_ts').on(t.ts),
  index('prod_day').on(t.mineDay, t.shift),
  index('prod_truck').on(t.truckId, t.ts),
  index('prod_loader').on(t.loaderId, t.ts),
]);

export const machineShiftStats = sqliteTable('machine_shift_stats', {
  mineDay: text('mine_day').notNull(),
  shift: text('shift').notNull(),
  machineId: text('machine_id').notNull(),
  operatingSec: real('operating_sec').notNull().default(0),
  idleSec: real('idle_sec').notNull().default(0),
  downSec: real('down_sec').notNull().default(0),
  maintSec: real('maint_sec').notNull().default(0),
  fuelL: real('fuel_l').notNull().default(0),
  distanceKm: real('distance_km').notNull().default(0),
  loads: integer('loads').notNull().default(0),
  tonnes: real('tonnes').notNull().default(0),
  passes: integer('passes').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.mineDay, t.shift, t.machineId] })]);

export const fuelEvents = sqliteTable('fuel_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  machineId: text('machine_id').notNull(),
  type: text('type').notNull(),
  litres: real('litres').notNull(),
  levelBefore: real('level_before').notNull(),
  levelAfter: real('level_after').notNull(),
  location: text('location').notNull(),
  note: text('note'),
  recordedBy: text('recorded_by').notNull(),
}, (t) => [index('fuel_ts').on(t.ts)]);

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  lastTs: integer('last_ts').notNull(),
  machineId: text('machine_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  value: real('value'),
  threshold: real('threshold'),
  status: text('status').notNull(),
  count: integer('count').notNull().default(1),
  camera: text('camera'),
  operatorName: text('operator_name'),
  ackBy: text('ack_by'),
  ackAt: integer('ack_at'),
  resolvedBy: text('resolved_by'),
  resolvedAt: integer('resolved_at'),
  note: text('note'),
}, (t) => [index('alerts_status').on(t.status), index('alerts_ts').on(t.ts), index('alerts_machine').on(t.machineId)]);

export const downtime = sqliteTable('downtime', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  machineId: text('machine_id').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  category: text('category').notNull(),
  reason: text('reason').notNull(),
  notes: text('notes'),
  source: text('source').notNull(),
  createdBy: text('created_by').notNull(),
}, (t) => [index('downtime_start').on(t.start)]);

export const maintenance = sqliteTable('maintenance', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  machineId: text('machine_id').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  priority: text('priority').notNull(),
  dueAt: integer('due_at').notNull(),
  durationH: real('duration_h').notNull(),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  technician: text('technician'),
  cost: real('cost'),
  notes: text('notes'),
  source: text('source').notNull(),
  createdBy: text('created_by').notNull(),
}, (t) => [index('maint_due').on(t.dueAt)]);

export const snapshots = sqliteTable('snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  createdAt: integer('created_at').notNull(),
  machineId: text('machine_id').notNull(),
  camera: text('camera').notNull(),
  image: text('image').notNull(),
  userName: text('user_name').notNull(),
  source: text('source').notNull(),
});

export const recordings = sqliteTable('recordings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  machineId: text('machine_id').notNull(),
  camera: text('camera').notNull(),
  startTs: integer('start_ts').notNull(),
  endTs: integer('end_ts').notNull(),
  kind: text('kind').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  clientKey: text('client_key').notNull(),
  userName: text('user_name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  userName: text('user_name').notNull(),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
}, (t) => [index('audit_ts').on(t.ts)]);
