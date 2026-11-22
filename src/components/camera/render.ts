// Procedural camera renderer. Each frame is drawn from the machine's state, so the same function
// produces live video and playback of any past moment (from stored telemetry).
import type { CameraPosition, MachineStatus, MachineType } from '../../../shared/types';

export interface NearbyObject {
  /** metres ahead of the machine (negative = behind) */
  fwd: number;
  /** metres to the left (negative = right) */
  left: number;
  type: MachineType;
  id: string;
}

export interface CamState {
  machineId: string;
  type: MachineType;
  position: CameraPosition;
  label: string;
  t: number;
  speed: number;
  status: MachineStatus;
  act: string;
  payloadPct: number;
  payloadT: number;
  bucketFill: number;
  swing: number;
  boom: number;
  water: number;
  depth: number;
  dms: 0 | 1 | 2;
  offline: boolean;
  operator: string;
  recording: boolean;
  mode: 'LIVE' | 'PLAYBACK';
  quality: string;
  nearby: NearbyObject[];
  turn: number;
  reversing: boolean;
  dumping: boolean;
  loading: boolean;
  /** text shown instead of video when the feed is off (e.g. CAMERA DISABLED) */
  notice?: string;
}

export interface ViewMemory {
  odo: number;
  lastPay: number;
  falling: { x: number; y: number; vy: number; vx: number; r: number; life: number }[];
  dust: { x: number; y: number; vx: number; vy: number; r: number; a: number }[];
  pan: number;
  turnSmooth: number;
  blink: number;
  grain: number;
}

export function newMemory(): ViewMemory {
  return { odo: Math.random() * 1000, lastPay: -1, falling: [], dust: [], pan: 0, turnSmooth: 0, blink: 0, grain: 0 };
}

// ---------------------------------------------------------------- helpers

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function noise1(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

let grainCanvas: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const g = c.getContext('2d')!;
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

interface Pal { skyTop: string; skyBot: string; far: string; mid: string; ground: string; groundFar: string; road: string; track: string; berm: string; rock: string; steel: string; yellow: string; ir: boolean }

function palette(night: boolean): Pal {
  return night
    ? { skyTop: '#0b1114', skyBot: '#25302f', far: '#2f3a38', mid: '#3a4644', ground: '#4c5654', groundFar: '#3b4543', road: '#5f6966', track: '#47504e', berm: '#3e4846', rock: '#6b7572', steel: '#59625f', yellow: '#a9ad94', ir: true }
    : { skyTop: '#7fa6c4', skyBot: '#d9cbb0', far: '#9b8a76', mid: '#86705a', ground: '#8f7556', groundFar: '#a48b6b', road: '#a08a6c', track: '#7e6a51', berm: '#6f5b45', rock: '#6b5b4b', steel: '#5b6168', yellow: '#e2a91a', ir: false };
}

function isNight(t: number) {
  const h = new Date(t).getHours();
  return h >= 19 || h < 6;
}

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------- scenery

function drawSky(ctx: CanvasRenderingContext2D, w: number, hz: number, p: Pal) {
  const g = ctx.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(1, p.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, hz + 2);
}

function drawRidge(ctx: CanvasRenderingContext2D, w: number, hz: number, shift: number, amp: number, color: string, seed: number, benches: boolean) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, hz + 2);
  const step = w / 48;
  for (let x = 0; x <= w + step; x += step) {
    const n = noise1((x + shift) / (w * 0.18) + seed) * 0.7 + noise1((x + shift) / (w * 0.05) + seed * 3) * 0.3;
    ctx.lineTo(x, hz - n * amp);
  }
  ctx.lineTo(w, hz + 2);
  ctx.closePath();
  ctx.fill();
  if (benches) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const n = noise1((x + shift) / (w * 0.18) + seed) * 0.7 + noise1((x + shift) / (w * 0.05) + seed * 3) * 0.3;
        const y = hz - n * amp * (1 - k * 0.24);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

