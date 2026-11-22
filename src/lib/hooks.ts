import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch JSON from the API. Re-fetches when `path` changes and, optionally, on an interval. */
export function useQuery<T>(path: string | null, opts: { refreshMs?: number; keepPrevious?: boolean } = {}): Query<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [nonce, setNonce] = useState(0);
  const keep = opts.keepPrevious ?? true;
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    if (lastPath.current !== path) {
      setLoading(true);
      if (!keep) setData(undefined);
    }
    lastPath.current = path;
    get<T>(path, ctrl.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, nonce, keep]);

  useEffect(() => {
    if (!opts.refreshMs || !path) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setNonce((n) => n + 1);
    }, opts.refreshMs);
    return () => clearInterval(id);
  }, [opts.refreshMs, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Remember a value per browser (falls back silently when storage is blocked). */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`strata:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try {
      localStorage.setItem(`strata:${key}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [key]);
  return [v, set];
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
