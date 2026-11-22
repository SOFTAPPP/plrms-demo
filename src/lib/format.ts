import { convert, type Dimension, type UnitPrefs } from '../../shared/sensors';

const nf = new Map<string, Intl.NumberFormat>();
function fmt(d: number, compact = false) {
  const k = `${d}|${compact}`;
  let f = nf.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', compact
      ? { notation: 'compact', maximumFractionDigits: d }
      : { minimumFractionDigits: d, maximumFractionDigits: d });
    nf.set(k, f);
  }
  return f;
}

export function num(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return fmt(d).format(v);
}

export function compact(v: number | null | undefined, d = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (Math.abs(v) < 1000) return fmt(0).format(v);
  return fmt(d, true).format(v);
}

export function tonnes(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) >= 100000) return `${fmt(1).format(v / 1000)} kt`;
  return `${fmt(0).format(v)} t`;
}

export function pct(v: number | null | undefined, d = 0): string {
  return v === null || v === undefined ? '—' : `${num(v, d)}%`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function time(ts: number, seconds = false): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function date(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function dateTime(ts: number, seconds = false): string {
  return `${date(ts)}, ${time(ts, seconds)}`;
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function ago(ts: number, now: number): string {
  const d = now - ts;
  if (d < 45_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}

/** Local datetime-input value for a timestamp. */
export function toInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sensorText(v: number | undefined, dim: Dimension, units: UnitPrefs, decimals: number): { value: string; unit: string } {
  if (v === undefined || Number.isNaN(v)) return { value: '—', unit: '' };
  const [cv, u] = convert(v, dim, units);
  return { value: num(cv, decimals), unit: u };
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function titleCase(s: string): string {
  return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
