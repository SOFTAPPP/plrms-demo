// Packs everything the desktop app needs to run the STRATA engine without any installed tools:
//   src-tauri/resources/backend/
//     server/index.mjs        the API + simulator, bundled into one file
//     server/db/migrations/   SQL migrations
//     dist/                   the built user interface
//     node/node(.exe)         the Node.js runtime this machine is using
//     node_modules/           better-sqlite3 (native) and its two helpers
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'resources', 'backend');
const require = createRequire(path.join(root, 'package.json'));

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing — run "vite build" first');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: path.join(out, 'server', 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3', 'vite', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
copy(path.join(root, 'server', 'db', 'migrations'), path.join(out, 'server', 'db', 'migrations'));
copy(path.join(root, 'dist'), path.join(out, 'dist'));

const nodeDir = path.join(out, 'node');
fs.mkdirSync(nodeDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node'));
if (process.platform !== 'win32') fs.chmodSync(path.join(nodeDir, 'node'), 0o755);

// better-sqlite3 plus the packages it requires at runtime (resolved through pnpm's store)
const sqliteDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const sqliteRequire = createRequire(path.join(sqliteDir, 'package.json'));
const pkgDir = (name, req) => path.dirname(req.resolve(`${name}/package.json`));
const bindingsDir = pkgDir('bindings', sqliteRequire);
const fileUriDir = pkgDir('file-uri-to-path', createRequire(path.join(bindingsDir, 'package.json')));
const nm = path.join(out, 'node_modules');
for (const [name, dir] of [['better-sqlite3', sqliteDir], ['bindings', bindingsDir], ['file-uri-to-path', fileUriDir]]) {
  fs.cpSync(dir, path.join(nm, name), {
    recursive: true,
    dereference: true,
    // only what runs: skip sources, the bundled SQLite amalgamation and build intermediates
    filter: (src) => !/(^|[\\/])(src|deps|docs|test|obj|node_modules|\.deps)([\\/]|$)/.test(path.relative(dir, src)) && !src.endsWith('.lib') && !src.endsWith('.pdb'),
  });
}

// Pre-build the database (demo data plus a week of history) with the bundled engine, so a fresh install starts at once.
const seedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-seed-'));
const built = spawnSync(path.join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node'), [path.join(out, 'server', 'index.mjs'), '--build-db'], {
  cwd: out,
  env: { ...process.env, STRATA_ROOT: out, STRATA_DATA_DIR: seedTmp, DB_PATH: '' },
  stdio: 'inherit',
});
if (built.status !== 0 || !fs.existsSync(path.join(seedTmp, 'plrms.db'))) {
  console.error('[bundle-backend] could not build the seed database');
  process.exit(1);
}
fs.mkdirSync(path.join(out, 'seed'), { recursive: true });
fs.copyFileSync(path.join(seedTmp, 'plrms.db'), path.join(out, 'seed', 'plrms.db'));
fs.rmSync(seedTmp, { recursive: true, force: true });

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, d) => s + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`[bundle-backend] ready in src-tauri/resources/backend (${(size(out) / 1024 / 1024).toFixed(1)} MB)`);
