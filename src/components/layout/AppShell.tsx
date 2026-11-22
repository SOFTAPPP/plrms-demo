import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { DemoControl } from './DemoControl';
import { NAV } from './nav';
import { useApp } from '../../lib/app-store';
import { connectLive, disconnectLive } from '../../lib/live';
import { isTyping, useStoredState } from '../../lib/hooks';
import { Dialog } from '../ui/overlay';
import { Kbd, Skeleton } from '../ui/core';
import { can } from '../../../shared/types';

function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  const set = useApp((s) => s.setShortcutsOpen);
  const rows: [string[], string][] = [
    [['Ctrl', 'K'], 'Global search'],
    [['?'], 'This help'],
    [['Ctrl', 'Shift', 'D'], 'Demo control (supervisors and admins)'],
    [['Shift', 'T'], 'Toggle light / dark theme'],
    [['['], 'Collapse or expand the sidebar'],
    ...NAV.map((n) => [['g', n.key], `Go to ${n.label}`] as [string[], string]),
    [['Space'], 'Play / pause recorded video'],
    [['←', '→'], 'Step recorded video 10 s (Shift: 1 min)'],
  ];
  return (
    <Dialog open={open} onOpenChange={set} title="Keyboard shortcuts" size="md">
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useStoredState('sidebar-collapsed', false);
  const navigate = useNavigate();
  const location = useLocation();
  const pending = useRef<string | null>(null);

  useEffect(() => {
    connectLive();
    return () => disconnectLive();
  }, []);

  useEffect(() => {
    const onNav = (e: Event) => navigate((e as CustomEvent<string>).detail);
    window.addEventListener('strata:navigate', onNav);
    return () => window.removeEventListener('strata:navigate', onNav);
  }, [navigate]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        app.setPaletteOpen(!app.paletteOpen);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (can(app.boot?.user.role, 'manage')) app.setDemoOpen(!app.demoOpen);
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') { app.setShortcutsOpen(true); return; }
      if (e.key === 'T' && e.shiftKey) { app.setTheme(app.theme === 'dark' ? 'light' : 'dark'); return; }
      if (e.key === '[') { setCollapsed(!collapsed); return; }
      if (pending.current === 'g') {
        const n = NAV.find((x) => x.key === e.key.toLowerCase());
        pending.current = null;
        if (n) navigate(n.to);
        return;
      }
      if (e.key === 'g') {
        pending.current = 'g';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { pending.current = null; }, 1200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, collapsed, setCollapsed]);

  return (
    <div className="flex h-full overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <motion.div key={location.pathname.split('/').slice(0, 2).join('/')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
            className="mx-auto w-full max-w-[1800px] p-4 lg:p-6">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </main>
      </div>
      <CommandPalette />
      <DemoControl />
      <ShortcutsDialog />
    </div>
  );
}
