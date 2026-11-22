// Sensor catalogue: the default definitions, unit dimensions and conversions.
import type { MachineType } from './types';

export type Dimension =
  | 'percent' | 'temp' | 'pressure_psi' | 'pressure_bar' | 'speed' | 'mass' | 'volume' | 'flow'
  | 'voltage' | 'rpm' | 'angle' | 'vibration' | 'hours' | 'count' | 'length';

export const DIMENSIONS: Dimension[] = [
  'percent', 'temp', 'pressure_psi', 'pressure_bar', 'speed', 'mass', 'volume', 'flow',
  'voltage', 'rpm', 'angle', 'vibration', 'hours', 'count', 'length',
];

export type SensorGroup = 'engine' | 'fuel' | 'load' | 'motion' | 'hydraulics' | 'tyres' | 'electrical' | 'work';

export interface SensorDef {
  key: string;
  label: string;
  dimension: Dimension;
  group: SensorGroup;
  types: MachineType[];
  min: number;
  max: number;
  /** 'high' = alert above thresholds, 'low' = alert below, 'none' = no alerting */
  dir: 'high' | 'low' | 'none';
  warn: number | null;
  crit: number | null;
  decimals: number;
  enabled: boolean;
}

const ALL: MachineType[] = ['shovel', 'excavator', 'loader', 'truck', 'dozer', 'drill', 'water', 'lv'];
const MOBILE: MachineType[] = ['truck', 'dozer', 'water', 'lv', 'loader', 'drill'];
const DIGGERS: MachineType[] = ['shovel', 'excavator', 'loader'];

export const DEFAULT_SENSORS: SensorDef[] = [
  { key: 'engine_temp', label: 'Engine temperature', dimension: 'temp', group: 'engine', types: ALL, min: 0, max: 130, dir: 'high', warn: 105, crit: 112, decimals: 1, enabled: true },
  { key: 'rpm', label: 'Engine speed', dimension: 'rpm', group: 'engine', types: ALL, min: 0, max: 2200, dir: 'high', warn: 2050, crit: 2150, decimals: 0, enabled: true },
  { key: 'engine_load', label: 'Engine load', dimension: 'percent', group: 'engine', types: ALL, min: 0, max: 100, dir: 'none', warn: null, crit: null, decimals: 0, enabled: true },
  { key: 'engine_hours', label: 'Engine hours', dimension: 'hours', group: 'engine', types: ALL, min: 0, max: 100000, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'fuel_level', label: 'Fuel level', dimension: 'percent', group: 'fuel', types: ALL, min: 0, max: 100, dir: 'low', warn: 15, crit: 7, decimals: 1, enabled: true },
  { key: 'fuel_rate', label: 'Fuel consumption', dimension: 'flow', group: 'fuel', types: ALL, min: 0, max: 400, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'battery', label: 'Battery voltage', dimension: 'voltage', group: 'electrical', types: ALL, min: 18, max: 30, dir: 'low', warn: 24.2, crit: 23.0, decimals: 2, enabled: true },
  { key: 'load_cycles', label: 'Load cycles (shift)', dimension: 'count', group: 'work', types: ['truck', 'shovel', 'excavator', 'loader', 'drill'], min: 0, max: 400, dir: 'none', warn: null, crit: null, decimals: 0, enabled: true },
  { key: 'speed', label: 'Ground speed', dimension: 'speed', group: 'motion', types: MOBILE, min: 0, max: 70, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'payload', label: 'Payload', dimension: 'mass', group: 'load', types: ['truck'], min: 0, max: 260, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'payload_pct', label: 'Payload vs rated', dimension: 'percent', group: 'load', types: ['truck'], min: 0, max: 130, dir: 'high', warn: 105, crit: 110, decimals: 0, enabled: true },
  { key: 'brake_temp', label: 'Brake temperature', dimension: 'temp', group: 'motion', types: ['truck', 'water'], min: 0, max: 400, dir: 'high', warn: 250, crit: 320, decimals: 0, enabled: true },
  { key: 'tyre_pressure', label: 'Tyre pressure (lowest)', dimension: 'pressure_psi', group: 'tyres', types: ['truck', 'water'], min: 40, max: 130, dir: 'low', warn: 88, crit: 78, decimals: 1, enabled: true },
  { key: 'tyre_temp', label: 'Tyre temperature (highest)', dimension: 'temp', group: 'tyres', types: ['truck', 'water'], min: 0, max: 120, dir: 'high', warn: 85, crit: 95, decimals: 1, enabled: true },
  { key: 'bucket_fill', label: 'Bucket fill', dimension: 'percent', group: 'load', types: DIGGERS, min: 0, max: 120, dir: 'none', warn: null, crit: null, decimals: 0, enabled: true },
  { key: 'bucket_weight', label: 'Bucket load', dimension: 'mass', group: 'load', types: DIGGERS, min: 0, max: 90, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'boom_angle', label: 'Boom angle', dimension: 'angle', group: 'work', types: DIGGERS, min: -10, max: 70, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'arm_angle', label: 'Arm angle', dimension: 'angle', group: 'work', types: ['shovel', 'excavator'], min: -60, max: 60, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'stick_angle', label: 'Stick angle', dimension: 'angle', group: 'work', types: DIGGERS, min: -90, max: 30, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'swing_angle', label: 'Swing angle', dimension: 'angle', group: 'work', types: ['shovel', 'excavator'], min: -180, max: 180, dir: 'none', warn: null, crit: null, decimals: 0, enabled: true },
  { key: 'hyd_pressure', label: 'Hydraulic pressure', dimension: 'pressure_bar', group: 'hydraulics', types: ['shovel', 'excavator', 'loader', 'dozer', 'drill'], min: 0, max: 420, dir: 'high', warn: 360, crit: 385, decimals: 0, enabled: true },
  { key: 'vibration', label: 'Vibration', dimension: 'vibration', group: 'hydraulics', types: ['shovel', 'excavator', 'loader', 'drill', 'dozer'], min: 0, max: 30, dir: 'high', warn: 16, crit: 22, decimals: 1, enabled: true },
  { key: 'drill_depth', label: 'Hole depth', dimension: 'length', group: 'work', types: ['drill'], min: 0, max: 20, dir: 'none', warn: null, crit: null, decimals: 1, enabled: true },
  { key: 'water_level', label: 'Water tank level', dimension: 'percent', group: 'load', types: ['water'], min: 0, max: 100, dir: 'low', warn: 12, crit: null, decimals: 0, enabled: true },
];

