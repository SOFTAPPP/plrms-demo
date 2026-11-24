// Colours used by canvas, SVG and chart code (CSS variables cover everything else).
import type { MachineStatus, Severity } from '../../shared/types';
import { useApp } from './app-store';

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  lineStrong: string;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  ok: string;
  warn: string;
  crit: string;
  info: string;
  violet: string;
  cyan: string;
  blue: string;
  series: string[];
  status: Record<MachineStatus, string>;
  severity: Record<Severity, string>;
  map: { ground: string; groundAlt: string; bench: string; benchLine: string; road: string; roadEdge: string; zone: string; water: string; dump: string };
}

const dark: Palette = {
  bg: '#111216', panel: '#181a20', panel2: '#1f222a', line: 'rgba(255,255,255,0.08)', lineStrong: 'rgba(255,255,255,0.18)',
  fg: '#f1f3f7', muted: '#9aa5b6', faint: '#64748b', accent: '#f59e0b', ok: '#10b981', warn: '#f59e0b', crit: '#ef4444',
  info: '#0ea5e9', violet: '#8b5cf6', cyan: '#06b6d4', blue: '#3b82f6',
  series: ['#f59e0b', '#06b6d4', '#8b5cf6', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#eab308', '#14b8a6', '#a855f7'],
  status: { running: '#10b981', loading: '#06b6d4', hauling: '#3b82f6', idle: '#f59e0b', breakdown: '#ef4444', maintenance: '#8b5cf6', offline: '#64748b' },
  severity: { info: '#0ea5e9', warning: '#f59e0b', critical: '#ef4444' },
  map: { ground: '#14161c', groundAlt: '#1a1d24', bench: '#222630', benchLine: 'rgba(245,158,11,0.2)', road: '#2b303d', roadEdge: '#3d4454', zone: 'rgba(255,255,255,0.05)', water: '#0e2a3f', dump: '#20242d' },
};

const light: Palette = {
  bg: '#eef1f5', panel: '#ffffff', panel2: '#f6f8fa', line: 'rgba(15,23,42,0.08)', lineStrong: 'rgba(15,23,42,0.18)',
  fg: '#0e1726', muted: '#586274', faint: '#8e99ab', accent: '#d48806', ok: '#059669', warn: '#c27c0e', crit: '#e11d48',
  info: '#0284c7', violet: '#7c3aed', cyan: '#0891b2', blue: '#2563eb',
  series: ['#d48806', '#0891b2', '#7c3aed', '#059669', '#e11d48', '#2563eb', '#db2777', '#ca8a04', '#0d9488', '#9333ea'],
  status: { running: '#059669', loading: '#0891b2', hauling: '#2563eb', idle: '#c27c0e', breakdown: '#e11d48', maintenance: '#7c3aed', offline: '#94a3b8' },
  severity: { info: '#0284c7', warning: '#c27c0e', critical: '#e11d48' },
  map: { ground: '#e9e4da', groundAlt: '#e2dccf', bench: '#d8cfbf', benchLine: 'rgba(120,90,50,0.22)', road: '#b9b2a6', roadEdge: '#a39b8e', zone: 'rgba(15,23,42,0.05)', water: '#bfdbfe', dump: '#cfc6b5' },
};

export const PALETTES = { dark, light };

export function usePalette(): Palette {
  return useApp((s) => (s.theme === 'light' ? light : dark));
}

export function paletteNow(): Palette {
  return useApp.getState().theme === 'light' ? light : dark;
}
