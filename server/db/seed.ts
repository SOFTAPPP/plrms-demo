// Base demo data: users, settings, fleet, operators, routes, sensors, cameras, maintenance plan.
import bcrypt from 'bcryptjs';
import { db } from './client';
import * as t from './schema';
import { config } from '../config';
import { DEFAULT_SENSORS, DEFAULT_UNITS } from '../../shared/sensors';
import { NODE_BY_ID, pathLength, shortestPath } from '../../shared/site';
import type { CameraPosition, MachineType } from '../../shared/types';
import { DAY, HOUR } from '../../shared/time';
import { Rng } from '../sim/rng';

export interface MachineSeed {
  id: string;
  name: string;
  type: MachineType;
  make: string;
  model: string;
  year: number;
  capacity: number;
  fuelCapacity: number;
  homeNode: string;
  routeId?: string;
  loaderId?: string;
  inService?: boolean;
}

export const ROUTES = [
  { id: 'R-01', name: 'N2 ore to crusher', loaderNode: 'F-N2', destNode: 'CR', material: 'ore' },
  { id: 'R-02', name: 'S2 waste to east dump', loaderNode: 'F-S2', destNode: 'WD', material: 'waste' },
  { id: 'R-03', name: 'N1 ore to crusher', loaderNode: 'F-N1', destNode: 'CR', material: 'ore' },
  { id: 'R-04', name: 'Pit floor waste to east dump', loaderNode: 'F-C', destNode: 'WD', material: 'waste' },
  { id: 'R-05', name: 'S1 waste to east dump', loaderNode: 'F-S1', destNode: 'WD', material: 'waste' },
  { id: 'R-06', name: 'W1 ore to crusher', loaderNode: 'F-W1', destNode: 'CR', material: 'ore' },
  { id: 'R-07', name: 'ROM rehandle to crusher', loaderNode: 'ROM', destNode: 'CR', material: 'ore' },
  { id: 'R-08', name: 'N1 ore to ROM stockpile', loaderNode: 'F-N1', destNode: 'ROM', material: 'ore' },
];

