// 360° views built from a machine's four surround cameras (front, right, rear, left):
//  - Panorama: the four feeds blended into one ring you can drag to look around
//  - Bird's-eye: the ground part of each feed warped into a top-down "around view"
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { CameraPosition, MachineType } from '../../../shared/types';
import { CAMERA_LABEL } from '../../../shared/types';
import { useLive } from '../../lib/live';
import { liveCamState, nearbyOf } from './liveState';
import { acquireFeed, clipFor, isNightTs, type ClipChoice, type Feed } from './footage';
import { irTint } from './render';
import { Button, cn } from '../ui/core';
import { Segmented } from '../ui/form';

const RING: { pos: CameraPosition; heading: number }[] = [
  { pos: 'front', heading: 0 },
  { pos: 'right', heading: 90 },
  { pos: 'rear', heading: 180 },
  { pos: 'left', heading: 270 },
];
/** horizontal field of view of each surround camera (overlap with neighbours is blended) */
const CAM_FOV = 110;
/** each camera owns 90° of the ring; the 10° beyond that on each side cross-fades with the neighbour */
const CORE = 45;
const BLEND_STRIPS = 5;

interface RingFeed { pos: CameraPosition; heading: number; feed: Feed; choice: ClipChoice | null; video: HTMLVideoElement | null }

/** Keeps the four surround feeds of a machine playing in step with its live state.
 *  The feeds are shared with the camera tiles on the same page, so each camera is decoded once. */
function useFeeds(machineId: string) {
  const feeds = useRef<RingFeed[]>([]);
  useEffect(() => {
    feeds.current = RING.map((r) => ({ ...r, feed: acquireFeed(`${machineId}:${r.pos}:LIVE`), choice: null, video: null }));
    return () => feeds.current.forEach((f) => f.feed.release());
  }, [machineId]);
  return () => {
    for (const f of feeds.current) {
      const st = liveCamState(machineId, f.pos, '', false);
      if (!st) { f.video = null; continue; }
      f.choice = clipFor(st.type, f.pos, machineId, st.t);
      f.video = f.feed.update(st, f.choice);
    }
    return feeds.current;
  };
}

/** Runs `draw` at up to `fps` while the canvas is on screen and the window is visible. */
function useCanvasLoop(ref: RefObject<HTMLCanvasElement | null>, fps: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number, dt: number) => void, deps: unknown[]) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
    io.observe(canvas);
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.visibilityState !== 'visible' || now - last < 1000 / fps - 2) return;
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const W = Math.round(canvas.clientWidth * dpr);
      const H = Math.round(canvas.clientHeight * dpr);
      if (!W || !H) return;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      drawRef.current(ctx, W, H, dt);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const wrap = (a: number) => ((a % 360) + 360) % 360;
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Draws the part of a camera between camera angles c0..c1 (degrees, -FOV/2..FOV/2) to screen x0..x1 in one call. */
function drawSpan(ctx: CanvasRenderingContext2D, f: RingFeed, c0: number, c1: number, x0: number, x1: number, H: number) {
  const v = f.video!;
  const vw = v.videoWidth || 640;
  const vh = v.videoHeight || 360;
  const u0 = (c0 + CAM_FOV / 2) / CAM_FOV;
  const u1 = (c1 + CAM_FOV / 2) / CAM_FOV;
  const dw = x1 - x0 + 0.75;
  if (f.choice?.flip) {
    ctx.save();
    ctx.translate(x0 + x1, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (1 - u1) * vw, 0, (u1 - u0) * vw, vh, x0, 0, dw, H);
    ctx.restore();
  } else ctx.drawImage(v, u0 * vw, 0, (u1 - u0) * vw, vh, x0, 0, dw, H);
}

/** Draws camera angles c0..c1 of a feed where they fall in the current view (handles wrap-around). */
function drawCamRange(ctx: CanvasRenderingContext2D, f: RingFeed, yaw: number, view: number, W: number, H: number, c0: number, c1: number) {
  const centre = angDiff(f.heading, yaw);
  for (const k of [-360, 0, 360]) {
    const a0 = Math.max(centre + k + c0, -view / 2);
    const a1 = Math.min(centre + k + c1, view / 2);
    if (a1 <= a0) continue;
    drawSpan(ctx, f, a0 - centre - k, a1 - centre - k, (a0 / view + 0.5) * W, (a1 / view + 0.5) * W, H);
  }
}

