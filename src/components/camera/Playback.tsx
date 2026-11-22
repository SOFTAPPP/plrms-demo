// Recorded-video player: rebuilds footage for any past moment from stored telemetry and plays it like a DVR.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Camera, ChevronLeft, ChevronRight, Circle, Grid2x2, Pause, Play, RectangleHorizontal, SkipBack, SkipForward, Square,
} from 'lucide-react';
import type { AlertRow, CameraPosition, MachineStatus } from '../../../shared/types';
import { CAMERA_LABEL, STATUS_LABEL, can } from '../../../shared/types';
import { mineDayOf, mineDayToTs, DAY, HOUR, MIN } from '../../../shared/time';
import { get, qs } from '../../lib/api';
import { useApp, useBoot } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { usePalette } from '../../lib/palette';
import type { TelemetryPoint } from '../../lib/types';
import { dateTime, time, toDateInput, dayLabel } from '../../lib/format';
import { attachCamera, recordCanvas, type CameraHandle } from './engine';
import type { CamState, NearbyObject } from './render';
import { nearbyOf } from './liveState';
import { saveSnapshot, storeRecording } from './CameraTile';
import { Badge, Button, cn, Spinner } from '../ui/core';
import { Input, Segmented, Select } from '../ui/form';
import { Tip } from '../ui/overlay';

interface Props {
  machineId: string;
  position?: CameraPosition;
  at?: number;
  onMachineChange?: (id: string) => void;
}

const RATES = [1, 2, 4, 8, 16, 32];
const NUMERIC: (keyof TelemetryPoint)[] = ['x', 'y', 'spd', 'pay', 'fuel', 'swing', 'boom', 'b_fill', 'water', 'depth'];

function interpolate(rows: TelemetryPoint[], ts: number): { row: TelemetryPoint; gap: number } | null {
  if (!rows.length || ts < rows[0].ts - 15_000 || ts > rows[rows.length - 1].ts + 15_000) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].ts <= ts) lo = mid; else hi = mid - 1;
  }
  const a = rows[lo];
  const b = rows[Math.min(rows.length - 1, lo + 1)];
  const gap = b.ts - a.ts;
  if (ts < a.ts) return { row: a, gap: 0 };
  if (gap > 6 * MIN || b === a) return gap > 6 * MIN ? null : { row: a, gap };
  const f = (ts - a.ts) / gap;
  const row: TelemetryPoint = { ...a, ts };
  for (const k of NUMERIC) {
    const va = a[k] as number | null | undefined;
    const vb = b[k] as number | null | undefined;
    if (typeof va === 'number' && typeof vb === 'number') (row as unknown as Record<string, number>)[k] = va + (vb - va) * f;
  }
  if (typeof a.h === 'number' && typeof b.h === 'number') {
    const dh = ((b.h - a.h + 540) % 360) - 180;
    row.h = a.h + dh * f;
  }
  return { row, gap };
}

