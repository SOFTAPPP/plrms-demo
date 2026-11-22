// One requestAnimationFrame loop drives every visible camera canvas at its own frame rate.
import { newMemory, renderCamera, type CamState, type ViewMemory } from './render';
import { acquireFeed, clipFor, feedKey, type Feed } from './footage';

interface View {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  source: () => CamState | null;
  fps: number;
  maxW: number;
  mem: ViewMemory;
  visible: boolean;
  force: boolean;
  last: number;
  io: IntersectionObserver;
  ro: ResizeObserver;
  feed: Feed | null;
}

const views = new Set<View>();
let raf = 0;

function sizeCanvas(v: View) {
  // 1.5× is sharp on high-DPI screens; full 2× quadruples the pixels every frame for little gain
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const cw = v.canvas.clientWidth || 320;
  const w = Math.max(240, Math.min(v.maxW, Math.round(cw * dpr)));
  const h = Math.round((w * 9) / 16);
  if (v.canvas.width !== w || v.canvas.height !== h) {
    v.canvas.width = w;
    v.canvas.height = h;
  }
}

function loop(now: number) {
  raf = 0;
  if (document.visibilityState === 'visible') {
    for (const v of views) {
      if (!v.visible && !v.force) continue;
      const interval = 1000 / v.fps;
      if (now - v.last < interval - 2) continue;
      const dt = v.last ? (now - v.last) / 1000 : 0.05;
      v.last = now;
      const st = v.source();
      if (!st) continue;
      try {
        const key = feedKey(st);
        if (v.feed?.key !== key) {
          v.feed?.release();
          v.feed = acquireFeed(key);
        }
        const choice = clipFor(st.type, st.position, st.machineId, st.t);
        const video = v.feed.update(st, choice);
        renderCamera(v.ctx, v.canvas.width, v.canvas.height, st, v.mem, dt,
          video ? { video, flip: choice.flip, native: Boolean(choice.native), face: choice.clip.face } : null);
      } catch (err) {
        console.warn('camera render failed', err);
      }
    }
  }
  if (views.size) raf = requestAnimationFrame(loop);
}

export interface CameraHandle {
  detach: () => void;
  setForce: (v: boolean) => void;
  setFps: (fps: number) => void;
  resetMemory: () => void;
}

export function attachCamera(canvas: HTMLCanvasElement, source: () => CamState | null, opts: { fps?: number; maxW?: number } = {}): CameraHandle {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const v: View = {
    canvas, ctx, source, fps: opts.fps ?? 12, maxW: opts.maxW ?? 640, mem: newMemory(), visible: true, force: false, last: 0, feed: null,
    io: new IntersectionObserver(([e]) => { v.visible = e.isIntersecting; }, { threshold: 0.01 }),
    ro: new ResizeObserver(() => sizeCanvas(v)),
  };
  v.io.observe(canvas);
  v.ro.observe(canvas);
  sizeCanvas(v);
  views.add(v);
  if (!raf) raf = requestAnimationFrame(loop);
  return {
    detach() {
      v.feed?.release();
      v.io.disconnect();
      v.ro.disconnect();
      views.delete(v);
    },
    setForce(f) { v.force = f; },
    setFps(f) { v.fps = f; },
    resetMemory() { v.mem = newMemory(); },
  };
}

/** Start recording a canvas; resolves with the video when `stop()` is called. */
export function recordCanvas(canvas: HTMLCanvasElement, fps = 20): { stop: () => Promise<Blob | null> } | null {
  if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') return null;
  const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(500);
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(chunks.length ? new Blob(chunks, { type: mime.split(';')[0] }) : null);
      };
      if (rec.state !== 'inactive') rec.stop(); else resolve(null);
    }),
  };
}
