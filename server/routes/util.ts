import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ah = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) out.catch(next);
  } catch (err) {
    next(err);
  }
};

export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw new HttpError(400, `${name} is required`);
  }
  const s = String(v).trim();
  if (opts.min && s.length < opts.min) throw new HttpError(400, `${name} must be at least ${opts.min} characters`);
  if (s.length > (opts.max ?? 200)) throw new HttpError(400, `${name} is too long`);
  return s;
}

export function num(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return NaN;
    throw new HttpError(400, `${name} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${name} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${name} must be at most ${opts.max}`);
  return n;
}

export function oneOf<T extends string>(v: unknown, name: string, list: readonly T[]): T {
  if (!list.includes(v as T)) throw new HttpError(400, `${name} must be one of: ${list.join(', ')}`);
  return v as T;
}

/** from/to query params (epoch ms) with a default window ending now. */
export function range(req: Request, now: number, defHours = 24): { from: number; to: number } {
  const to = req.query.to ? Number(req.query.to) : now;
  const from = req.query.from ? Number(req.query.from) : to - defHours * 3_600_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new HttpError(400, 'Invalid time range');
  return { from, to };
}
