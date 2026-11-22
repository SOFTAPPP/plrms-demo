import type { SensorDef, UnitPrefs } from '../../shared/sensors';
import type { CameraPosition, MachineType, SessionUser, ShiftCode } from '../../shared/types';
import type { SiteNode, SiteZone } from '../../shared/site';

export interface MachineMeta {
  id: string;
  name: string;
  type: MachineType;
  make: string;
  model: string;
  year: number;
  serial: string;
  capacity: number;
  fuelCapacity: number;
  homeNode: string;
  routeId: string | null;
  loaderId: string | null;
  inService: boolean;
  engineHours: number;
  notes: string | null;
}

export interface RouteMeta {
  id: string;
  name: string;
  loaderNode: string;
  destNode: string;
  material: 'ore' | 'waste';
  distanceKm: number;
  targetCycleMin: number;
  active: boolean;
}

export interface CameraMeta {
  id: string;
  machineId: string;
  position: CameraPosition;
  label: string;
  resolution: string;
  fps: number;
  enabled: boolean;
  recording: boolean;
}

export interface OperatorMeta {
  id: number;
  name: string;
  employeeNo: string;
  shift: ShiftCode;
}

export interface Settings {
  site: { name: string; company: string; location: string; commodity: string };
  shifts: { aStartHour: number; names: Record<ShiftCode, string> };
  kpiTargets: { dailyTonnes: number; tph: number; availability: number; utilisation: number; maxQueueMin: number; fuelLPerTonne: number; cycleMin: number };
  units: UnitPrefs;
  dispatch: { autoBalance: boolean };
  alerts: { overspeedMargin: number; proximityM: number; fatigueEnabled: boolean; autoCloseMin: number };
}

export interface WidgetLayoutItem {
  id: string;
  kind: string;
  size: 's' | 'm' | 'l' | 'xl';
}

export interface Boot {
  user: SessionUser;
  settings: Settings;
  sensorDefs: SensorDef[];
  machines: MachineMeta[];
  routes: RouteMeta[];
  cameras: CameraMeta[];
  operators: OperatorMeta[];
  prefs: { layout: WidgetLayoutItem[] | null; theme: 'dark' | 'light' | null };
  sim: { t: number; speed: number; paused: boolean; historyDays: number };
  site: { nodes: SiteNode[]; zones: SiteZone[] };
}

export interface TelemetryPoint {
  ts: number;
  st?: string;
  act?: string | null;
  x?: number;
  y?: number;
  h?: number;
  spd?: number;
  pay?: number | null;
  fuel?: number | null;
  e_temp?: number | null;
  rpm?: number | null;
  e_load?: number | null;
  fuel_rate?: number | null;
  brk?: number | null;
  tyre_p?: number | null;
  tyre_t?: number | null;
  hyd?: number | null;
  vib?: number | null;
  bat?: number | null;
  swing?: number | null;
  boom?: number | null;
  stick?: number | null;
  arm?: number | null;
  b_fill?: number | null;
  water?: number | null;
  depth?: number | null;
}