/** Forward or rearward road view with perspective, berms, posts, other vehicles and dust. */
function drawRoad(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal, rear: boolean) {
  const hz = h * 0.42;
  const shift = mem.pan;
  drawSky(ctx, w, hz, p);
  if (!p.ir) {
    const sun = ctx.createRadialGradient(w * 0.78, hz * 0.35, 0, w * 0.78, hz * 0.35, w * 0.35);
    sun.addColorStop(0, 'rgba(255,240,210,0.55)');
    sun.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, hz);
  }
  drawRidge(ctx, w, hz, shift * 0.3, h * 0.2, p.far, 1.7, true);
  drawRidge(ctx, w, hz, shift * 0.6, h * 0.11, p.mid, 4.2, false);
  const gg = ctx.createLinearGradient(0, hz, 0, h);
  gg.addColorStop(0, p.groundFar);
  gg.addColorStop(1, p.ground);
  ctx.fillStyle = gg;
  ctx.fillRect(0, hz, w, h - hz);

  const vx = w / 2 + mem.turnSmooth * w * 0.25 * (rear ? -1 : 1);
  const camH = 4.2;
  const f = h * 0.9;
  const halfRoad = 11;
  const proj = (z: number, x: number) => [vx + (x / z) * f + (w / 2 - vx) * Math.min(1, 6 / z), hz + (camH / z) * f * 0.45];
  // road surface
  const zNear = 2.2;
  const zFar = 260;
  const [lx0, y0] = proj(zNear, -halfRoad);
  const [rx0] = proj(zNear, halfRoad);
  const [lx1, y1] = proj(zFar, -halfRoad);
  const [rx1] = proj(zFar, halfRoad);
  ctx.fillStyle = p.road;
  ctx.beginPath();
  ctx.moveTo(lx0, y0); ctx.lineTo(lx1, y1); ctx.lineTo(rx1, y1); ctx.lineTo(rx0, y0);
  ctx.closePath();
  ctx.fill();
  // berms
  for (const side of [-1, 1]) {
    const [a0] = proj(zNear, side * halfRoad);
    const [b0] = proj(zNear, side * (halfRoad + 4));
    const [a1] = proj(zFar, side * halfRoad);
    const [b1] = proj(zFar, side * (halfRoad + 4));
    ctx.fillStyle = p.berm;
    ctx.beginPath();
    ctx.moveTo(a0, y0); ctx.lineTo(a1, y1); ctx.lineTo(b1, y1 - 2); ctx.lineTo(b0, y0 - h * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  // wheel tracks
  ctx.strokeStyle = p.track;
  for (const x of [-6.5, -2.5, 2.5, 6.5]) {
    const [ax, ay] = proj(zNear, x);
    const [bx, by] = proj(zFar, x);
    ctx.lineWidth = Math.max(1, w / 140);
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // ruts and posts moving with odometer
  const dir = rear ? -1 : 1;
  const spacing = 9;
  const off = ((mem.odo * dir) % spacing + spacing) % spacing;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let i = 1; i < 30; i++) {
    const z = i * spacing - off;
    if (z < zNear) continue;
    const [ax, ay] = proj(z, -halfRoad);
    const [bx] = proj(z, halfRoad);
    ctx.lineWidth = Math.max(0.5, 3 / z * 10);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.stroke();
  }
  const postSpace = 25;
  const poff = ((mem.odo * dir) % postSpace + postSpace) % postSpace;
  for (let i = 0; i < 12; i++) {
    const z = i * postSpace - poff + 3;
    if (z < zNear) continue;
    for (const side of [-1, 1]) {
      const [px, py] = proj(z, side * (halfRoad + 1.5));
      const ph = Math.max(2, (1.2 / z) * f * 0.6);
      const pw = Math.max(1, ph * 0.12);
      ctx.fillStyle = p.ir ? '#9aa39f' : '#e8e2d4';
      ctx.fillRect(px - pw / 2, py - ph, pw, ph);
      ctx.fillStyle = p.ir ? '#f0f5f2' : side < 0 ? '#ff8a1f' : '#f2f2f2';
      ctx.fillRect(px - pw / 2, py - ph, pw, ph * 0.22);
    }
  }
  // other machines on the road
  const objs = st.nearby.filter((o) => (rear ? o.fwd < -4 : o.fwd > 4) && Math.abs(o.left) < 40).sort((a, b) => Math.abs(b.fwd) - Math.abs(a.fwd));
  for (const o of objs) {
    const z = Math.abs(o.fwd);
    const [ox, oy] = proj(z, -o.left * (rear ? -1 : 1));
    const s = (1 / z) * f * 0.75;
    drawVehicleBack(ctx, ox, oy, s, o.type, p);
    if (z < 60 && !p.ir) dustPuff(ctx, ox, oy - s * 3, s * 5, 0.18);
  }
  // headlights at night
  if (p.ir && !rear) {
    const g = ctx.createRadialGradient(w / 2, h * 0.95, 0, w / 2, h * 0.75, w * 0.55);
    g.addColorStop(0, 'rgba(230,240,235,0.35)');
    g.addColorStop(1, 'rgba(230,240,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, hz, w, h - hz);
  }
  // own dust
  if (st.speed > 6 && !p.ir) {
    const a = Math.min(0.28, st.speed / 160);
    dustPuff(ctx, w * 0.5, h * (rear ? 0.75 : 0.98), w * 0.7, rear ? a * 1.6 : a * 0.5);
  }
}

function dustPuff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(205,185,150,${a})`);
  g.addColorStop(1, 'rgba(205,185,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawVehicleBack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, type: MachineType, p: Pal) {
  const big = type === 'truck' || type === 'water';
  const W = (big ? 7 : type === 'lv' ? 2 : 5) * s;
  const H = (big ? 6 : type === 'lv' ? 1.8 : 4) * s;
  ctx.fillStyle = '#16181a';
  ctx.fillRect(x - W / 2, y - H * 0.35, W * 0.22, H * 0.35);
  ctx.fillRect(x + W / 2 - W * 0.22, y - H * 0.35, W * 0.22, H * 0.35);
  ctx.fillStyle = type === 'lv' ? (p.ir ? '#cfd6d2' : '#f2f2ee') : type === 'water' ? (p.ir ? '#8f9792' : '#d9d4c5') : p.yellow;
  ctx.fillRect(x - W / 2, y - H, W, H * 0.68);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - W / 2, y - H * 0.42, W, H * 0.08);
  ctx.fillStyle = p.ir ? '#ffffff' : '#ff3b30';
  const lw = Math.max(1, W * 0.06);
  ctx.fillRect(x - W / 2 + lw, y - H * 0.5, lw, lw);
  ctx.fillRect(x + W / 2 - 2 * lw, y - H * 0.5, lw, lw);
}

// ---------------------------------------------------------------- camera views

function viewRoad(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal) {
  drawRoad(ctx, w, h, st, mem, p, false);
  // own machine in frame
  if (st.type === 'truck' || st.type === 'water') {
    ctx.fillStyle = p.yellow;
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.9); ctx.lineTo(w * 0.18, h * 0.86); ctx.lineTo(w * 0.82, h * 0.86); ctx.lineTo(w, h * 0.9); ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,20,0.7)';
    ctx.lineWidth = Math.max(2, w / 200);
    ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.8); ctx.lineTo(w * 0.9, h * 0.8); ctx.stroke();
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(w * (0.1 + i * 0.1), h * 0.8); ctx.lineTo(w * (0.1 + i * 0.1), h * 0.87); ctx.stroke(); }
  } else if (st.type === 'lv') {
    ctx.fillStyle = p.ir ? '#2a2f2e' : '#1d1f22';
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.86); ctx.quadraticCurveTo(w / 2, h * 0.8, w, h * 0.86); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  } else if (st.type === 'dozer') {
    ctx.fillStyle = p.steel;
    ctx.beginPath(); ctx.moveTo(w * 0.04, h); ctx.lineTo(w * 0.08, h * 0.74); ctx.quadraticCurveTo(w / 2, h * 0.68, w * 0.92, h * 0.74); ctx.lineTo(w * 0.96, h); ctx.closePath(); ctx.fill();
    if (st.speed > 1) {
      ctx.fillStyle = p.groundFar;
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, w * 0.36, h * 0.08, 0, Math.PI, 0); ctx.fill();
    }
  } else if (st.type === 'loader') {
    ctx.fillStyle = p.yellow;
    ctx.fillRect(w * 0.18, h * 0.78 - (st.boom - 20) * h * 0.006, w * 0.64, h * 0.08);
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    ctx.fillRect(w * 0.18, h * 0.86 - (st.boom - 20) * h * 0.006, w * 0.64, h * 0.03);
  }
  if (st.type === 'water' && st.speed > 3 && !p.ir) {
    ctx.fillStyle = 'rgba(160,190,210,0.12)';
    ctx.fillRect(0, h * 0.6, w, h * 0.25);
  }
}

function viewRear(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal) {
  drawRoad(ctx, w, h, st, mem, p, true);
  if (st.type === 'truck') {
    ctx.fillStyle = p.ir ? '#2c3130' : '#3b3732';
    ctx.fillRect(0, 0, w, h * (st.dumping ? 0.05 : 0.12));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, h * (st.dumping ? 0.05 : 0.12), w, h * 0.012);
  }
  if (st.type === 'water' && st.speed > 2 && st.water > 0) {
    for (let i = 0; i < 40; i++) {
      const x = w * (0.1 + hash(i + Math.floor(mem.odo * 3)) * 0.8);
      const y = h * (0.62 + hash(i * 7 + mem.odo) * 0.33);
      ctx.fillStyle = p.ir ? 'rgba(220,230,225,0.25)' : 'rgba(200,225,240,0.35)';
      ctx.fillRect(x, y, 2, 6);
    }
  }
  if (st.reversing || st.speed < 8) {
    // parking guide lines
    const cols = ['#ef4444', '#f59e0b', '#22c55e'];
    for (let i = 0; i < 3; i++) {
      const y = h * (0.92 - i * 0.12);
      const inset = w * (0.18 + i * 0.07);
      ctx.strokeStyle = cols[i];
      ctx.lineWidth = Math.max(2, w / 180);
      ctx.beginPath();
      ctx.moveTo(inset, y); ctx.lineTo(inset + w * 0.06, y);
      ctx.moveTo(w - inset, y); ctx.lineTo(w - inset - w * 0.06, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.moveTo(w * 0.18, h * 0.95); ctx.lineTo(w * 0.32, h * 0.62); ctx.moveTo(w * 0.82, h * 0.95); ctx.lineTo(w * 0.68, h * 0.62); ctx.stroke();
  }
}

function viewSide(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal, side: 1 | -1) {
  // looking down beside the machine: ground streams past
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.groundFar);
  g.addColorStop(1, p.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const scroll = mem.odo * 22 * side;
  for (let i = 0; i < 70; i++) {
    const baseX = hash(i * 3.1) * w * 3;
    const x = (((baseX - scroll) % (w * 3)) + w * 3) % (w * 3) - w;
    const y = h * (0.15 + hash(i * 1.7) * 0.8);
    const r = (2 + hash(i * 9.2) * 6) * (y / h + 0.4) * (w / 480);
    ctx.fillStyle = hash(i) > 0.5 ? p.rock : p.track;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.4, r, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // tyre tracks
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, h * 0.55, w, h * 0.1);
  // berm / road edge
  ctx.fillStyle = p.berm;
  ctx.beginPath(); ctx.moveTo(0, h * 0.18); ctx.quadraticCurveTo(w / 2, h * 0.1, w, h * 0.18); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  // nearby machines on this side
  for (const o of st.nearby) {
    const lateral = o.left * side;
    if (lateral < 2 || lateral > 35 || Math.abs(o.fwd) > 40) continue;
    const s = (1 - lateral / 40) * h * 0.06;
    const x = w / 2 + o.fwd * (w / 60) * side;
    ctx.fillStyle = o.type === 'lv' ? '#eeeeea' : p.yellow;
    ctx.fillRect(x - s * 4, h * 0.25 - s, s * 8, s * 3);
    ctx.fillStyle = '#121212';
    ctx.beginPath(); ctx.arc(x - s * 2.5, h * 0.25 + s * 2, s * 1.1, 0, Math.PI * 2); ctx.arc(x + s * 2.5, h * 0.25 + s * 2, s * 1.1, 0, Math.PI * 2); ctx.fill();
  }
  // own tyre and body edge
  if (st.type !== 'shovel' && st.type !== 'excavator' && st.type !== 'dozer' && st.type !== 'drill') {
    const cx = side > 0 ? w * 0.86 : w * 0.14;
    const R = h * 0.42;
    ctx.fillStyle = '#141414';
    ctx.beginPath(); ctx.arc(cx, h * 1.05, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = R * 0.08;
    const rot = (mem.odo / 1.8) * side;
    for (let k = 0; k < 14; k++) {
      const a = rot + (k / 14) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.82, h * 1.05 + Math.sin(a) * R * 0.82); ctx.lineTo(cx + Math.cos(a) * R * 0.98, h * 1.05 + Math.sin(a) * R * 0.98); ctx.stroke();
    }
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath(); ctx.arc(cx, h * 1.05, R * 0.45, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    ctx.fillStyle = '#2c2c2c';
    for (let k = 0; k < 16; k++) ctx.fillRect(((k * w) / 12 + (mem.odo * 30 * side) % (w / 12) + w) % (w + 20) - 20, h * 0.86, w / 30, h * 0.12);
  }
  ctx.fillStyle = p.yellow;
  ctx.fillRect(side > 0 ? w * 0.94 : 0, 0, w * 0.06, h);
  // proximity zones
  ctx.lineWidth = Math.max(2, w / 220);
  const zc = ['rgba(239,68,68,0.75)', 'rgba(245,158,11,0.7)', 'rgba(34,197,94,0.65)'];
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = zc[i];
    ctx.setLineDash([w / 40, w / 60]);
    const y = h * (0.78 - i * 0.18);
    ctx.beginPath(); ctx.moveTo(w * 0.05, y); ctx.quadraticCurveTo(w / 2, y + h * 0.05, w * 0.95, y); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function viewCabin(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal) {
  const wall = p.ir ? '#1e2322' : '#2a2c30';
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // windscreen with outside world
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w * 0.05, h * 0.06); ctx.lineTo(w * 0.62, h * 0.04); ctx.lineTo(w * 0.66, h * 0.5); ctx.lineTo(w * 0.04, h * 0.52); ctx.closePath();
  ctx.clip();
  const ow = w * 0.7;
  const oh = h * 0.6;
  ctx.translate(-w * 0.02, -h * 0.02);
  drawRoad(ctx, ow, oh, st, mem, p, false);
  ctx.restore();
  ctx.strokeStyle = p.ir ? '#121514' : '#15161a';
  ctx.lineWidth = w / 60;
  ctx.beginPath(); ctx.moveTo(w * 0.05, h * 0.06); ctx.lineTo(w * 0.62, h * 0.04); ctx.lineTo(w * 0.66, h * 0.5); ctx.lineTo(w * 0.04, h * 0.52); ctx.closePath(); ctx.stroke();
  // dashboard
  ctx.fillStyle = p.ir ? '#262b2a' : '#1b1c1f';
  ctx.beginPath(); ctx.moveTo(0, h * 0.62); ctx.lineTo(w * 0.7, h * 0.56); ctx.lineTo(w * 0.72, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = p.ir ? '#6f7c78' : '#0f6e8c';
  ctx.fillRect(w * 0.08, h * 0.66, w * 0.14, h * 0.09);
  ctx.fillStyle = p.ir ? '#5d6965' : '#7a4b0c';
  ctx.fillRect(w * 0.26, h * 0.65, w * 0.1, h * 0.09);
  // steering wheel or joysticks
  ctx.strokeStyle = '#0d0d0f';
  ctx.lineWidth = w / 70;
  if (st.type === 'shovel' || st.type === 'excavator' || st.type === 'drill') {
    ctx.beginPath(); ctx.moveTo(w * 0.18, h); ctx.lineTo(w * 0.2, h * 0.8); ctx.moveTo(w * 0.55, h); ctx.lineTo(w * 0.53, h * 0.8); ctx.stroke();
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath(); ctx.arc(w * 0.2, h * 0.79, w * 0.018, 0, Math.PI * 2); ctx.arc(w * 0.53, h * 0.79, w * 0.018, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(w * 0.33, h * 0.86, w * 0.13, h * 0.1, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  // operator (seen from the dash, slightly to the right)
  const t = st.t / 1000;
  const sway = Math.sin(t * 0.9) * w * 0.006 + (st.speed > 1 ? Math.sin(t * 3.1) * w * 0.003 : 0);
  const look = st.dms === 2 ? -0.35 : Math.sin(t * 0.21) * 0.15;
  const hx = w * 0.8 + sway;
  const hy = h * 0.4;
  const hr = h * 0.12;
  // seat
  ctx.fillStyle = p.ir ? '#222726' : '#151618';
  ctx.fillRect(w * 0.68, h * 0.3, w * 0.26, h * 0.7);
  // shoulders & hi-vis vest
  ctx.fillStyle = p.ir ? '#8d9894' : '#f97316';
  ctx.beginPath(); ctx.ellipse(hx, h * 0.82, w * 0.14, h * 0.24, 0, Math.PI, 0); ctx.fill();
  ctx.fillRect(hx - w * 0.14, h * 0.82, w * 0.28, h * 0.2);
  ctx.fillStyle = p.ir ? '#e7ecea' : '#e5e7eb';
  ctx.fillRect(hx - w * 0.14, h * 0.86, w * 0.28, h * 0.025);
  // neck & head
  ctx.fillStyle = p.ir ? '#9aa39f' : '#8d5a3b';
  ctx.fillRect(hx - hr * 0.35, hy + hr * 0.8, hr * 0.7, hr * 0.6);
  ctx.beginPath(); ctx.ellipse(hx + look * hr, hy + (st.dms === 1 ? hr * 0.15 : 0), hr * 0.78, hr, 0, 0, Math.PI * 2); ctx.fill();
  // hard hat
  ctx.fillStyle = p.ir ? '#f2f5f4' : '#f8fafc';
  ctx.beginPath(); ctx.ellipse(hx + look * hr, hy - hr * 0.55 + (st.dms === 1 ? hr * 0.15 : 0), hr * 0.95, hr * 0.62, 0, Math.PI, 0); ctx.fill();
  ctx.fillRect(hx + look * hr - hr * 1.05, hy - hr * 0.6 + (st.dms === 1 ? hr * 0.15 : 0), hr * 2.1, hr * 0.14);
  // eyes
  const ey = hy - hr * 0.05 + (st.dms === 1 ? hr * 0.15 : 0);
  mem.blink = (mem.blink + 1) % 90;
  const closed = st.dms === 1 || mem.blink < 3;
  ctx.fillStyle = '#111';
  for (const dx of [-0.32, 0.32]) {
    const ex = hx + look * hr * 1.3 + dx * hr;
    if (closed) ctx.fillRect(ex - hr * 0.13, ey, hr * 0.26, Math.max(1, hr * 0.05));
    else { ctx.beginPath(); ctx.arc(ex, ey, hr * 0.08, 0, Math.PI * 2); ctx.fill(); }
  }
  if (st.dms === 2) {
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(hx - hr * 1.15, hy - hr * 0.2, hr * 0.32, hr * 0.62);
    ctx.fillStyle = p.ir ? '#cfd8d4' : '#60a5fa';
    ctx.fillRect(hx - hr * 1.11, hy - hr * 0.15, hr * 0.24, hr * 0.5);
  }
  // driver-monitoring overlay
  const box = { x: hx - hr * 1.4, y: hy - hr * 1.5, w: hr * 2.8, h: hr * 2.9 };
  const col = st.dms === 1 ? '#ef4444' : st.dms === 2 ? '#f59e0b' : '#22c55e';
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, w / 300);
  const c = box.w * 0.18;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + c); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + c, box.y);
  ctx.moveTo(box.x + box.w - c, box.y); ctx.lineTo(box.x + box.w, box.y); ctx.lineTo(box.x + box.w, box.y + c);
  ctx.moveTo(box.x, box.y + box.h - c); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + c, box.y + box.h);
  ctx.moveTo(box.x + box.w - c, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h - c);
  ctx.stroke();
  const label = st.dms === 1 ? 'FATIGUE · EYES CLOSED' : st.dms === 2 ? 'DISTRACTION · PHONE' : 'ATTENTIVE';
  ctx.font = `600 ${Math.max(9, w / 52)}px "JetBrains Mono Variable", monospace`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = col;
  ctx.fillRect(box.x, box.y - w / 34, tw + 10, w / 34);
  ctx.fillStyle = '#0b0b0c';
  ctx.fillText(label, box.x + 5, box.y - w / 120);
  if (st.dms === 1 && Math.floor(st.t / 400) % 2 === 0) {
    ctx.fillStyle = 'rgba(239,68,68,0.18)';
    ctx.fillRect(0, 0, w, h);
  }
}

function viewBucket(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal) {
  // background pans with the swing angle: face when digging, truck when dumping
  const pan = st.swing * (w / 55);
  const hz = h * 0.3;
  drawSky(ctx, w, hz, p);
  drawRidge(ctx, w, hz, pan * 0.4, h * 0.12, p.far, 2.3, true);
  // the bench face (rock wall)
  ctx.fillStyle = p.mid;
  ctx.fillRect(0, hz, w, h - hz);
  for (let i = 0; i < 90; i++) {
    const x = ((hash(i * 4.7) * w * 4 - pan) % (w * 4) + w * 4) % (w * 4) - w;
    const y = hz + hash(i * 2.3) * (h - hz);
    const r = (3 + hash(i) * 10) * (w / 480);
    ctx.fillStyle = i % 3 ? p.rock : p.berm;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.3, r, hash(i) * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // truck tray appears when swung over to the truck
  const truckX = w / 2 - pan + 90 * (w / 55) * Math.sign(st.swing || 1);
  if (Math.abs(st.swing) > 40 && st.loading) {
    ctx.fillStyle = p.yellow;
    ctx.fillRect(truckX - w * 0.35, h * 0.62, w * 0.7, h * 0.4);
    ctx.fillStyle = p.ir ? '#454b48' : '#4a3b2b';
    ctx.fillRect(truckX - w * 0.31, h * 0.66, w * 0.62, h * 0.34);
  }
  // falling material when the bucket opens
  if (st.bucketFill < mem.lastPay - 2 && st.bucketFill < 60) {
    for (let i = 0; i < 26; i++) mem.falling.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.55, vy: Math.random() * 2, vx: (Math.random() - 0.5) * 2, r: 2 + Math.random() * 5, life: 1 });
  }
  mem.lastPay = st.bucketFill;
  // the bucket
  const bw = w * 0.5;
  const bh = h * 0.42;
  const bx = w / 2 - bw / 2;
  const by = h * 0.18 + Math.sin(st.t / 700) * h * 0.01;
  ctx.fillStyle = p.ir ? '#3b403f' : '#c99417';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw * 0.92, by + bh); ctx.lineTo(bx + bw * 0.08, by + bh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = p.ir ? '#2c302f' : '#3a3026';
  ctx.beginPath(); ctx.moveTo(bx + bw * 0.06, by + bh * 0.08); ctx.lineTo(bx + bw * 0.94, by + bh * 0.08); ctx.lineTo(bx + bw * 0.88, by + bh * 0.9); ctx.lineTo(bx + bw * 0.12, by + bh * 0.9); ctx.closePath(); ctx.fill();
  // material heap in bucket
  const fill = Math.max(0, Math.min(1.15, st.bucketFill / 100));
  if (fill > 0.02) {
    const top = by + bh * (0.9 - 0.82 * fill);
    ctx.fillStyle = p.ir ? '#6a706d' : '#6f5843';
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.12, by + bh * 0.9);
    for (let i = 0; i <= 12; i++) {
      const x = bx + bw * (0.12 + (i / 12) * 0.76);
      const y = top + Math.sin(i * 1.3) * bh * 0.04 - (fill > 1 ? Math.sin((i / 12) * Math.PI) * bh * 0.15 * (fill - 1) * 6 : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(bx + bw * 0.88, by + bh * 0.9);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = i % 2 ? (p.ir ? '#7e8582' : '#86705a') : (p.ir ? '#545a57' : '#5a4634');
      ctx.beginPath(); ctx.arc(bx + bw * (0.18 + hash(i * 3) * 0.64), top + bh * 0.05 + hash(i * 5) * (by + bh * 0.85 - top), w * 0.008 + hash(i) * w * 0.01, 0, Math.PI * 2); ctx.fill();
    }
  }
  // teeth
  ctx.fillStyle = p.ir ? '#9ca3a0' : '#9aa0a6';
  for (let i = 0; i < 6; i++) {
    const tx = bx + bw * (0.12 + i * 0.152);
    ctx.beginPath(); ctx.moveTo(tx, by + bh); ctx.lineTo(tx + bw * 0.06, by + bh); ctx.lineTo(tx + bw * 0.03, by + bh * 1.12); ctx.closePath(); ctx.fill();
  }
  // particles
  for (const q of mem.falling) {
    q.vy += 0.5;
    q.y += q.vy;
    q.x += q.vx;
    q.life -= 0.02;
    ctx.fillStyle = p.ir ? 'rgba(130,140,135,0.9)' : 'rgba(110,88,66,0.95)';
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
  }
  mem.falling = mem.falling.filter((q) => q.life > 0 && q.y < h + 10);
  // payload HUD
  hudBox(ctx, w * 0.03, h * 0.68, w * 0.3, [
    ['BUCKET', `${Math.round(st.bucketFill)} %`],
    ['LOAD', `${(st.payloadT).toFixed(1)} t`],
    ['SWING', `${Math.round(st.swing)}°`],
  ], w);
}

function viewTray(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, p: Pal) {
  ctx.fillStyle = p.ground;
  ctx.fillRect(0, 0, w, h);
  const tilt = st.dumping ? Math.min(1, Math.max(0.15, 1 - st.payloadPct)) : 0;
  const top = h * (0.08 + tilt * 0.18);
  const bot = h * 0.96;
  const tl = w * (0.16 + tilt * 0.08);
  const tr = w * (0.84 - tilt * 0.08);
  // body walls
  ctx.fillStyle = p.ir ? '#4b504e' : '#c8951a';
  ctx.beginPath(); ctx.moveTo(w * 0.04, bot); ctx.lineTo(tl - w * 0.06, top); ctx.lineTo(tr + w * 0.06, top); ctx.lineTo(w * 0.96, bot); ctx.closePath(); ctx.fill();
  // floor
  ctx.fillStyle = p.ir ? '#2f3432' : '#3d3a35';
  ctx.beginPath(); ctx.moveTo(w * 0.12, bot); ctx.lineTo(tl, top + h * 0.04); ctx.lineTo(tr, top + h * 0.04); ctx.lineTo(w * 0.88, bot); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 6; i++) {
    const f = i / 6;
    ctx.beginPath(); ctx.moveTo(w * 0.12 + (tl - w * 0.12) * f, bot + (top + h * 0.04 - bot) * f); ctx.lineTo(w * 0.88 + (tr - w * 0.88) * f, bot + (top + h * 0.04 - bot) * f); ctx.stroke();
  }
  // material heap
  const fill = Math.max(0, Math.min(1.2, st.payloadPct));
  if (fill > 0.01) {
    const cx = w / 2;
    const cy = h * (0.58 - tilt * 0.1);
    const rx = w * 0.33 * Math.sqrt(fill);
    const ry = h * 0.36 * Math.sqrt(fill);
    const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.3, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, p.ir ? '#8b928f' : '#8b735a');
    g.addColorStop(1, p.ir ? '#4f5553' : '#5a4634');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = 1 + (hash(i * 3.3) - 0.5) * 0.18;
      const x = cx + Math.cos(a) * rx * rr;
      const y = cy + Math.sin(a) * ry * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const a = hash(i * 7.7) * Math.PI * 2;
      const rr = Math.sqrt(hash(i * 1.9));
      ctx.fillStyle = i % 2 ? (p.ir ? '#a1a8a5' : '#9c8468') : (p.ir ? '#606663' : '#4e3d2e');
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * rr * 0.9, cy + Math.sin(a) * ry * rr * 0.9, w * (0.006 + hash(i) * 0.012), 0, Math.PI * 2); ctx.fill();
    }
  }
  // new pass: material falls in
  if (mem.lastPay >= 0 && st.payloadT > mem.lastPay + 5) {
    for (let i = 0; i < 60; i++) mem.falling.push({ x: w * (0.3 + Math.random() * 0.4), y: -Math.random() * h * 0.3, vy: 2 + Math.random() * 3, vx: (Math.random() - 0.5) * 2, r: 2 + Math.random() * 6, life: 1 });
    mem.dust.push({ x: w / 2, y: h * 0.5, vx: 0, vy: -0.3, r: w * 0.2, a: 0.5 });
  }
  mem.lastPay = st.payloadT;
  for (const q of mem.falling) {
    q.vy += 0.6;
    q.y += q.vy;
    q.x += q.vx;
    q.life -= 0.012;
    ctx.fillStyle = p.ir ? 'rgba(150,160,155,0.95)' : 'rgba(120,96,72,0.95)';
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
  }
  mem.falling = mem.falling.filter((q) => q.life > 0 && q.y < h * 0.7);
  for (const d of mem.dust) {
    d.r *= 1.01;
    d.a *= 0.97;
    dustPuff(ctx, d.x, d.y, d.r, d.a * (p.ir ? 0.3 : 0.6));
  }
  mem.dust = mem.dust.filter((d) => d.a > 0.02);
  // loading shadow of the bucket
  if (st.loading && !p.ir) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(w * (0.5 + Math.sin(st.t / 3000) * 0.15), h * 0.4, w * 0.18, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  }
  const pct = Math.round(st.payloadPct * 100);
  hudBox(ctx, w * 0.03, h * 0.04, w * 0.3, [
    ['PAYLOAD', `${st.payloadT.toFixed(1)} t`],
    ['RATED', `${pct} %`],
  ], w, pct > 110 ? '#ef4444' : pct > 105 ? '#f59e0b' : '#22c55e');
}

function viewDrill(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, p: Pal) {
  const hz = h * 0.35;
  drawSky(ctx, w, hz, p);
  drawRidge(ctx, w, hz, 0, h * 0.15, p.far, 3.1, true);
  ctx.fillStyle = p.groundFar;
  ctx.fillRect(0, hz, w, h - hz);
  // drill pattern flags
  for (let r = 0; r < 4; r++) {
    for (let c = -3; c <= 3; c++) {
      const z = 8 + r * 7;
      const x = w / 2 + (c * 6 / z) * h * 0.9;
      const y = hz + (4 / z) * h * 0.55;
      const s = (1 / z) * h * 1.2;
      ctx.fillStyle = '#ff6b00';
      ctx.fillRect(x, y - s * 1.6, s * 0.12, s * 1.6);
      ctx.fillRect(x, y - s * 1.6, s * 0.5, s * 0.35);
    }
  }
  // mast and rotating pipe
  const mx = w * 0.5;
  ctx.fillStyle = p.yellow;
  ctx.fillRect(mx - w * 0.05, 0, w * 0.1, h * 0.86);
  ctx.fillStyle = p.ir ? '#5c6360' : '#7b8188';
  ctx.fillRect(mx - w * 0.015, 0, w * 0.03, h * 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const phase = st.status === 'running' && st.act.startsWith('Drilling') ? (st.t / 60) % 20 : 0;
  for (let y = -20 + phase; y < h; y += 20) ctx.fillRect(mx - w * 0.015, y, w * 0.03, 4);
  if (st.act.startsWith('Drilling')) {
    dustPuff(ctx, mx, h * 0.9, w * 0.3, p.ir ? 0.12 : 0.4);
    hudBox(ctx, w * 0.62, h * 0.06, w * 0.34, [['DEPTH', `${st.depth.toFixed(1)} m`], ['MODE', 'ROTARY']], w);
  }
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
}

function hudBox(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, rows: [string, string][], w: number, accent = '#f5a524') {
  const fs = Math.max(9, w / 46);
  const lh = fs * 1.5;
  const bh = rows.length * lh + fs * 0.8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 3, bh);
  ctx.font = `600 ${fs}px "JetBrains Mono Variable", monospace`;
  rows.forEach(([k, v], i) => {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(k, x + 10, y + fs * 1.3 + i * lh);
    ctx.fillStyle = '#fff';
    const tw = ctx.measureText(v).width;
    ctx.fillText(v, x + bw - tw - 8, y + fs * 1.3 + i * lh);
  });
}

function noSignal(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState) {
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect((i * w) / bars.length, 0, w / bars.length + 1, h * 0.7);
  });
  ctx.fillStyle = '#111';
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(grain(), Math.random() * -80, Math.random() * -80, w + 160, h + 160);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(w * 0.25, h * 0.38, w * 0.5, h * 0.2);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.max(12, w / 22)}px "JetBrains Mono Variable", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(st.notice ?? 'NO SIGNAL', w / 2, h * 0.5);
  ctx.font = `500 ${Math.max(9, w / 50)}px "JetBrains Mono Variable", monospace`;
  ctx.fillText(`${st.machineId} · ${st.position.toUpperCase()}`, w / 2, h * 0.555);
  ctx.textAlign = 'left';
}

function overlay(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, ch: number) {
  const fs = Math.max(9, Math.round(w / 48));
  ctx.font = `600 ${fs}px "JetBrains Mono Variable", monospace`;
  ctx.textBaseline = 'alphabetic';
  const pad = fs * 0.7;
  const shadow = (text: string, x: number, y: number, color = '#fff') => {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  shadow(`CH${ch} ${st.label}`, pad, pad + fs);
  const right = st.mode === 'PLAYBACK' ? `▶ PLAYBACK ${st.quality}` : `${st.quality} LIVE`;
  const rw = ctx.measureText(right).width;
  shadow(right, w - rw - pad, pad + fs, st.mode === 'PLAYBACK' ? '#7dd3fc' : '#fff');
  if (st.recording && Math.floor(Date.now() / 600) % 2 === 0) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(w - rw - pad - fs * 0.9, pad + fs * 0.62, fs * 0.36, 0, Math.PI * 2); ctx.fill();
  }
  shadow(stamp(st.t), pad, h - pad);
  const sp = `${st.speed.toFixed(0)} KM/H`;
  shadow(sp, w - ctx.measureText(sp).width - pad, h - pad);
}

const CH: Record<CameraPosition, number> = { front: 1, rear: 2, left: 3, right: 4, cabin: 5, bucket: 6, tray: 6 };

// ---------------------------------------------------------------- real footage

export interface FootageFrame {
  video: HTMLVideoElement;
  flip: boolean;
  /** clip is already a low-light shot */
  native: boolean;
  face?: [number, number];
}

/** Infrared look: one "color" blend fill turns the area into a green-tinted monochrome image.
 *  Much cheaper than ctx.filter, which allocates an offscreen layer for every filtered draw. */
export function irTint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = 'hsl(140, 20%, 50%)';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

const vignettes = new Map<string, HTMLCanvasElement>();
/** Lens vignette, rendered once per size and reused. */
function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, inner: number, alpha: number) {
  const key = `${w}x${h}:${inner}:${alpha}`;
  let c = vignettes.get(key);
  if (!c) {
    if (vignettes.size > 24) vignettes.clear();
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.max(w, h) * (inner + 0.38));
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${alpha})`);
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    vignettes.set(key, c);
  }
  ctx.drawImage(c, 0, 0);
}

