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
  bg: '#080b10', panel: '#0e131a', panel2: '#121922', line: 'rgba(148,163,184,0.11)', lineStrong: 'rgba(148,163,184,0.24)',
  fg: '#e8edf4', muted: '#8d99ab', faint: '#5a6577', accent: '#f5a524', ok: '#34d399', warn: '#fbbf24', crit: '#fb7185',
  info: '#38bdf8', violet: '#a78bfa', cyan: '#22d3ee', blue: '#60a5fa',
  series: ['#f5a524', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#60a5fa', '#f472b6', '#facc15', '#2dd4bf', '#c084fc'],
  status: { running: '#34d399', loading: '#22d3ee', hauling: '#60a5fa', idle: '#fbbf24', breakdown: '#fb7185', maintenance: '#a78bfa', offline: '#5a6577' },
  severity: { info: '#38bdf8', warning: '#fbbf24', critical: '#fb7185' },
  map: { ground: '#10151b', groundAlt: '#141a21', bench: '#1a2028', benchLine: 'rgba(205,180,140,0.16)', road: '#2b3440', roadEdge: '#3a4553', zone: 'rgba(148,163,184,0.06)', water: '#123247', dump: '#1d1f22' },
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
