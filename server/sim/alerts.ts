// Alert lifecycle: raise (deduplicated per machine + type), escalate, acknowledge, resolve, auto-close.
import { sqlite } from '../db/client';
import type { AlertRow, CameraPosition, Severity } from '../../shared/types';

export interface RaiseInput {
  machineId: string;
  type: string;
  title: string;
  severity: Severity;
  message: string;
  value?: number | null;
  threshold?: number | null;
  camera?: CameraPosition | null;
  operatorName?: string | null;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

function rowFromDb(r: Record<string, unknown>): AlertRow {
  return {
    id: r.id as number, ts: r.ts as number, lastTs: r.last_ts as number, machineId: r.machine_id as string,
    type: r.type as string, title: r.title as string, severity: r.severity as Severity, message: r.message as string,
    value: (r.value as number | null) ?? null, threshold: (r.threshold as number | null) ?? null,
    status: r.status as AlertRow['status'], count: r.count as number, camera: (r.camera as CameraPosition | null) ?? null,
    operatorName: (r.operator_name as string | null) ?? null, ackBy: (r.ack_by as string | null) ?? null,
    ackAt: (r.ack_at as number | null) ?? null, resolvedBy: (r.resolved_by as string | null) ?? null,
    resolvedAt: (r.resolved_at as number | null) ?? null, note: (r.note as string | null) ?? null,
  };
}

export { rowFromDb as alertFromDb };

export class AlertManager {
  /** unresolved alerts by `${machineId}|${type}` */
  private open = new Map<string, AlertRow>();
  onChange: (row: AlertRow, isNew: boolean) => void = () => {};
  autoCloseMin = 30;

  private ins = sqlite.prepare(
    `insert into alerts (ts, last_ts, machine_id, type, title, severity, message, value, threshold, status, count, camera, operator_name)
     values (?,?,?,?,?,?,?,?,?,'active',1,?,?)`,
  );
  private upd = sqlite.prepare(
    `update alerts set last_ts = ?, severity = ?, message = ?, value = ?, threshold = ?, count = ?, status = ? where id = ?`,
  );
  private setStatus = sqlite.prepare(
    `update alerts set status = ?, ack_by = ?, ack_at = ?, resolved_by = ?, resolved_at = ?, note = coalesce(?, note) where id = ?`,
  );

  load() {
    this.open.clear();
    const rows = sqlite.prepare(`select * from alerts where status != 'resolved'`).all() as Record<string, unknown>[];
    for (const r of rows) {
      const a = rowFromDb(r);
      this.open.set(`${a.machineId}|${a.type}`, a);
    }
  }

  raise(input: RaiseInput, ts: number): AlertRow {
    const key = `${input.machineId}|${input.type}`;
    const existing = this.open.get(key);
    if (existing) {
      existing.lastTs = ts;
      existing.count += 1;
      existing.message = input.message;
      existing.value = input.value ?? null;
      existing.threshold = input.threshold ?? null;
      if (RANK[input.severity] > RANK[existing.severity]) {
        existing.severity = input.severity;
        existing.status = 'active';
      }
      this.upd.run(ts, existing.severity, existing.message, existing.value, existing.threshold, existing.count, existing.status, existing.id);
      this.onChange(existing, false);
      return existing;
    }
    const id = Number(this.ins.run(ts, ts, input.machineId, input.type, input.title, input.severity, input.message,
      input.value ?? null, input.threshold ?? null, input.camera ?? null, input.operatorName ?? null).lastInsertRowid);
    const row: AlertRow = {
      id, ts, lastTs: ts, machineId: input.machineId, type: input.type, title: input.title, severity: input.severity,
      message: input.message, value: input.value ?? null, threshold: input.threshold ?? null, status: 'active', count: 1,
      camera: input.camera ?? null, operatorName: input.operatorName ?? null, ackBy: null, ackAt: null,
      resolvedBy: null, resolvedAt: null, note: null,
    };
    this.open.set(key, row);
    this.onChange(row, true);
    return row;
  }

  has(machineId: string, type: string) {
    return this.open.has(`${machineId}|${type}`);
  }

  /** Condition cleared: resolve automatically. */
  clear(machineId: string, type: string, ts: number, by = 'system (condition cleared)') {
    const key = `${machineId}|${type}`;
    const a = this.open.get(key);
    if (!a) return;
    this.finish(a, by, ts, null);
  }

  acknowledge(id: number, user: string, ts: number, note: string | null): AlertRow | null {
    const a = [...this.open.values()].find((x) => x.id === id);
    if (!a) return null;
    a.status = 'acknowledged';
    a.ackBy = user;
    a.ackAt = ts;
    if (note) a.note = note;
    this.setStatus.run(a.status, a.ackBy, a.ackAt, null, null, note, a.id);
    this.onChange(a, false);
    return a;
  }

  resolve(id: number, user: string, ts: number, note: string | null): AlertRow | null {
    const a = [...this.open.values()].find((x) => x.id === id);
    if (!a) return null;
    this.finish(a, user, ts, note);
    return a;
  }

  private finish(a: AlertRow, by: string, ts: number, note: string | null) {
    a.status = 'resolved';
    a.resolvedBy = by;
    a.resolvedAt = ts;
    if (!a.ackBy) { a.ackBy = by; a.ackAt = ts; }
    if (note) a.note = note;
    this.setStatus.run('resolved', a.ackBy, a.ackAt, a.resolvedBy, a.resolvedAt, note, a.id);
    this.open.delete(`${a.machineId}|${a.type}`);
    this.onChange(a, false);
  }

  /** Close stale non-critical event alerts so the active list stays meaningful. */
  autoClose(ts: number, sticky: (a: AlertRow) => boolean) {
    const limit = this.autoCloseMin * 60_000;
    for (const a of [...this.open.values()]) {
      if (a.severity === 'critical' && a.status === 'active') continue;
      if (sticky(a)) continue;
      if (ts - a.lastTs > limit) this.finish(a, 'system (auto-closed)', ts, null);
    }
  }

  /** After a history backfill: older alerts were handled by people on shift. */
  settleHistory(now: number, people: string[], pick: (n: number) => number) {
    for (const a of [...this.open.values()]) {
      const age = now - a.lastTs;
      if (age > 45 * 60_000) {
        const who = people[pick(people.length)];
        const ackAt = a.ts + (2 + pick(12)) * 60_000;
        a.ackBy = who;
        a.ackAt = Math.min(ackAt, now);
        a.status = 'resolved';
        a.resolvedBy = who;
        a.resolvedAt = Math.min(a.ackAt + (5 + pick(40)) * 60_000, now);
        this.setStatus.run('resolved', a.ackBy, a.ackAt, a.resolvedBy, a.resolvedAt, 'Checked with operator, condition cleared.', a.id);
        this.open.delete(`${a.machineId}|${a.type}`);
      }
    }
  }

  all(): AlertRow[] {
    return [...this.open.values()];
  }

  counts() {
    let total = 0;
    let critical = 0;
    const perMachine = new Map<string, number>();
    for (const a of this.open.values()) {
      total++;
      if (a.severity === 'critical') critical++;
      perMachine.set(a.machineId, (perMachine.get(a.machineId) ?? 0) + 1);
    }
    return { total, critical, perMachine };
  }
}
