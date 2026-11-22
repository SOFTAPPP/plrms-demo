// Formats live values in the display units chosen in Admin › KPI targets & units.
import { useMemo } from 'react';
import { DEFAULT_UNITS, convert, type Dimension } from '../../shared/sensors';
import { useApp } from './app-store';
import { compact, num } from './format';

export function useUnits() {
  const u = useApp((s) => s.boot?.settings.units ?? DEFAULT_UNITS);
  return useMemo(() => {
    const fmt = (dim: Dimension) => (v: number | null | undefined, d = 0) => {
      if (v === null || v === undefined || Number.isNaN(v)) return '—';
      const [cv, unit] = convert(v, dim, u);
      return `${num(cv, d)} ${unit}`.trim();
    };
    const part = (dim: Dimension) => (v: number | null | undefined, d = 0): [string, string] => {
      if (v === null || v === undefined || Number.isNaN(v)) return ['—', convert(0, dim, u)[1]];
      const [cv, unit] = convert(v, dim, u);
      return [Math.abs(cv) >= 10000 ? compact(cv, 1) : num(cv, d), unit];
    };
    return {
      units: u,
      speed: fmt('speed'),
      temp: fmt('temp'),
      mass: fmt('mass'),
      volume: fmt('volume'),
      flow: fmt('flow'),
      /** [value, unit] for stat tiles */
      speedParts: part('speed'),
      tempParts: part('temp'),
      massParts: part('mass'),
      volumeParts: part('volume'),
      flowParts: part('flow'),
    };
  }, [u]);
}