/** Draws a video frame scaled to cover the canvas; infrared look at night. */
export function drawVideoCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number, flip: boolean, ir: boolean) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const s = Math.max(w / vw, h / vh);
  const sw = w / s;
  const sh = h / s;
  if (flip) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
  }
  if (ir) irTint(ctx, x, y, w, h);
}

function parkingGuides(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cols = ['#ef4444', '#f59e0b', '#22c55e'];
  ctx.lineWidth = Math.max(2, w / 180);
  for (let i = 0; i < 3; i++) {
    const y = h * (0.92 - i * 0.12);
    const inset = w * (0.18 + i * 0.07);
    ctx.strokeStyle = cols[i];
    ctx.beginPath();
    ctx.moveTo(inset, y); ctx.lineTo(inset + w * 0.06, y);
    ctx.moveTo(w - inset, y); ctx.lineTo(w - inset - w * 0.06, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.moveTo(w * 0.18, h * 0.95); ctx.lineTo(w * 0.32, h * 0.62); ctx.moveTo(w * 0.82, h * 0.95); ctx.lineTo(w * 0.68, h * 0.62); ctx.stroke();
}

function proximityLines(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const zc = ['rgba(239,68,68,0.8)', 'rgba(245,158,11,0.75)', 'rgba(34,197,94,0.7)'];
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.setLineDash([w / 40, w / 60]);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = zc[i];
    const y = h * (0.86 - i * 0.14);
    ctx.beginPath(); ctx.moveTo(w * 0.04, y); ctx.quadraticCurveTo(w / 2, y + h * 0.04, w * 0.96, y); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function dmsBox(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, face: [number, number]) {
  const r = h * 0.17;
  const box = { x: face[0] * w - r, y: face[1] * h - r * 1.1, w: r * 2, h: r * 2.3 };
  const col = st.dms === 1 ? '#ef4444' : st.dms === 2 ? '#f59e0b' : '#22c55e';
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, w / 300);
  const c = box.w * 0.2;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + c); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + c, box.y);
  ctx.moveTo(box.x + box.w - c, box.y); ctx.lineTo(box.x + box.w, box.y); ctx.lineTo(box.x + box.w, box.y + c);
  ctx.moveTo(box.x, box.y + box.h - c); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + c, box.y + box.h);
  ctx.moveTo(box.x + box.w - c, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h - c);
  ctx.stroke();
  const label = st.dms === 1 ? 'FATIGUE · EYES CLOSED' : st.dms === 2 ? 'DISTRACTION · PHONE' : 'DRIVER ATTENTIVE';
  ctx.font = `600 ${Math.max(9, w / 52)}px "JetBrains Mono Variable", monospace`;
  const tw = ctx.measureText(label).width;
  const lx = Math.min(w - tw - 12, Math.max(2, box.x));
  ctx.fillStyle = col;
  ctx.fillRect(lx, box.y - w / 34, tw + 10, w / 34);
  ctx.fillStyle = '#0b0b0c';
  ctx.fillText(label, lx + 5, box.y - w / 120);
  if (st.dms && Math.floor(st.t / 400) % 2 === 0) {
    ctx.fillStyle = st.dms === 1 ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.14)';
    ctx.fillRect(0, 0, w, h);
  }
}

