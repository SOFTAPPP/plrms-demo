import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { sqlite } from './db/client';
import { config } from './config';
import { can, type Role, type SessionUser } from '../shared/types';

export const COOKIE = 'strata_session';
const key = new TextEncoder().encode(config.jwtSecret);
/** New on every engine start. A session token carries it, so a token from an earlier launch is rejected and sign-in is required each time the app starts. */
const BOOT_ID = crypto.randomUUID();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function signSession(u: SessionUser) {
  return new SignJWT({ role: u.role, boot: BOOT_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(u.id))
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key);
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (payload.boot !== BOOT_ID) return null;
    const row = sqlite.prepare('select id, email, name, role, active from users where id = ?').get(Number(payload.sub)) as
      | { id: number; email: string; name: string; role: Role; active: number }
      | undefined;
    if (!row || !row.active) return null;
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  // no maxAge: a session cookie, dropped when the app window closes
  return { httpOnly: true, sameSite: 'lax' as const, secure: false, path: '/' };
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await userFromToken(req.cookies?.[COOKIE]);
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
}

export function requireRole(action: 'admin' | 'manage' | 'operate') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!can(req.user?.role, action)) return res.status(403).json({ error: 'Your role does not allow this action' });
    next();
  };
}

export function audit(user: string, action: string, detail: string, ts = Date.now()) {
  sqlite.prepare('insert into audit_log (ts, user_name, action, detail) values (?,?,?,?)').run(ts, user, action, detail);
}
