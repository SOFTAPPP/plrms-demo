import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Check, Command, FlaskConical, KeyRound, Keyboard, LogOut, Moon, Search, Sun, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { navTitle } from './nav';
import { useApp } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { post } from '../../lib/api';
import { ago, time } from '../../lib/format';
import { Badge, Button, cn, Kbd, SEVERITY_TONE } from '../ui/core';
import { Dialog, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, Tip } from '../ui/overlay';
import { Field, Input } from '../ui/form';
import { ROLE_LABEL, can } from '../../../shared/types';

function SimClock() {
  const t = useLive((s) => s.t);
  const speed = useLive((s) => s.speed);
  const paused = useLive((s) => s.paused);
  const kpi = useLive((s) => s.kpi);
  const connected = useLive((s) => s.connected);
  const d = new Date(t);
  return (
    <div className="hidden items-center gap-3 rounded-xl border border-line bg-panel-2/70 px-3 py-1.5 md:flex">
      <Tip content={connected ? 'Live data connected' : 'Reconnecting to the live feed…'}>
        <span className={cn('flex items-center', connected ? 'text-ok' : 'text-crit')}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4 animate-pulse" />}</span>
      </Tip>
      <div className="leading-none">
        <p className="tnum font-mono text-[15px] font-semibold tracking-wide">{time(t, true)}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      </div>
      {kpi && (
        <div className="border-l border-line pl-3 leading-none">
          <p className="text-xs font-semibold">Shift {kpi.shift} · {kpi.shiftName}</p>
          <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-fg/10"><div className="h-full bg-accent" style={{ width: `${kpi.shiftProgress * 100}%` }} /></div>
        </div>
      )}
      {(speed > 1 || paused) && <Badge tone={paused ? 'warn' : 'accent'}>{paused ? 'Paused' : `${speed}× speed`}</Badge>}
    </div>
  );
}

function AlertBell() {
  const alerts = useLive((s) => s.openAlerts);
  const now = useLive((s) => s.t);
  const navigate = useNavigate();
  const role = useApp((s) => s.boot?.user.role);
  const active = alerts.filter((a) => a.status === 'active');
  return (
    <Popover align="end" className="w-[380px] p-0" trigger={
      <Button variant="ghost" size="icon" aria-label={`${active.length} unacknowledged alerts`} className="relative">
        <Bell className="h-[18px] w-[18px]" />
        {active.length > 0 && <span className="tnum absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[10px] font-bold text-white">{active.length > 99 ? '99+' : active.length}</span>}
      </Button>
    }>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-display text-sm font-semibold">Open alerts</p>
        <Button size="xs" variant="ghost" onClick={() => navigate('/alerts')}>View all</Button>
      </div>
      <div className="scroll-thin max-h-96 overflow-y-auto">
        {alerts.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">All clear. No open alerts.</p>}
        {alerts.slice(0, 12).map((a) => (
          <div key={a.id} className="flex gap-3 border-b border-line px-4 py-2.5 last:border-0">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-crit' : a.severity === 'warning' ? 'bg-warn' : 'bg-info')} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(`/alerts?focus=${a.id}`)}>
              <p className="truncate text-sm font-medium">{a.title} · <span className="text-muted">{a.machineId}</span></p>
              <p className="truncate text-xs text-muted">{a.message}</p>
              <p className="mt-0.5 text-[11px] text-faint">{ago(a.lastTs, now)}{a.count > 1 ? ` · ${a.count}×` : ''} {a.status === 'acknowledged' && '· acknowledged'}</p>
            </button>
            {a.status === 'active' && can(role, 'operate') && (
              <Tip content="Acknowledge"><Button size="icon-sm" variant="ghost" aria-label="Acknowledge" onClick={() => post(`/alerts/${a.id}/ack`).catch((e) => toast.error(e.message))}><Check className="h-4 w-4" /></Button></Tip>
            )}
            {a.status !== 'active' && <Badge tone={SEVERITY_TONE[a.severity]}>Ack</Badge>}
          </div>
        ))}
      </div>
    </Popover>
  );
}

function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await post('/auth/password', { current: cur, next });
      toast.success('Password changed');
      onOpenChange(false);
      setCur('');
      setNext('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change password" size="sm"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={next.length < 8 || !cur} onClick={submit}>Update</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function Topbar() {
  const { pathname } = useLocation();
  const nav = navTitle(pathname);
  const user = useApp((s) => s.boot?.user);
  const theme = useApp((s) => s.theme);
  const muted = useApp((s) => s.muted);
  const { setTheme, setPaletteOpen, setShortcutsOpen, setDemoOpen, logout, setMuted } = useApp.getState();
  const [pwOpen, setPwOpen] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  return (
    <header data-noprint className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-semibold">{nav?.label ?? 'STRATA'}</p>
        <p className="hidden truncate text-xs text-muted lg:block">{nav?.description}</p>
      </div>
      <SimClock />
      <button type="button" onClick={() => setPaletteOpen(true)}
        className="hidden h-9 w-60 items-center gap-2 rounded-lg border border-line-strong bg-panel-2 px-3 text-sm text-faint transition-colors hover:text-muted lg:flex">
        <Search className="h-4 w-4 shrink-0" /> <span className="flex-1 truncate whitespace-nowrap text-left">Search…</span>
        <span className="flex gap-0.5"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
      </button>
      <Button variant="ghost" size="icon" aria-label="Search" className="lg:hidden" onClick={() => setPaletteOpen(true)}><Command className="h-4 w-4" /></Button>
      <AlertBell />
      <Tip content={muted ? 'Alert pop-ups muted' : 'Mute alert pop-ups'}>
        <Button variant="ghost" size="icon" aria-label="Toggle alert pop-ups" onClick={() => setMuted(!muted)}>{muted ? <VolumeX className="h-[18px] w-[18px] text-warn" /> : <Volume2 className="h-[18px] w-[18px]" />}</Button>
      </Tip>
      <Tip content={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
        <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </Button>
      </Tip>
      <Menu trigger={
        <button type="button" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-fg/[0.05]" aria-label="Account menu">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-orange-600 text-xs font-bold text-black">
            {user?.name.split(' ').map((s) => s[0]).join('').slice(0, 2)}
          </span>
          <span className="hidden text-left leading-tight xl:block">
            <span className="block text-sm font-medium">{user?.name}</span>
            <span className="block text-[11px] text-muted">{user ? ROLE_LABEL[user.role] : ''}</span>
          </span>
        </button>
      }>
        <MenuLabel>{user?.email}</MenuLabel>
        <MenuItem icon={<KeyRound className="h-4 w-4" />} onSelect={() => setPwOpen(true)}>Change password</MenuItem>
        <MenuItem icon={<Keyboard className="h-4 w-4" />} onSelect={() => setShortcutsOpen(true)}>Keyboard shortcuts</MenuItem>
        {can(user?.role, 'manage') && <MenuItem icon={<FlaskConical className="h-4 w-4" />} onSelect={() => setDemoOpen(true)}>Demo control</MenuItem>}
        <MenuSeparator />
        <MenuItem icon={<LogOut className="h-4 w-4" />} danger onSelect={() => void logout()}>Sign out</MenuItem>
      </Menu>
      <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}