export const FLEET: MachineSeed[] = [
  { id: 'SHV-01', name: 'Shovel 01', type: 'shovel', make: 'Liebherr', model: 'R 9800', year: 2019, capacity: 75, fuelCapacity: 11000, homeNode: 'F-N2' },
  { id: 'SHV-02', name: 'Shovel 02', type: 'shovel', make: 'Komatsu', model: 'PC8000-11', year: 2020, capacity: 75, fuelCapacity: 12500, homeNode: 'F-S2' },
  { id: 'EX-01', name: 'Excavator 01', type: 'excavator', make: 'Hitachi', model: 'EX5600-7', year: 2021, capacity: 52, fuelCapacity: 11000, homeNode: 'F-N1' },
  { id: 'EX-02', name: 'Excavator 02', type: 'excavator', make: 'Caterpillar', model: '6060', year: 2018, capacity: 60, fuelCapacity: 15000, homeNode: 'F-C' },
  { id: 'EX-03', name: 'Excavator 03', type: 'excavator', make: 'Komatsu', model: 'PC4000-11', year: 2022, capacity: 40, fuelCapacity: 6700, homeNode: 'F-S1' },
  { id: 'EX-04', name: 'Excavator 04', type: 'excavator', make: 'Hitachi', model: 'EX3600-7', year: 2020, capacity: 38, fuelCapacity: 6000, homeNode: 'F-W1' },
  { id: 'LDR-01', name: 'Loader 01', type: 'loader', make: 'Caterpillar', model: '994K', year: 2021, capacity: 34, fuelCapacity: 4040, homeNode: 'ROM' },
  { id: 'LDR-02', name: 'Loader 02', type: 'loader', make: 'Caterpillar', model: '994K', year: 2019, capacity: 34, fuelCapacity: 4040, homeNode: 'ROM' },
  ...[1, 2, 3, 7].map((n) => truck(`TRK-10${n}`, 'Caterpillar', '793F', 227, 4540, 'SHV-01', 'R-01', 2017 + (n % 5))),
  ...[1, 2, 3].map((n) => truck(`TRK-20${n}`, 'Komatsu', '830E-5', 221, 4542, 'SHV-02', 'R-02', 2019 + n)),
  ...[4, 5, 6].map((n) => truck(`TRK-10${n}`, 'Caterpillar', '793F', 227, 4540, 'EX-01', 'R-03', 2017 + n)),
  ...[4, 5].map((n) => truck(`TRK-20${n}`, 'Komatsu', '830E-5', 221, 4542, 'EX-02', 'R-04', 2016 + n)),
  ...[1, 2].map((n) => truck(`TRK-30${n}`, 'Caterpillar', '785D', 136, 1900, 'EX-03', 'R-05', 2019 + n)),
  truck('TRK-303', 'Caterpillar', '785D', 136, 1900, 'EX-04', 'R-06', 2022),
  truck('TRK-304', 'Caterpillar', '785D', 136, 1900, 'EX-04', 'R-06', 2023),
  ...[1, 2].map((n) => truck(`TRK-40${n}`, 'Caterpillar', '777G', 98, 1136, 'LDR-01', 'R-07', 2020 + n)),
  truck('TRK-403', 'Caterpillar', '777G', 98, 1136, 'LDR-02', 'R-07', 2023),
  { id: 'DZ-01', name: 'Dozer 01', type: 'dozer', make: 'Caterpillar', model: 'D11', year: 2020, capacity: 45, fuelCapacity: 1600, homeNode: 'WD' },
  { id: 'DZ-02', name: 'Dozer 02', type: 'dozer', make: 'Caterpillar', model: 'D10T2', year: 2021, capacity: 35, fuelCapacity: 1000, homeNode: 'F-S2' },
  { id: 'DZ-03', name: 'Dozer 03', type: 'dozer', make: 'Komatsu', model: 'D375A-8', year: 2019, capacity: 30, fuelCapacity: 1200, homeNode: 'ROM' },
  { id: 'DR-01', name: 'Drill 01', type: 'drill', make: 'Epiroc', model: 'Pit Viper 271', year: 2020, capacity: 15, fuelCapacity: 1500, homeNode: 'N40' },
  { id: 'DR-02', name: 'Drill 02', type: 'drill', make: 'Epiroc', model: 'SmartROC D65', year: 2022, capacity: 12, fuelCapacity: 700, homeNode: 'N40' },
  { id: 'WT-01', name: 'Water tanker 01', type: 'water', make: 'Caterpillar', model: '777G Water', year: 2019, capacity: 75, fuelCapacity: 1136, homeNode: 'WF' },
  { id: 'WT-02', name: 'Water tanker 02', type: 'water', make: 'Komatsu', model: 'HD785 Water', year: 2018, capacity: 60, fuelCapacity: 990, homeNode: 'WF' },
  { id: 'LV-01', name: 'Light vehicle 01', type: 'lv', make: 'Toyota', model: 'Land Cruiser 79', year: 2022, capacity: 1, fuelCapacity: 130, homeNode: 'AD' },
  { id: 'LV-02', name: 'Light vehicle 02', type: 'lv', make: 'Toyota', model: 'Hilux', year: 2023, capacity: 1, fuelCapacity: 80, homeNode: 'WS' },
  { id: 'LV-03', name: 'Light vehicle 03', type: 'lv', make: 'Mahindra', model: 'Scorpio-N', year: 2023, capacity: 1, fuelCapacity: 57, homeNode: 'AD' },
  { id: 'LV-04', name: 'Light vehicle 04', type: 'lv', make: 'Tata', model: 'Yodha Pickup', year: 2021, capacity: 1, fuelCapacity: 45, homeNode: 'FB' },
];

function truck(id: string, make: string, model: string, cap: number, fuel: number, loaderId: string, routeId: string, year: number): MachineSeed {
  return { id, name: `Haul truck ${id.slice(4)}`, type: 'truck', make, model, year, capacity: cap, fuelCapacity: fuel, homeNode: '', loaderId, routeId };
}

export const CAMERA_LAYOUT: Record<MachineType, CameraPosition[]> = {
  truck: ['front', 'rear', 'left', 'right', 'cabin', 'tray'],
  shovel: ['front', 'rear', 'left', 'right', 'cabin', 'bucket'],
  excavator: ['front', 'rear', 'left', 'right', 'cabin', 'bucket'],
  loader: ['front', 'rear', 'cabin', 'bucket'],
  dozer: ['front', 'rear', 'cabin'],
  drill: ['front', 'rear', 'cabin'],
  water: ['front', 'rear', 'cabin'],
  lv: ['front', 'cabin'],
};