function renderFootage(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, f: FootageFrame) {
  const night = isNight(st.t);
  drawVideoCover(ctx, f.video, 0, 0, w, h, f.flip, night && !f.native);
  switch (st.position) {
    case 'rear': if (st.reversing || st.speed < 8) parkingGuides(ctx, w, h); break;
    case 'left':
    case 'right': if (st.type === 'truck' || st.type === 'water' || st.type === 'lv') proximityLines(ctx, w, h); break;
    case 'cabin': dmsBox(ctx, w, h, st, f.face ?? [0.5, 0.35]); break;
    case 'tray': {
      const pct = Math.round(st.payloadPct * 100);
      hudBox(ctx, w * 0.03, h * 0.66, w * 0.3, [['PAYLOAD', `${st.payloadT.toFixed(1)} t`], ['RATED', `${pct} %`]], w, pct > 110 ? '#ef4444' : pct > 105 ? '#f59e0b' : '#22c55e');
      break;
    }
    case 'bucket':
      hudBox(ctx, w * 0.03, h * 0.66, w * 0.3, [['BUCKET', `${Math.round(st.bucketFill)} %`], ['LOAD', `${st.payloadT.toFixed(1)} t`], ['SWING', `${Math.round(st.swing)}°`]], w);
      break;
    case 'front':
      if (st.type === 'drill' && st.act.startsWith('Drilling')) hudBox(ctx, w * 0.62, h * 0.08, w * 0.34, [['DEPTH', `${st.depth.toFixed(1)} m`], ['MODE', 'ROTARY']], w);
      break;
  }
  vignette(ctx, w, h, 0.4, 0.35);
}

