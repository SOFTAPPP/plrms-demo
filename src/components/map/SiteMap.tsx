// Live mine map: static site layer + moving machine markers, with pan/zoom, layers and a details card.
import { useUnits } from '../../lib/units';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, Layers, Maximize2, Minus, Plus, Route as RouteIcon, X } from 'lucide-react';
import { BENCH_COUNT, EDGES, NODE_BY_ID, NODES, SITE_SIZE, ZONES, benchOutline } from '../../../shared/site';
import type { MachineLive, MachineStatus, MachineType } from '../../../shared/types';
import { STATUS_LABEL, TYPE_LABEL } from '../../../shared/types';
import { useLive } from '../../lib/live';
import { usePalette, type Palette } from '../../lib/palette';
import { useElementSize } from '../../lib/hooks';
import { num } from '../../lib/format';
import { MachineGlyph } from '../machine/glyphs';
import { Button, cn, StatusPill } from '../ui/core';
import { Popover } from '../ui/overlay';
import { Checkbox } from '../ui/form';
import { SATELLITE_CREDIT, SatelliteLayer, useSatelliteState } from './Satellite';

interface View { x: number; y: number; w: number; h: number }

const FULL: View = { x: 950, y: 640, w: 2500, h: 2380 };

const StaticLayer = memo(function StaticLayer({ p, labels, roads, satellite }: { p: Palette; labels: boolean; roads: boolean; satellite: boolean }) {
  const benches = useMemo(() => Array.from({ length: BENCH_COUNT }, (_, k) => benchOutline(k)), []);
  const zoneFill: Record<string, string> = {
    pit: 'transparent', dump: p.map.dump, crusher: p.map.zone, rom: p.map.zone, stockpile: p.map.dump, fuel: p.map.zone, water: p.map.water,
    workshop: p.map.zone, parking: p.map.zone, drill: 'transparent',
  };
  const labelFill = satellite ? '#ffffff' : p.muted;
  const labelStroke = satellite ? 'rgba(0,0,0,0.75)' : 'none';
  if (satellite) {
    return (
      <g>
        {ZONES.filter((z) => z.kind === 'drill').map((z) => (
          <polygon key={z.id} points={z.points.map((q) => q.join(',')).join(' ')} fill="none" stroke="#f5a524" strokeOpacity="0.85" strokeDasharray="10 8" strokeWidth="2.5" />
        ))}
        {roads && EDGES.map((e) => {
          const a = NODE_BY_ID[e.a];
          const b = NODE_BY_ID[e.b];
          return <line key={`${e.a}-${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd166" strokeOpacity="0.55" strokeWidth="3" strokeDasharray="14 10" strokeLinecap="round" />;
        })}
        {NODES.filter((n) => n.kind === 'face').map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r="34" fill={n.material === 'ore' ? '#f5a524' : '#ffffff'} fillOpacity="0.16"
            stroke={n.material === 'ore' ? '#f5a524' : '#ffffff'} strokeOpacity="0.85" strokeDasharray="6 6" strokeWidth="2" />
        ))}
        {labels && ZONES.filter((z) => z.kind !== 'pit').map((z) => (
          <text key={z.id} x={z.label[0]} y={z.label[1]} textAnchor="middle" fill={labelFill} stroke={labelStroke} strokeWidth="6" paintOrder="stroke"
            style={{ font: '600 24px var(--font-display)', letterSpacing: 2, textTransform: 'uppercase' }}>{z.name}</text>
        ))}
        {labels && NODES.filter((n) => n.kind === 'face').map((n) => (
          <text key={n.id} x={n.x} y={n.y - 46} textAnchor="middle" fill={n.material === 'ore' ? '#ffc35a' : '#ffffff'} stroke={labelStroke} strokeWidth="6" paintOrder="stroke"
            style={{ font: '600 22px var(--font-mono)' }}>{n.id.replace('F-', 'FACE ')} · {n.material === 'ore' ? 'ORE' : 'WASTE'}</text>
        ))}
      </g>
    );
  }
  return (
    <g>
      <rect x={-1000} y={-1000} width={SITE_SIZE.w + 2000} height={SITE_SIZE.h + 2000} fill={p.map.ground} />
      <pattern id="ground-noise" width="80" height="80" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="18" r="1.4" fill={p.map.benchLine} />
        <circle cx="54" cy="44" r="1" fill={p.map.benchLine} />
        <circle cx="30" cy="66" r="1.2" fill={p.map.benchLine} />
      </pattern>
      <rect x={-1000} y={-1000} width={SITE_SIZE.w + 2000} height={SITE_SIZE.h + 2000} fill="url(#ground-noise)" opacity="0.6" />
      {benches.map((pts, k) => (
        <polygon key={k} points={pts.map((q) => q.join(',')).join(' ')} fill={k % 2 ? p.map.groundAlt : p.map.bench}
          stroke={p.map.benchLine} strokeWidth={k === 0 ? 3 : 1.6} />
      ))}
      {ZONES.filter((z) => z.kind !== 'pit').map((z) => (
        <polygon key={z.id} points={z.points.map((q) => q.join(',')).join(' ')} fill={zoneFill[z.kind]}
          stroke={z.kind === 'drill' ? p.accent : p.lineStrong} strokeOpacity={z.kind === 'drill' ? 0.45 : 1} strokeDasharray={z.kind === 'drill' ? '10 8' : undefined} strokeWidth="2" />
      ))}
      {roads && EDGES.map((e) => {
        const a = NODE_BY_ID[e.a];
        const b = NODE_BY_ID[e.b];
        return <line key={`${e.a}-${e.b}-o`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.map.roadEdge} strokeWidth={e.limit >= 40 ? 34 : 26} strokeLinecap="round" />;
      })}
      {roads && EDGES.map((e) => {
        const a = NODE_BY_ID[e.a];
        const b = NODE_BY_ID[e.b];
        return <line key={`${e.a}-${e.b}-i`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.map.road} strokeWidth={e.limit >= 40 ? 26 : 19} strokeLinecap="round" />;
      })}
      {roads && EDGES.map((e) => {
        const a = NODE_BY_ID[e.a];
        const b = NODE_BY_ID[e.b];
        return <line key={`${e.a}-${e.b}-c`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.fg} strokeOpacity="0.12" strokeWidth="1.5" strokeDasharray="18 22" />;
      })}
      {NODES.filter((n) => n.kind === 'face').map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <circle r="34" fill={n.material === 'ore' ? p.accent : p.muted} fillOpacity="0.1" stroke={n.material === 'ore' ? p.accent : p.muted} strokeOpacity="0.45" strokeDasharray="6 6" strokeWidth="2" />
        </g>
      ))}
      {labels && ZONES.map((z) => (
        <text key={z.id} x={z.label[0]} y={z.label[1]} textAnchor="middle" fill={p.muted} style={{ font: '600 30px var(--font-display)', letterSpacing: 2, textTransform: 'uppercase' }}>{z.name}</text>
      ))}
      {labels && NODES.filter((n) => n.kind === 'face').map((n) => (
        <text key={n.id} x={n.x} y={n.y - 46} textAnchor="middle" fill={n.material === 'ore' ? p.accent : p.muted} style={{ font: '600 24px var(--font-mono)' }}>
          {n.id.replace('F-', 'FACE ')} · {n.material === 'ore' ? 'ORE' : 'WASTE'}
        </text>
      ))}
    </g>
  );
});

interface Props {
  className?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  focusId?: string | null;
  compact?: boolean;
  showLegend?: boolean;
  typeFilter?: MachineType[];
  statusFilter?: MachineStatus[];
}

export function SiteMap({ className, selectedId: selProp, onSelect, focusId, compact, showLegend = true, typeFilter, statusFilter }: Props) {
  const p = usePalette();
  const U = useUnits();
  const machines = useLive((s) => s.machines);
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [view, setView] = useState<View>(FULL);
  const [selInternal, setSelInternal] = useState<string | null>(null);
  const selected = selProp !== undefined ? selProp : selInternal;
  const setSelected = useCallback((id: string | null) => { onSelect ? onSelect(id) : setSelInternal(id); }, [onSelect]);
  const [layers, setLayers] = useState({ labels: true, roads: true, trails: !compact, ids: !compact, satellite: true });
  const satState = useSatelliteState();
  const satOn = layers.satellite && satState === 'online';
  const [follow, setFollow] = useState(false);
  const trails = useRef(new Map<string, [number, number][]>());
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);

  // fit the view to the container aspect ratio
  const fitted = useMemo(() => {
    if (!size.w || !size.h) return view;
    const ar = size.w / size.h;
    let { x, y, w, h } = view;
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    return { x, y, w, h };
  }, [view, size.w, size.h]);

  // record trails
  useEffect(() => {
    for (const m of Object.values(machines)) {
      const t = trails.current.get(m.id) ?? [];
      const last = t[t.length - 1];
      if (!last || Math.hypot(last[0] - m.x, last[1] - m.y) > 6) {
        t.push([m.x, m.y]);
        if (t.length > 50) t.shift();
        trails.current.set(m.id, t);
      }
    }
  }, [machines]);

  // focus a machine when asked
  useEffect(() => {
    if (!focusId) return;
    const m = useLive.getState().machines[focusId];
    if (m) setView({ x: m.x - 450, y: m.y - 300, w: 900, h: 600 });
  }, [focusId]);

  const followTarget = follow && selected ? machines[selected] : undefined;
  useEffect(() => {
    if (!followTarget) return;
    setView((v) => ({ ...v, x: followTarget.x - v.w / 2, y: followTarget.y - v.h / 2 }));
  }, [followTarget]);

  const scale = size.w ? fitted.w / size.w : 4;
  const markerScale = Math.max(0.9, Math.min(5.5, scale * (compact ? 0.95 : 1.15)));

  const zoom = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const nw = Math.max(260, Math.min(FULL.w * 1.6, v.w * factor));
      const nh = (nw / v.w) * v.h;
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) / v.w) * nw, y: py - ((py - v.y) / v.h) * nh, w: nw, h: nh };
    });
  };

  const toWorld = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: fitted.x + ((clientX - r.left) / r.width) * fitted.w, y: fitted.y + ((clientY - r.top) / r.height) * fitted.h };
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, w.x, w.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const visible = Object.values(machines).filter((m) => (!typeFilter?.length || typeFilter.includes(m.type)) && (!statusFilter?.length || statusFilter.includes(m.st)));
  const sel = selected ? machines[selected] : undefined;
  const selScreen = sel && size.w ? { x: ((sel.x - fitted.x) / fitted.w) * size.w, y: ((sel.y - fitted.y) / fitted.h) * size.h } : null;

  return (
    <div ref={boxRef} className={cn('relative h-full w-full touch-none select-none overflow-hidden rounded-[inherit]', className)}
      onPointerDown={(e) => {
        // events from pop-ups (rendered in a portal) and from map controls must not start a drag
        if (!e.currentTarget.contains(e.target as Node) || (e.target as Element).closest('[data-ui]')) return;
        drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !size.w) return;
        const dx = ((e.clientX - d.x) / size.w) * fitted.w;
        const dy = ((e.clientY - d.y) / size.h) * fitted.h;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) { d.moved = true; setFollow(false); }
        setView({ ...d.v, x: d.v.x - dx, y: d.v.y - dy });
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && !(e.target as Element).closest('[data-marker]')) setSelected(null);
      }}>
      <svg viewBox={`${fitted.x} ${fitted.y} ${fitted.w} ${fitted.h}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Live mine site map">
        {satOn && <rect x={-2000} y={-2000} width={SITE_SIZE.w + 4000} height={SITE_SIZE.h + 4000} fill="#20251d" />}
        {satOn && <SatelliteLayer view={fitted} mppScreen={scale} />}
        <StaticLayer p={p} labels={layers.labels && scale < 6} roads={layers.roads} satellite={satOn} />
        {layers.trails && visible.map((m) => {
          const t = trails.current.get(m.id);
          if (!t || t.length < 2 || (m.type !== 'truck' && m.type !== 'water' && m.type !== 'lv')) return null;
          return <polyline key={`t-${m.id}`} points={t.map((q) => q.join(',')).join(' ')} fill="none" stroke={p.status[m.st]} strokeOpacity="0.35" strokeWidth={2.2 * markerScale * 0.6} strokeLinecap="round" />;
        })}
        {visible.map((m) => (
          <Marker key={m.id} m={m} p={p} s={markerScale} selected={m.id === selected} showId={layers.ids} onClick={() => setSelected(m.id === selected ? null : m.id)} />
        ))}
      </svg>

      {!compact && (
        <div data-ui className="absolute right-3 top-3 flex flex-col gap-1.5">
          <Button size="icon" variant="secondary" aria-label="Zoom in" onClick={() => zoom(1 / 1.4)}><Plus className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" aria-label="Zoom out" onClick={() => zoom(1.4)}><Minus className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" aria-label="Fit to site" onClick={() => { setView(FULL); setFollow(false); }}><Maximize2 className="h-4 w-4" /></Button>
          <Popover align="end" className="w-52 p-3" trigger={<Button size="icon" variant="secondary" aria-label="Map layers"><Layers className="h-4 w-4" /></Button>}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Layers</p>
            <div className="flex flex-col gap-2">
              <Checkbox label="Satellite imagery" checked={layers.satellite} onChange={(v) => setLayers({ ...layers, satellite: v })} />
              {layers.satellite && satState !== 'online' && <p className="-mt-1 text-[11px] text-warn">{satState === 'checking' ? 'Connecting…' : 'Offline: showing site plan'}</p>}
              <Checkbox label="Area labels" checked={layers.labels} onChange={(v) => setLayers({ ...layers, labels: v })} />
              <Checkbox label="Haul roads" checked={layers.roads} onChange={(v) => setLayers({ ...layers, roads: v })} />
              <Checkbox label="Vehicle trails" checked={layers.trails} onChange={(v) => setLayers({ ...layers, trails: v })} />
              <Checkbox label="Machine IDs" checked={layers.ids} onChange={(v) => setLayers({ ...layers, ids: v })} />
            </div>
          </Popover>
        </div>
      )}
      {compact && (
        <div data-ui className="absolute right-2 top-2 flex gap-1">
          <Button size="icon-sm" variant="secondary" aria-label="Zoom in" onClick={() => zoom(1 / 1.4)}><Plus className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="secondary" aria-label="Zoom out" onClick={() => zoom(1.4)}><Minus className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="secondary" aria-label="Fit" onClick={() => setView(FULL)}><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      )}

      {satOn && <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-white/70 [text-shadow:0_1px_2px_#000]">{SATELLITE_CREDIT}</div>}
      {layers.satellite && satState === 'offline' && !compact && (
        <div data-ui className="absolute left-3 top-3 rounded-lg border border-warn/30 bg-panel/90 px-2.5 py-1.5 text-[11px] text-warn backdrop-blur">No internet: satellite imagery unavailable, showing the site plan</div>
      )}
      {showLegend && (
        <div data-ui className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-panel/85 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
          {(['running', 'loading', 'hauling', 'idle', 'breakdown', 'maintenance'] as MachineStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.status[s] }} />{STATUS_LABEL[s]}</span>
          ))}
        </div>
      )}

      {sel && selScreen && (
        <div data-ui className="absolute z-10 w-64 rounded-xl border border-line-strong bg-elev/95 p-3 shadow-2xl backdrop-blur"
          style={{ left: Math.min(Math.max(8, selScreen.x + 18), size.w - 264), top: Math.min(Math.max(8, selScreen.y - 40), size.h - 200) }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold">{sel.id}</p>
              <p className="truncate text-xs text-muted">{TYPE_LABEL[sel.type]} · {sel.zone}</p>
            </div>
            <button aria-label="Close" className="text-muted hover:text-fg" onClick={() => setSelected(null)}><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 flex items-center gap-2"><StatusPill status={sel.st} /><span className="truncate text-xs text-muted">{sel.act}</span></div>
          <dl className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-faint">Speed</dt><dd className="tnum font-medium">{U.speed(sel.spd)}</dd></div>
            <div><dt className="text-faint">Fuel</dt><dd className="tnum font-medium">{num(sel.s.fuel_level)}%</dd></div>
            {sel.type === 'truck' ? <div><dt className="text-faint">Payload</dt><dd className="tnum font-medium">{U.mass(sel.s.payload)}</dd></div>
              : <div><dt className="text-faint">Eng. temp</dt><dd className="tnum font-medium">{U.temp(sel.s.engine_temp)}</dd></div>}
          </dl>
          <p className="mt-2 truncate text-xs text-muted">Operator: <span className="text-fg">{sel.op || 'Unassigned'}</span></p>
          <div className="mt-3 flex gap-1.5">
            <Link to={`/fleet/${sel.id}`} className="flex-1"><Button size="xs" variant="primary" className="w-full justify-center">Details</Button></Link>
            <Link to={`/cameras?machine=${sel.id}`}><Button size="xs">Cameras</Button></Link>
            <Button size="xs" variant={follow ? 'primary' : 'secondary'} aria-label="Follow" onClick={() => setFollow(!follow)} icon={<Crosshair className="h-3 w-3" />} />
          </div>
          {sel.route && <p className="mt-2 flex items-center gap-1 text-[11px] text-faint"><RouteIcon className="h-3 w-3" /> {sel.route} · loader {sel.loader}</p>}
        </div>
      )}
    </div>
  );
}

const Marker = memo(function Marker({ m, p, s, selected, showId, onClick }: { m: MachineLive; p: Palette; s: number; selected: boolean; showId: boolean; onClick: () => void }) {
  const color = p.status[m.st];
  return (
    <g data-marker className="marker cursor-pointer" style={{ transform: `translate(${m.x}px, ${m.y}px)` }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <g transform={`scale(${s})`}>
        {selected && <circle r="20" fill="none" stroke={p.accent} strokeWidth="2.5" />}
        {selected && <circle r="20" fill={p.accent} opacity="0.25" className="pulse-ring" />}
        {(m.st === 'breakdown' || m.al > 0) && <circle r="16" fill={m.st === 'breakdown' ? p.crit : p.warn} opacity="0.18" className="pulse-ring" />}
        <g transform={`rotate(${m.h})`}>
          <MachineGlyph type={m.type} fill={color} stroke={p.bg} swing={m.s.swing_angle ?? 0} />
        </g>
        {m.al > 0 && <circle cx="10" cy="-10" r="4.2" fill={p.crit} stroke={p.bg} strokeWidth="1.5" />}
        {showId && (
          <text y="24" textAnchor="middle" fill={p.fg} stroke={p.bg} strokeWidth="3" paintOrder="stroke" style={{ font: '600 9.5px var(--font-mono)' }}>{m.id}</text>
        )}
      </g>
      <title>{`${m.id} · ${STATUS_LABEL[m.st]} · ${m.act}`}</title>
    </g>
  );
});
