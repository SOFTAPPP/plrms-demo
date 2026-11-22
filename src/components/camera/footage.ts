// Real camera footage: a library of mining clips mapped to each camera position, and a controller that
// plays, freezes or scrubs a clip to follow the machine's live (or recorded) state.
// Clips: Mixkit free stock video licence (commercial use allowed), see public/footage/CREDITS.md.
import type { CameraPosition, MachineType } from '../../../shared/types';
import type { CamState } from './render';

/** How a clip follows the machine: driving footage moves with speed, work footage with activity. */
export type ClipMode = 'motion' | 'work' | 'always' | 'payload';

export interface Clip {
  id: number;
  /** operator face position (fraction of width/height) for the driver-monitoring box */
  face?: [number, number];
}

export interface ClipChoice {
  src: string;
  clip: Clip;
  flip: boolean;
  mode: ClipMode;
  /** clip is already a night/low-light shot: do not apply the infrared filter */
  native?: boolean;
}

const LIB: Record<string, Clip[]> = {
  haulFront: [{ id: 39181 }, { id: 45822 }],
  roadFront: [{ id: 16350 }, { id: 40063 }],
  rear: [{ id: 45822 }, { id: 39181 }],
  side: [{ id: 45819 }, { id: 45823 }, { id: 45824 }, { id: 45818 }],
  tray: [{ id: 49192 }, { id: 49193 }, { id: 49190 }],
  bucket: [{ id: 4069 }, { id: 45904 }, { id: 49165 }, { id: 25444 }],
  digFront: [{ id: 10161 }, { id: 45904 }],
  bench: [{ id: 45815 }, { id: 45817 }, { id: 45906 }],
  loader: [{ id: 49189 }, { id: 49188 }],
  dozer: [{ id: 32402 }, { id: 32397 }, { id: 21017 }],
  drill: [{ id: 48993 }, { id: 48994 }],
  cabinDay: [{ id: 41560, face: [0.6, 0.42] }, { id: 13976, face: [0.55, 0.22] }],
  cabinNight: [{ id: 17228, face: [0.17, 0.42] }],
};

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const src = (c: Clip) => `/footage/${c.id}.mp4`;
function pick(list: Clip[], key: string): Clip {
  return list[hashStr(key) % list.length];
}

export function isNightTs(t: number): boolean {
  const h = new Date(t).getHours();
  return h >= 19 || h < 6;
}

export function clipFor(type: MachineType, position: CameraPosition, machineId: string, t: number): ClipChoice {
  const key = `${machineId}:${position}`;
  const choose = (lib: string, mode: ClipMode, flip = false): ClipChoice => {
    const clip = pick(LIB[lib], key);
    return { src: src(clip), clip, flip, mode, native: lib === 'cabinNight' };
  };
  if (position === 'cabin') return isNightTs(t) ? choose('cabinNight', 'always') : choose('cabinDay', 'always');
  switch (type) {
    case 'truck':
    case 'water':
    case 'lv':
      if (position === 'front') return choose(type === 'truck' ? 'haulFront' : 'roadFront', 'motion');
      if (position === 'rear') return choose('rear', 'motion', true);
      if (position === 'left') return choose('side', 'motion');
      if (position === 'right') return choose('side', 'motion', true);
      if (position === 'tray') return choose('tray', 'payload');
      return choose('haulFront', 'motion');
    case 'shovel':
    case 'excavator':
      if (position === 'bucket') return choose('bucket', 'work');
      if (position === 'front') return choose('digFront', 'work');
      return choose('bench', 'always', position === 'right');
    case 'loader':
      if (position === 'front' || position === 'bucket') return choose('loader', 'work');
      return choose('bench', 'always', position === 'right');
    case 'dozer':
      return choose('dozer', 'motion', position === 'rear');
    case 'drill':
      return choose('drill', 'always', position === 'rear');
  }
}

/** One video element per camera view, kept in step with the machine state. */
export class FootagePlayer {
  video: HTMLVideoElement | null = null;
  choice: ClipChoice | null = null;
  private offset = 0;
  private lastT = 0;
  private lastWall = 0;

  constructor(private key: string) {}

