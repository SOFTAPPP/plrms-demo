import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { MachineStatus, Severity } from '../../../shared/types';
import { STATUS_LABEL } from '../../../shared/types';

export const cn = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-[0_0_0_1px_rgba(0,0,0,0.15)_inset] font-semibold',
  secondary: 'bg-elev text-fg border border-line-strong hover:bg-panel-2',
  ghost: 'text-muted hover:text-fg hover:bg-fg/[0.06]',
  danger: 'bg-crit/12 text-crit border border-crit/30 hover:bg-crit/20',
  outline: 'border border-line-strong text-fg hover:bg-fg/[0.05]',
};
const SIZES: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  icon: 'h-9 w-9 justify-center rounded-lg',
  'icon-sm': 'h-7 w-7 justify-center rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center whitespace-nowrap font-medium transition-[background,color,filter,border] duration-150 disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'crit' | 'info' | 'violet' | 'cyan' | 'blue';
const TONES: Record<Tone, string> = {
  neutral: 'bg-fg/[0.06] text-muted border-line',
  accent: 'bg-accent/12 text-accent border-accent/25',
  ok: 'bg-ok/12 text-ok border-ok/25',
  warn: 'bg-warn/12 text-warn border-warn/25',
  crit: 'bg-crit/12 text-crit border-crit/25',
  info: 'bg-info/12 text-info border-info/25',
  violet: 'bg-violet/12 text-violet border-violet/25',
  cyan: 'bg-cyan/12 text-cyan border-cyan/25',
  blue: 'bg-blue/12 text-blue border-blue/25',
};
const DOTS: Record<Tone, string> = {
  neutral: 'bg-faint', accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-info', violet: 'bg-violet', cyan: 'bg-cyan', blue: 'bg-blue',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4', TONES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<MachineStatus, Tone> = {
  running: 'ok', loading: 'cyan', hauling: 'blue', idle: 'warn', breakdown: 'crit', maintenance: 'violet', offline: 'neutral',
};
export const SEVERITY_TONE: Record<Severity, Tone> = { info: 'info', warning: 'warn', critical: 'crit' };

export function StatusPill({ status, className }: { status: MachineStatus; className?: string }) {
  return <Badge tone={STATUS_TONE[status]} dot className={className}>{STATUS_LABEL[status]}</Badge>;
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOTS[tone])} />}
      <span className={cn('relative h-2 w-2 rounded-full', DOTS[tone])} />
    </span>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClassName, icon, flush }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string; icon?: ReactNode; flush?: boolean;
}) {
  return (
    <section className={cn('panel hairline-top flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2.5">
          {icon && <span className="text-muted">{icon}</span>}
          <div className="min-w-0 flex-1">
            {title && <h3 className="truncate font-display text-[13px] font-semibold tracking-wide text-fg">{title}</h3>}
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 grow', !flush && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} />;
}

export function EmptyState({ title, message, icon, action, className }: { title: string; message?: string; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <div className="mb-1 grid h-11 w-11 place-items-center rounded-xl border border-line bg-panel-2 text-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="font-display text-sm font-semibold text-fg">{title}</p>
      {message && <p className="max-w-sm text-xs text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <div className="mb-1 grid h-11 w-11 place-items-center rounded-xl border border-crit/30 bg-crit/10 text-crit"><AlertTriangle className="h-5 w-5" /></div>
      <p className="font-display text-sm font-semibold">Could not load this data</p>
      <p className="max-w-sm text-xs text-muted">{message}</p>
      {onRetry && <Button size="sm" className="mt-2" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-panel-2 px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, unit, hint, tone }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; tone?: Tone }) {
  const color = tone ? { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', info: 'text-info', accent: 'text-accent', violet: 'text-violet', cyan: 'text-cyan', blue: 'text-blue', neutral: 'text-fg' }[tone] : 'text-fg';
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('tnum mt-0.5 truncate font-display text-lg font-semibold', color)}>
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
      </p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}
