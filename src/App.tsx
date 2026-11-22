import { createElement, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useApp } from './lib/app-store';
import { AppShell } from './components/layout/AppShell';
import { ConfirmHost, TipProvider } from './components/ui/overlay';
import { ErrorState } from './components/ui/core';
import { LogoMark } from './components/layout/Logo';
import { ErrorBoundary } from './components/ErrorBoundary';
import LoginPage from './pages/Login';

type PageModule = { default: ComponentType };

/** A code-split page that renders straight away once its code is in memory.
 *  React.lazy suspends on every first render, and React 19 then holds the content back for ~300 ms so the
 *  fallback does not flicker; that hold showed up as a short freeze after sign-in and on each new page. */
function page(load: () => Promise<PageModule>) {
  let loaded: ComponentType | null = null;
  const preload = () => load().then((m) => { loaded = m.default; return m; });
  const Lazy = lazy(preload);
  const Page = () => (loaded ? createElement(loaded) : createElement(Lazy));
  Page.preload = preload;
  return Page;
}

const Dashboard = page(() => import('./pages/Dashboard'));
const LiveMap = page(() => import('./pages/LiveMap'));
const Fleet = page(() => import('./pages/Fleet'));
const MachineDetail = page(() => import('./pages/MachineDetail'));
const Production = page(() => import('./pages/Production'));
const Sensors = page(() => import('./pages/Sensors'));
const Cameras = page(() => import('./pages/Cameras'));
const Surround = page(() => import('./pages/Surround'));
const FuelPage = page(() => import('./pages/Fuel'));
const Alerts = page(() => import('./pages/Alerts'));
const Reports = page(() => import('./pages/Reports'));
const Admin = page(() => import('./pages/Admin'));
const NotFound = page(() => import('./pages/NotFound'));
const OTHER_PAGES = [LiveMap, Fleet, MachineDetail, Production, Sensors, Cameras, FuelPage, Alerts, Reports, Admin, NotFound, Surround];

const idle = (cb: () => void, timeout = 2500) =>
  typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout }) : setTimeout(cb, 600);

/** Every other page, one per idle slot once the dashboard is up, so switching pages never waits. */
function warmPages() {
  const queue = [...OTHER_PAGES];
  const next = () => {
    const p = queue.shift();
    if (p) void p.preload().finally(() => idle(next, 4000));
  };
  idle(next, 4000);
}

/** The dashboard and its chart, map and camera code, fetched and evaluated while the user signs in,
 *  so pressing Sign in only has to draw the page instead of downloading and parsing ~1 MB first. */
function warmDashboard() {
  idle(() => void Dashboard.preload());
}

function Splash({ children, delay = 0 }: { children?: ReactNode; delay?: number }) {
  // Short waits (the usual case: a local session check takes milliseconds) show nothing rather than
  // flashing a logo for one frame between the window opening and the sign-in page.
  const [show, setShow] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const id = window.setTimeout(() => setShow(true), delay);
    return () => clearTimeout(id);
  }, [delay]);
  if (!show) return <div className="h-full" />;
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="h-14 w-14 animate-pulse" />
        {children ?? <p className="text-sm text-muted">Connecting to the mine…</p>}
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const progress = useApp((s) => s.progress);
  const load = useApp((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (status === 'anon') warmDashboard();
    if (status === 'ready') warmPages();
  }, [status]);
  if (status === 'loading') return <Splash delay={400} />;
  if (status === 'warming') {
    return (
      <Splash>
        <div className="w-64 text-center">
          <p className="text-sm text-muted">Catching up on the mine since you last opened it…</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-fg/10">
            <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300" style={{ transform: `scaleX(${Math.max(0.03, progress)})` }} />
          </div>
          <p className="tnum mt-1.5 text-xs text-faint">{Math.round(progress * 100)} %</p>
        </div>
      </Splash>
    );
  }
  if (status === 'anon') return <LoginPage />;
  if (status === 'error') {
    return <Splash><ErrorState message={error ?? 'Unknown error'} onRetry={() => void load()} /></Splash>;
  }
  return <>{children}</>;
}

export function App() {
  const theme = useApp((s) => s.theme);
  return (
    <TipProvider delayDuration={250}>
      <BrowserRouter>
        <Gate>
          <ErrorBoundary>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="map" element={<LiveMap />} />
                <Route path="fleet" element={<Fleet />} />
                <Route path="fleet/dispatch" element={<Fleet />} />
                <Route path="fleet/operators" element={<Fleet />} />
                <Route path="fleet/maintenance" element={<Fleet />} />
                <Route path="fleet/downtime" element={<Fleet />} />
                <Route path="fleet/:id" element={<MachineDetail />} />
                <Route path="production" element={<Production />} />
                <Route path="sensors" element={<Sensors />} />
                <Route path="cameras" element={<Cameras />} />
                <Route path="surround" element={<Surround />} />
                <Route path="fuel" element={<FuelPage />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="reports" element={<Reports />} />
                <Route path="admin" element={<Admin />} />
                <Route path="login" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </ErrorBoundary>
        </Gate>
        <ConfirmHost />
        <Toaster theme={theme} position="bottom-right" richColors closeButton visibleToasts={4}
          toastOptions={{ className: 'font-sans' }} />
      </BrowserRouter>
    </TipProvider>
  );
}