export const GROUP_LABEL: Record<SensorGroup, string> = {
  engine: 'Engine',
  fuel: 'Fuel',
  load: 'Load',
  motion: 'Motion & brakes',
  hydraulics: 'Hydraulics',
  tyres: 'Tyres',
  electrical: 'Electrical',
  work: 'Work cycle',
};

export interface UnitPrefs {
  temp: 'C' | 'F';
  pressure: 'psi' | 'bar' | 'kPa';
  speed: 'kmh' | 'mph';
  mass: 't' | 'st';
  volume: 'L' | 'gal';
}

export const DEFAULT_UNITS: UnitPrefs = { temp: 'C', pressure: 'psi', speed: 'kmh', mass: 't', volume: 'L' };

/** Convert a base-unit value to the display unit, returning [value, unit label]. */
export function convert(value: number, dim: Dimension, u: UnitPrefs): [number, string] {
  switch (dim) {
    case 'percent': return [value, '%'];
    case 'temp': return u.temp === 'F' ? [value * 1.8 + 32, '°F'] : [value, '°C'];
    case 'pressure_psi':
      if (u.pressure === 'bar') return [value * 0.0689476, 'bar'];
      if (u.pressure === 'kPa') return [value * 6.89476, 'kPa'];
      return [value, 'psi'];
    case 'pressure_bar':
      if (u.pressure === 'psi') return [value * 14.5038, 'psi'];
      if (u.pressure === 'kPa') return [value * 100, 'kPa'];
      return [value, 'bar'];
    case 'speed': return u.speed === 'mph' ? [value * 0.621371, 'mph'] : [value, 'km/h'];
    case 'mass': return u.mass === 'st' ? [value * 1.10231, 'st'] : [value, 't'];
    case 'volume': return u.volume === 'gal' ? [value * 0.264172, 'gal'] : [value, 'L'];
    case 'flow': return u.volume === 'gal' ? [value * 0.264172, 'gal/h'] : [value, 'L/h'];
    case 'voltage': return [value, 'V'];
    case 'rpm': return [value, 'rpm'];
    case 'angle': return [value, '°'];
    case 'vibration': return [value, 'mm/s'];
    case 'hours': return [value, 'h'];
    case 'count': return [value, ''];
    case 'length': return [value, 'm'];
  }
}

export type SensorState = 'normal' | 'warning' | 'critical';

export function sensorState(def: Pick<SensorDef, 'dir' | 'warn' | 'crit'>, v: number | undefined): SensorState {
  if (v === undefined || Number.isNaN(v) || def.dir === 'none') return 'normal';
  if (def.dir === 'high') {
    if (def.crit !== null && v >= def.crit) return 'critical';
    if (def.warn !== null && v >= def.warn) return 'warning';
  } else {
    if (def.crit !== null && v <= def.crit) return 'critical';
    if (def.warn !== null && v <= def.warn) return 'warning';
  }
  return 'normal';
}
