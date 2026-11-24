import { memo, useId, type ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './core';
import type { SensorState } from '../../../shared/sensors';

export const STATE_COLOR: Record<SensorState, string> = { normal: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' };

export const Sparkline = memo(function Sparkline({ values, color = 'var(--accent)', height = 32, className, fill = true, min, max }: {
  values: number[]; color?: string; height?: number; className?: string; fill?: boolean; min?: number; max?: number;
}) {
  const id = useId();
  const W = 120;
  if (values.length < 2) return <div className={className} style={{ height }} />;
  let lo = min ?? Math.min(...values);
  let hi = max ?? Math.max(...values);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - 2 - ((v - lo) / (hi - lo)) * (height - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={cn('w-full', className)} style={{ height }} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${W},${height}L0,${height}Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
});

/** 240° radial gauge with warning and critical bands. */
export const Gauge = memo(function Gauge({ value, min, max, warn, crit, dir, label, display, unit, size = 132 }: {
  value: number | undefined; min: number; max: number; warn?: number | null; crit?: number | null; dir: 'high' | 'low' | 'none';
  label: string; display: string; unit: string; size?: number;
}) {
  const r = 52;
  const cx = 64;
  const cy = 64;
  const start = 150;
  const sweep = 240;
  const toA = (v: number) => start + (Math.min(max, Math.max(min, v)) - min) / (max - min || 1) * sweep;
  const pt = (a: number, rr = r) => [cx + rr * Math.cos((a * Math.PI) / 180), cy + rr * Math.sin((a * Math.PI) / 180)];
  const arc = (a0: number, a1: number, rr = r) => {
    const [x0, y0] = pt(a0, rr);
    const [x1, y1] = pt(a1, rr);
    return `M${x0},${y0} A${rr},${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  let state: 'normal' | 'warning' | 'critical' = 'normal';
  if (value !== undefined && dir !== 'none') {
    if (dir === 'high') state = crit != null && value >= crit ? 'critical' : warn != null && value >= warn ? 'warning' : 'normal';
    else state = crit != null && value <= crit ? 'critical' : warn != null && value <= warn ? 'warning' : 'normal';
  }
  const bands: ReactNode[] = [];
  if (dir === 'high') {
    if (warn != null) bands.push(<path key="w" d={arc(toA(warn), toA(crit ?? max))} stroke="var(--warn)" strokeOpacity="0.55" strokeWidth="3" fill="none" />);
    if (crit != null) bands.push(<path key="c" d={arc(toA(crit), toA(max))} stroke="var(--crit)" strokeOpacity="0.7" strokeWidth="3" fill="none" />);
  } else if (dir === 'low') {
    if (warn != null) bands.push(<path key="w" d={arc(toA(crit ?? min), toA(warn))} stroke="var(--warn)" strokeOpacity="0.55" strokeWidth="3" fill="none" />);
    if (crit != null) bands.push(<path key="c" d={arc(toA(min), toA(crit))} stroke="var(--crit)" strokeOpacity="0.7" strokeWidth="3" fill="none" />);
  }
  const color = STATE_COLOR[state];
  const a = value === undefined ? start : toA(value);
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 128 112" style={{ width: size, height: size * 0.875 }} role="img" aria-label={`${label} ${display} ${unit}`}>
        <path d={arc(start, start + sweep)} stroke="var(--line-strong)" strokeWidth="9" fill="none" strokeLinecap="round" />
        {value !== undefined && a > start + 0.5 && <path d={arc(start, a)} stroke={color} strokeWidth="9" fill="none" strokeLinecap="round" style={{ transition: 'all 400ms ease' }} />}
        {bands}
        <text x="64" y="66" textAnchor="middle" className="tnum" style={{ font: '600 20px var(--font-display)', fill: 'var(--fg)' }}>{display}</text>
        <text x="64" y="82" textAnchor="middle" style={{ font: '500 10px var(--font-sans)', fill: 'var(--muted)' }}>{unit}</text>
      </svg>
      <p className="-mt-2 max-w-full truncate text-center text-xs font-medium text-muted">{label}</p>
    </div>
  );
});

export function Meter({ value, max, warnAt, color, className, height = 7 }: { value: number; max: number; warnAt?: number; color?: string; className?: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={cn('relative w-full overflow-hidden rounded-full bg-fg/[0.08]', className)} style={{ height }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color ?? 'var(--accent)' }}
      />
      {warnAt !== undefined && (
        <div
          className="absolute top-0 h-full w-px bg-fg/40"
          style={{ left: `${(warnAt / max) * 100}%` }}
        />
      )}
    </div>
  );
}

export function Delta({ value, suffix = '%', invert }: { value: number; suffix?: string; invert?: boolean }) {
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn('tnum inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-ok' : 'text-crit')}>
      <Icon className="h-3 w-3" />
      {value > 0 ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

export function Ring({ value, size = 44, stroke = 5, color = 'var(--accent)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line-strong)" strokeWidth={stroke} fill="none" opacity={0.35} />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
