import { useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from './core';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs<T extends string>({ value, onChange, items, className, id = 'tabs' }: {
  value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string; id?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    refs.current[n]?.focus();
    onChange(items[n].value);
  };
  return (
    <div role="tablist" className={cn('scroll-thin flex items-center gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((t, i) => {
        const active = t.value === value;
        return (
          <button key={t.value} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" aria-selected={active}
            tabIndex={active ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => onChange(t.value)}
            className={cn('relative flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors', active ? 'text-fg' : 'text-muted hover:text-fg')}>
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={cn('tnum rounded-full px-1.5 text-[10px] leading-4', active ? 'bg-accent/15 text-accent' : 'bg-fg/[0.07] text-muted')}>{t.count}</span>
            )}
            {active && <motion.span layoutId={`tab-underline-${id}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          </button>
        );
      })}
    </div>
  );
}

/** Tab state kept in the URL (?tab=) so tabs are linkable and survive reloads. */
export function useTabParam<T extends string>(values: readonly T[], fallback: T, param = 'tab'): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(param) as T | null;
  const value = raw && values.includes(raw) ? raw : fallback;
  const set = (v: T) => {
    const next = new URLSearchParams(sp);
    if (v === fallback) next.delete(param);
    else next.set(param, v);
    setSp(next, { replace: true });
  };
  return [value, set];
}