export function PlaybackPlayer({ machineId, position: initialPos, at, onMachineChange }: Props) {
  const boot = useBoot();
  const p = usePalette();
  const role = useApp((s) => s.boot?.user.role);
  const simNow = useLive((s) => s.t);
  const meta = boot.machines.find((m) => m.id === machineId);
  const cams = useMemo(() => boot.cameras.filter((c) => c.machineId === machineId), [boot.cameras, machineId]);
  const [position, setPosition] = useState<CameraPosition>(initialPos && cams.some((c) => c.position === initialPos) ? initialPos : cams[0]?.position ?? 'front');
  const [layout, setLayout] = useState<'single' | 'quad'>('single');
  const startTs = at ?? simNow - 20 * MIN;
  const [cursor, setCursor] = useState(startTs);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState<'day' | '2h' | '20m'>('day');
  const clock = useRef({ base: startTs, at: performance.now(), playing: false, rate: 1 });
  const rowsRef = useRef<TelemetryPoint[]>([]);
  const windowRef = useRef<{ from: number; to: number } | null>(null);
  const nearbyRef = useRef<{ ts: number; list: NearbyObject[] }>({ ts: 0, list: [] });
  const [loadingWin, setLoadingWin] = useState(false);
  const [dayRows, setDayRows] = useState<{ ts: number; st: string }[]>([]);
  const [events, setEvents] = useState<AlertRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<{ stop: () => Promise<Blob | null>; start: number } | null>(null);

  const day = mineDayOf(cursor, boot.settings.shifts.aStartHour);
  const dayStart = mineDayToTs(day, boot.settings.shifts.aStartHour);
  const dayEnd = dayStart + DAY;

  useEffect(() => {
    if (!cams.some((c) => c.position === position) && cams[0]) setPosition(cams[0].position);
  }, [cams, position]);

  const now = useCallback(() => {
    const c = clock.current;
    return c.playing ? c.base + (performance.now() - c.at) * c.rate : c.base;
  }, []);

  const seek = useCallback((ts: number) => {
    const max = useLive.getState().t;
    const v = Math.min(max, ts);
    clock.current = { ...clock.current, base: v, at: performance.now() };
    setCursor(v);
  }, []);

  useEffect(() => {
    if (at) seek(at);
  }, [at, seek]);

  // day timeline data and alert markers
  useEffect(() => {
    const ctrl = new AbortController();
    setDayRows([]);
    get<{ rows: { ts: number; st: string }[] }>(`/telemetry/${machineId}${qs({ from: dayStart, to: dayEnd, fields: 'st', max: 1440 })}`, ctrl.signal)
      .then((r) => setDayRows(r.rows)).catch(() => {});
    get<{ rows: AlertRow[] }>(`/alerts${qs({ status: 'all', machineId, from: dayStart, to: dayEnd, limit: 400 })}`, ctrl.signal)
      .then((r) => setEvents(r.rows.filter((a) => a.ts >= dayStart && a.ts < dayEnd).sort((a, b) => a.ts - b.ts))).catch(() => {});
    return () => ctrl.abort();
  }, [machineId, dayStart, dayEnd]);

  // detailed window around the playhead
  const ensureWindow = useCallback(async (ts: number) => {
    const w = windowRef.current;
    if (w && ts > w.from + 5 * MIN && ts < w.to - 5 * MIN) return;
    const from = ts - 20 * MIN;
    const to = ts + 40 * MIN;
    windowRef.current = { from, to };
    setLoadingWin(true);
    try {
      const r = await get<{ rows: TelemetryPoint[] }>(`/telemetry/${machineId}${qs({ from, to, max: 4000 })}`);
      if (windowRef.current?.from === from) rowsRef.current = r.rows;
    } catch {
      /* the player shows "no recording" */
    } finally {
      setLoadingWin(false);
    }
  }, [machineId]);

  useEffect(() => {
    windowRef.current = null;
    rowsRef.current = [];
    void ensureWindow(now());
  }, [machineId, ensureWindow, now]);

  // UI tick: playhead, window loading, nearby machines, end of data
  useEffect(() => {
    const id = setInterval(() => {
      let ts = now();
      const liveT = useLive.getState().t;
      if (ts >= liveT - 2000 && clock.current.playing) {
        clock.current = { ...clock.current, base: liveT - 2000, at: performance.now(), playing: false };
        setPlaying(false);
        ts = liveT - 2000;
        toast('Reached the live edge', { description: 'Switch to Live view to keep watching.' });
      }
      setCursor(ts);
      void ensureWindow(ts);
      if (Math.abs(ts - nearbyRef.current.ts) > 8000) {
        nearbyRef.current.ts = ts;
        get<{ id: string; x: number; y: number; h: number }[]>(`/telemetry-at${qs({ ts: Math.round(ts) })}`).then((rows) => {
          const me = rows.find((r) => r.id === machineId);
          if (!me) return;
          const typed = rows.map((r) => ({ ...r, type: boot.machines.find((m) => m.id === r.id)?.type ?? 'truck' }));
          nearbyRef.current.list = nearbyOf({ ...me, id: machineId }, typed, 90);
        }).catch(() => {});
      }
    }, 200);
    return () => clearInterval(id);
  }, [now, ensureWindow, machineId, boot.machines]);

  const stateFor = useCallback((pos: CameraPosition): CamState | null => {
    if (!meta) return null;
    const ts = now();
    const hit = interpolate(rowsRef.current, ts);
    const label = `${machineId} ${CAMERA_LABEL[pos].toUpperCase()}`;
    const base: CamState = {
      machineId, type: meta.type, position: pos, label, t: ts, speed: 0, status: 'offline', act: '', payloadPct: 0, payloadT: 0,
      bucketFill: 0, swing: 0, boom: 25, water: 0, depth: 0, dms: 0, offline: true, operator: '', recording: exportRef.current !== null,
      mode: 'PLAYBACK', quality: 'NO REC', nearby: [], turn: 0, reversing: false, dumping: false, loading: false,
    };
    const cam = cams.find((c) => c.position === pos);
    if (cam && !cam.enabled) return { ...base, notice: 'CAMERA DISABLED' };
    if (cam && !cam.recording) return { ...base, notice: 'RECORDING OFF', quality: 'REC OFF' };
    if (!hit) return { ...base, notice: 'NO RECORDING' };
    const r = hit.row;
    const act = r.act ?? '';
    const cap = meta.capacity || 1;
    const isTruck = meta.type === 'truck';
    const cycle = (ts / 1000) % 30;
    const digging = (r.st === 'loading') && !isTruck;
    return {
      ...base, offline: r.st === 'offline', status: (r.st as MachineStatus) ?? 'idle', act, speed: r.spd ?? 0,
      payloadPct: isTruck ? (r.pay ?? 0) / cap : 0, payloadT: isTruck ? r.pay ?? 0 : ((r.b_fill ?? 0) / 100) * cap,
      bucketFill: digging && hit.gap > 15_000 ? Math.max(0, Math.sin((cycle / 30) * Math.PI) * 95) : r.b_fill ?? 0,
      swing: digging && hit.gap > 15_000 ? Math.max(0, Math.sin((cycle / 30) * Math.PI * 2)) * 90 : r.swing ?? 0,
      boom: r.boom ?? 25, water: r.water ?? 0, depth: r.depth ?? 0,
      quality: hit.gap <= 12_000 ? 'HD' : hit.gap <= 70_000 ? 'SD' : 'ARCHIVE',
      nearby: nearbyRef.current.list, reversing: act.startsWith('Spotting'), dumping: act.startsWith('Tipping'), loading: r.st === 'loading',
    };
  }, [meta, machineId, now, cams]);

  const positions: CameraPosition[] = layout === 'quad' ? cams.slice(0, 4).map((c) => c.position) : [position];

  const play = (v: boolean) => {
    clock.current = { ...clock.current, base: now(), at: performance.now(), playing: v };
    setPlaying(v);
  };
  const changeRate = (r: number) => {
    clock.current = { ...clock.current, base: now(), at: performance.now(), rate: r };
    setRate(r);
  };
  const step = (ms: number) => seek(now() + ms);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); play(!clock.current.playing); }
      else if (e.key === 'ArrowRight') step(e.shiftKey ? 60_000 : 10_000);
      else if (e.key === 'ArrowLeft') step(e.shiftKey ? -60_000 : -10_000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nextEvent = (dir: 1 | -1) => {
    const t = now();
    const list = dir > 0 ? events.filter((e) => e.ts > t + 16_000) : events.filter((e) => e.ts < t - 16_000).reverse();
    if (list[0]) seek(list[0].ts - 15_000);
    else toast('No more events on this day');
  };

  const firstCanvas = useRef<HTMLCanvasElement | null>(null);
  const exportClip = async () => {
    if (exportRef.current) {
      const r = exportRef.current;
      exportRef.current = null;
      setExporting(false);
      const blob = await r.stop();
      if (blob) await storeRecording(blob, machineId, position, r.start, now(), 'playback');
      return;
    }
    if (!firstCanvas.current) return;
    const r = recordCanvas(firstCanvas.current, 20);
    if (!r) { toast.error('Recording is not supported in this browser'); return; }
    exportRef.current = { ...r, start: now() };
    setExporting(true);
    if (!clock.current.playing) play(true);
    toast('Exporting clip — press stop when done');
  };

  const win = zoom === 'day' ? { from: dayStart, to: dayEnd } : (() => {
    const span = zoom === '2h' ? 2 * HOUR : 20 * MIN;
    const from = Math.max(dayStart, Math.min(dayEnd - span, cursor - span / 2));
    return { from, to: from + span };
  })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {onMachineChange && (
          <Select aria-label="Machine" value={machineId} onChange={(e) => onMachineChange(e.target.value)} className="w-40">
            {boot.machines.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.model}</option>)}
          </Select>
        )}
        <Select aria-label="Camera" value={position} onChange={(e) => setPosition(e.target.value as CameraPosition)} className="w-32" disabled={layout === 'quad'}>
          {cams.map((c) => <option key={c.id} value={c.position}>{CAMERA_LABEL[c.position]}{!c.enabled ? ' (disabled)' : !c.recording ? ' (not recording)' : ''}</option>)}
        </Select>
        <Input type="date" aria-label="Date" value={toDateInput(cursor)} className="w-40"
          min={toDateInput(simNow - boot.sim.historyDays * DAY)} max={toDateInput(simNow)}
          onChange={(e) => {
            if (!e.target.value) return;
            const [y, m, d] = e.target.value.split('-').map(Number);
            const c = new Date(cursor);
            seek(new Date(y, m - 1, d, c.getHours(), c.getMinutes(), c.getSeconds()).getTime());
          }} />
        <Input type="time" aria-label="Time" step={1} value={time(cursor, true)} className="w-32"
          onChange={(e) => {
            const [hh, mm, ss] = e.target.value.split(':').map(Number);
            const c = new Date(cursor);
            seek(new Date(c.getFullYear(), c.getMonth(), c.getDate(), hh || 0, mm || 0, ss || 0).getTime());
          }} />
        <Segmented size="sm" value={layout} onChange={setLayout} options={[
          { value: 'single', label: <RectangleHorizontal className="h-3.5 w-3.5" />, title: 'Single camera' },
          { value: 'quad', label: <Grid2x2 className="h-3.5 w-3.5" />, title: 'Four cameras, synchronised' },
        ]} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          {loadingWin && <Spinner className="h-4 w-4" />}
          <span className="tnum">{dayLabel(day)} · {dateTime(cursor, true)}</span>
        </div>
      </div>

      <div className={cn('mx-auto grid w-full gap-2', layout === 'quad' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')} style={{ maxWidth: 'calc(56vh * 16 / 9)' }}>
        {positions.map((pos, i) => (
          <PlaybackCanvas key={`${machineId}-${pos}`} source={() => stateFor(pos)} big={layout === 'single'}
            canvasRef={i === 0 ? (el) => { firstCanvas.current = el; } : undefined} />
        ))}
      </div>

      <div className="panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Tip content="Previous event"><Button size="icon-sm" variant="ghost" aria-label="Previous event" onClick={() => nextEvent(-1)}><SkipBack className="h-4 w-4" /></Button></Tip>
          <Tip content="Back 10 s (←)"><Button size="icon-sm" variant="ghost" aria-label="Back 10 seconds" onClick={() => step(-10_000)}><ChevronLeft className="h-4 w-4" /></Button></Tip>
          <Button size="sm" variant="primary" onClick={() => play(!playing)} icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Tip content="Forward 10 s (→)"><Button size="icon-sm" variant="ghost" aria-label="Forward 10 seconds" onClick={() => step(10_000)}><ChevronRight className="h-4 w-4" /></Button></Tip>
          <Tip content="Next event"><Button size="icon-sm" variant="ghost" aria-label="Next event" onClick={() => nextEvent(1)}><SkipForward className="h-4 w-4" /></Button></Tip>
          <Segmented size="sm" value={rate} onChange={changeRate} options={RATES.map((r) => ({ value: r, label: `${r}×` }))} className="ml-1" />
          <div className="ml-auto flex items-center gap-1.5">
            <Segmented size="sm" value={zoom} onChange={setZoom} options={[{ value: 'day', label: '24 h' }, { value: '2h', label: '2 h' }, { value: '20m', label: '20 min' }]} />
            {can(role, 'operate') && (
              <>
                <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} onClick={() => firstCanvas.current && saveSnapshot(firstCanvas.current, machineId, position, now(), 'playback')}>Snapshot</Button>
                <Button size="sm" variant={exporting ? 'danger' : 'secondary'} onClick={exportClip}
                  icon={exporting ? <Square className="h-3 w-3 fill-current" /> : <Circle className="h-3 w-3 fill-red-500 text-red-500" />}>
                  {exporting ? 'Stop export' : 'Export clip'}
                </Button>
              </>
            )}
          </div>
        </div>
        <Timeline from={win.from} to={win.to} cursor={cursor} rows={dayRows} events={events} onSeek={seek} statusColor={p.status} dayStart={dayStart} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {(['running', 'loading', 'hauling', 'idle', 'breakdown', 'maintenance'] as MachineStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: p.status[s] }} />{STATUS_LABEL[s]}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-fg/10" />No recording</span>
          <span className="ml-auto">{events.length} event{events.length === 1 ? '' : 's'} on this day · Space play/pause · ←/→ step</span>
        </div>
        {events.length > 0 && (
          <div className="scroll-thin mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {events.map((e) => (
              <button key={e.id} type="button" onClick={() => seek(e.ts - 15_000)}
                className={cn('flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs hover:bg-fg/[0.05]', Math.abs(cursor - e.ts) < 30_000 ? 'border-accent/60 bg-accent/10' : 'border-line')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', e.severity === 'critical' ? 'bg-crit' : e.severity === 'warning' ? 'bg-warn' : 'bg-info')} />
                <span className="tnum text-muted">{time(e.ts)}</span>
                <span className="font-medium">{e.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaybackCanvas({ source, big, canvasRef }: { source: () => CamState | null; big: boolean; canvasRef?: (el: HTMLCanvasElement | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef(source);
  srcRef.current = source;
  const cbRef = useRef(canvasRef);
  cbRef.current = canvasRef;
  useEffect(() => {
    const h: CameraHandle = attachCamera(ref.current!, () => srcRef.current(), { fps: 20, maxW: big ? 1280 : 720 });
    cbRef.current?.(ref.current);
    return () => h.detach();
  }, [big]);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-black">
      <canvas ref={ref} className="block aspect-video w-full" aria-label="Recorded camera playback" />
    </div>
  );
}

function Timeline({ from, to, cursor, rows, events, onSeek, statusColor, dayStart }: {
  from: number; to: number; cursor: number; rows: { ts: number; st: string }[]; events: AlertRow[]; onSeek: (ts: number) => void;
  statusColor: Record<MachineStatus, string>; dayStart: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = to - from;
  const segs = useMemo(() => {
    const out: { a: number; b: number; st: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i].ts;
      const next = rows[i + 1]?.ts ?? a + 60_000;
      const b = next - a > 6 * MIN ? a + 60_000 : next;
      const last = out[out.length - 1];
      if (last && last.st === rows[i].st && Math.abs(last.b - a) < 1000) last.b = b;
      else out.push({ a, b, st: rows[i].st });
    }
    return out;
  }, [rows]);
  const x = (ts: number) => ((ts - from) / span) * 100;
  const ticks = useMemo(() => {
    const step = span > 6 * HOUR ? 2 * HOUR : span > HOUR ? 15 * MIN : 2 * MIN;
    const out: number[] = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
    return out;
  }, [from, to, span]);
  const seekAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek(from + ((clientX - r.left) / r.width) * span);
  };
  const drag = useRef(false);
  return (
    <div className="select-none">
      <div ref={ref} role="slider" aria-label="Playback position" aria-valuemin={from} aria-valuemax={to} aria-valuenow={Math.round(cursor)} tabIndex={0}
        className="relative h-14 cursor-pointer overflow-hidden rounded-lg border border-line bg-fg/[0.05]"
        onPointerDown={(e) => { drag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={(e) => { if (drag.current) seekAt(e.clientX); }}
        onPointerUp={() => { drag.current = false; }}>
        {[1, 2].map((k) => {
          const b = dayStart + k * 8 * HOUR;
          return b > from && b < to ? <div key={k} className="absolute inset-y-0 w-px bg-fg/25" style={{ left: `${x(b)}%` }} /> : null;
        })}
        {segs.filter((s) => s.b > from && s.a < to).map((s, i) => (
          <div key={i} className="absolute top-2 h-6 rounded-[2px]" style={{
            left: `${Math.max(0, x(s.a))}%`, width: `${Math.max(0.15, x(Math.min(s.b, to)) - Math.max(0, x(s.a)))}%`,
            background: statusColor[s.st as MachineStatus] ?? '#888', opacity: 0.85,
          }} />
        ))}
        {events.filter((e) => e.ts >= from && e.ts <= to).map((e) => (
          <button key={e.id} type="button" title={`${time(e.ts)} · ${e.title}`} aria-label={`${e.title} at ${time(e.ts)}`}
            onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onSeek(e.ts - 15_000)}
            className="absolute bottom-1 h-3.5 w-1.5 -translate-x-1/2 rounded-sm hover:scale-150"
            style={{ left: `${x(e.ts)}%`, background: e.severity === 'critical' ? 'var(--crit)' : e.severity === 'warning' ? 'var(--warn)' : 'var(--info)' }} />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent shadow-[0_0_10px_var(--accent)]" style={{ left: `${x(cursor)}%` }}>
          <div className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-accent" />
        </div>
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-faint">
        {ticks.map((t) => <span key={t} className="tnum absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>{time(t)}</span>)}
      </div>
    </div>
  );
}

export function QualityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Badge tone="ok">HD</Badge> last 2 h, full frame rate
      <Badge tone="info">SD</Badge> up to 48 h
      <Badge tone="neutral">ARCHIVE</Badge> older footage, 5-minute index
    </div>
  );
}
