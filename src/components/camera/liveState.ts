// Builds a camera frame state from the live WebSocket data (read on demand, no React re-renders).
import type { CameraPosition, MachineLive } from '../../../shared/types';
import { frameClock, useLive } from '../../lib/live';
import type { CamState, NearbyObject } from './render';

const lastHeading = new Map<string, { h: number; turn: number; frame: number }>();

export function nearbyOf(m: { x: number; y: number; h: number; id: string }, all: Iterable<{ id: string; x: number; y: number; type: MachineLive['type'] }>, radius = 90): NearbyObject[] {
  const out: NearbyObject[] = [];
  const hr = (m.h * Math.PI) / 180;
  const c = Math.cos(hr);
  const s = Math.sin(hr);
  for (const o of all) {
    if (o.id === m.id) continue;
    const dx = o.x - m.x;
    const dy = o.y - m.y;
    if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
    out.push({ id: o.id, type: o.type, fwd: dx * c + dy * s, left: dx * s - dy * c });
  }
  return out;
}

export function liveCamState(machineId: string, position: CameraPosition, label: string, recording: boolean, quality = '1080p'): CamState | null {
  const live = useLive.getState();
  const m = live.machines[machineId];
  if (!m) return null;
  const t = live.t + (live.paused ? 0 : Math.min(1000, performance.now() - frameClock.at) * live.speed);
  let turn = 0;
  const prev = lastHeading.get(machineId);
  if (prev && prev.frame !== live.frameNo) {
    const dh = ((m.h - prev.h + 540) % 360) - 180;
    turn = Math.max(-1, Math.min(1, dh / 25));
    lastHeading.set(machineId, { h: m.h, turn, frame: live.frameNo });
  } else if (prev) {
    turn = prev.turn;
  } else {
    lastHeading.set(machineId, { h: m.h, turn: 0, frame: live.frameNo });
  }
  const cap = m.s.payload_pct !== undefined ? m.s.payload_pct / 100 : 0;
  return {
    machineId, type: m.type, position, label, t, speed: m.spd, status: m.st, act: m.act,
    payloadPct: cap, payloadT: m.type === 'truck' ? m.s.payload ?? 0 : m.s.bucket_weight ?? 0,
    bucketFill: m.s.bucket_fill ?? 0, swing: m.s.swing_angle ?? 0, boom: m.s.boom_angle ?? 25, water: m.s.water_level ?? 0,
    depth: m.s.drill_depth ?? 0, dms: m.dms ?? 0, offline: m.st === 'offline' || Boolean(m.camOff?.includes(`${machineId}-${position}`)),
    operator: m.op, recording, mode: 'LIVE', quality, nearby: nearbyOf(m, Object.values(live.machines)), turn,
    reversing: m.act.startsWith('Spotting') || m.act === 'Reversing', dumping: m.act.startsWith('Tipping'),
    loading: m.st === 'loading',
  };
}