export function PanoramaView({ machineId, className, height = 520 }: { machineId: string; className?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(0);
  const [auto, setAuto] = useState(false);
  const [fov, setFov] = useState(100);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const fovRef = useRef(fov);
  fovRef.current = fov;
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const [heading, setHeading] = useState(0);
  const getFeeds = useFeeds(machineId);
  const getFeedsRef = useRef(getFeeds);
  getFeedsRef.current = getFeeds;

  const lastUi = useRef(0);
  useCanvasLoop(ref, 30, (ctx, W, H, dt) => {
    if (autoRef.current && !drag.current) yaw.current = wrap(yaw.current + dt * 12);
    const now = performance.now();
    if (now - lastUi.current > 150) { lastUi.current = now; setHeading(Math.round(yaw.current)); }
    const feeds = getFeedsRef.current();
    const live = useLive.getState();
    const m = live.machines[machineId];
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);
    if (!m) return;
    const night = isNightTs(live.t);
    const view = fovRef.current;
    const ready = feeds.filter((f) => f.video);
    // each camera's own 90°, then the overlaps cross-faded in a few strips
    for (const f of ready) drawCamRange(ctx, f, yaw.current, view, W, H, -CORE, CORE);
    const step = (CAM_FOV / 2 - CORE) / BLEND_STRIPS;
    for (const f of ready) {
      for (let i = 0; i < BLEND_STRIPS; i++) {
        ctx.globalAlpha = 0.5 * (1 - (i + 0.5) / BLEND_STRIPS);
        drawCamRange(ctx, f, yaw.current, view, W, H, CORE + i * step, CORE + (i + 1) * step);
        drawCamRange(ctx, f, yaw.current, view, W, H, -CORE - (i + 1) * step, -CORE - i * step);
      }
    }
    ctx.globalAlpha = 1;
    if (night) irTint(ctx, 0, 0, W, H);
    const fs = Math.max(11, W / 90);
    // compass strip with camera seams
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, fs * 2.6);
    ctx.font = `600 ${fs}px "JetBrains Mono Variable", monospace`;
    ctx.textAlign = 'center';
    for (let d = 0; d < 360; d += 15) {
      const rel = angDiff(d, yaw.current);
      if (Math.abs(rel) > view / 2) continue;
      const x = (rel / view + 0.5) * W;
      const cam = RING.find((r) => r.heading === d);
      ctx.fillStyle = cam ? '#f5a524' : 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - 1, fs * 1.9, 2, cam ? fs * 0.7 : fs * 0.4);
      if (cam) ctx.fillText(CAMERA_LABEL[cam.pos].toUpperCase(), x, fs * 1.4);
      else if (d % 45 === 0) ctx.fillText(`${d}°`, x, fs * 1.4);
    }
    // nearby machines at their bearing
    for (const o of nearbyOf(m, Object.values(live.machines), 120)) {
      const bearing = wrap((Math.atan2(-o.left, o.fwd) * 180) / Math.PI);
      const rel = angDiff(bearing, yaw.current);
      if (Math.abs(rel) > view / 2) continue;
      const d = Math.hypot(o.fwd, o.left);
      const x = (rel / view + 0.5) * W;
      const y = H * 0.36;
      const label = `${o.id} · ${d.toFixed(0)} m`;
      const tw = ctx.measureText(label).width + fs;
      ctx.fillStyle = d < 15 ? 'rgba(220,38,38,0.9)' : d < 30 ? 'rgba(217,119,6,0.9)' : 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - tw / 2, y - fs * 1.2, tw, fs * 1.7);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y);
      ctx.beginPath(); ctx.moveTo(x, y + fs * 0.5); ctx.lineTo(x, y + fs * 2.2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, H - fs * 2, W, fs * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${m.id} · 360° stitched from 4 cameras · ${new Date(live.t).toLocaleTimeString()} · ${m.spd.toFixed(0)} km/h`, fs * 0.6, H - fs * 0.6);
    ctx.textAlign = 'right';
    ctx.fillText(`VIEW ${Math.round(yaw.current)}°`, W - fs * 0.6, H - fs * 0.6);
    ctx.textAlign = 'left';
  }, [machineId]);

  const turnTo = (deg: number) => { yaw.current = wrap(deg); setHeading(Math.round(yaw.current)); };
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative overflow-hidden rounded-xl border border-line bg-black" style={{ height }}>
        <canvas ref={ref} className="h-full w-full cursor-grab active:cursor-grabbing" aria-label={`${machineId} 360 degree camera view, drag to look around`}
          onPointerDown={(e) => { drag.current = { x: e.clientX, yaw: yaw.current }; (e.target as HTMLElement).setPointerCapture(e.pointerId); setAuto(false); }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const w = (e.target as HTMLElement).clientWidth || 1;
            yaw.current = wrap(d.yaw - ((e.clientX - d.x) / w) * fovRef.current);
          }}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => setFov((f) => Math.min(150, Math.max(60, f + (e.deltaY > 0 ? 8 : -8))))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="secondary" aria-label="Look left" onClick={() => turnTo(heading - 30)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="icon-sm" variant="secondary" aria-label="Look right" onClick={() => turnTo(heading + 30)}><ChevronRight className="h-4 w-4" /></Button>
        <Segmented size="sm" value={RING.find((r) => Math.abs(angDiff(r.heading, heading)) < 5)?.heading ?? -1}
          onChange={(v) => turnTo(v)} options={RING.map((r) => ({ value: r.heading, label: CAMERA_LABEL[r.pos] }))} />
        <Button size="sm" variant={auto ? 'primary' : 'secondary'} icon={auto ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => setAuto(!auto)}>
          {auto ? 'Stop pan' : 'Auto pan'}
        </Button>
        <Segmented size="sm" value={fov} onChange={setFov} options={[{ value: 70, label: 'Narrow' }, { value: 100, label: 'Normal' }, { value: 140, label: 'Wide' }]} />
        <span className="ml-auto text-xs text-muted">Drag to look around · scroll to zoom · heading {heading}°</span>
      </div>
    </div>
  );
}

const SIZE: Record<MachineType, [number, number]> = {
  truck: [13, 7.6], water: [12, 6.5], shovel: [11, 9], excavator: [10, 8], loader: [11, 5], dozer: [8, 5.5], drill: [9, 5], lv: [5, 2],
};

/** Warps the bottom (ground) part of a feed into a trapezoid: outer edge (far ground) to inner edge (next to the machine). */
function warpZone(ctx: CanvasRenderingContext2D, f: RingFeed, outerW: number, innerW: number, depth: number, strips = 28) {
  const v = f.video!;
  const vw = v.videoWidth || 640;
  const vh = v.videoHeight || 360;
  if (f.choice?.flip) ctx.scale(-1, 1);
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const w = outerW + (innerW - outerW) * (t0 + t1) / 2;
    ctx.drawImage(v, 0, vh * (0.4 + 0.6 * t0), vw, (vh * 0.6) / strips, -w / 2, depth * t0, w, depth * (t1 - t0) + 0.75);
  }
}

export function BirdsEyeView({ machineId, className }: { machineId: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const getFeeds = useFeeds(machineId);
  const getFeedsRef = useRef(getFeeds);
  getFeedsRef.current = getFeeds;
  useCanvasLoop(ref, 24, (ctx, W, H) => {
    const feeds = getFeedsRef.current();
    const live = useLive.getState();
    const m = live.machines[machineId];
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, W, H);
    if (!m) return;
    const [len, wid] = SIZE[m.type];
    const ppm = Math.min(W, H) / (m.type === 'lv' ? 22 : 48);
    const cx = W / 2;
    const cy = H / 2;
    const hx = (wid / 2) * ppm;
    const hy = (len / 2) * ppm;
    const night = isNightTs(live.t);
    ctx.save();
    const zone = (pos: CameraPosition, rot: number, outerW: number, innerW: number, depth: number, clip: [number, number][]) => {
      const f = feeds.find((x) => x.pos === pos);
      if (!f?.video) return;
      ctx.save();
      ctx.beginPath();
      clip.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.translate(0, -(depth + (rot === 0 || Math.abs(rot - Math.PI) < 0.01 ? hy : hx)));
      warpZone(ctx, f, outerW, innerW, depth);
      ctx.restore();
    };
    // front (top), rear (bottom), left, right; seams run from the machine's corners to the canvas corners
    zone('front', 0, W * 1.6, hx * 2, cy - hy, [[0, 0], [W, 0], [cx + hx, cy - hy], [cx - hx, cy - hy]]);
    zone('rear', Math.PI, W * 1.6, hx * 2, H - cy - hy, [[0, H], [W, H], [cx + hx, cy + hy], [cx - hx, cy + hy]]);
    zone('left', -Math.PI / 2, H * 1.6, hy * 2, cx - hx, [[0, 0], [0, H], [cx - hx, cy + hy], [cx - hx, cy - hy]]);
    zone('right', Math.PI / 2, H * 1.6, hy * 2, W - cx - hx, [[W, 0], [W, H], [cx + hx, cy + hy], [cx + hx, cy - hy]]);
    ctx.restore();
    if (night) irTint(ctx, 0, 0, W, H);
    // seams
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = Math.max(1, ppm * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - hx, cy - hy); ctx.lineTo(0, 0); ctx.moveTo(cx + hx, cy - hy); ctx.lineTo(W, 0);
    ctx.moveTo(cx - hx, cy + hy); ctx.lineTo(0, H); ctx.moveTo(cx + hx, cy + hy); ctx.lineTo(W, H);
    ctx.stroke();
    // proximity guides
    const zones: [number, string][] = [[3, 'rgba(239,68,68,0.95)'], [6, 'rgba(245,158,11,0.9)'], [10, 'rgba(34,197,94,0.85)']];
    ctx.lineWidth = Math.max(2, ppm * 0.16);
    for (const [d, c] of zones) {
      ctx.strokeStyle = c;
      ctx.setLineDash([ppm * 0.8, ppm * 0.5]);
      ctx.beginPath(); ctx.roundRect(cx - hx - d * ppm, cy - hy - d * ppm, (hx + d * ppm) * 2, (hy + d * ppm) * 2, d * ppm); ctx.stroke();
    }
    ctx.setLineDash([]);
    // nearby machines
    const fs = Math.max(10, W / 60);
    ctx.font = `600 ${fs}px "JetBrains Mono Variable", monospace`;
    ctx.textAlign = 'center';
    for (const o of nearbyOf(m, Object.values(live.machines), 45)) {
      const x = cx - o.left * ppm;
      const y = cy - o.fwd * ppm;
      const d = Math.hypot(o.fwd, o.left);
      ctx.fillStyle = d < 10 ? '#ef4444' : d < 20 ? '#f59e0b' : '#e5e7eb';
      ctx.beginPath(); ctx.arc(x, y, fs * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(`${o.id} ${d.toFixed(0)}m`, x, y - fs * 0.8);
    }
    // the machine (top view)
    ctx.fillStyle = '#16181c';
    ctx.fillRect(cx - hx - 3, cy - hy - 3, hx * 2 + 6, hy * 2 + 6);
    const g = ctx.createLinearGradient(cx - hx, 0, cx + hx, 0);
    g.addColorStop(0, '#c48a12'); g.addColorStop(0.5, '#f0b429'); g.addColorStop(1, '#c48a12');
    ctx.fillStyle = m.type === 'lv' ? '#eeeeea' : g;
    ctx.fillRect(cx - hx, cy - hy, hx * 2, hy * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    if (m.type === 'truck') ctx.fillRect(cx - hx * 0.86, cy - hy * 0.25, hx * 1.72, hy * 1.18);
    ctx.fillStyle = '#26394b';
    ctx.fillRect(cx + hx * 0.1, cy - hy * 0.93, hx * 0.75, hy * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(cx, cy - hy - fs * 1.2); ctx.lineTo(cx - fs * 0.6, cy - hy - fs * 0.3); ctx.lineTo(cx + fs * 0.6, cy - hy - fs * 0.3); ctx.fill();
    // labels
    ctx.font = `700 ${fs}px "JetBrains Mono Variable", monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('FRONT', cx, fs * 1.4);
    ctx.fillText('REAR', cx, H - fs * 0.6);
    ctx.save(); ctx.translate(fs * 1.2, cy); ctx.rotate(-Math.PI / 2); ctx.fillText('LEFT', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(W - fs * 1.2, cy); ctx.rotate(Math.PI / 2); ctx.fillText('RIGHT', 0, 0); ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillText(`${m.id} · ${m.spd.toFixed(0)} km/h`, fs * 0.6, H - fs * 0.6);
  }, [machineId]);
  return <canvas ref={ref} className={className} aria-label={`${machineId} bird's-eye view stitched from 4 cameras`} />;
}
