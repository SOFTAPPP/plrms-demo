import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config, ROOT } from '../config';
import * as schema from './schema';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('temp_store = MEMORY');
sqlite.pragma('cache_size = -32000');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(ROOT, 'server/db/migrations') });
}

/** Wipe every table's rows (used by "reset demo data"). */
export function truncateAll() {
  const tables = sqlite
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as { name: string }[];
  sqlite.transaction(() => {
    for (const t of tables) sqlite.prepare(`delete from "${t.name}"`).run();
    sqlite.prepare("delete from sqlite_sequence").run();
  })();
}