/** Draw one camera frame. `dt` is real seconds since the last frame of this view. */
export function renderCamera(ctx: CanvasRenderingContext2D, w: number, h: number, st: CamState, mem: ViewMemory, dt: number, footage?: FootageFrame | null) {
  const p = palette(isNight(st.t));
  const mps = st.speed / 3.6;
  mem.odo += mps * Math.min(dt, 0.25) * (st.reversing ? -1 : 1);
  mem.turnSmooth += (st.turn - mem.turnSmooth) * Math.min(1, dt * 1.5);
  mem.pan += st.turn * dt * 40;
  ctx.save();
  if (st.offline) {
    noSignal(ctx, w, h, st);
  } else if (footage) {
    renderFootage(ctx, w, h, st, footage);
  } else {
    switch (st.position) {
      case 'front':
        if (st.type === 'drill') viewDrill(ctx, w, h, st, p);
        else if (st.type === 'shovel' || st.type === 'excavator') viewBucket(ctx, w, h, { ...st, swing: st.swing * 0.3 }, mem, p);
        else viewRoad(ctx, w, h, st, mem, p);
        break;
      case 'rear': viewRear(ctx, w, h, st, mem, p); break;
      case 'left': viewSide(ctx, w, h, st, mem, p, 1); break;
      case 'right': viewSide(ctx, w, h, st, mem, p, -1); break;
      case 'cabin': viewCabin(ctx, w, h, st, mem, p); break;
      case 'bucket': viewBucket(ctx, w, h, st, mem, p); break;
      case 'tray': viewTray(ctx, w, h, st, mem, p); break;
    }
    // lens: grain, vignette, IR tint
    ctx.globalAlpha = p.ir ? 0.12 : 0.05;
    ctx.globalCompositeOperation = 'overlay';
    mem.grain = (mem.grain + 37) % 160;
    ctx.drawImage(grain(), -mem.grain, -((mem.grain * 3) % 160), w + 160, h + 160);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (p.ir) {
      ctx.fillStyle = 'rgba(40,70,55,0.12)';
      ctx.fillRect(0, 0, w, h);
    }
    vignette(ctx, w, h, 0.35, 0.45);
  }
  overlay(ctx, w, h, st, CH[st.position]);
  ctx.restore();
}
