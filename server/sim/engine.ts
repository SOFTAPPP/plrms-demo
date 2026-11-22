// The mine simulator: machines, load-and-haul cycles, sensors, faults, alerts and KPIs.
import { sqlite } from '../db/client';
import { DRILL_PATTERN, NODE_BY_ID, edgeLimit, shortestPath, zoneAt } from '../../shared/site';
import { DEFAULT_SENSORS, type SensorDef, sensorState } from '../../shared/sensors';
import { shiftOf, type ShiftInfo } from '../../shared/time';
import type {
  AlertRow, CameraPosition, KpiSnapshot, LiveFrame, MachineLive, MachineStatus, MachineType, ServerMessage, ShiftCode,
} from '../../shared/types';
import { MACHINE_STATUSES } from '../../shared/types';
import { AlertManager } from './alerts';
import { Recorder, emptyStats, type StatDelta, type TelemetryRow } from './recorder';
import { Rng } from './rng';

interface PathPt { x: number; y: number; z: number; limit: number; node?: string }

interface Hold {
  until: number;
  st: MachineStatus;
  act: string;
  kind: 'shift' | 'crib' | 'breakdown' | 'maintenance' | 'refuel' | 'cooldown' | 'offline' | 'park' | 'delay';
  downtimeId: number | null;
  workOrderId?: number | null;
}

interface Cycle {
  valid: boolean;
  start: number;
  queueStart: number | null;
  spotStart: number | null;
  loadStart: number | null;
  loadEnd: number | null;
  dumpStart: number | null;
  passes: number;
  tonnes: number;
  loaderId: string;
  routeId: string;
  material: string;
  distM: number;
  opId: number | null;
}

interface Fault {
  overheatUntil?: number;
  overheatLevel?: number;
  tyreLeak?: number;
  camOff?: { cam: string; until: number };
  forceOverload?: boolean;
  lowBattery?: boolean;
}

export interface SimMachine {
  id: string;
  type: MachineType;
  name: string;
  model: string;
  capacity: number;
  fuelCap: number;
  homeNode: string;
  inService: boolean;
  homeLoaderId: string | null;
  homeRouteId: string | null;
  loaderId: string | null;
  routeId: string | null;
  x: number; y: number; z: number; h: number; v: number;
  node: string;
  path: PathPt[] | null;
  pi: number;
  mode: string;
  phaseEnd: number;
  st: MachineStatus;
  act: string;
  payload: number;
  fuelL: number;
  hours: number;
  eTemp: number; rpm: number; eLoad: number; fuelRate: number; bat: number; brk: number;
  tp: number[]; tt: number[]; cold: number[];
  hyd: number; vib: number; swing: number; boom: number; stick: number; arm: number; bFill: number; bWt: number;
  water: number; depth: number;
  cycles: number;
  aggr: number;
  opId: number | null;
  opName: string;
  hold: Hold | null;
  cyc: Cycle | null;
  fault: Fault;
  dms: 0 | 1 | 2;
  dmsUntil: number;
  stats: StatDelta;
  sustain: Record<string, number>;
  clearSince: Record<string, number>;
  target: { x: number; y: number } | null;
  anchor: { x: number; y: number };
  drillIdx: number;
  pendingWorkOrder: { id: number; title: string; durationH: number } | null;
  lastDistM: number;
  engineOn: boolean;
  grade: number;
  prevV: number;
  leadFootUntil: number;
  lastDist: Record<string, number>;
  stuckSince: number | null;
  ghostUntil: number;
}

interface LoaderState {
  queue: string[];
  current: string | null;
  phase: 'wait' | 'dig' | 'swingFull' | 'dump' | 'swingEmpty';
  phaseStart: number;
  phaseDur: number;
  passT: number;
  passFill: number;
  side: number;
  pos: { x: number; y: number };
  spot: { x: number; y: number; h: number };
  queuePt: { x: number; y: number };
  pile: { x: number; y: number };
  idleSince: number | null;
  idleDowntime: number | null;
}

export interface RouteRow { id: string; name: string; loaderNode: string; destNode: string; material: string; active: boolean; distanceKm: number; targetCycleMin: number }

interface Settings {
  aStartHour: number;
  shiftNames: Record<ShiftCode, string>;
  targets: { dailyTonnes: number; tph: number; availability: number; utilisation: number; maxQueueMin: number; fuelLPerTonne: number; cycleMin: number };
  autoBalance: boolean;
  overspeedMargin: number;
  proximityM: number;
  fatigueEnabled: boolean;
  autoCloseMin: number;
}

