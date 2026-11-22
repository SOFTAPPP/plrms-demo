// pnpm db:seed  - create the demo database if it is empty (and catch up history)
// pnpm db:reset - delete every row and rebuild the demo data from scratch
import { sqlite, runMigrations, truncateAll } from './client';
import { runtime } from '../runtime';

const cmd = process.argv[2];
runMigrations();

if (cmd === 'reset') {
  truncateAll();
  console.log('[strata] all data removed');
} else if (cmd !== 'seed') {
  console.error('Usage: tsx server/db/cli.ts <seed|reset>');
  process.exit(1);
}

runtime.boot();
runtime.shutdown();
const n = (sqlite.prepare('select count(*) as n from production_events').get() as { n: number }).n;
console.log(`[strata] database ready (${n} loads of history). Start the app with: pnpm dev`);
process.exit(0);