  /** Returns the video when it has a frame to draw. */
  update(st: CamState, choice: ClipChoice, visible: boolean): HTMLVideoElement | null {
    if (!this.video || this.choice?.src !== choice.src) this.load(choice);
    this.choice = choice;
    const v = this.video!;
    if (!visible || st.offline) {
      if (!v.paused) v.pause();
      return v.readyState >= 2 ? v : null;
    }
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    // how fast the camera's clock runs compared with real time (recorded playback can be paused or 8× etc.)
    const now = performance.now();
    const wall = this.lastWall ? (now - this.lastWall) / 1000 : 0;
    const ratio = st.mode === 'PLAYBACK' && wall > 0 ? (st.t - this.lastT) / 1000 / wall : 1;
    this.lastT = st.t;
    this.lastWall = now;
    const frozen = st.mode === 'PLAYBACK' && Math.abs(ratio) < 0.05;
    const jumped = st.mode === 'PLAYBACK' && (ratio > 80 || ratio < 0);
    if (jumped && dur) v.currentTime = ((st.t / 1000 + this.offset) % dur + dur) % dur;

    let rate = 0;
    switch (choice.mode) {
      case 'motion': rate = st.speed > 1.5 ? Math.min(2, Math.max(0.5, st.speed / 28)) : 0; break;
      case 'work': rate = st.status === 'loading' || st.status === 'running' ? 1 : 0; break;
      case 'always': rate = st.status === 'offline' ? 0 : 1; break;
      case 'payload':
        if (st.loading) rate = 1;
        else if (dur) {
          const target = Math.min(0.98, Math.max(0.02, st.payloadPct)) * dur;
          if (Math.abs(v.currentTime - target) > 0.4 && !v.seeking) v.currentTime = target;
        }
        break;
    }
    rate *= frozen ? 0 : Math.min(16, Math.max(0.25, ratio));
    if (rate > 0.05) {
      const r = Math.min(16, Math.max(0.25, rate));
      if (Math.abs(v.playbackRate - r) > 0.05) v.playbackRate = r;
      if (v.paused) v.play().catch(() => {});
    } else if (!v.paused) v.pause();
    return v.readyState >= 2 ? v : null;
  }

  pause() {
    if (this.video && !this.video.paused) this.video.pause();
  }

  private load(choice: ClipChoice) {
    this.dispose();
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = choice.src;
    v.addEventListener('loadedmetadata', () => {
      this.offset = (hashStr(this.key) % 997) / 997 * v.duration;
      v.currentTime = this.offset;
    }, { once: true });
    this.video = v;
  }

  dispose() {
    if (!this.video) return;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video = null;
  }
}

// Feeds are shared: every view of the same camera (tile, panorama, bird's-eye, full screen) draws from one
// video decoder. A feed nobody has drawn for a moment is paused; one nobody holds is released.
interface Shared { player: FootagePlayer; refs: number; used: number; t: number; video: HTMLVideoElement | null }
const shared = new Map<string, Shared>();
let sweeper = 0;

function sweep() {
  const now = performance.now();
  for (const s of shared.values()) if (now - s.used > 400) s.player.pause();
  if (!shared.size) { clearInterval(sweeper); sweeper = 0; }
}

export interface Feed {
  key: string;
  /** Keeps the clip in step with the state and returns the video when it has a frame to draw. */
  update(st: CamState, choice: ClipChoice): HTMLVideoElement | null;
  release(): void;
}

export function acquireFeed(key: string): Feed {
  let s = shared.get(key);
  if (!s) {
    s = { player: new FootagePlayer(key), refs: 0, used: 0, t: NaN, video: null };
    shared.set(key, s);
  }
  s.refs++;
  if (!sweeper) sweeper = window.setInterval(sweep, 250);
  const entry = s;
  let released = false;
  return {
    key,
    update(st, choice) {
      const now = performance.now();
      // several views in the same frame: advance the clip once
      if (now - entry.used < 12 && entry.t === st.t && entry.player.choice?.src === choice.src) return entry.video;
      entry.used = now;
      entry.t = st.t;
      entry.video = entry.player.update(st, choice, true);
      return entry.video;
    },
    release() {
      if (released) return;
      released = true;
      if (--entry.refs <= 0) {
        entry.player.dispose();
        shared.delete(key);
      }
    },
  };
}

export const feedKey = (st: CamState) => `${st.machineId}:${st.position}:${st.mode}`;
