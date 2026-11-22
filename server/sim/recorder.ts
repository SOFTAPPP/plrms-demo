// Writes simulator output to SQLite with prepared statements (fast enough for multi-day backfill).
import { sqlite } from '../db/client';

export type TelemetryRow = [
  machineId: string, ts: number, st: string, act: string | null, x: number, y: number, h: number, spd: number,
  pay: number | null, fuel: number, eTemp: number, rpm: number, eLoad: number, fuelRate: number,
  brk: number | null, tyreP: number | null, tyreT: number | null, hyd: number | null, vib: number | null, bat: number,
  swing: number | null, boom: number | null, stick: number | null, arm: number | null, bFill: number | null,
  water: number | null, depth: number | null,
];

export interface ProductionRow {
  ts: number; mineDay: string; shift: string; truckId: string; loaderId: string; routeId: string; operatorId: number | null;
  material: string; tonnes: number; passes: number; loadTs: number; cycleSec: number; queueSec: number; spotSec: number;
  loadSec: number; haulSec: number; dumpSec: number; returnSec: number; distanceKm: number;
}

export interface StatDelta {
  operatingSec: number; idleSec: number; downSec: number; maintSec: number; fuelL: number; distanceKm: number;
  loads: number; tonnes: number; passes: number;
}

export function emptyStats(): StatDelta {
  return { operatingSec: 0, idleSec: 0, downSec: 0, maintSec: 0, fuelL: 0, distanceKm: 0, loads: 0, tonnes: 0, passes: 0 };
}

export class Recorder {
  private telemetryStmt = sqlite.prepare(
    `insert into telemetry (machine_id, ts, st, act, x, y, h, spd, pay, fuel, e_temp, rpm, e_load, fuel_rate, brk, tyre_p, tyre_t, hyd, vib, bat, swing, boom, stick, arm, b_fill, water, depth)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  private prodStmt = sqlite.prepare(
    `insert into production_events (ts, mine_day, shift, truck_id, loader_id, route_id, operator_id, material, tonnes, passes, load_ts, cycle_sec, queue_sec, spot_sec, load_sec, haul_sec, dump_sec, return_sec, distance_km)
     values (@ts, @mineDay, @shift, @truckId, @loaderId, @routeId, @operatorId, @material, @tonnes, @passes, @loadTs, @cycleSec, @queueSec, @spotSec, @loadSec, @haulSec, @dumpSec, @returnSec, @distanceKm)`,
  );
  private fuelStmt = sqlite.prepare(
    `insert into fuel_events (ts, machine_id, type, litres, level_before, level_after, location, note, recorded_by) values (?,?,?,?,?,?,?,?,?)`,
  );
  private openDownStmt = sqlite.prepare(
    `insert into downtime (machine_id, start, end, category, reason, notes, source, created_by) values (?,?,null,?,?,?,?,?)`,
  );
  private closeDownStmt = sqlite.prepare(`update downtime set end = ? where id = ? and end is null`);
  private statStmt = sqlite.prepare(
    `insert into machine_shift_stats (mine_day, shift, machine_id, operating_sec, idle_sec, down_sec, maint_sec, fuel_l, distance_km, loads, tonnes, passes)
     values (?,?,?,?,?,?,?,?,?,?,?,?)
     on conflict(mine_day, shift, machine_id) do update set
       operating_sec = operating_sec + excluded.operating_sec, idle_sec = idle_sec + excluded.idle_sec,
       down_sec = down_sec + excluded.down_sec, maint_sec = maint_sec + excluded.maint_sec,
       fuel_l = fuel_l + excluded.fuel_l, distance_km = distance_km + excluded.distance_km,
       loads = loads + excluded.loads, tonnes = tonnes + excluded.tonnes, passes = passes + excluded.passes`,
  );
  private maintInsert = sqlite.prepare(
    `insert into maintenance (machine_id, title, type, status, priority, due_at, duration_h, started_at, completed_at, technician, cost, notes, source, created_by)
     values (?,?,?,?,?,?,?,?,null,?,null,?,?,?)`,
  );
  private maintComplete = sqlite.prepare(`update maintenance set status = 'completed', completed_at = ?, cost = coalesce(cost, ?) where id = ?`);
  private maintStart = sqlite.prepare(`update maintenance set status = 'in_progress', started_at = ? where id = ?`);
  private maintDue = sqlite.prepare(`select id, machine_id as machineId, title, duration_h as durationH from maintenance where status = 'scheduled' and due_at <= ? order by due_at`);

  telemetry(rows: TelemetryRow[]) {
    for (const r of rows) this.telemetryStmt.run(r);
  }

  production(p: ProductionRow) {
    this.prodStmt.run(p);
  }

  fuel(ts: number, machineId: string, type: string, litres: number, before: number, after: number, location: string, note: string | null, by: string) {
    this.fuelStmt.run(ts, machineId, type, litres, before, after, location, note, by);
  }

  openDowntime(machineId: string, start: number, category: string, reason: string, notes: string | null = null): number {
    return Number(this.openDownStmt.run(machineId, start, category, reason, notes, 'system', 'system').lastInsertRowid);
  }

  closeDowntime(id: number, end: number) {
    this.closeDownStmt.run(end, id);
  }

  stats(mineDay: string, shift: string, machineId: string, d: StatDelta) {
    this.statStmt.run(mineDay, shift, machineId, d.operatingSec, d.idleSec, d.downSec, d.maintSec, d.fuelL, d.distanceKm, d.loads, d.tonnes, d.passes);
  }

  createWorkOrder(machineId: string, title: string, type: string, priority: string, start: number, durationH: number, technician: string, notes: string): number {
    return Number(this.maintInsert.run(machineId, title, type, 'in_progress', priority, start, durationH, start, technician, notes, 'system', 'system').lastInsertRowid);
  }

  startWorkOrder(id: number, ts: number) {
    this.maintStart.run(ts, id);
  }

  completeWorkOrder(id: number, ts: number, cost: number) {
    this.maintComplete.run(ts, cost, id);
  }

  dueWorkOrders(ts: number): { id: number; machineId: string; title: string; durationH: number }[] {
    return this.maintDue.all(ts) as { id: number; machineId: string; title: string; durationH: number }[];
  }

  transaction(fn: () => void) {
    sqlite.transaction(fn)();
  }

  /** Thin old telemetry (10 s -> 1 min after 2 h, -> 5 min after 48 h) and drop expired rows. */
  retention(now: number, historyDays: number) {
    const H = 3_600_000;
    sqlite.prepare('delete from telemetry where ts < ? and ts % 60000 != 0').run(now - 2 * H);
    sqlite.prepare('delete from telemetry where ts < ? and ts % 300000 != 0').run(now - 48 * H);
    sqlite.prepare('delete from telemetry where ts < ?').run(now - (historyDays + 1) * 24 * H);
    const keep = now - 35 * 24 * H;
    sqlite.prepare('delete from production_events where ts < ?').run(keep);
    sqlite.prepare("delete from alerts where ts < ? and status = 'resolved'").run(keep);
    sqlite.prepare('delete from fuel_events where ts < ?').run(keep);
    sqlite.prepare('delete from downtime where start < ? and end is not null').run(keep);
    sqlite.prepare('delete from snapshots where id not in (select id from snapshots order by id desc limit 300)').run();
    sqlite.prepare('delete from audit_log where id not in (select id from audit_log order by id desc limit 2000)').run();
  }
}
