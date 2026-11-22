// Owns the simulator instance: first-run seeding, history backfill, the live loop and demo resets.
import { sqlite, runMigrations, truncateAll } from './db/client';
import { seedBase } from './db/seed';
import { Engine } from './sim/engine';
import { config } from './config';
import type { ServerMessage } from '../shared/types';

const DAY = 86_400_000;

class Runtime {
  engine!: Engine;
  private listeners = new Set<(msg: ServerMessage) => void>();
  private loop: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private lastFrame = 0;
  private lastPersist = 0;
  private lastRetention = 0;
  busy: string | null = null;

  subscribe(fn: (msg: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(msg: ServerMessage) {
    for (const fn of this.listeners) fn(msg);
  }

  /** False while the mine history since the last run is being simulated in the background. */
  ready = false;
  /** 0..1 progress of that catch-up. */
  progress = 0;
  /** Resolves when the catch-up (if any) is done. */
  warm: Promise<void> = Promise.resolve();

  boot() {
    runMigrations();
    const now = Date.now();
    const hasUsers = (sqlite.prepare('select count(*) as n from users').get() as { n: number }).n > 0;
    if (!hasUsers) {
      console.log('[strata] creating demo database...');
      seedBase(now);
    }
    this.warm = this.start();
  }

  /** Builds the engine at once and catches up on the time the app was closed without blocking the server. */
  private start(): Promise<void> {
    this.ready = false;
    this.progress = 0;
    const now = Date.now();
    const last = (sqlite.prepare('select max(ts) as t from telemetry').get() as { t: number | null }).t;
    const earliest = now - config.historyDays * DAY;
    let startAt = last ? Math.max(last, earliest) : earliest;
    if (last && last > now) startAt = last;
    const engine = new Engine(startAt, config.simSpeed);
    engine.loadAll();
    this.engine = engine;
    const target = Math.max(now, startAt);
    const finish = () => {
      engine.loadProductionLog();
      engine.emit = (msg) => this.broadcast(msg);
      this.lastTick = performance.now();
      this.loop = setInterval(() => this.tick(), 200);
      this.progress = 1;
      this.ready = true;
    };
    if (target - startAt <= 60_000) {
      finish();
      return Promise.resolve();
    }
    const hours = (target - startAt) / 3_600_000;
    const t0 = Date.now();
    console.log(`[strata] simulating ${hours.toFixed(1)} h of mine history in the background`);
    return engine
      .fastForwardAsync(target, 5, (f) => { this.progress = f; })
      .then(() => {
        engine.rec.retention(engine.t, config.historyDays);
        finish();
        console.log(`[strata] history ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      });
  }

  private tick() {
    const nowP = performance.now();
    const realDt = Math.min(1, (nowP - this.lastTick) / 1000);
    this.lastTick = nowP;
    const e = this.engine;
    if (!e.paused) {
      let simDt = realDt * e.speed;
      while (simDt > 0) {
        const d = Math.min(1, simDt);
        e.step(d);
        simDt -= d;
      }
    }
    if (nowP - this.lastFrame >= 480) {
      this.lastFrame = nowP;
      if (this.listeners.size) this.broadcast(e.frame());
    }
    if (nowP - this.lastPersist > 60_000) {
      this.lastPersist = nowP;
      e.persistMachines();
    }
    if (nowP - this.lastRetention > 5 * 60_000) {
      this.lastRetention = nowP;
      e.rec.retention(e.t, config.historyDays);
    }
  }

  setSpeed(speed: number) {
    this.engine.speed = Math.min(60, Math.max(1, speed));
  }

  setPaused(p: boolean) {
    this.engine.paused = p;
  }

  /** Throw away all data and rebuild the demo from scratch. */
  async reset() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.busy = 'Resetting demo data';
    try {
      truncateAll();
      seedBase(Date.now());
      this.warm = this.start();
      await this.warm;
    } finally {
      this.busy = null;
    }
    this.broadcast({ type: 'event', kind: 'reset', text: 'Demo data was reset', t: this.engine.t });
  }

  shutdown() {
    if (this.loop) clearInterval(this.loop);
    try {
      this.engine?.flushStats();
      this.engine?.persistMachines();
    } catch {
      /* closing anyway */
    }
  }
}

export const runtime = new Runtime();
