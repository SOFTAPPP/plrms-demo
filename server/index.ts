// STRATA demo server: API, live WebSocket, simulator and (in development) the Vite dev server, on one port.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer, type WebSocket } from 'ws';
import { config, ROOT } from './config';
import { runtime } from './runtime';
import { sqlite } from './db/client';
import { COOKIE, parseCookie, userFromToken } from './auth';
import { publicApi, admin } from './routes/admin';
import { fleet } from './routes/fleet';
import { ops } from './routes/ops';
import { HttpError } from './routes/util';
import { requireAuth } from './auth';
import type { ServerMessage } from '../shared/types';

async function main() {
  const t0 = Date.now();
  runtime.boot();

  // Build step for the installer: create the demo database with its history, then stop (see scripts/bundle-backend.mjs).
  if (process.argv.includes('--build-db')) {
    await runtime.warm;
    runtime.shutdown();
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.exec('vacuum');
    sqlite.close();
    console.log(`[strata] seed database ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    process.exit(0);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '6mb' }));
  app.use(cookieParser());

  app.use('/api', publicApi);
  // Sign-in and the status check above work at once; everything that reads the simulator waits for its catch-up.
  app.use('/api', (_req, res, next) => (runtime.ready ? next() : res.status(503).json({ error: 'Preparing the mine data', warming: true, progress: runtime.progress })));
  app.use('/api', admin);
  app.use('/api', requireAuth, fleet);
  app.use('/api', requireAuth, ops);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large' });
    console.error('[api]', err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  const server = http.createServer(app);

  // Live data socket: authenticated by the session cookie.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on('upgrade', async (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return; // Vite's HMR socket handles its own upgrades
    if (!runtime.ready) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = await userFromToken(parseCookie(req.headers.cookie, COOKIE));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const clients = new Set<WebSocket>();
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    const hello: ServerMessage = { type: 'hello', t: runtime.engine.t, speed: runtime.engine.speed };
    ws.send(JSON.stringify(hello));
    ws.send(JSON.stringify(runtime.engine.frame()));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
  runtime.subscribe((msg) => {
    if (!clients.size) return;
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN && c.bufferedAmount < 2_000_000) c.send(data);
  });

  if (config.prod) {
    const dist = path.join(ROOT, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.error('\n[strata] No production build found. Run "pnpm build" first, or use "pnpm dev".\n');
      process.exit(1);
    }
    app.use(express.static(dist, { index: false, maxAge: '7d', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: ROOT,
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
      logLevel: 'warn',
    });
    app.use(vite.middlewares);
  }

  server.listen(config.port, config.host, () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n  STRATA mine operations demo is running (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    console.log(`  Open  ${url}`);
    console.log(`  Login ${config.adminEmail}\n`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') console.error(`\n[strata] Port ${config.port} is busy. Set PORT in .env to another value.\n`);
    else console.error(err);
    process.exit(1);
  });

  const stop = () => {
    runtime.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