const OPERATING: MachineStatus[] = ['running', 'loading', 'hauling'];
const KMH = 3.6;
const PASS_TIMES: Record<string, [number, number, number, number]> = {
  shovel: [11, 9, 4, 8],
  excavator: [9, 7, 4, 7],
  loader: [10, 11, 5, 10],
};
const FUEL_RATES: Record<MachineType, [number, number]> = {
  truck: [20, 250], shovel: [55, 380], excavator: [40, 300], loader: [22, 160], dozer: [12, 110], drill: [14, 105], water: [16, 150], lv: [1.2, 14],
};
const BREAKDOWN_REASONS: Record<MachineType, string[]> = {
  truck: ['Hydraulic hose burst', 'Alternator failure', 'Transmission fault code', 'Flat tyre - position 3', 'Coolant leak', 'Suspension strut fault'],
  shovel: ['Swing motor fault', 'Hydraulic pump failure', 'Bucket tooth lost', 'Track tension fault'],
  excavator: ['Hydraulic hose burst', 'Bucket tooth lost', 'Pilot pressure fault', 'Slew ring noise'],
  loader: ['Lift cylinder leak', 'Tyre damage', 'Transmission overheating'],
  dozer: ['Track pin failure', 'Blade tilt cylinder leak', 'Final drive noise'],
  drill: ['Compressor trip', 'Bit stuck in hole', 'Rotation head fault'],
  water: ['Spray pump failure', 'Air leak - brake system'],
  lv: ['Flat tyre', 'Battery failure'],
};
const STICKY_TYPES = new Set(['sensor.payload_pct', 'fuel_anomaly', 'breakdown', 'collision_risk']);
const SENSOR_TITLES: Record<string, string> = {
  payload_pct: 'Overload', engine_temp: 'Engine overheating', fuel_level: 'Low fuel', tyre_pressure: 'Low tyre pressure',
  tyre_temp: 'High tyre temperature', brake_temp: 'Brake overheating', hyd_pressure: 'High hydraulic pressure',
  vibration: 'Excessive vibration', battery: 'Low battery voltage', water_level: 'Water tank low', rpm: 'Engine over-rev',
};
const SENSOR_CAMERA: Record<string, CameraPosition> = {
  payload_pct: 'tray', tyre_pressure: 'left', tyre_temp: 'left', brake_temp: 'left', fuel_level: 'rear',
  hyd_pressure: 'bucket', vibration: 'bucket',
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const approach = (v: number, target: number, dt: number, tau: number) => v + (target - v) * Math.min(1, dt / tau);
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export class Engine {
  t: number;
  speed: number;
  paused = false;
  machines = new Map<string, SimMachine>();
  loaders = new Map<string, LoaderState>();
  routes = new Map<string, RouteRow>();
  sensorDefs: SensorDef[] = DEFAULT_SENSORS;
  alerts = new AlertManager();
  rec = new Recorder();
  rng = new Rng(Date.now() & 0xffffffff);
  settings!: Settings;
  /** operators: id -> name, and roster machine -> shift -> operator id */
  operators = new Map<number, string>();
  roster = new Map<string, Record<string, number | null>>();
  emit: (msg: ServerMessage) => void = () => {};
  backfilling = false;
  private lastDt = 1;

  private shift!: ShiftInfo;
  private lastTelemetryBucket = 0;
  private lastStatsFlush = 0;
  private lastMaintCheck = 0;
  private prodLog: { ts: number; tonnes: number; cycleSec: number; queueSec: number; mineDay: string; shift: string }[] = [];
  private fuelDay = { day: '', litres: 0 };
  private cribPlan = new Map<string, number>();
  private proxCooldown = new Map<string, number>();

  constructor(t: number, speed: number) {
    this.t = t;
    this.speed = speed;
    this.alerts.onChange = (row, isNew) => {
      if (!this.backfilling) this.emit({ type: 'alert', alert: row, isNew });
    };
  }

  // ---------------------------------------------------------------- loading state from the database

  loadAll() {
    this.loadSettings();
    this.loadSensorDefs();
    this.loadRoutes();
    this.loadRoster();
    this.alerts.load();
    const rows = sqlite.prepare('select * from machines').all() as Record<string, unknown>[];
    for (const r of rows) this.addMachine(r);
    this.shift = shiftOf(this.t, this.settings.aStartHour);
    this.planCribs();
    this.applyOperators();
  }

  loadSettings() {
    const rows = sqlite.prepare('select key, value from settings').all() as { key: string; value: string }[];
    const s: Record<string, any> = {};
    for (const r of rows) s[r.key] = JSON.parse(r.value);
    this.settings = {
      aStartHour: s.shifts?.aStartHour ?? 6,
      shiftNames: s.shifts?.names ?? { A: 'Day', B: 'Evening', C: 'Night' },
      targets: s.kpiTargets,
      autoBalance: s.dispatch?.autoBalance ?? true,
      overspeedMargin: s.alerts?.overspeedMargin ?? 5,
      proximityM: s.alerts?.proximityM ?? 15,
      fatigueEnabled: s.alerts?.fatigueEnabled ?? true,
      autoCloseMin: s.alerts?.autoCloseMin ?? 30,
    };
    this.alerts.autoCloseMin = this.settings.autoCloseMin;
  }

  loadSensorDefs() {
    const rows = sqlite.prepare('select def from sensor_defs order by sort').all() as { def: string }[];
    this.sensorDefs = rows.length ? rows.map((r) => JSON.parse(r.def) as SensorDef) : DEFAULT_SENSORS;
  }

  loadRoutes() {
    this.routes.clear();
    const rows = sqlite.prepare('select id, name, loader_node as loaderNode, dest_node as destNode, material, active, distance_km as distanceKm, target_cycle_min as targetCycleMin from routes').all() as RouteRow[];
    for (const r of rows) this.routes.set(r.id, { ...r, active: Boolean(r.active) });
  }

  loadRoster() {
    this.operators.clear();
    // operators on leave are not on the machine even if they are rostered
    for (const o of sqlite.prepare("select id, name from operators where status != 'leave'").all() as { id: number; name: string }[]) this.operators.set(o.id, o.name);
    this.roster.clear();
    for (const r of sqlite.prepare('select machine_id as m, shift, operator_id as op from roster').all() as { m: string; shift: string; op: number | null }[]) {
      if (!this.roster.has(r.m)) this.roster.set(r.m, {});
      this.roster.get(r.m)![r.shift] = r.op;
    }
    if (this.shift) this.applyOperators();
  }

  private applyOperators(shiftCode?: ShiftCode) {
    const code = shiftCode ?? this.shift.code;
    for (const m of this.machines.values()) {
      const op = this.roster.get(m.id)?.[code] ?? null;
      m.opId = op && this.operators.has(op) ? op : null;
      m.opName = op ? this.operators.get(op) ?? '' : '';
      m.aggr = op ? 0.9 + ((op * 7919) % 100) / 100 * (m.type === 'lv' ? 0.3 : 0.2) : 1;
    }
  }

  addMachine(r: Record<string, unknown>) {
    const type = r.type as MachineType;
    const home = NODE_BY_ID[r.home_node as string] ?? NODE_BY_ID.AD;
    const m: SimMachine = {
      id: r.id as string, type, name: r.name as string, model: r.model as string,
      capacity: r.capacity as number, fuelCap: r.fuel_capacity as number, homeNode: home.id,
      inService: Boolean(r.in_service),
      homeLoaderId: (r.loader_id as string | null) ?? null, homeRouteId: (r.route_id as string | null) ?? null,
      loaderId: (r.loader_id as string | null) ?? null, routeId: (r.route_id as string | null) ?? null,
      x: home.x, y: home.y, z: home.z, h: this.rng.range(0, 360), v: 0, node: home.id, path: null, pi: 0,
      mode: 'idle', phaseEnd: 0, st: 'idle', act: 'Starting up', payload: 0,
      fuelL: r.fuel_l as number, hours: r.engine_hours as number,
      eTemp: 80, rpm: 700, eLoad: 20, fuelRate: 20, bat: 27.6, brk: 70,
      tp: [], tt: [], cold: [],
      hyd: 90, vib: 2, swing: 0, boom: 25, stick: -50, arm: 0, bFill: 0, bWt: 0, water: 80, depth: 0,
      cycles: 0, aggr: 1, opId: null, opName: '', hold: null, cyc: null, fault: {}, dms: 0, dmsUntil: 0,
      stats: emptyStats(), sustain: {}, clearSince: {}, target: null, anchor: { x: home.x, y: home.y },
      drillIdx: 0, pendingWorkOrder: null, lastDistM: 0, engineOn: true, grade: 0, prevV: 0, leadFootUntil: 0, lastDist: {}, stuckSince: null, ghostUntil: 0,
    };
    if (type === 'truck' || type === 'water') {
      for (let i = 0; i < 6; i++) {
        m.cold.push(this.rng.range(95, 101));
        m.tt.push(this.rng.range(35, 55));
        m.tp.push(m.cold[i]);
      }
    }
    this.machines.set(m.id, m);
    if (type === 'shovel' || type === 'excavator' || type === 'loader') this.setupLoader(m);
    this.placeInitial(m);
    if (!m.inService) this.putOffline(m);
    if (this.shift) this.applyOperators();
    return m;
  }

  removeMachine(id: string) {
    const m = this.machines.get(id);
    if (!m) return;
    if (m.hold?.downtimeId) this.rec.closeDowntime(m.hold.downtimeId, this.t);
    this.machines.delete(id);
    for (const ls of this.loaders.values()) {
      ls.queue = ls.queue.filter((q) => q !== id);
      if (ls.current === id) { ls.current = null; ls.phase = 'wait'; }
    }
    if (this.loaders.has(id)) {
      this.loaders.delete(id);
      for (const t of this.machines.values()) if (t.loaderId === id) this.redispatch(t);
    }
  }

  private setupLoader(m: SimMachine) {
    const face = NODE_BY_ID[m.homeNode];
    const nb = shortestPath(m.homeNode, m.type === 'loader' ? 'CRJ' : 'JX')[1] ?? m.homeNode;
    const prev = NODE_BY_ID[nb];
    let dx = face.x - prev.x;
    let dy = face.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const side = m.id.charCodeAt(m.id.length - 1) % 2 ? 1 : -1;
    const left = { x: dy * side, y: -dx * side };
    const pos = { x: face.x + dx * 14, y: face.y + dy * 14 };
    const ls: LoaderState = {
      queue: [], current: null, phase: 'wait', phaseStart: this.t, phaseDur: 0, passT: 0, passFill: 0, side,
      pos,
      spot: { x: face.x + left.x * 17 - dx * 4, y: face.y + left.y * 17 - dy * 4, h: Math.atan2(-left.y, -left.x) * 180 / Math.PI },
      queuePt: { x: face.x - dx * 55, y: face.y - dy * 55 },
      pile: { x: face.x + dx * 60 - left.x * 25, y: face.y + dy * 60 - left.y * 25 },
      idleSince: null, idleDowntime: null,
    };
    // Two loaders can share a face (ROM). Offset the second one.
    const others = [...this.loaders.values()].filter((o) => Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) < 30).length;
    if (others) {
      ls.pos = { x: pos.x - left.x * 45, y: pos.y - left.y * 45 };
      ls.pile = { x: ls.pile.x - left.x * 50, y: ls.pile.y - left.y * 50 };
    }
    this.loaders.set(m.id, ls);
    m.x = ls.pos.x;
    m.y = ls.pos.y;
    m.h = Math.atan2(dy, dx) * 180 / Math.PI;
    m.anchor = { ...ls.pos };
  }

  private placeInitial(m: SimMachine) {
    switch (m.type) {
      case 'truck': {
        const route = this.routes.get(m.routeId ?? '');
        if (!route) { m.mode = 'idle'; m.st = 'idle'; m.act = 'Awaiting dispatch'; return; }
        const full = shortestPath(route.loaderNode, route.destNode);
        const idx = this.rng.int(0, Math.max(0, full.length - 2));
        const at = NODE_BY_ID[full[idx]];
        m.x = at.x; m.y = at.y; m.z = at.z; m.node = at.id;
        if (this.rng.chance(0.5) && idx > 0) {
          m.payload = m.capacity * this.rng.range(0.94, 1.02);
          m.cyc = this.newCycle(m, false);
          m.cyc.loadEnd = this.t;
          m.cyc.tonnes = m.payload;
          this.startPath(m, route.destNode, 'to_dump');
        } else {
          m.cyc = this.newCycle(m, false);
          this.goToLoader(m);
        }
        break;
      }
      case 'dozer':
      case 'drill': {
        const n = NODE_BY_ID[m.homeNode];
        if (m.type === 'drill') {
          m.drillIdx = m.id.endsWith('2') ? 30 : 0;
          const p = this.drillHole(m.drillIdx);
          m.x = p.x; m.y = p.y; m.z = -20;
          m.mode = 'drill';
          m.phaseEnd = this.t + this.rng.range(200, 600) * 1000;
          m.depth = this.rng.range(0, 10);
        } else {
          const off = m.id === 'DZ-01' ? { x: 80, y: 60 } : m.id === 'DZ-02' ? { x: -40, y: 45 } : { x: 120, y: -90 };
          m.anchor = { x: n.x + off.x, y: n.y + off.y };
          m.x = m.anchor.x; m.y = m.anchor.y; m.z = n.z;
          m.mode = 'push';
          m.target = this.dozerWaypoint(m);
        }
        break;
      }
      case 'water':
      case 'lv': {
        m.water = this.rng.range(30, 95);
        this.startPath(m, this.randomDest(m), 'drive');
        break;
      }
      default:
        m.mode = 'wait';
    }
  }

  private putOffline(m: SimMachine) {
    m.hold = { until: Number.MAX_SAFE_INTEGER, st: 'offline', act: 'Out of service', kind: 'offline', downtimeId: null };
    m.v = 0;
    m.engineOn = false;
  }

  setInService(id: string, inService: boolean) {
    const m = this.machines.get(id);
    if (!m) return;
    m.inService = inService;
    if (!inService) {
      if (m.hold?.downtimeId) this.rec.closeDowntime(m.hold.downtimeId, this.t);
      this.putOffline(m);
      if (this.loaders.has(id)) for (const t of this.machines.values()) if (t.loaderId === id) this.redispatch(t);
    } else if (m.hold?.kind === 'offline') {
      m.hold = null;
      m.engineOn = true;
      if (m.type === 'truck') this.goToLoader(m);
    }
  }

  updateMachineMeta(id: string, patch: { name?: string; model?: string; capacity?: number; fuelCapacity?: number }) {
    const m = this.machines.get(id);
    if (!m) return;
    if (patch.name) m.name = patch.name;
    if (patch.model) m.model = patch.model;
    if (patch.capacity) m.capacity = patch.capacity;
    if (patch.fuelCapacity) m.fuelCap = patch.fuelCapacity;
  }

  // ---------------------------------------------------------------- paths and movement

  private newCycle(m: SimMachine, valid: boolean): Cycle {
    const route = this.routes.get(m.routeId ?? '');
    return {
      valid, start: this.t, queueStart: null, spotStart: null, loadStart: null, loadEnd: null, dumpStart: null, passes: 0, tonnes: 0,
      loaderId: m.loaderId ?? '', routeId: m.routeId ?? '', material: route?.material ?? 'ore', distM: 0, opId: m.opId,
    };
  }

  private upcomingNode(m: SimMachine): string {
    if (m.path && m.pi < m.path.length) {
      for (let i = m.pi; i < m.path.length; i++) if (m.path[i].node) return m.path[i].node!;
    }
    return m.node;
  }

  /** Build a path from the machine's position along the road graph to `dest`. */
  private startPath(m: SimMachine, dest: string, mode: string, endAt?: { x: number; y: number }) {
    const from = this.upcomingNode(m);
    const ids = shortestPath(from, dest);
    const pts: PathPt[] = [];
    for (let i = 0; i < ids.length; i++) {
      const n = NODE_BY_ID[ids[i]];
      const limit = i === 0 ? edgeLimit(m.node, ids[0]) : edgeLimit(ids[i - 1], ids[i]);
      pts.push({ x: n.x, y: n.y, z: n.z, limit, node: n.id });
    }
    if (endAt) {
      const last = pts[pts.length - 1];
      pts[pts.length - 1] = { ...last, x: endAt.x, y: endAt.y, node: undefined };
      m.node = m.node || last.node!;
    }
    m.path = pts;
    m.pi = 0;
    m.mode = mode;
    m.lastDistM = 0;
  }

  private goToLoader(m: SimMachine) {
    const loaderId = this.effectiveLoader(m);
    m.loaderId = loaderId;
    const ls = loaderId ? this.loaders.get(loaderId) : null;
    if (!ls || !loaderId) {
      m.path = null;
      m.mode = 'idle';
      m.st = 'idle';
      m.act = 'Awaiting dispatch';
      return;
    }
    const loader = this.machines.get(loaderId)!;
    if (m.loaderId !== m.homeLoaderId || !m.routeId) {
      const r = this.routeForLoader(loader, this.routes.get(m.homeRouteId ?? '')?.material);
      if (r) m.routeId = r.id;
    } else {
      m.routeId = m.homeRouteId;
    }
    this.startPath(m, loader.homeNode, 'to_loader', ls.queuePt);
  }

  private routeForLoader(loader: SimMachine, material?: string): RouteRow | null {
    const rs = [...this.routes.values()].filter((r) => r.active && r.loaderNode === loader.homeNode);
    return rs.find((r) => r.material === material) ?? rs[0] ?? null;
  }

  private loaderAvailable(id: string | null): boolean {
    if (!id) return false;
    const l = this.machines.get(id);
    if (!l || !l.inService) return false;
    // short operational pauses (shift handover, meal break) keep the trucks waiting; anything else frees them
    return !l.hold || l.hold.kind === 'shift' || l.hold.kind === 'crib';
  }

  private effectiveLoader(m: SimMachine): string | null {
    if (this.loaderAvailable(m.homeLoaderId)) return m.homeLoaderId;
    if (!this.settings.autoBalance) return m.homeLoaderId;
    const material = this.routes.get(m.homeRouteId ?? '')?.material;
    let best: string | null = null;
    let score = Infinity;
    for (const [id] of this.loaders) {
      if (!this.loaderAvailable(id)) continue;
      const l = this.machines.get(id)!;
      const r = this.routeForLoader(l, material);
      if (!r || r.material !== material) continue;
      const assigned = [...this.machines.values()].filter((t) => t.loaderId === id).length;
      if (assigned < score) { score = assigned; best = id; }
    }
    return best ?? m.homeLoaderId;
  }

  /** Re-plan a truck whose loader went down or was changed by a dispatcher. */
  redispatch(m: SimMachine, announce = true) {
    if (m.type !== 'truck') return;
    if (m.mode === 'to_loader' || m.mode === 'queue' || m.mode === 'idle') {
      const old = m.loaderId;
      for (const ls of this.loaders.values()) ls.queue = ls.queue.filter((q) => q !== m.id);
      if (m.hold?.kind === 'park') m.hold = null;
      this.goToLoader(m);
      if (m.cyc) m.cyc.queueStart = null;
      if (announce && old !== m.loaderId && m.loaderId && !this.backfilling) {
        this.emit({ type: 'event', kind: 'dispatch', text: `${m.id} dispatched to ${m.loaderId}${old ? ` (was ${old})` : ''}`, machineId: m.id, t: this.t });
      }
    }
  }

  assignTruck(id: string, loaderId: string, routeId: string) {
    const m = this.machines.get(id);
    if (!m) return;
    m.homeLoaderId = loaderId;
    m.homeRouteId = routeId;
    m.routeId = routeId;
    this.redispatch(m);
  }

  private randomDest(m: SimMachine): string {
    const lv = ['AD', 'WS', 'FB', 'CR', 'WD', 'EXIT', 'B60', 'PF', 'ROM', 'N40', 'F-S2', 'F-N2'];
    const wt = ['CR', 'WD', 'PF', 'B40', 'B80', 'WDJ', 'CRJ', 'S80', 'N40', 'JX'];
    const opts = (m.type === 'lv' ? lv : wt).filter((x) => x !== m.node);
    return this.rng.pick(opts);
  }

  private moveAlong(m: SimMachine, dt: number, cruise: number): boolean {
    if (!m.path || m.pi >= m.path.length) return true;
    let remaining = 0;
    let px = m.x;
    let py = m.y;
    for (let i = m.pi; i < m.path.length; i++) {
      remaining += Math.hypot(m.path[i].x - px, m.path[i].y - py);
      px = m.path[i].x;
      py = m.path[i].y;
    }
    if (remaining < 3) {
      const last = m.path[m.path.length - 1];
      m.x = last.x;
      m.y = last.y;
      if (last.node) m.node = last.node;
      m.pi = m.path.length;
      m.v = 0;
      return true;
    }
    const acc = m.payload > m.capacity * 0.5 ? 0.35 : 0.6;
    const dec = 1.1;
    let tgt = cruise;
    const stopV = Math.sqrt(2 * dec * Math.max(0, remaining - 2));
    if (stopV < tgt) tgt = stopV;
    m.prevV = m.v;
    m.v = m.v < tgt ? Math.min(tgt, m.v + acc * dt) : Math.max(tgt, m.v - dec * dt);
    let d = m.v * dt;
    while (d > 0 && m.pi < m.path.length) {
      const p = m.path[m.pi];
      const seg = Math.hypot(p.x - m.x, p.y - m.y);
      if (seg > 0.01) m.h = Math.atan2(p.y - m.y, p.x - m.x) * 180 / Math.PI;
      if (seg <= d) {
        m.grade = seg > 1 ? (p.z - m.z) / seg : m.grade;
        m.x = p.x; m.y = p.y; m.z = p.z;
        if (p.node) m.node = p.node;
        d -= seg;
        m.pi++;
      } else {
        const f = d / seg;
        m.grade = (p.z - m.z) / seg;
        m.x += (p.x - m.x) * f;
        m.y += (p.y - m.y) * f;
        m.z += (p.z - m.z) * f;
        d = 0;
      }
    }
    const moved = m.v * dt;
    m.stats.distanceKm += moved / 1000;
    if (m.cyc) m.cyc.distM += moved;
    return m.pi >= m.path.length;
  }

  /** Cruise speed (m/s) for the current segment considering limit, grade, load and operator style. */
  private cruiseSpeed(m: SimMachine): number {
    const seg = m.path?.[Math.min(m.pi, (m.path?.length ?? 1) - 1)];
    const limit = seg?.limit ?? 30;
    const pr = m.type === 'water' ? m.water / 100 * 0.6 : m.payload / Math.max(1, m.capacity);
    let cap: number;
    if (m.type === 'lv') cap = 60;
    else if (m.grade > 0.03) cap = pr > 0.5 ? lerp(18, 11, (m.grade - 0.03) / 0.07) : 30;
    else if (m.grade < -0.03) cap = pr > 0.5 ? 24 : 34;
    else cap = pr > 0.5 ? 42 : 52;
    let kmh = Math.min(limit * m.aggr, limit + this.settings.overspeedMargin - 1, cap);
    // a heavy-footed operator now and then pushes past the limit for half a minute
    if (m.leadFootUntil > this.t) kmh = Math.min(cap + 6, limit + this.settings.overspeedMargin + 6);
    else if (m.aggr > 1.05 && this.rng.chance(this.lastDt / 30000)) m.leadFootUntil = this.t + this.rng.range(20, 45) * 1000;
    return this.followLimit(m, kmh / KMH);
  }

  /** Car following: slow down or stop behind a machine travelling the same way. */
  private followLimit(m: SimMachine, v: number): number {
    if (m.ghostUntil > this.t) return v;
    const hr = (m.h * Math.PI) / 180;
    const fx = Math.cos(hr);
    const fy = Math.sin(hr);
    let best = Infinity;
    let leadV = v;
    for (const o of this.machines.values()) {
      if (o === m || (o.type !== 'truck' && o.type !== 'water' && o.type !== 'lv')) continue;
      // broken-down, parked or held machines are pulled over: traffic goes around them
      if (o.hold) continue;
      const dx = o.x - m.x;
      const dy = o.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 70 || d < 0.1) continue;
      const along = (dx * fx + dy * fy) / d;
      if (along < 0.85) continue;
      let dh = Math.abs(((o.h - m.h + 540) % 360) - 180);
      if (o.v < 0.3 && o.mode !== 'to_loader' && o.mode !== 'to_dump' && o.mode !== 'drive') dh = 180;
      if (dh > 50) continue;
      if (d < best) { best = d; leadV = o.v; }
    }
    if (best < 24) return 0;
    if (best < 55) return Math.min(v, leadV * 0.95);
    return v;
  }

  // ---------------------------------------------------------------- the simulation step

  step(dt: number) {
    if (this.paused) return;
    this.lastDt = dt;
    this.t += dt * 1000;
    const shift = shiftOf(this.t, this.settings.aStartHour);
    if (shift.start !== this.shift.start) this.onShiftChange(shift);

    for (const m of this.machines.values()) this.stepMachine(m, dt);
    this.checkProximity();
    this.recordTelemetry();

    if (this.t - this.lastStatsFlush >= 60_000) this.flushStats();
    if (this.t - this.lastMaintCheck >= 60_000) {
      this.lastMaintCheck = this.t;
      this.checkMaintenance();
      this.alerts.autoClose(this.t, (a) => STICKY_TYPES.has(a.type));
    }
  }

  private stepMachine(m: SimMachine, dt: number) {
    if (m.hold) {
      if (this.t >= m.hold.until) this.endHold(m);
      else {
        m.v = Math.max(0, m.v - 1.5 * dt);
        if (m.hold.kind !== 'park') { m.st = m.hold.st; m.act = m.hold.act; }
      }
    }
    if (!m.hold && m.fuelL <= 0.5 && m.st !== 'offline') {
      this.setHold(m, { kind: 'refuel', st: 'breakdown', act: 'Out of fuel · service truck called', until: this.t + this.rng.range(25, 40) * 60_000 }, 'Refuelling', 'Ran out of fuel');
      this.alerts.raise({ machineId: m.id, type: 'out_of_fuel', title: 'Out of fuel', severity: 'critical', message: `${m.id} stopped with an empty tank at ${zoneAt(m.x, m.y)}`, camera: 'front', operatorName: m.opName }, this.t);
    }
    if (!m.hold) this.randomEvents(m, dt);
    if (!m.hold) {
      switch (m.type) {
        case 'truck': this.stepTruck(m, dt); break;
        case 'shovel':
        case 'excavator':
        case 'loader': this.stepLoader(m, dt); break;
        case 'dozer': this.stepDozer(m, dt); break;
        case 'drill': this.stepDrill(m, dt); break;
        case 'water':
        case 'lv': this.stepRoamer(m, dt); break;
      }
    } else if (m.hold.kind === 'park') {
      this.stepRoamer(m, dt);
    }
    this.watchGridlock(m);
    this.stepSensors(m, dt);
    this.accountStats(m, dt);
    this.evaluateSensors(m);
  }

  /** A vehicle that should be driving but has not moved for 15 minutes ignores traffic for a while. */
  private watchGridlock(m: SimMachine) {
    const driving = !m.hold && (m.mode === 'to_loader' || m.mode === 'to_dump' || m.mode === 'to_fuel' || m.mode === 'to_workshop' || m.mode === 'drive' || m.mode === 'to_fill');
    if (!driving || m.v > 0.3) { m.stuckSince = null; return; }
    m.stuckSince ??= this.t;
    if (this.t - m.stuckSince > 15 * 60_000) {
      m.ghostUntil = this.t + 3 * 60_000;
      m.stuckSince = null;
    }
  }

  /** The loading unit stopped serving this truck (breakdown, removal): leave with what is on board or re-queue. */
  private orphanedAtLoader(m: SimMachine, ls: LoaderState | undefined): boolean {
    if (ls && ls.current === m.id && this.loaderAvailable(m.loaderId)) return false;
    if (ls && ls.current === m.id) {
      ls.current = null;
      ls.phase = 'wait';
    }
    if (m.payload > 1) {
      this.dispatchLoaded(m, m.loaderId ? this.machines.get(m.loaderId) : undefined);
    } else {
      m.mode = 'queue';
      m.path = null;
      if (ls && ls.current === m.id) ls.current = null;
      if (this.loaderAvailable(m.loaderId) && ls && !ls.queue.includes(m.id)) ls.queue.unshift(m.id);
      else this.redispatch(m, false);
    }
    return true;
  }

  private stepTruck(m: SimMachine, dt: number) {
    const ls = m.loaderId ? this.loaders.get(m.loaderId) : undefined;
    switch (m.mode) {
      case 'to_loader': {
        if (m.fuelL / m.fuelCap < 0.12) {
          for (const q of this.loaders.values()) q.queue = q.queue.filter((x) => x !== m.id);
          this.startPath(m, 'FB', 'to_fuel');
          break;
        }
        if (!this.loaderAvailable(m.loaderId) && this.settings.autoBalance) this.redispatch(m);
        const arrived = this.moveAlong(m, dt, this.cruiseSpeed(m));
        const left = m.path ? Math.hypot(m.path[m.path.length - 1].x - m.x, m.path[m.path.length - 1].y - m.y) : 0;
        if (m.v < 0.5 && left < 250 && m.cyc && m.cyc.queueStart === null) m.cyc.queueStart = this.t;
        if (arrived) {
          m.mode = 'queue';
          m.v = 0;
          if (m.cyc) m.cyc.queueStart ??= this.t;
          if (ls && !ls.queue.includes(m.id)) ls.queue.push(m.id);
        }
        m.st = m.v < 0.5 && left < 250 ? 'idle' : 'running';
        m.act = m.st === 'idle' ? `Queued at ${m.loaderId}` : `Returning empty to ${m.loaderId}`;
        break;
      }
      case 'queue': {
        if (!this.loaderAvailable(m.loaderId) && this.settings.autoBalance) { this.redispatch(m); break; }
        m.v = 0;
        m.st = 'idle';
        const pos = ls ? ls.queue.indexOf(m.id) + 1 : 0;
        m.act = `Queued at ${m.loaderId}${pos > 1 ? ` (#${pos})` : ''}`;
        break;
      }
      case 'spot': {
        if (this.orphanedAtLoader(m, ls)) break;
        if (this.moveAlong(m, dt, 2.2) && this.t >= m.phaseEnd) {
          m.mode = 'loading';
          if (ls) m.h = ls.spot.h;
          if (m.cyc) m.cyc.loadStart = this.t;
        }
        m.st = 'loading';
        m.act = `Spotting at ${m.loaderId}`;
        break;
      }
      case 'loading': {
        if (this.orphanedAtLoader(m, ls)) break;
        m.v = 0;
        m.st = 'loading';
        m.act = `Loading at ${m.loaderId} · pass ${(m.cyc?.passes ?? 0) + 1}`;
        break;
      }
      case 'to_dump': {
        this.moveAlong(m, dt, this.cruiseSpeed(m));
        const route = this.routes.get(m.cyc?.routeId ?? m.routeId ?? '');
        const dest = NODE_BY_ID[route?.destNode ?? 'CR'];
        m.st = 'hauling';
        m.act = m.v < 0.5 && m.pi > 0 ? `Waiting to tip at ${dest.zone}` : `Hauling ${route?.material ?? 'ore'} to ${dest.zone}`;
        if (m.path && m.pi >= m.path.length) {
          m.mode = 'dump';
          m.phaseEnd = this.t + this.rng.range(32, 50) * 1000;
          if (m.cyc) m.cyc.dumpStart = this.t;
        }
        break;
      }
      case 'dump': {
        m.v = 0;
        const total = m.cyc?.dumpStart ? m.phaseEnd - m.cyc.dumpStart : 40_000;
        const f = 1 - (m.phaseEnd - this.t) / total;
        // body raises for the first quarter, then the load slides out
        if (f > 0.25) m.payload = Math.max(0, m.payload - (m.capacity * dt) / (total / 1000) * 1.6);
        m.st = 'running';
        m.act = `Tipping at ${NODE_BY_ID[m.node]?.zone ?? 'dump'}`;
        if (this.t >= m.phaseEnd) {
          this.finishCycle(m);
          this.afterDump(m);
        }
        break;
      }
      case 'to_fuel': {
        m.st = 'running';
        m.act = 'Travelling to fuel bay';
        if (this.moveAlong(m, dt, this.cruiseSpeed(m))) this.startRefuel(m, 'Fuel bay');
        break;
      }
      case 'to_workshop': {
        m.st = 'running';
        m.act = 'Travelling to workshop';
        if (this.moveAlong(m, dt, this.cruiseSpeed(m))) this.startWorkshop(m);
        break;
      }
      case 'after_hold':
        this.goToLoader(m);
        break;
      default: {
        m.v = 0;
        m.st = 'idle';
        if (m.mode === 'idle' && this.rng.chance(dt / 30)) this.goToLoader(m);
      }
    }
  }

  private finishCycle(m: SimMachine) {
    const c = m.cyc;
    const tonnes = c?.tonnes ?? 0;
    if (c && c.valid && c.queueStart && c.spotStart && c.loadStart && c.loadEnd && c.dumpStart && tonnes > 0) {
      const sh = shiftOf(c.loadEnd, this.settings.aStartHour);
      const row = {
        ts: this.t, mineDay: sh.mineDay, shift: sh.code, truckId: m.id, loaderId: c.loaderId, routeId: c.routeId,
        operatorId: c.opId, material: c.material, tonnes: r1(tonnes), passes: c.passes, loadTs: c.loadEnd,
        cycleSec: (this.t - c.start) / 1000, queueSec: (c.spotStart - c.queueStart) / 1000, spotSec: (c.loadStart - c.spotStart) / 1000,
        loadSec: (c.loadEnd - c.loadStart) / 1000, haulSec: (c.dumpStart - c.loadEnd) / 1000, dumpSec: (this.t - c.dumpStart) / 1000,
        returnSec: (c.queueStart - c.start) / 1000, distanceKm: r2(c.distM / 1000),
      };
      this.rec.production(row);
      this.prodLog.push({ ts: this.t, tonnes: row.tonnes, cycleSec: row.cycleSec, queueSec: row.queueSec, mineDay: row.mineDay, shift: row.shift });
      m.stats.loads += 1;
      m.stats.tonnes += row.tonnes;
      const loader = this.machines.get(c.loaderId);
      if (loader) loader.stats.tonnes += row.tonnes;
      m.cycles += 1;
      if (!this.backfilling && this.rng.chance(0.25)) {
        this.emit({ type: 'event', kind: 'load', text: `${m.id} tipped ${row.tonnes.toFixed(0)} t ${c.material} from ${c.loaderId}`, machineId: m.id, t: this.t });
      }
    }
    m.payload = 0;
    m.cyc = this.newCycle(m, true);
  }

  private afterDump(m: SimMachine) {
    if (m.pendingWorkOrder) {
      this.startPath(m, 'WS', 'to_workshop');
      return;
    }
    if (m.fuelL / m.fuelCap < 0.22) {
      this.startPath(m, 'FB', 'to_fuel');
      return;
    }
    this.goToLoader(m);
  }

  private startRefuel(m: SimMachine, where: string) {
    const mins = m.type === 'lv' ? this.rng.range(4, 8) : this.rng.range(10, 16);
    this.setHold(m, { kind: 'refuel', st: 'idle', act: `Refuelling at ${where}`, until: this.t + mins * 60_000 }, 'Refuelling', 'Scheduled refuel');
    m.mode = 'after_hold';
  }

  private startWorkshop(m: SimMachine) {
    const wo = m.pendingWorkOrder!;
    m.pendingWorkOrder = null;
    this.rec.startWorkOrder(wo.id, this.t);
    this.setHold(m, { kind: 'maintenance', st: 'maintenance', act: wo.title, until: this.t + wo.durationH * 3_600_000, workOrderId: wo.id },
      'Planned maintenance', wo.title);
    m.mode = 'after_hold';
  }

  private stepLoader(m: SimMachine, dt: number) {
    const ls = this.loaders.get(m.id)!;
    const [tDig, tSwing, tDump, tBack] = PASS_TIMES[m.type];
    const truck = ls.current ? this.machines.get(ls.current) : undefined;
    // only a truck that is actually spotting or under the bucket keeps the loader
    if (ls.current && (!truck || truck.loaderId !== m.id || (truck.mode !== 'spot' && truck.mode !== 'loading'))) { ls.current = null; ls.phase = 'wait'; }
    // a truck that breaks down under the bucket is released; it leaves with its part load once repaired
    if (truck && ls.current === truck.id && truck.hold && truck.hold.kind !== 'shift' && truck.hold.kind !== 'crib') {
      ls.current = null;
      ls.phase = 'wait';
      ls.queue = ls.queue.filter((q) => q !== truck.id);
    }

    if (!ls.current) {
      ls.queue = ls.queue.filter((id) => this.machines.get(id)?.mode === 'queue' && this.machines.get(id)?.loaderId === m.id);
      // first queued truck that is ready (a broken-down truck does not block the queue)
      const nextId = ls.queue.find((id) => !this.machines.get(id)?.hold);
      const next = nextId ? this.machines.get(nextId) : undefined;
      if (next) {
        ls.current = next.id;
        next.mode = 'spot';
        next.path = [{ x: ls.spot.x, y: ls.spot.y, z: next.z, limit: 8 }];
        next.pi = 0;
        next.phaseEnd = this.t + this.rng.range(16, 26) * 1000;
        if (next.cyc) next.cyc.spotStart = this.t;
        this.beginPassPhase(ls, 'dig', tDig);
        ls.passFill = this.nextFill(m, next);
        if (ls.idleDowntime) { this.rec.closeDowntime(ls.idleDowntime, this.t); ls.idleDowntime = null; }
        ls.idleSince = null;
      }
    }

    const el = (this.t - ls.phaseStart) / 1000;
    const f = clamp(el / Math.max(0.1, ls.phaseDur), 0, 1);
    const swingTo = 95 * ls.side;
    const tr = ls.current ? this.machines.get(ls.current) : undefined;

    if (!ls.current) {
      const waited = this.t - (ls.idleSince ?? this.t);
      const cleanup = !ls.queue.length && waited > 70_000 && Math.floor(this.t / 150_000) % 5 !== 0;
      m.st = cleanup ? 'running' : 'idle';
      m.act = ls.queue.length ? 'Waiting for truck to spot' : cleanup ? 'Face clean-up' : 'Waiting for trucks';
      ls.phase = 'wait';
      m.swing = approach(m.swing, Math.sin(this.t / 9000) * 12, dt, 3);
      m.boom = approach(m.boom, 22, dt, 3);
      m.stick = approach(m.stick, -55, dt, 3);
      m.bFill = approach(m.bFill, 0, dt, 2);
      ls.idleSince ??= this.t;
      if (!ls.idleDowntime && this.t - ls.idleSince > 20 * 60_000) {
        ls.idleDowntime = this.rec.openDowntime(m.id, ls.idleSince, 'Waiting on trucks', 'No trucks at the face');
      }
      if (m.type === 'loader') this.loaderDrive(m, ls.pile, dt);
      return;
    }

    m.st = 'loading';
    const passNo = (tr?.cyc?.passes ?? 0) + 1;
    m.act = `Loading ${ls.current} · pass ${passNo}`;
    switch (ls.phase) {
      case 'dig':
        m.swing = approach(m.swing, 0, dt, 1.2);
        m.boom = lerp(18, 34, f);
        m.stick = lerp(-70, -12, f);
        m.arm = lerp(-35, 20, f);
        m.bFill = lerp(0, ls.passFill * 100, f);
        if (m.type === 'loader') this.loaderDrive(m, ls.pile, dt);
        if (f >= 1) this.beginPassPhase(ls, 'swingFull', tSwing);
        break;
      case 'swingFull':
        m.swing = m.type === 'loader' ? 0 : lerp(0, swingTo, f);
        m.boom = lerp(34, 46, f);
        m.stick = lerp(-12, -24, f);
        m.arm = lerp(20, 32, f);
        if (m.type === 'loader') this.loaderDrive(m, ls.spot, dt);
        if (f >= 1 && tr?.mode === 'loading') this.beginPassPhase(ls, 'dump', tDump);
        break;
      case 'dump':
        m.bFill = lerp(ls.passFill * 100, 0, f);
        m.stick = lerp(-24, -5, f);
        if (f >= 1 && tr) {
          const add = ls.passT;
          tr.payload += add;
          if (tr.cyc) {
            tr.cyc.passes += 1;
            tr.cyc.tonnes = tr.payload;
          }
          m.cycles += 1;
          m.stats.passes += 1;
          const remaining = tr.capacity - tr.payload;
          const done = remaining < m.capacity * 0.3 || (tr.cyc?.passes ?? 0) >= 8 || tr.fault.forceOverload === false;
          if (done) {
            this.dispatchLoaded(tr, m);
            ls.current = null;
            ls.queue = ls.queue.filter((q) => q !== tr.id);
          } else {
            ls.passFill = this.nextFill(m, tr);
          }
          this.beginPassPhase(ls, 'swingEmpty', tBack);
        }
        break;
      case 'swingEmpty':
        m.swing = m.type === 'loader' ? 0 : lerp(swingTo, 0, f);
        m.boom = lerp(46, 18, f);
        m.stick = lerp(-5, -70, f);
        m.arm = lerp(32, -35, f);
        if (m.type === 'loader') this.loaderDrive(m, ls.pile, dt);
        if (f >= 1) this.beginPassPhase(ls, 'dig', tDig);
        break;
      case 'wait':
        this.beginPassPhase(ls, 'dig', tDig);
        break;
    }
    m.bWt = (m.bFill / 100) * m.capacity;
  }

  private loaderDrive(m: SimMachine, to: { x: number; y: number }, dt: number) {
    const dx = to.x - m.x;
    const dy = to.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) { m.v = 0; return; }
    m.v = Math.min(3.5, d / 2);
    m.h = Math.atan2(dy, dx) * 180 / Math.PI;
    const s = Math.min(d, m.v * dt);
    m.x += (dx / d) * s;
    m.y += (dy / d) * s;
    m.stats.distanceKm += s / 1000;
  }

  private beginPassPhase(ls: LoaderState, phase: LoaderState['phase'], dur: number) {
    ls.phase = phase;
    ls.phaseStart = this.t;
    ls.phaseDur = dur * this.rng.range(0.88, 1.15);
  }

  private nextFill(loader: SimMachine, truck: SimMachine): number {
    const remaining = truck.capacity - truck.payload;
    const ls = this.loaders.get(loader.id)!;
    let fill: number;
    if (truck.fault.forceOverload && remaining < loader.capacity * 1.1) {
      fill = (remaining + truck.capacity * 0.12) / loader.capacity;
      truck.fault.forceOverload = false;
    } else if (remaining < loader.capacity * 0.95) {
      fill = (remaining / loader.capacity) * this.rng.range(0.9, 1.16);
    } else {
      fill = this.rng.range(0.84, 1.04);
    }
    ls.passT = loader.capacity * fill * this.rng.range(0.97, 1.03);
    return Math.min(1.25, fill);
  }

  private dispatchLoaded(truck: SimMachine, loaderArg?: SimMachine) {
    const route0 = this.routes.get(truck.routeId ?? '');
    const loader: { id: string; homeNode: string } = loaderArg ?? { id: truck.loaderId ?? '', homeNode: route0?.loaderNode ?? truck.node };
    if (truck.cyc) {
      truck.cyc.loadEnd = this.t;
      truck.cyc.loaderId = loader.id;
      truck.cyc.routeId = truck.routeId ?? '';
      truck.cyc.material = this.routes.get(truck.routeId ?? '')?.material ?? 'ore';
      truck.cyc.opId = truck.opId;
    }
    truck.fault.forceOverload = undefined;
    const route = route0 ?? (loaderArg ? this.routeForLoader(loaderArg) : null);
    truck.node = loader.homeNode;
    const ids = shortestPath(route?.loaderNode ?? loader.homeNode, route?.destNode ?? 'CR').slice(1);
    truck.path = ids.map((id, i) => {
      const n = NODE_BY_ID[id];
      return { x: n.x, y: n.y, z: n.z, limit: edgeLimit(i === 0 ? loader.homeNode : ids[i - 1], id), node: id };
    });
    truck.pi = 0;
    truck.mode = 'to_dump';
  }

  private stepDozer(m: SimMachine, dt: number) {
    if (m.mode === 'idle') {
      m.v = 0;
      m.st = 'idle';
      m.act = 'Standing by';
      if (this.t >= m.phaseEnd) { m.mode = 'push'; m.target = this.dozerWaypoint(m); }
      return;
    }
    const tgt = m.target ?? this.dozerWaypoint(m);
    const dx = tgt.x - m.x;
    const dy = tgt.y - m.y;
    const d = Math.hypot(dx, dy);
    const forward = m.mode === 'push';
    m.v = approach(m.v, forward ? 1.8 : 2.6, dt, 2);
    if (forward) m.h = Math.atan2(dy, dx) * 180 / Math.PI;
    const s = Math.min(d, m.v * dt);
    if (d > 0.5) { m.x += (dx / d) * s; m.y += (dy / d) * s; }
    m.stats.distanceKm += s / 1000;
    m.st = 'running';
    m.act = forward ? 'Pushing material' : 'Reversing';
    if (d < 2) {
      if (forward) {
        m.mode = 'reverse';
        m.target = { x: m.x - Math.cos(m.h * Math.PI / 180) * 45, y: m.y - Math.sin(m.h * Math.PI / 180) * 45 };
      } else if (this.rng.chance(0.08)) {
        m.mode = 'idle';
        m.phaseEnd = this.t + this.rng.range(2, 6) * 60_000;
      } else {
        m.mode = 'push';
        m.target = this.dozerWaypoint(m);
      }
    }
  }

  private dozerWaypoint(m: SimMachine) {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(20, 85);
    return { x: m.anchor.x + Math.cos(a) * r, y: m.anchor.y + Math.sin(a) * r };
  }

  private drillHole(i: number) {
    const p = DRILL_PATTERN;
    const idx = i % (p.cols * p.rows);
    const col = idx % p.cols;
    const row = Math.floor(idx / p.cols);
    return { x: p.x + col * p.spacing + (row % 2) * (p.spacing / 2), y: p.y + row * p.spacing };
  }

  private stepDrill(m: SimMachine, dt: number) {
    if (m.mode === 'drill') {
      m.v = 0;
      m.st = 'running';
      const target = 15;
      m.depth = Math.min(target, m.depth + dt * (target / this.rng.range(420, 560)));
      m.act = `Drilling hole ${m.drillIdx + 1} · ${m.depth.toFixed(1)} m`;
      if (this.t >= m.phaseEnd || m.depth >= target - 0.01) {
        m.cycles += 1;
        m.stats.passes += 1;
        m.drillIdx = (m.drillIdx + 1) % (DRILL_PATTERN.cols * DRILL_PATTERN.rows);
        m.target = this.drillHole(m.drillIdx);
        m.mode = 'tram';
      }
    } else {
      const tgt = m.target ?? this.drillHole(m.drillIdx);
      const dx = tgt.x - m.x;
      const dy = tgt.y - m.y;
      const d = Math.hypot(dx, dy);
      m.v = 0.45;
      m.depth = Math.max(0, m.depth - dt * 0.5);
      m.st = 'running';
      m.act = 'Tramming to next hole';
      if (d > 0.3) {
        m.h = Math.atan2(dy, dx) * 180 / Math.PI;
        const s = Math.min(d, m.v * dt);
        m.x += (dx / d) * s;
        m.y += (dy / d) * s;
        m.stats.distanceKm += s / 1000;
      } else {
        m.mode = 'drill';
        m.depth = 0;
        m.phaseEnd = this.t + this.rng.range(420, 720) * 1000;
      }
    }
  }

  private stepRoamer(m: SimMachine, dt: number) {
    if (m.hold?.kind === 'park') {
      m.v = 0;
      return;
    }
    if (m.mode === 'after_hold' || !m.path) {
      this.startPath(m, this.randomDest(m), 'drive');
    }
    const arrived = this.moveAlong(m, dt, this.cruiseSpeed(m));
    m.st = m.v < 0.3 ? 'idle' : 'running';
    if (m.type === 'water') {
      if (m.v > 1 && m.mode === 'drive') m.water = Math.max(0, m.water - dt * 0.028);
      if (m.mode === 'drive' && m.water < 15) this.startPath(m, 'WF', 'to_fill');
      m.act = m.mode === 'to_fill' ? 'Going to water fill' : m.mode === 'to_fuel' ? 'Travelling to fuel bay' : m.v > 1 ? 'Spraying haul road' : 'Stopped';
    } else {
      m.act = m.mode === 'to_fuel' ? 'Travelling to fuel bay' : m.v > 1 ? 'Driving' : 'Stopped';
    }
    if (!arrived) return;
    if (m.mode === 'to_fuel') return this.startRefuel(m, 'Fuel bay');
    if (m.mode === 'to_fill') {
      this.setHold(m, { kind: 'refuel', st: 'idle', act: 'Filling water tank', until: this.t + this.rng.range(8, 12) * 60_000 }, null, null);
      m.water = 100;
      m.mode = 'after_hold';
      return;
    }
    if (m.fuelL / m.fuelCap < (m.type === 'lv' ? 0.3 : 0.2)) return this.startPath(m, 'FB', 'to_fuel');
    if (m.type === 'water' && m.water < 16) return this.startPath(m, 'WF', 'to_fill');
    if (m.type === 'lv') {
      const mins = this.rng.range(3, 15);
      m.hold = { kind: 'park', st: 'idle', act: `Parked at ${NODE_BY_ID[m.node]?.zone ?? 'site'}`, until: this.t + mins * 60_000, downtimeId: null };
      m.st = 'idle';
      m.act = m.hold.act;
      m.engineOn = this.rng.chance(0.4);
      m.path = null;
      m.mode = 'after_hold';
      return;
    }
    this.startPath(m, this.randomDest(m), 'drive');
  }

  // ---------------------------------------------------------------- holds (breakdowns, shifts, refuels)

  private setHold(m: SimMachine, h: Omit<Hold, 'downtimeId'>, category: string | null, reason: string | null) {
    if (m.hold && m.hold.kind !== 'park') this.endHold(m, true);
    const downtimeId = category ? this.rec.openDowntime(m.id, this.t, category, reason ?? category) : null;
    m.hold = { ...h, downtimeId };
    m.st = h.st;
    m.act = h.act;
  }

  private endHold(m: SimMachine, replaced = false) {
    const h = m.hold!;
    m.hold = null;
    m.engineOn = true;
    if (h.downtimeId) this.rec.closeDowntime(h.downtimeId, this.t);
    if (h.kind === 'refuel' && (m.type !== 'water' || h.act.includes('fuel'))) {
      const before = m.fuelL;
      m.fuelL = m.fuelCap * this.rng.range(0.96, 1);
      this.rec.fuel(this.t, m.id, 'refuel', r1(m.fuelL - before), r1(before / m.fuelCap * 100), r1(m.fuelL / m.fuelCap * 100),
        h.act.includes('Field') ? zoneAt(m.x, m.y) : 'Fuel bay', null, 'Fuel bay attendant');
      if (!this.backfilling) this.emit({ type: 'event', kind: 'refuel', text: `${m.id} refuelled ${(m.fuelL - before).toFixed(0)} L`, machineId: m.id, t: this.t });
    }
    if (h.kind === 'breakdown' || h.kind === 'maintenance') {
      if (h.workOrderId) this.rec.completeWorkOrder(h.workOrderId, this.t, Math.round(this.rng.range(400, 6000)) * 10);
      if (h.kind === 'breakdown') {
        this.alerts.clear(m.id, 'breakdown', this.t, 'system (repaired)');
        if (!this.backfilling) this.emit({ type: 'event', kind: 'repaired', text: `${m.id} back in service`, machineId: m.id, t: this.t });
      }
      if (this.loaders.has(m.id) && this.settings.autoBalance) {
        for (const tr of this.machines.values()) if (tr.homeLoaderId === m.id && tr.loaderId !== m.id) this.redispatch(tr);
      }
    }
    if (h.kind === 'cooldown') m.fault.overheatUntil = undefined;
    if (replaced) return;
    if (m.type === 'truck' && (m.mode === 'after_hold' || m.mode === 'idle')) this.goToLoader(m);
  }

  /** A planned job started by hand (Fleet › Maintenance › Mark in progress). */
  beginWorkOrder(wo: { id: number; machineId: string; title: string; durationH: number }) {
    const m = this.machines.get(wo.machineId);
    if (!m || m.hold?.kind === 'maintenance' || m.pendingWorkOrder) return;
    if (m.type === 'truck') {
      m.pendingWorkOrder = wo;
      if (m.mode === 'to_loader' || m.mode === 'queue' || m.mode === 'idle' || m.mode === 'after_hold') {
        for (const ls of this.loaders.values()) ls.queue = ls.queue.filter((q) => q !== m.id);
        this.startPath(m, 'WS', 'to_workshop');
      }
      return;
    }
    this.setHold(m, { kind: 'maintenance', st: 'maintenance', act: wo.title, until: this.t + wo.durationH * 3_600_000, workOrderId: wo.id }, 'Planned maintenance', wo.title);
    if (this.loaders.has(m.id)) for (const tr of this.machines.values()) if (tr.loaderId === m.id) this.redispatch(tr);
  }

  /** An ongoing delay logged by hand (Fleet › Downtime): the machine stops until the record is closed. */
  manualDelay(machineId: string, downtimeId: number, category: string, reason: string) {
    const m = this.machines.get(machineId);
    if (!m || m.hold?.kind === 'offline') return;
    const st: MachineStatus = category === 'Breakdown' ? 'breakdown' : category === 'Planned maintenance' ? 'maintenance' : 'idle';
    this.setHold(m, { kind: 'delay', st, act: `${category}: ${reason}`, until: Number.MAX_SAFE_INTEGER }, null, null);
    m.hold!.downtimeId = downtimeId;
    if (this.loaders.has(m.id)) for (const tr of this.machines.values()) if (tr.loaderId === m.id) this.redispatch(tr);
  }

  endDelay(downtimeId: number) {
    for (const m of this.machines.values()) if (m.hold?.kind === 'delay' && m.hold.downtimeId === downtimeId) m.hold.until = this.t;
  }

  breakdown(m: SimMachine, reason?: string) {
    if (m.hold?.kind === 'breakdown' || m.hold?.kind === 'offline') return;
    const why = reason ?? this.rng.pick(BREAKDOWN_REASONS[m.type]);
    const hours = this.rng.range(0.7, 3);
    const wo = this.rec.createWorkOrder(m.id, `Breakdown: ${why}`, 'corrective', 'high', this.t, r1(hours), this.rng.pick(['S. Mohanty', 'R. Behera', 'K. Iyer', 'A. Khan']), 'Raised automatically from machine fault.');
    const resume = m.mode;
    this.setHold(m, { kind: 'breakdown', st: 'breakdown', act: `Breakdown: ${why}`, until: this.t + hours * 3_600_000, workOrderId: wo }, 'Breakdown', why);
    if (m.type === 'truck') {
      // keep the truck's place in its cycle; it resumes where it stopped
      m.mode = resume === 'queue' || resume === 'to_loader' ? 'after_hold' : resume;
      for (const ls of this.loaders.values()) ls.queue = ls.queue.filter((q) => q !== m.id);
    }
    this.alerts.raise({ machineId: m.id, type: 'breakdown', title: 'Breakdown', severity: 'critical', message: `${m.id} stopped: ${why}. Work order raised.`, camera: 'cabin', operatorName: m.opName }, this.t);
    if (!this.backfilling) this.emit({ type: 'event', kind: 'breakdown', text: `${m.id} breakdown: ${why}`, machineId: m.id, t: this.t });
    if (this.loaders.has(m.id) && this.settings.autoBalance) {
      const ls = this.loaders.get(m.id)!;
      const cur = ls.current ? this.machines.get(ls.current) : undefined;
      ls.current = null;
      if (cur && cur.payload > 1) this.dispatchLoaded(cur, m);
      else if (cur) { cur.mode = 'queue'; cur.path = null; }
      for (const tr of this.machines.values()) if (tr.loaderId === m.id && tr.mode !== 'to_dump') this.redispatch(tr);
    }
  }

  private onShiftChange(next: ShiftInfo) {
    this.flushStats();
    const prev = this.shift;
    this.shift = next;
    for (const m of this.machines.values()) {
      m.cycles = 0;
      if (m.hold && m.hold.kind !== 'park') continue;
      if (m.type === 'lv') continue;
      const mins = this.rng.range(6, 14);
      if (m.type === 'truck' && (m.mode === 'loading' || m.mode === 'spot' || m.mode === 'dump')) continue;
      if (this.loaders.get(m.id)?.current) continue;
      this.setHold(m, { kind: 'shift', st: 'idle', act: 'Shift change', until: this.t + mins * 60_000 }, 'Shift change', `Handover ${prev.code} → ${next.code}`);
    }
    this.applyOperators();
    this.planCribs();
    if (!this.backfilling) this.emit({ type: 'event', kind: 'shift', text: `Shift ${next.code} (${this.settings.shiftNames[next.code]}) started`, t: this.t });
  }

  /** Demo control: hand over to the next crew now. */
  forceShiftChange() {
    const order: ShiftCode[] = ['A', 'B', 'C'];
    const nextCode = order[(order.indexOf(this.shift.code) + 1) % 3];
    for (const m of this.machines.values()) {
      if (m.type === 'lv' || (m.hold && m.hold.kind !== 'park')) continue;
      if (m.type === 'truck' && (m.mode === 'loading' || m.mode === 'spot' || m.mode === 'dump')) continue;
      this.setHold(m, { kind: 'shift', st: 'idle', act: 'Shift change', until: this.t + this.rng.range(2, 5) * 60_000 }, 'Shift change', `Handover ${this.shift.code} → ${nextCode} (drill)`);
    }
    this.applyOperators(nextCode);
    this.emit({ type: 'event', kind: 'shift', text: `Crew handover drill: shift ${nextCode} crew took over`, t: this.t });
  }

  private planCribs() {
    this.cribPlan.clear();
    for (const m of this.machines.values()) {
      if (m.type === 'lv') continue;
      this.cribPlan.set(m.id, this.shift.start + (3.5 * 60 + this.rng.range(0, 70)) * 60_000);
    }
  }

  private checkMaintenance() {
    for (const wo of this.rec.dueWorkOrders(this.t)) {
      const m = this.machines.get(wo.machineId);
      if (!m || m.hold?.kind === 'maintenance' || m.pendingWorkOrder) continue;
      if (m.type === 'truck') {
        m.pendingWorkOrder = wo;
        this.rec.startWorkOrder(wo.id, this.t);
        sqlite.prepare("update maintenance set status = 'in_progress' where id = ?").run(wo.id);
        if (m.mode === 'to_loader' || m.mode === 'queue') {
          for (const ls of this.loaders.values()) ls.queue = ls.queue.filter((q) => q !== m.id);
          this.startPath(m, 'WS', 'to_workshop');
        }
      } else {
        this.rec.startWorkOrder(wo.id, this.t);
        this.setHold(m, { kind: 'maintenance', st: 'maintenance', act: wo.title, until: this.t + wo.durationH * 3_600_000, workOrderId: wo.id }, 'Planned maintenance', wo.title);
        if (this.loaders.has(m.id)) for (const tr of this.machines.values()) if (tr.loaderId === m.id) this.redispatch(tr);
      }
    }
  }

  // ---------------------------------------------------------------- random events and scenarios

  private randomEvents(m: SimMachine, dt: number) {
    const p = (perHour: number) => this.rng.chance((perHour * dt) / 3600);
    const crib = this.cribPlan.get(m.id);
    if (crib && this.t >= crib && m.type !== 'lv') {
      this.cribPlan.delete(m.id);
      const busy = (m.type === 'truck' && (m.mode === 'loading' || m.mode === 'spot' || m.mode === 'dump')) || Boolean(this.loaders.get(m.id)?.current);
      if (busy) this.cribPlan.set(m.id, this.t + 60_000);
      else {
        this.setHold(m, { kind: 'crib', st: 'idle', act: 'Crib break', until: this.t + this.rng.range(18, 28) * 60_000 }, 'Crib break', 'Scheduled meal break');
        return;
      }
    }
    if (p(m.type === 'lv' ? 0.0015 : 0.0042)) return this.breakdown(m);
    if (p(0.0007) && !m.fault.overheatUntil) this.startOverheat(m);
    if ((m.type === 'truck' || m.type === 'water') && p(0.0004) && m.fault.tyreLeak === undefined) m.fault.tyreLeak = this.rng.int(0, 5);
    if (p(0.00025) && m.v < 0.5) this.fuelTheft(m);
    if (this.settings.fatigueEnabled && m.opName && m.engineOn) {
      const hour = new Date(this.t).getHours();
      const night = hour >= 1 && hour < 5 ? 3 : 1;
      if (p(0.012 * night)) this.dmsEvent(m, 1);
      else if (p(0.006)) this.dmsEvent(m, 2);
    }
    if (m.dms && this.t > m.dmsUntil) m.dms = 0;
    if (m.fault.camOff && this.t > m.fault.camOff.until) {
      m.fault.camOff = undefined;
      this.alerts.clear(m.id, 'camera_offline', this.t, 'system (signal restored)');
    }
    // field refuel for machines that do not drive to the fuel bay
    if ((m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader' || m.type === 'dozer' || m.type === 'drill')
      && m.fuelL / m.fuelCap < 0.18) {
      if (m.type !== 'drill' && this.loaders.get(m.id)?.current && m.fuelL / m.fuelCap > 0.1) return;
      this.setHold(m, { kind: 'refuel', st: 'idle', act: 'Field refuelling (service truck)', until: this.t + this.rng.range(12, 20) * 60_000 }, 'Refuelling', 'Field service refuel');
    }
  }

  startOverheat(m: SimMachine, level = 32) {
    m.fault.overheatUntil = this.t + 25 * 60_000;
    m.fault.overheatLevel = level;
  }

  fuelTheft(m: SimMachine) {
    const lost = Math.min(m.fuelL * 0.4, m.type === 'lv' ? 25 : this.rng.range(320, 680));
    if (lost < 10) return;
    const before = m.fuelL;
    m.fuelL -= lost;
    this.rec.fuel(this.t, m.id, 'anomaly', -r1(lost), r1(before / m.fuelCap * 100), r1(m.fuelL / m.fuelCap * 100), zoneAt(m.x, m.y), 'Level drop while stationary - possible theft or leak', 'system');
    this.alerts.raise({
      machineId: m.id, type: 'fuel_anomaly', title: 'Fuel anomaly', severity: 'critical',
      message: `Fuel dropped ${lost.toFixed(0)} L in under 5 minutes while stationary at ${zoneAt(m.x, m.y)}`,
      value: r1(lost), camera: 'rear', operatorName: m.opName,
    }, this.t);
  }

  dmsEvent(m: SimMachine, kind: 1 | 2) {
    m.dms = kind;
    m.dmsUntil = this.t + this.rng.range(6, 14) * 1000;
    const fatigue = kind === 1;
    const repeated = this.alerts.has(m.id, fatigue ? 'fatigue' : 'distraction');
    this.alerts.raise({
      machineId: m.id, type: fatigue ? 'fatigue' : 'distraction', title: fatigue ? 'Operator fatigue' : 'Operator distraction',
      severity: fatigue && repeated ? 'critical' : 'warning',
      message: fatigue
        ? `${m.opName || 'Operator'}: eyes closed ${this.rng.range(1.6, 3.2).toFixed(1)} s (cabin camera)`
        : `${m.opName || 'Operator'}: mobile phone use detected (cabin camera)`,
      camera: 'cabin', operatorName: m.opName,
    }, this.t);
  }

  cameraOffline(m: SimMachine, cam?: CameraPosition) {
    const pos = cam ?? 'front';
    m.fault.camOff = { cam: `${m.id}-${pos}`, until: this.t + 8 * 60_000 };
    this.alerts.raise({ machineId: m.id, type: 'camera_offline', title: 'Camera offline', severity: 'warning', message: `${m.id} ${pos} camera lost video signal`, camera: pos }, this.t);
  }

  private checkProximity() {
    const movers = [...this.machines.values()].filter((m) => m.st !== 'offline');
    const lim = this.settings.proximityM;
    for (const lv of movers) {
      if (lv.type !== 'lv' || lv.hold?.kind === 'park') continue;
      for (const o of movers) {
        if (o === lv || o.type === 'lv') continue;
        const d = Math.hypot(o.x - lv.x, o.y - lv.y);
        const key = `${lv.id}|${o.id}`;
        const prevD = lv.lastDist[o.id];
        if (d < 80) lv.lastDist[o.id] = d; else delete lv.lastDist[o.id];
        // only an LV closing in on a moving heavy machine (not passing in the opposite lane) counts
        if (d > lim * 0.7 || o.v < 2 || lv.v < 1 || prevD === undefined || prevD <= d) continue;
        const dh = Math.abs(((o.h - lv.h + 540) % 360) - 180);
        if (dh > 120) continue;
        if ((this.proxCooldown.get(key) ?? 0) > this.t || (this.proxCooldown.get(lv.id) ?? 0) > this.t) continue;
        this.proxCooldown.set(key, this.t + 120 * 60_000);
        this.proxCooldown.set(lv.id, this.t + 90 * 60_000);
        this.proximity(o, lv, d);
      }
    }
  }

  proximity(heavy: SimMachine, lv: SimMachine, d: number) {
    const critical = d < 7;
    this.alerts.raise({
      machineId: heavy.id, type: critical ? 'collision_risk' : 'proximity', title: critical ? 'Collision risk' : 'Proximity warning',
      severity: critical ? 'critical' : 'warning',
      message: `${lv.id} within ${d.toFixed(1)} m of ${heavy.id} (${zoneAt(heavy.x, heavy.y)})`,
      value: r1(d), threshold: critical ? 7 : this.settings.proximityM, camera: 'rear', operatorName: heavy.opName,
    }, this.t);
  }

  /** Demo scenarios, triggered from the Demo Control panel. */
  scenario(kind: string, machineId?: string): string {
    const pickType = (types: MachineType[]) => {
      const list = [...this.machines.values()].filter((m) => types.includes(m.type) && !m.hold);
      return list[Math.floor(this.rng.next() * list.length)];
    };
    const chosen = machineId ? this.machines.get(machineId) : undefined;
    switch (kind) {
      case 'overload': {
        const m = chosen?.type === 'truck' ? chosen : pickType(['truck']);
        if (!m) return 'No truck available';
        if (m.mode === 'to_dump' || m.mode === 'dump') {
          m.payload = m.capacity * 1.13;
          if (m.cyc) m.cyc.tonnes = m.payload;
        } else m.fault.forceOverload = true;
        return `${m.id} will be overloaded ${m.mode === 'to_dump' ? 'now' : 'on its next load'}`;
      }
      case 'overheat': {
        const m = chosen ?? pickType(['truck', 'excavator', 'shovel']);
        if (!m) return 'No machine available';
        this.startOverheat(m, 38);
        m.eTemp = Math.max(m.eTemp, 101);
        return `${m.id} engine temperature rising`;
      }
      case 'breakdown': {
        const m = chosen ?? pickType(['truck']);
        if (!m) return 'No machine available';
        this.breakdown(m);
        return `${m.id} broke down`;
      }
      case 'low_fuel': {
        const m = chosen ?? pickType(['truck']);
        if (!m) return 'No machine available';
        m.fuelL = m.fuelCap * 0.065;
        return `${m.id} fuel set to 6.5 %`;
      }
      case 'fuel_theft': {
        const m = chosen ?? pickType(['truck', 'dozer', 'excavator']);
        if (!m) return 'No machine available';
        this.fuelTheft(m);
        return `Fuel anomaly on ${m.id}`;
      }
      case 'fatigue': {
        const m = chosen ?? pickType(['truck']);
        if (!m) return 'No machine available';
        this.dmsEvent(m, 1);
        return `Fatigue event on ${m.id}`;
      }
      case 'distraction': {
        const m = chosen ?? pickType(['truck']);
        if (!m) return 'No machine available';
        this.dmsEvent(m, 2);
        return `Phone-use event on ${m.id}`;
      }
      case 'proximity': {
        const heavy = chosen && chosen.type !== 'lv' ? chosen : pickType(['truck']);
        const lv = [...this.machines.values()].find((x) => x.type === 'lv');
        if (!heavy || !lv) return 'No machines available';
        this.proximity(heavy, lv, this.rng.range(4, 6.5));
        return `Collision risk between ${heavy.id} and ${lv.id}`;
      }
      case 'tyre': {
        const m = chosen && (chosen.type === 'truck' || chosen.type === 'water') ? chosen : pickType(['truck']);
        if (!m) return 'No truck available';
        m.fault.tyreLeak = this.rng.int(2, 5);
        m.cold[m.fault.tyreLeak] = Math.min(m.cold[m.fault.tyreLeak], 92);
        return `${m.id} tyre ${m.fault.tyreLeak + 1} losing pressure`;
      }
      case 'overspeed': {
        const m = chosen?.type === 'truck' || chosen?.type === 'lv' ? chosen : pickType(['truck']);
        if (!m) return 'No vehicle available';
        this.overspeedAlert(m, 35 + this.rng.range(9, 16), 35);
        return `${m.id} overspeed recorded`;
      }
      case 'camera': {
        const m = chosen ?? pickType(['truck']);
        if (!m) return 'No machine available';
        this.cameraOffline(m, 'front');
        return `${m.id} front camera offline for 8 minutes`;
      }
      case 'shift_change':
        this.forceShiftChange();
        return 'Crew handover started';
      default:
        return 'Unknown scenario';
    }
  }

  private overspeedAlert(m: SimMachine, kmh: number, limit: number) {
    const over = kmh - limit;
    this.alerts.raise({
      machineId: m.id, type: 'overspeed', title: 'Overspeed', severity: over > 12 ? 'critical' : 'warning',
      message: `${kmh.toFixed(0)} km/h in a ${limit} km/h zone (${zoneAt(m.x, m.y)})`, value: r1(kmh), threshold: limit,
      camera: 'front', operatorName: m.opName,
    }, this.t);
  }

  // ---------------------------------------------------------------- sensors

  private stepSensors(m: SimMachine, dt: number) {
    const on = m.engineOn && m.st !== 'offline';
    const pr = m.type === 'truck' ? m.payload / m.capacity : m.type === 'water' ? m.water / 100 * 0.7 : 0;
    const vk = m.v * KMH;
    let load: number;
    switch (m.type) {
      case 'shovel':
      case 'excavator':
      case 'loader': {
        const ph = this.loaders.get(m.id)?.phase ?? 'wait';
        load = ph === 'dig' ? 88 : ph === 'swingFull' ? 62 : ph === 'dump' ? 40 : ph === 'swingEmpty' ? 48 : 18;
        const hydT = ph === 'dig' ? 330 : ph === 'swingFull' ? 265 : ph === 'dump' ? 205 : ph === 'swingEmpty' ? 185 : 95;
        m.hyd = approach(m.hyd, hydT + this.rng.gauss() * 6, dt, 0.8);
        m.vib = approach(m.vib, (ph === 'dig' ? 10.5 : ph === 'wait' ? 2.2 : 5.5) + Math.abs(this.rng.gauss()) * 0.8, dt, 1.2);
        break;
      }
      case 'dozer':
        load = m.mode === 'push' ? 82 : m.mode === 'reverse' ? 45 : 16;
        m.hyd = approach(m.hyd, m.mode === 'push' ? 270 : 140, dt, 2);
        m.vib = approach(m.vib, m.mode === 'push' ? 8 : 3, dt, 2);
        break;
      case 'drill':
        load = m.mode === 'drill' ? 74 : 35;
        m.hyd = approach(m.hyd, m.mode === 'drill' ? 255 : 120, dt, 3);
        m.vib = approach(m.vib, m.mode === 'drill' ? 10 + this.rng.gauss() * 0.6 : 3, dt, 2);
        break;
      default: {
        const accel = (m.v - m.prevV) / Math.max(dt, 0.001);
        load = 16 + 700 * Math.max(0, m.grade) * (0.35 + 0.65 * pr) + 28 * (m.v / 14) + (accel > 0.1 ? 12 : 0);
        if (m.mode === 'dump' && m.type === 'truck') load = 45;
      }
    }
    if (!on) load = 0;
    m.eLoad = approach(m.eLoad, clamp(load + this.rng.gauss() * 2, 0, 99), dt, 2);
    const [idle, max] = FUEL_RATES[m.type];
    const rate = on ? idle + (max - idle) * Math.pow(m.eLoad / 100, 1.1) : 0;
    m.fuelRate = approach(m.fuelRate, rate, dt, 2);
    const used = (m.fuelRate * dt) / 3600;
    m.fuelL = Math.max(0, m.fuelL - used);
    m.stats.fuelL += used;
    this.trackFuelDay(used);
    if (on) m.hours += dt / 3600;
    m.rpm = on ? approach(m.rpm, 650 + m.eLoad * 12.4 + this.rng.gauss() * 15, dt, 0.8) : approach(m.rpm, 0, dt, 1);
    const hour = new Date(this.t).getHours();
    const ambient = hour >= 11 && hour < 17 ? 4 : hour >= 22 || hour < 6 ? -2 : 1;
    let tempT = on ? 78 + m.eLoad * 0.18 + ambient : 35;
    if (m.fault.overheatUntil) {
      if (this.t < m.fault.overheatUntil) tempT += m.fault.overheatLevel ?? 30;
      else if (!m.hold) {
        this.setHold(m, { kind: 'cooldown', st: 'breakdown', act: 'Engine cooling down (derate)', until: this.t + 12 * 60_000 }, 'Breakdown', 'Engine overheat - cool down');
      }
    }
    m.eTemp = approach(m.eTemp, tempT + this.rng.gauss() * 0.4, dt, m.fault.overheatUntil ? 140 : 90);
    m.bat = approach(m.bat, (on ? 27.7 : 25.1) - (m.fault.lowBattery ? 3.6 : 0) + this.rng.gauss() * 0.05, dt, 20);
    if (m.type === 'truck' || m.type === 'water') {
      const decel = m.v < m.prevV - 0.05;
      const heat = (decel ? 1.1 * (0.5 + pr) * vk / 10 : 0) + (m.grade < -0.02 ? 0.75 * (pr + 0.3) * (-m.grade * 10) * (vk / 20) : 0);
      m.brk = m.brk + heat * dt + ((60 - m.brk) * dt) / 260;
      for (let i = 0; i < 6; i++) {
        const tT = 31 + vk * 0.85 * (0.55 + 0.45 * pr) + (i >= 2 ? 3 : 0);
        m.tt[i] = approach(m.tt[i], tT, dt, 900);
        if (m.fault.tyreLeak === i) m.cold[i] = Math.max(55, m.cold[i] - dt * 0.03);
        m.tp[i] = m.cold[i] + (m.tt[i] - 30) * 0.12 + this.rng.gauss() * 0.15;
      }
    }
    // overspeed check
    if ((m.type === 'truck' || m.type === 'lv' || m.type === 'water') && m.path && m.pi < m.path.length) {
      const limit = m.path[m.pi].limit;
      const over = vk > limit + this.settings.overspeedMargin && m.v >= m.prevV - 0.02;
      if (over) {
        m.sustain.overspeed ??= this.t;
        if (this.t - m.sustain.overspeed > 4000 && !this.alerts.has(m.id, 'overspeed')) this.overspeedAlert(m, vk, limit);
      } else delete m.sustain.overspeed;
    }
  }

  private trackFuelDay(l: number) {
    const day = this.shift?.mineDay ?? '';
    if (this.fuelDay.day !== day) this.fuelDay = { day, litres: 0 };
    this.fuelDay.litres += l;
  }

  sensorValues(m: SimMachine): Record<string, number> {
    const s: Record<string, number> = {
      engine_temp: r1(m.eTemp), rpm: Math.round(m.rpm), engine_load: Math.round(m.eLoad), engine_hours: r1(m.hours),
      fuel_level: r1((m.fuelL / m.fuelCap) * 100), fuel_rate: r1(m.fuelRate), battery: r2(m.bat),
    };
    if (m.type !== 'shovel' && m.type !== 'excavator') s.speed = r1(m.v * KMH);
    if (m.type !== 'lv' && m.type !== 'dozer' && m.type !== 'water') s.load_cycles = m.cycles;
    if (m.type === 'truck') {
      s.payload = r1(m.payload);
      s.payload_pct = Math.round((m.payload / m.capacity) * 100);
    }
    if (m.type === 'truck' || m.type === 'water') {
      s.brake_temp = Math.round(m.brk);
      s.tyre_pressure = r1(Math.min(...m.tp));
      s.tyre_temp = r1(Math.max(...m.tt));
    }
    if (m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader') {
      s.bucket_fill = Math.round(m.bFill);
      s.bucket_weight = r1(m.bWt);
      s.boom_angle = r1(m.boom);
      s.stick_angle = r1(m.stick);
      if (m.type !== 'loader') {
        s.arm_angle = r1(m.arm);
        s.swing_angle = Math.round(m.swing);
      }
    }
    if (m.type !== 'truck' && m.type !== 'water' && m.type !== 'lv') {
      s.hyd_pressure = Math.round(m.hyd);
      s.vibration = r1(m.vib);
    }
    if (m.type === 'drill') s.drill_depth = r1(m.depth);
    if (m.type === 'water') s.water_level = Math.round(m.water);
    return s;
  }

  private evaluateSensors(m: SimMachine) {
    if (m.st === 'offline') return;
    const s = this.sensorValues(m);
    for (const def of this.sensorDefs) {
      if (!def.enabled || def.dir === 'none' || !def.types.includes(m.type)) continue;
      const v = s[def.key];
      if (v === undefined) continue;
      const state = sensorState(def, v);
      const type = `sensor.${def.key}`;
      if (state !== 'normal') {
        delete m.clearSince[def.key];
        m.sustain[def.key] ??= this.t;
        if (this.t - m.sustain[def.key] >= 5000) {
          const sev = state === 'critical' ? 'critical' : 'warning';
          const thr = state === 'critical' ? def.crit : def.warn;
          const existing = this.alerts.has(m.id, type);
          if (!existing || sev === 'critical') {
            this.alerts.raise({
              machineId: m.id, type, title: SENSOR_TITLES[def.key] ?? def.label, severity: sev,
              message: `${def.label} ${v}${unitOf(def.dimension)} ${def.dir === 'high' ? 'above' : 'below'} ${sev} limit ${thr}${unitOf(def.dimension)}`,
              value: v, threshold: thr, camera: m.type === 'truck' || def.key !== 'payload_pct' ? SENSOR_CAMERA[def.key] ?? 'front' : 'tray',
              operatorName: m.opName,
            }, this.t);
            if (existing && sev === 'critical') m.sustain[def.key] = Number.MAX_SAFE_INTEGER;
          }
        }
      } else {
        delete m.sustain[def.key];
        if (this.alerts.has(m.id, type) && !STICKY_TYPES.has(type)) {
          m.clearSince[def.key] ??= this.t;
          if (this.t - m.clearSince[def.key] > 30_000) {
            this.alerts.clear(m.id, type, this.t);
            delete m.clearSince[def.key];
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- bookkeeping

  private accountStats(m: SimMachine, dt: number) {
    if (m.st === 'breakdown') m.stats.downSec += dt;
    else if (m.st === 'maintenance' || m.st === 'offline') m.stats.maintSec += dt;
    else if (OPERATING.includes(m.st)) m.stats.operatingSec += dt;
    else m.stats.idleSec += dt;
  }

  flushStats() {
    this.lastStatsFlush = this.t;
    const sh = this.shift;
    for (const m of this.machines.values()) {
      const d = m.stats;
      if (d.operatingSec + d.idleSec + d.downSec + d.maintSec === 0) continue;
      this.rec.stats(sh.mineDay, sh.code, m.id, d);
      m.stats = emptyStats();
    }
  }

  private telemetryInterval(): number {
    const age = Date.now() - this.t;
    if (age > 48 * 3_600_000) return 300_000;
    if (age > 2 * 3_600_000) return 60_000;
    return 10_000;
  }

  private recordTelemetry() {
    const iv = this.telemetryInterval();
    const bucket = Math.floor(this.t / iv) * iv;
    if (bucket <= this.lastTelemetryBucket) return;
    this.lastTelemetryBucket = bucket;
    const rows: TelemetryRow[] = [];
    for (const m of this.machines.values()) {
      const isTruck = m.type === 'truck' || m.type === 'water';
      const dig = m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader';
      const [x, y] = this.displayXY(m);
      rows.push([
        m.id, bucket, m.st, m.act, r1(x), r1(y), Math.round(m.h), r1(m.v * KMH),
        m.type === 'truck' ? r1(m.payload) : null, r1((m.fuelL / m.fuelCap) * 100), r1(m.eTemp), Math.round(m.rpm), Math.round(m.eLoad), r1(m.fuelRate),
        isTruck ? Math.round(m.brk) : null, isTruck ? r1(Math.min(...m.tp)) : null, isTruck ? r1(Math.max(...m.tt)) : null,
        dig || m.type === 'dozer' || m.type === 'drill' ? Math.round(m.hyd) : null, dig || m.type === 'dozer' || m.type === 'drill' ? r1(m.vib) : null,
        r2(m.bat), dig ? Math.round(m.swing) : null, dig ? r1(m.boom) : null, dig ? r1(m.stick) : null, dig ? r1(m.arm) : null,
        dig ? Math.round(m.bFill) : null, m.type === 'water' ? Math.round(m.water) : null, m.type === 'drill' ? r1(m.depth) : null,
      ]);
    }
    this.rec.telemetry(rows);
  }

  /** Position with a left-hand lane offset while driving on roads. */
  displayXY(m: SimMachine): [number, number] {
    if (!m.path || m.pi >= m.path.length || m.mode === 'spot') return [m.x, m.y];
    const hr = (m.h * Math.PI) / 180;
    return [m.x + Math.sin(hr) * 4.5, m.y - Math.cos(hr) * 4.5];
  }

  // ---------------------------------------------------------------- fast-forward and live output

  fastForward(to: number, dt: number, onProgress?: (f: number) => void) {
    this.backfilling = true;
    const from = this.t;
    const chunk = 3_600_000;
    try {
      while (this.t < to) {
        const end = Math.min(to, this.t + chunk);
        this.rec.transaction(() => {
          while (this.t < end) this.step(Math.min(dt, (end - this.t) / 1000 || dt));
          this.flushStats();
        });
        onProgress?.((this.t - from) / Math.max(1, to - from));
      }
      this.alerts.settleHistory(this.t, ['Priya Nair', 'R. Behera', 'Shift supervisor A', 'Control room', 'S. Mohanty', 'Dispatch desk'], (n) => Math.floor(this.rng.next() * n));
    } finally {
      this.backfilling = false;
    }
  }

  /** Same as fastForward, but hands the event loop back after every simulated hour so the server stays responsive while it catches up. */
  async fastForwardAsync(to: number, dt: number, onProgress?: (f: number) => void) {
    this.backfilling = true;
    const from = this.t;
    const chunk = 3_600_000;
    try {
      while (this.t < to) {
        const end = Math.min(to, this.t + chunk);
        this.rec.transaction(() => {
          while (this.t < end) this.step(Math.min(dt, (end - this.t) / 1000 || dt));
          this.flushStats();
        });
        onProgress?.((this.t - from) / Math.max(1, to - from));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.alerts.settleHistory(this.t, ['Priya Nair', 'R. Behera', 'Shift supervisor A', 'Control room', 'S. Mohanty', 'Dispatch desk'], (n) => Math.floor(this.rng.next() * n));
    } finally {
      this.backfilling = false;
    }
  }

  loadProductionLog() {
    const rows = sqlite.prepare('select ts, tonnes, cycle_sec as cycleSec, queue_sec as queueSec, mine_day as mineDay, shift from production_events where ts > ? order by ts')
      .all(this.t - 26 * 3_600_000) as { ts: number; tonnes: number; cycleSec: number; queueSec: number; mineDay: string; shift: string }[];
    this.prodLog = rows;
    const day = shiftOf(this.t, this.settings.aStartHour).mineDay;
    const f = sqlite.prepare('select coalesce(sum(fuel_l), 0) as l from machine_shift_stats where mine_day = ?').get(day) as { l: number };
    this.fuelDay = { day, litres: f.l };
  }

  kpi(): KpiSnapshot {
    const cutoff = this.t - 26 * 3_600_000;
    if (this.prodLog.length && this.prodLog[0].ts < cutoff) this.prodLog = this.prodLog.filter((p) => p.ts >= cutoff);
    const sh = this.shift;
    let hourT = 0;
    let shiftT = 0;
    let dayT = 0;
    let loads = 0;
    let cyc = 0;
    let q = 0;
    let n = 0;
    for (const p of this.prodLog) {
      if (p.ts > this.t - 3_600_000) { hourT += p.tonnes; cyc += p.cycleSec; q += p.queueSec; n++; }
      if (p.mineDay === sh.mineDay) { dayT += p.tonnes; loads++; if (p.shift === sh.code) shiftT += p.tonnes; }
    }
    const counts = Object.fromEntries(MACHINE_STATUSES.map((s) => [s, 0])) as Record<MachineStatus, number>;
    let burn = 0;
    for (const m of this.machines.values()) {
      counts[m.st]++;
      burn += m.fuelRate;
    }
    const total = this.machines.size || 1;
    const down = counts.breakdown + counts.maintenance + counts.offline;
    const available = total - down;
    const operating = counts.running + counts.loading + counts.hauling;
    const ac = this.alerts.counts();
    const tg = this.settings.targets;
    return {
      tph: Math.round(hourT), tonnesShift: Math.round(shiftT), tonnesDay: Math.round(dayT), targetDay: tg.dailyTonnes,
      targetShift: Math.round(tg.dailyTonnes / 3), targetTph: tg.tph, loadsDay: loads,
      availability: r1((available / total) * 100), utilisation: r1(available ? (operating / available) * 100 : 0),
      fuelBurnLph: Math.round(burn), fuelDayL: Math.round(this.fuelDay.litres), activeAlerts: ac.total, criticalAlerts: ac.critical,
      avgCycleMin: n ? r1(cyc / n / 60) : 0, avgQueueMin: n ? r1(q / n / 60) : 0, statusCounts: counts,
      shift: sh.code, shiftName: this.settings.shiftNames[sh.code], mineDay: sh.mineDay,
      shiftProgress: clamp((this.t - sh.start) / (sh.end - sh.start), 0, 1),
    };
  }

  frame(): LiveFrame {
    const counts = this.alerts.counts().perMachine;
    const machines: MachineLive[] = [];
    for (const m of this.machines.values()) {
      const [x, y] = this.displayXY(m);
      const live: MachineLive = {
        id: m.id, type: m.type, x: r1(x), y: r1(y), h: Math.round(m.h), spd: r1(m.v * KMH), st: m.st, act: m.act,
        op: m.opName, opId: m.opId, zone: zoneAt(m.x, m.y), s: this.sensorValues(m), al: counts.get(m.id) ?? 0,
      };
      if (m.type === 'truck') {
        live.loader = m.loaderId ?? undefined;
        live.route = m.routeId ?? undefined;
      }
      if (this.loaders.has(m.id)) live.queue = this.loaders.get(m.id)!.queue.length;
      if (m.tp.length) { live.tp = m.tp.map(r1); live.tt = m.tt.map(r1); }
      if (m.fault.camOff) live.camOff = [m.fault.camOff.cam];
      if (m.dms) live.dms = m.dms;
      machines.push(live);
    }
    return { type: 'frame', t: this.t, speed: this.speed, paused: this.paused, machines, kpi: this.kpi() };
  }

  persistMachines() {
    const stmt = sqlite.prepare('update machines set fuel_l = ?, engine_hours = ? where id = ?');
    sqlite.transaction(() => {
      for (const m of this.machines.values()) stmt.run(r1(m.fuelL), r1(m.hours), m.id);
    })();
  }

  activeAlerts(): AlertRow[] {
    return this.alerts.all();
  }

  get currentShift() {
    return this.shift;
  }
}

function unitOf(dim: string): string {
  switch (dim) {
    case 'percent': return ' %';
    case 'temp': return ' °C';
    case 'pressure_psi': return ' psi';
    case 'pressure_bar': return ' bar';
    case 'voltage': return ' V';
    case 'vibration': return ' mm/s';
    case 'rpm': return ' rpm';
    default: return '';
  }
}
