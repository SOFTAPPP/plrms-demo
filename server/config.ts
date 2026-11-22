import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// In the desktop build the backend is bundled into server/index.mjs and the app passes STRATA_ROOT.
export const ROOT = process.env.STRATA_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn('[config] could not read .env:', (err as Error).message);
  }
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' ? v : fallback;
}

// The desktop app keeps its database in the user's app-data folder (STRATA_DATA_DIR).
export const dataDir = process.env.STRATA_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

// A fresh install ships a database that already holds a week of simulated history (see scripts/bundle-backend.mjs),
// so the first start does not have to simulate it. Used only when there is no database yet.
const seedDb = path.join(ROOT, 'seed', 'plrms.db');
const wantedDb = process.env.DB_PATH ? path.resolve(ROOT, process.env.DB_PATH) : path.join(dataDir, 'plrms.db');
if (!fs.existsSync(wantedDb) && fs.existsSync(seedDb)) {
  try {
    fs.copyFileSync(seedDb, wantedDb);
  } catch (err) {
    console.warn('[config] could not copy the seed database:', (err as Error).message);
  }
}

export const config = {
  port: num('PORT', 5180),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH ? path.resolve(ROOT, process.env.DB_PATH) : path.join(dataDir, 'plrms.db'),
  jwtSecret: loadSecret(),
  adminEmail: (process.env.ADMIN_EMAIL || 'aritradatt39@gmail.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Aritradutta@2005',
  simSpeed: Math.min(60, Math.max(1, num('SIM_SPEED', 1))),
  historyDays: Math.min(14, Math.max(1, num('HISTORY_DAYS', 7))),
  prod: process.argv.includes('--prod'),
};
