// Shift calendar helpers. All times are epoch milliseconds read in the local time zone.
import type { ShiftCode } from './types';

export const SHIFTS: ShiftCode[] = ['A', 'B', 'C'];
export const SHIFT_HOURS = 8;
export const HOUR = 3_600_000;
export const MIN = 60_000;
export const DAY = 24 * HOUR;

export interface ShiftInfo {
  code: ShiftCode;
  /** mine day the shift belongs to, 'YYYY-MM-DD' (a mine day starts with shift A) */
  mineDay: string;
  start: number;
  end: number;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Start of the mine day containing ts (the most recent shift-A start). */
export function mineDayStart(ts: number, aStartHour = 6): number {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), aStartHour, 0, 0, 0).getTime();
  if (ts >= start) return start;
  const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, aStartHour, 0, 0, 0);
  return prev.getTime();
}

export function mineDayOf(ts: number, aStartHour = 6): string {
  return ymd(new Date(mineDayStart(ts, aStartHour)));
}

/** Timestamp of shift-A start on the given mine day. */
export function mineDayToTs(day: string, aStartHour = 6): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, aStartHour, 0, 0, 0).getTime();
}

export function shiftOf(ts: number, aStartHour = 6): ShiftInfo {
  const dayStart = mineDayStart(ts, aStartHour);
  // Local-day arithmetic so a daylight-saving change does not shift the boundaries.
  const base = new Date(dayStart);
  const bounds = [0, 8, 16, 24].map((h) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate(), aStartHour + h, 0, 0, 0).getTime());
  let i = 0;
  while (i < 2 && ts >= bounds[i + 1]) i++;
  return { code: SHIFTS[i], mineDay: ymd(new Date(dayStart)), start: bounds[i], end: bounds[i + 1] };
}

export function shiftWindow(day: string, code: ShiftCode, aStartHour = 6): { start: number; end: number } {
  const start = mineDayToTs(day, aStartHour);
  const i = SHIFTS.indexOf(code);
  const base = new Date(start);
  return {
    start: new Date(base.getFullYear(), base.getMonth(), base.getDate(), aStartHour + i * 8, 0, 0, 0).getTime(),
    end: new Date(base.getFullYear(), base.getMonth(), base.getDate(), aStartHour + (i + 1) * 8, 0, 0, 0).getTime(),
  };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}