const FIRST = ['Arjun', 'Rakesh', 'Sunil', 'Pradeep', 'Manoj', 'Vikram', 'Sanjay', 'Deepak', 'Rahul', 'Amit', 'Suresh', 'Ramesh', 'Ajay', 'Anil', 'Kiran', 'Prakash', 'Mahesh', 'Dinesh', 'Rajesh', 'Santosh', 'Bikash', 'Sachin', 'Naveen', 'Gopal', 'Sourav', 'Imran', 'Harpreet', 'Joseph', 'Lakshmi', 'Meena', 'Kavita', 'Pooja', 'Anita', 'Sunita', 'Rekha', 'Farhan', 'Abhishek', 'Tarun', 'Bhaskar', 'Debashis'];
const LAST = ['Patel', 'Singh', 'Kumar', 'Sharma', 'Das', 'Mohanty', 'Behera', 'Nayak', 'Reddy', 'Yadav', 'Mishra', 'Sahoo', 'Pradhan', 'Rao', 'Gupta', 'Iyer', 'Banerjee', 'Ghosh', 'Khan', 'Pillai', 'Verma', 'Jena', 'Rout', 'Naidu'];

export const DEFAULT_SETTINGS = {
  site: { name: 'Kalinga Ridge Opencast', company: 'Winteg Demo Mining Co.', location: 'Eastern India iron ore belt', commodity: 'Iron ore' },
  shifts: { aStartHour: 6, names: { A: 'Day', B: 'Evening', C: 'Night' } },
  kpiTargets: { dailyTonnes: 300000, tph: 12500, availability: 88, utilisation: 70, maxQueueMin: 2, fuelLPerTonne: 0.3, cycleMin: 18 },
  units: DEFAULT_UNITS,
  dispatch: { autoBalance: true },
  alerts: { overspeedMargin: 5, proximityM: 15, fatigueEnabled: true, autoCloseMin: 30 },
};

export const DEMO_USERS = [
  { email: 'supervisor@strata.demo', name: 'Priya Nair', role: 'supervisor', password: 'Demo@1234' },
  { email: 'operator@strata.demo', name: 'Ravi Kumar', role: 'operator', password: 'Demo@1234' },
  { email: 'viewer@strata.demo', name: 'Client Viewer', role: 'viewer', password: 'Demo@1234' },
];

export const TECHNICIANS = ['S. Mohanty', 'R. Behera', 'K. Iyer', 'A. Khan', 'P. Das', 'M. Reddy'];

const PM_TITLES: Record<MachineType, string[]> = {
  truck: ['250 h service - engine oil & filters', '500 h service - transmission & final drives', 'Tyre rotation & inspection', 'Brake system inspection'],
  shovel: ['500 h service - hydraulics', 'Bucket teeth & lip change', 'Swing gear inspection'],
  excavator: ['500 h service - hydraulics', 'Bucket teeth change', 'Track tension & roller check'],
  loader: ['500 h service', 'Bucket edge replacement', 'Tyre inspection'],
  dozer: ['250 h service', 'Undercarriage inspection', 'Blade cutting edge change'],
  drill: ['Compressor service', 'Drill string & bit inspection', '250 h service'],
  water: ['250 h service', 'Spray pump & nozzle service'],
  lv: ['10,000 km service', 'Brake & tyre check'],
};

