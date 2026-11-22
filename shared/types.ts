// Types shared by the server, the simulator and the browser app.

export type MachineType = 'shovel' | 'excavator' | 'loader' | 'truck' | 'dozer' | 'drill' | 'water' | 'lv';
export type MachineStatus = 'running' | 'idle' | 'loading' | 'hauling' | 'breakdown' | 'maintenance' | 'offline';
export type Role = 'admin' | 'supervisor' | 'operator' | 'viewer';
export type Severity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';
export type CameraPosition = 'front' | 'rear' | 'left' | 'right' | 'cabin' | 'bucket' | 'tray';
export type ShiftCode = 'A' | 'B' | 'C';

export const MACHINE_TYPES: MachineType[] = ['shovel', 'excavator', 'loader', 'truck', 'dozer', 'drill', 'water', 'lv'];
export const MACHINE_STATUSES: MachineStatus[] = ['running', 'loading', 'hauling', 'idle', 'breakdown', 'maintenance', 'offline'];
export const LOADING_TYPES: MachineType[] = ['shovel', 'excavator', 'loader'];

export const TYPE_LABEL: Record<MachineType, string> = {
  shovel: 'Shovel',
  excavator: 'Excavator',
  loader: 'Wheel loader',
  truck: 'Haul truck',
  dozer: 'Dozer',
  drill: 'Drill rig',
  water: 'Water tanker',
  lv: 'Light vehicle',
};

export const STATUS_LABEL: Record<MachineStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  loading: 'Loading',
  hauling: 'Hauling',
  breakdown: 'Breakdown',
  maintenance: 'Maintenance',
  offline: 'Offline',
};

export const CAMERA_LABEL: Record<CameraPosition, string> = {
  front: 'Front',
  rear: 'Rear',
  left: 'Left',
  right: 'Right',
  cabin: 'Cabin',
  bucket: 'Bucket',
  tray: 'Tray',
};

/** Live state of one machine, pushed over the WebSocket twice a second. */
export interface MachineLive {
  id: string;
  type: MachineType;
  x: number;
  y: number;
  /** heading in degrees, 0 = east, clockwise (screen coordinates) */
  h: number;
  /** speed km/h */
  spd: number;
  st: MachineStatus;
  /** human readable activity, e.g. "Hauling to Crusher" */
  act: string;
  /** operator name on shift (or '') */
  op: string;
  opId: number | null;
  zone: string;
  /** truck: assigned loader id; loader: number of trucks queued */
  loader?: string;
  route?: string;
  queue?: number;
  /** sensor values keyed by sensor definition key (base units) */
  s: Record<string, number>;
  /** truck tyres: pressure psi and temperature °C, 6 positions */
  tp?: number[];
  tt?: number[];
  /** active alert count on this machine */
  al: number;
  /** camera ids that are offline (scenario) */
  camOff?: string[];
  /** fatigue / distraction indicator for the cabin camera (0 = attentive) */
  dms?: 0 | 1 | 2;
}

export interface KpiSnapshot {
  tph: number;
  tonnesShift: number;
  tonnesDay: number;
  targetDay: number;
  targetShift: number;
  targetTph: number;
  loadsDay: number;
  availability: number;
  utilisation: number;
  fuelBurnLph: number;
  fuelDayL: number;
  activeAlerts: number;
  criticalAlerts: number;
  avgCycleMin: number;
  avgQueueMin: number;
  statusCounts: Record<MachineStatus, number>;
  shift: ShiftCode;
  shiftName: string;
  mineDay: string;
  shiftProgress: number;
}

export interface LiveFrame {
  type: 'frame';
  t: number;
  speed: number;
  paused: boolean;
  machines: MachineLive[];
  kpi: KpiSnapshot;
}

export interface AlertRow {
  id: number;
  ts: number;
  lastTs: number;
  machineId: string;
  type: string;
  title: string;
  severity: Severity;
  message: string;
  value: number | null;
  threshold: number | null;
  status: AlertStatus;
  count: number;
  camera: CameraPosition | null;
  operatorName: string | null;
  ackBy: string | null;
  ackAt: number | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  note: string | null;
}

export type ServerMessage =
  | LiveFrame
  | { type: 'alert'; alert: AlertRow; isNew: boolean }
  | { type: 'event'; kind: 'load' | 'refuel' | 'breakdown' | 'repaired' | 'shift' | 'dispatch' | 'reset' | 'info'; text: string; machineId?: string; t: number }
  | { type: 'hello'; t: number; speed: number };

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  operator: 'Operator',
  viewer: 'Viewer',
};

export function can(role: Role | undefined, action: 'admin' | 'manage' | 'operate'): boolean {
  if (!role) return false;
  if (action === 'admin') return role === 'admin';
  if (action === 'manage') return role === 'admin' || role === 'supervisor';
  return role !== 'viewer';
}
