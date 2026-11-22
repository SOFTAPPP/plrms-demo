import { Children, Fragment, forwardRef, isValidElement, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import * as P from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from './core';

const control = 'rounded-lg border border-line-strong bg-panel-2 px-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50';

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="text-xs text-crit">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, 'h-9', !/(^|\s)w-/.test(className ?? '') && 'w-full', className)} {...rest} />;
});

export function SearchInput({ value, onChange, placeholder = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className={cn(control, 'h-9 w-full pl-8')} />
    </div>
  );
}

interface SelectOption { value: string; label: string; disabled: boolean }

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Reads `<option>` children (also inside arrays and fragments), the same markup a native select takes. */
function readOptions(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) { out.push(...readOptions(child.props.children)); return; }
    if (child.type !== 'option') return;
    const label = textOf(child.props.children);
    out.push({ value: child.props.value != null ? String(child.props.value) : label, label, disabled: Boolean(child.props.disabled) });
  });
  return out;
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value?: string | number;
  /** called like a native select's change event: `e.target.value` is the chosen option's value */
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
};

/** Drop-down list. Same props and `<option>` children as a native `<select>`, drawn as a styled popover
 *  with keyboard navigation, type-ahead, and a search box for long lists. */
export function Select({ className, children, value, onChange, disabled, id, title, 'aria-label': ariaLabel }: SelectProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const current = value != null ? String(value) : options[0]?.value ?? '';
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const searchable = options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const choose = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    setOpen(false);
    if (o.value !== current) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>);
  };
  const openList = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    }
  };
  const move = (delta: number) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + delta + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  const onListKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': if (!searchable) { e.preventDefault(); setActive(0); } break;
      case 'End': if (!searchable) { e.preventDefault(); setActive(shown.length - 1); } break;
      case 'Enter': e.preventDefault(); choose(shown[active]); break;
      case 'Tab': setOpen(false); break;
      default:
        // type-ahead when there is no search box
        if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
          const i = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
          if (i >= 0) setActive(i);
        }
    }
  };

  return (
    <P.Root open={open} onOpenChange={openList}>
      <P.Trigger asChild disabled={disabled}>
        <button type="button" id={id} title={title} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
          data-value={current}
          onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openList(true); } }}
          className={cn(control, 'group/select relative flex h-9 items-center gap-2 pr-8 text-left',
            'hover:border-fg/25 data-[state=open]:border-accent/60 data-[state=open]:ring-2 data-[state=open]:ring-accent/20',
            !/(^|\s)(w-|flex-1)/.test(className ?? '') && 'w-full', className)}>
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-faint')}>{selected?.label ?? 'Select…'}</span>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint transition-transform duration-200 group-data-[state=open]/select:rotate-180" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="start" sideOffset={6} collisionPadding={12}
          onOpenAutoFocus={(e) => { if (!searchable) { e.preventDefault(); listRef.current?.focus(); } }}
          className="panel animate-pop z-[70] flex min-w-[var(--radix-popover-trigger-width)] max-w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden bg-elev p-1 shadow-2xl focus:outline-none"
          style={{ maxHeight: 'min(340px, var(--radix-popover-content-available-height))' }}>
          {searchable && (
            <div className="relative mb-1 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input autoFocus value={query} placeholder="Search…" aria-label="Search options" aria-controls={listId}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onListKey}
                className="h-8 w-full rounded-md border border-line bg-panel-2 pl-8 pr-2 text-sm text-fg placeholder:text-faint focus:border-accent/50 focus:outline-none" />
            </div>
          )}
          <div ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel} onKeyDown={onListKey}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none">
            {shown.length === 0 && <p className="px-2.5 py-3 text-center text-xs text-faint">No matches</p>}
            {shown.map((o, i) => {
              const isSel = o.value === current;
              return (
                <div key={`${o.value}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={isSel} aria-disabled={o.disabled || undefined} data-index={i}
                  onPointerMove={() => { if (active !== i && !o.disabled) setActive(i); }}
                  onClick={() => choose(o)}
                  className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    i === active && 'bg-fg/[0.07]', isSel ? 'font-medium text-fg' : 'text-fg/85', o.disabled && 'cursor-not-allowed opacity-40')}>
                  <span className="min-w-0 flex-1 truncate">{o.label || ' '}</span>
                  <Check className={cn('h-3.5 w-3.5 shrink-0 text-accent', !isSel && 'invisible')} />
                </div>
              );
            })}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 w-full py-2', className)} {...rest} />;
});

export function Switch({ checked, onChange, label, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative shrink-0 rounded-full border transition-colors disabled:opacity-50',
          size === 'sm' ? 'h-4.5 w-8' : 'h-5.5 w-10',
          checked ? 'border-accent/60 bg-accent' : 'border-line-strong bg-fg/10')}>
        <span className={cn('absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-all',
          size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
          checked ? (size === 'sm' ? 'left-[16px]' : 'left-[20px]') : 'left-[3px]')} />
      </button>
      {label && <label htmlFor={id} className="cursor-pointer text-sm text-fg">{label}</label>}
    </span>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, size = 'md', className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg border border-line-strong bg-panel-2 p-0.5', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md font-medium transition-colors', size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
            value === o.value ? 'bg-elev text-fg shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate, hideLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: string; indeterminate?: boolean; hideLabel?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} aria-label={label}
        ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate); }}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--accent)]" />
      {!hideLabel && label}
    </label>
  );
}
