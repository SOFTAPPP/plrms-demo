// Sign-in page, laid out like the PLRMS one: full-screen footage with the headline on the left, and a sign-in panel
// that slides in from the right when "Sign in" is pressed. The sign-in itself is STRATA's own (POST /auth/login).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Mountain,
  Radio,
  ShieldAlert,
  ShieldCheck,
  UnlockKeyhole,
  Video,
} from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app-store';
import { cn } from '../components/ui/core';
import { Input } from '../components/ui/form';
import { LogoMark } from '../components/layout/Logo';
import { LoginHero } from '../components/layout/LoginHero';

const FEATURES = [
  { icon: Mountain, label: 'Live operations' },
  { icon: Radio, label: 'Live telemetry' },
  { icon: Video, label: 'Camera DVR & 360°' },
  { icon: ShieldCheck, label: 'Fatigue, proximity & overload alerts' },
];

const DRAWER_WIDTH = 440;

type Status = 'idle' | 'authenticating' | 'success' | 'error';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const load = useApp((s) => s.load);

  // Escape closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // the email field takes focus once the panel has slid in
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => emailRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [open]);

  const fail = (message: string) => {
    setError(message);
    setStatus('error');
    window.setTimeout(() => setStatus('idle'), 2500);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'authenticating' || status === 'success') return;
    setStatus('authenticating');
    setError(null);
    try {
      const r = await post<{ error?: string }>('/auth/login', { email, password });
      if (r.error) return fail(r.error);
      setStatus('success');
      await load();
    } catch (err) {
      fail((err as Error).message);
    }
  };

  return (
    <div className="relative h-full w-full select-none overflow-clip bg-[#0b0b0c] font-sans">
      {/* full-screen footage, with the shot card and copyright at the bottom left */}
      <LoginHero />

      {/* brand and headline */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-black/60 shadow-lg backdrop-blur-md sm:h-11 sm:w-11">
            <LogoMark className="h-7 w-7" />
          </div>
          <div>
            <p className="m-0 font-display text-base font-bold tracking-[0.2em] text-white sm:text-lg">STRATA</p>
            <p className="m-0 text-[10px] uppercase tracking-[0.16em] text-white/70 sm:text-xs">
              Mine Operations Intelligence
            </p>
          </div>
        </div>

        <div className="pointer-events-auto my-auto max-w-xl py-8">
          <h1 className="m-0 font-display text-2xl font-semibold leading-tight tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.85)] sm:text-3xl md:text-4xl lg:text-5xl">
            Every machine, sensor and camera — <span className="text-accent">in one live view</span>
          </h1>
          <p className="m-0 mt-3 max-w-md text-xs leading-relaxed text-white/80 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)] sm:mt-4 sm:text-sm md:text-base">
            Live fleet, production, sensor, fuel and camera monitoring for open-pit mines.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 sm:mt-7">
            {FEATURES.map((f, i) => (
              <span
                key={f.label}
                style={{ animationDelay: `${200 + i * 80}ms` }}
                className="animate-login-rise inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-medium text-white/90 shadow-sm backdrop-blur-md sm:gap-2"
              >
                <f.icon className="h-3 w-3 text-accent sm:h-3.5 sm:w-3.5" /> {f.label}
              </span>
            ))}
          </div>
        </div>

        {/* room for the shot card and copyright drawn by LoginHero */}
        <div className="pointer-events-none h-8" />
      </div>

      {/* the one button that opens and closes the panel; it rides along with the panel's edge */}
      <div
        className="absolute top-1/2 z-50 flex -translate-y-1/2 items-center justify-center transition-transform duration-500 ease-out"
        style={{
          right: '24px',
          transform: open ? `translateX(calc(-1 * min(${DRAWER_WIDTH}px, 100vw)))` : 'translateX(0)',
          willChange: 'transform',
        }}
      >
        {!open && (
          <div
            className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-accent/30 opacity-40"
            style={{ animationDuration: '3s' }}
          />
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Close sign in panel' : 'Open sign in panel'}
          className={cn(
            'group relative flex cursor-pointer items-center justify-center border border-white/20 bg-black/70 text-white shadow-[0_10px_30px_-5px_rgba(0,0,0,0.6)] outline-none backdrop-blur-2xl transition-all duration-500 hover:border-accent/60 hover:bg-black/85 hover:shadow-[0_0_35px_rgba(245,165,36,0.45)] focus-visible:ring-2 focus-visible:ring-accent',
            open
              ? 'hidden h-12 w-12 rounded-full hover:scale-110 active:scale-95 sm:flex'
              : 'h-12 rounded-full px-5 hover:scale-105 active:scale-95 sm:px-6',
          )}
        >
          <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-accent/0 via-accent/0 to-accent/20 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          {open ? (
            <ChevronRight className="relative z-10 h-6 w-6 text-accent transition-transform duration-300 group-hover:translate-x-0.5" />
          ) : (
            <div className="relative z-10 flex items-center gap-2.5">
              <ChevronLeft className="h-5 w-5 animate-pulse text-accent transition-transform group-hover:-translate-x-1" />
              <span className="font-display text-xs font-bold uppercase tracking-widest text-white sm:text-sm">
                Sign in
              </span>
            </div>
          )}
        </button>
      </div>

      {/* backdrop */}
      <div
        onClick={() => setOpen(false)}
        className={cn(
          'absolute inset-0 z-30 bg-black/60 backdrop-blur-xs transition-opacity duration-500',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sign-in panel. Closed, it is inert: Tab cannot focus its fields, which would scroll the off-screen panel
          half into view. */}
      <div
        inert={!open}
        className={cn(
          'absolute bottom-0 right-0 top-0 z-40 flex h-full w-full flex-col overflow-hidden border-l border-line bg-bg/95 text-fg shadow-[-20px_0_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform duration-500 ease-out sm:w-[440px]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line p-6 pb-4 pt-7 sm:p-8 sm:pb-6 sm:pt-9">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel">
              <LogoMark className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display text-sm font-bold tracking-wider">STRATA</span>
              <span className="block text-[9px] uppercase tracking-wider text-muted">Mine Operations Intelligence</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-fg"
          >
            <span>Close</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 sm:p-8">
          <div className="mx-auto my-auto w-full max-w-sm py-4">
            <div className="mb-6 text-center">
              <div
                className={cn(
                  'mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border shadow-sm transition-colors duration-300',
                  status === 'idle' && 'border-accent/25 bg-accent/10 text-accent',
                  status === 'authenticating' && 'animate-pulse border-accent/40 bg-accent/15 text-accent',
                  status === 'success' && 'border-ok/30 bg-ok/10 text-ok',
                  status === 'error' && 'animate-login-shake border-crit/30 bg-crit/10 text-crit',
                )}
              >
                {status === 'success' ? <UnlockKeyhole className="h-6 w-6" /> : <LockKeyhole className="h-6 w-6" />}
              </div>
              <h2 className="m-0 font-display text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="m-0 mt-1.5 text-sm text-muted">Use your control-room account</p>
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Email address</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input
                    ref={emailRef}
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-10 pl-9"
                    placeholder="name@company.com"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Password</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-10 pl-9 pr-10 [&::-ms-reveal]:hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:text-fg"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {error && (
                <div
                  role="alert"
                  className="animate-login-rise flex items-center rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-sm font-medium text-crit"
                >
                  <ShieldAlert className="mr-2 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'authenticating' || status === 'success' || !email || !password}
                className="mt-2 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-accent-fg transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'authenticating' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin opacity-70" /> Signing in…
                  </>
                ) : status === 'success' ? (
                  <>
                    <UnlockKeyhole className="h-4 w-4" /> Success
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="m-0 mt-6 text-center text-xs text-faint">
              Demo roles (password <span className="font-mono">Demo@1234</span>): supervisor@strata.demo ·
              operator@strata.demo · viewer@strata.demo
            </p>
            <p className="m-0 mt-6 text-center text-[10px] font-semibold uppercase tracking-widest text-faint">
              © {new Date().getFullYear()} Winteg Technologies · STRATA
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