export function seedBase(now: number) {
  const rng = new Rng(20261120);
  const adminHash = bcrypt.hashSync(config.adminPassword, 10);

  db.transaction((tx) => {
    tx.insert(t.users).values({ email: config.adminEmail, name: 'Aritra Dutta', passwordHash: adminHash, role: 'admin', createdAt: now }).run();
    for (const u of DEMO_USERS) {
      tx.insert(t.users).values({ email: u.email, name: u.name, passwordHash: bcrypt.hashSync(u.password, 10), role: u.role, createdAt: now }).run();
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) tx.insert(t.settings).values({ key, value }).run();
    DEFAULT_SENSORS.forEach((def, i) => tx.insert(t.sensorDefs).values({ key: def.key, def, sort: i }).run());

    for (const r of ROUTES) {
      const km = pathLength(shortestPath(r.loaderNode, r.destNode)) / 1000;
      tx.insert(t.routes).values({ ...r, distanceKm: Math.round(km * 100) / 100, targetCycleMin: Math.round((8 + km * 4.2) * 10) / 10, active: true }).run();
    }

    for (const m of FLEET) {
      const home = m.homeNode || ROUTES.find((r) => r.id === m.routeId)!.loaderNode;
      tx.insert(t.machines).values({
        id: m.id, name: m.name, type: m.type, make: m.make, model: m.model, year: m.year,
        serial: `${m.make.slice(0, 3).toUpperCase()}${rng.int(100000, 999999)}`,
        capacity: m.capacity, fuelCapacity: m.fuelCapacity, homeNode: home,
        routeId: m.routeId ?? null, loaderId: m.loaderId ?? null, inService: true,
        fuelL: m.fuelCapacity * rng.range(0.35, 0.95),
        engineHours: Math.round(rng.range(4000, 38000) * 10) / 10,
        notes: null, createdAt: now,
      }).run();
      for (const pos of CAMERA_LAYOUT[m.type]) {
        tx.insert(t.cameras).values({
          id: `${m.id}-${pos}`, machineId: m.id, position: pos, label: `${m.id} ${pos}`,
          resolution: pos === 'cabin' ? '1280x720' : '1920x1080', fps: pos === 'cabin' ? 15 : 25,
          enabled: true, recording: true, createdAt: now,
        }).run();
      }
    }

    // Operators: one per operated machine per shift, plus a relief pool.
    const used = new Set<string>();
    let empNo = 1040;
    const makeOperator = (shift: string) => {
      let name = '';
      do name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; while (used.has(name));
      used.add(name);
      const res = tx.insert(t.operators).values({
        name, employeeNo: `EMP-${empNo++}`, shift, phone: `+91 9${rng.int(100000000, 999999999)}`,
        licence: rng.pick(['HME-A', 'HME-A, HME-B', 'HME-B', 'HME-A, LMV']), status: rng.chance(0.06) ? 'leave' : 'active',
        experienceYears: rng.int(1, 22), safetyScore: rng.int(72, 99), createdAt: now,
      }).returning({ id: t.operators.id }).get();
      return res.id;
    };
    for (const shift of ['A', 'B', 'C']) {
      for (const m of FLEET) tx.insert(t.roster).values({ machineId: m.id, shift, operatorId: makeOperator(shift) }).run();
      for (let i = 0; i < 3; i++) makeOperator(shift);
    }

    // Maintenance: history, one job in progress and a forward plan.
    for (const m of FLEET) {
      const titles = PM_TITLES[m.type];
      for (let k = 0; k < rng.int(1, 3); k++) {
        const due = now - rng.range(2, 40) * DAY;
        const dur = rng.range(3, 10);
        tx.insert(t.maintenance).values({
          machineId: m.id, title: rng.pick(titles), type: 'preventive', status: 'completed', priority: 'medium',
          dueAt: due, durationH: Math.round(dur * 10) / 10, startedAt: due, completedAt: due + dur * HOUR,
          technician: rng.pick(TECHNICIANS), cost: Math.round(rng.range(800, 9000)) * 10, notes: 'Completed as scheduled.',
          source: 'plan', createdBy: 'Maintenance planner',
        }).run();
      }
    }
    // Negative offsets fall inside the simulated history, so the simulator carries them out
    // (machine to the workshop, downtime, work order completed). LDR-02 and TRK-204 are in the workshop at start.
    const plan: [string, number, number][] = [
      ['TRK-103', -6.4, 5], ['EX-04', -5.6, 7], ['TRK-301', -4.8, 4], ['DZ-01', -3.9, 6], ['TRK-205', -3.1, 5], ['SHV-01', -2.3, 9],
      ['WT-02', -1.6, 3], ['TRK-106', -0.9, 5], ['LDR-02', -0.12, 9], ['TRK-204', -0.05, 4],
      ['TRK-105', 1.2, 6], ['EX-03', 2.5, 8], ['TRK-202', 3.4, 5], ['DZ-02', 4.1, 6], ['TRK-302', 5.0, 4],
      ['SHV-02', 6.2, 10], ['WT-01', 6.8, 3], ['TRK-101', 8.0, 6], ['DR-01', 9.5, 5],
    ];
    for (const [id, days, dur] of plan) {
      const m = FLEET.find((f) => f.id === id)!;
      tx.insert(t.maintenance).values({
        machineId: id, title: rng.pick(PM_TITLES[m.type]), type: 'preventive', status: 'scheduled', priority: 'medium',
        dueAt: now + days * DAY, durationH: dur, technician: rng.pick(TECHNICIANS), source: 'plan', createdBy: 'Maintenance planner',
      }).run();
    }
    tx.insert(t.auditLog).values({ ts: now, userName: 'system', action: 'seed', detail: 'Demo database created' }).run();
  });
}

export function routeDistanceKm(routeId: string): number {
  const r = ROUTES.find((x) => x.id === routeId);
  if (!r) return 0;
  return pathLength(shortestPath(r.loaderNode, r.destNode)) / 1000;
}

export { NODE_BY_ID };
