import { create } from 'zustand';
import { get, post, put, setUnauthorizedHandler } from './api';
import type { Boot, WidgetLayoutItem } from './types';

type Status = 'loading' | 'warming' | 'ready' | 'anon' | 'error';

interface AppState {
  status: Status;
  error: string | null;
  /** 0..1 while the simulator catches up on the time the app was closed (status 'warming') */
  progress: number;
  boot: Boot | null;
  theme: 'dark' | 'light';
  demoOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  muted: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setTheme: (t: 'dark' | 'light') => void;
  saveLayout: (layout: WidgetLayoutItem[]) => void;
  setDemoOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setMuted: (v: boolean) => void;
}

function initialTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('strata-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('strata-theme', t);
  } catch {
    /* storage unavailable */
  }
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, getState) => ({
  status: 'loading',
  error: null,
  progress: 0,
  boot: null,
  theme: initialTheme(),
  demoOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,
  muted: false,
  async load() {
    try {
      const session = await get<{ user: unknown }>('/auth/session');
      if (!session.user) {
        set({ status: 'anon', boot: null });
        return;
      }
      // The server accepts sign-in at once and simulates the missed time in the background; wait for it here.
      for (;;) {
        const st = await get<{ ready: boolean; progress: number }>('/status');
        if (st.ready) break;
        set({ status: 'warming', progress: st.progress });
        await new Promise((r) => setTimeout(r, 300));
      }
      const boot = await get<Boot>('/bootstrap');
      if (boot.prefs.theme && boot.prefs.theme !== getState().theme) {
        applyTheme(boot.prefs.theme);
        set({ theme: boot.prefs.theme });
      }
      set({ boot, status: 'ready', error: null });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) set({ status: 'anon', boot: null });
      else set({ status: 'error', error: (err as Error).message });
    }
  },
  async refresh() {
    try {
      const boot = await get<Boot>('/bootstrap');
      set({ boot });
    } catch {
      /* keep previous data */
    }
  },
  async logout() {
    try {
      await post('/auth/logout');
    } finally {
      set({ status: 'anon', boot: null });
    }
  },
  setTheme(t) {
    applyTheme(t);
    set({ theme: t });
    if (getState().boot) put('/prefs', { theme: t }).catch(() => {});
  },
  saveLayout(layout) {
    const boot = getState().boot;
    if (!boot) return;
    set({ boot: { ...boot, prefs: { ...boot.prefs, layout } } });
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => put('/prefs', { layout }).catch(() => {}), 400);
  },
  setDemoOpen: (v) => set({ demoOpen: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  setMuted: (v) => set({ muted: v }),
}));

setUnauthorizedHandler(() => {
  if (useApp.getState().status === 'ready') useApp.setState({ status: 'anon', boot: null });
});

export const useBoot = () => useApp((s) => s.boot!);
export const useUser = () => useApp((s) => s.boot?.user);
export const useSettings = () => useApp((s) => s.boot!.settings);
