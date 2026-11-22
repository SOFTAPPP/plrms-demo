// Live data: one WebSocket, a small zustand store, and ring buffers for sparklines.
import { create } from 'zustand';
import { toast } from 'sonner';
import type { AlertRow, KpiSnapshot, LiveFrame, MachineLive, ServerMessage } from '../../shared/types';
import { get } from './api';
import { useApp } from './app-store';

export interface FeedEvent {
  id: number;
  t: number;
  kind: string;
  text: string;
  machineId?: string;
}

interface LiveState {
  connected: boolean;
  t: number;
  speed: number;
  paused: boolean;
  machines: Record<string, MachineLive>;
  ids: string[];
  kpi: KpiSnapshot | null;
  frameNo: number;
  feed: FeedEvent[];
  openAlerts: AlertRow[];
  alertsVersion: number;
}

export const useLive = create<LiveState>(() => ({
  connected: false,
  t: Date.now(),
  speed: 1,
  paused: false,
  machines: {},
  ids: [],
  kpi: null,
  frameNo: 0,
  feed: [],
  openAlerts: [],
  alertsVersion: 0,
}));

// ---------------------------------------------------------------- ring buffers for sparklines

const HIST = 150;
class Ring {
  v = new Float32Array(HIST);
  n = 0;
  i = 0;
  push(x: number) {
    this.v[this.i] = x;
    this.i = (this.i + 1) % HIST;
    if (this.n < HIST) this.n++;
  }
  values(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.n; k++) out.push(this.v[(this.i - this.n + k + HIST) % HIST]);
    return out;
  }
}
const rings = new Map<string, Ring>();
function ring(key: string) {
  let r = rings.get(key);
  if (!r) { r = new Ring(); rings.set(key, r); }
  return r;
}
export function history(key: string): number[] {
  return rings.get(key)?.values() ?? [];
}

/** performance.now() of the last frame, used to extrapolate the sim clock between frames */
export const frameClock = { at: performance.now() };

const KPI_KEYS: (keyof KpiSnapshot)[] = ['tph', 'availability', 'utilisation', 'fuelBurnLph', 'activeAlerts', 'avgCycleMin', 'avgQueueMin', 'tonnesDay'];

function onFrame(f: LiveFrame) {
  frameClock.at = performance.now();
  const machines: Record<string, MachineLive> = {};
  for (const m of f.machines) {
    machines[m.id] = m;
    for (const k in m.s) ring(`${m.id}:${k}`).push(m.s[k]);
  }
  for (const k of KPI_KEYS) ring(`kpi:${k}`).push(f.kpi[k] as number);
  const prev = useLive.getState();
  const ids = prev.ids.length === f.machines.length ? prev.ids : f.machines.map((m) => m.id);
  useLive.setState({ machines, ids, kpi: f.kpi, t: f.t, speed: f.speed, paused: f.paused, frameNo: prev.frameNo + 1 });
}

let feedId = 1;
function pushFeed(e: Omit<FeedEvent, 'id'>) {
  const feed = [{ ...e, id: feedId++ }, ...useLive.getState().feed].slice(0, 60);
  useLive.setState({ feed });
}

function onAlert(a: AlertRow, isNew: boolean) {
  const st = useLive.getState();
  let list = st.openAlerts.filter((x) => x.id !== a.id);
  if (a.status !== 'resolved') list = [a, ...list];
  list.sort((x, y) => (x.status === y.status ? y.lastTs - x.lastTs : x.status === 'active' ? -1 : 1));
  useLive.setState({ openAlerts: list, alertsVersion: st.alertsVersion + 1 });
  if (isNew) {
    pushFeed({ t: a.ts, kind: `alert-${a.severity}`, text: `${a.title} · ${a.machineId}`, machineId: a.machineId });
    if (!useApp.getState().muted && a.severity !== 'info') {
      const fn = a.severity === 'critical' ? toast.error : toast.warning;
      fn(`${a.title} — ${a.machineId}`, {
        description: a.message,
        duration: a.severity === 'critical' ? 9000 : 5000,
        action: { label: 'View', onClick: () => window.dispatchEvent(new CustomEvent('strata:navigate', { detail: `/alerts?focus=${a.id}` })) },
      });
    }
  }
}

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'frame':
      onFrame(msg);
      break;
    case 'alert':
      onAlert(msg.alert, msg.isNew);
      break;
    case 'event':
      pushFeed({ t: msg.t, kind: msg.kind, text: msg.text, machineId: msg.machineId });
      if (msg.kind === 'reset') {
        toast.success('Demo data regenerated');
        rings.clear();
        void loadOpenAlerts();
        void useApp.getState().refresh();
      } else if (!useApp.getState().muted && (msg.kind === 'breakdown' || msg.kind === 'shift' || msg.kind === 'info' || msg.kind === 'dispatch')) {
        toast(msg.text);
      }
      break;
    case 'hello':
      useLive.setState({ t: msg.t, speed: msg.speed });
      break;
  }
}

export async function loadOpenAlerts() {
  try {
    const r = await get<{ rows: AlertRow[] }>('/alerts?status=open&limit=500');
    useLive.setState((s) => ({ openAlerts: r.rows, alertsVersion: s.alertsVersion + 1 }));
  } catch {
    /* shown elsewhere */
  }
}

let ws: WebSocket | null = null;
let retry = 0;
let stopped = true;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

export function connectLive() {
  stopped = false;
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    useLive.setState({ connected: true });
    void loadOpenAlerts();
  };
  sock.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data as string) as ServerMessage);
    } catch {
      /* ignore malformed frames */
    }
  };
  sock.onclose = () => {
    useLive.setState({ connected: false });
    if (ws === sock) ws = null;
    if (stopped) return;
    const delay = Math.min(8000, 500 * 2 ** retry++);
    retryTimer = setTimeout(() => {
      // the session may have expired; the bootstrap call routes to the login page if so
      if (retry > 2) void useApp.getState().refresh();
      connectLive();
    }, delay);
  };
}

export function disconnectLive() {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  // Deferred so an immediate re-connect (React dev double-mount) reuses the socket.
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    const sock = ws;
    ws = null;
    if (!sock) return;
    if (sock.readyState === WebSocket.CONNECTING) sock.onopen = () => sock.close();
    else sock.close();
  }, 250);
}

// ---------------------------------------------------------------- selectors

export const useMachine = (id: string | undefined) => useLive((s) => (id ? s.machines[id] : undefined));
export const useSimTime = () => useLive((s) => s.t);
export const useKpi = () => useLive((s) => s.kpi);
