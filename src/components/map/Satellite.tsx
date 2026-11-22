// Real satellite imagery (Esri World Imagery) under the live map, with an offline check.
import { memo, useEffect, useState } from 'react';
import { GEO } from '../../../shared/site';

export interface View { x: number; y: number; w: number; h: number }

const TILE = (z: number, y: number, x: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

export const SATELLITE_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';

type SatState = 'checking' | 'online' | 'offline';
let satState: SatState = 'checking';
const listeners = new Set<(s: SatState) => void>();

function publish(s: SatState) {
  satState = s;
  listeners.forEach((fn) => fn(s));
}

/** Loads one tile to find out whether imagery is reachable (no internet = drawn site plan). */
function probe() {
  publish('checking');
  const img = new Image();
  const timer = setTimeout(() => finish('offline'), 6000);
  function finish(s: SatState) {
    clearTimeout(timer);
    img.onload = img.onerror = null;
    publish(s);
  }
  img.onload = () => finish('online');
  img.onerror = () => finish('offline');
  img.src = `${TILE(14, GEO.tileY0 >> 2, GEO.tileX0 >> 2)}?probe=${Date.now()}`;
}

if (typeof window !== 'undefined') {
  probe();
  window.addEventListener('online', probe);
  window.addEventListener('offline', () => publish('offline'));
}

export function useSatelliteState(): SatState {
  const [s, setS] = useState<SatState>(satState);
  useEffect(() => {
    listeners.add(setS);
    setS(satState);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

function tilesFor(view: View, z: number) {
  const s = 2 ** (GEO.zoom - z);
  const size = 256 * s * GEO.mpp;
  const tx0 = Math.floor((view.x / (256 * GEO.mpp) + GEO.tileX0) / s);
  const tx1 = Math.floor(((view.x + view.w) / (256 * GEO.mpp) + GEO.tileX0) / s);
  const ty0 = Math.floor((view.y / (256 * GEO.mpp) + GEO.tileY0) / s);
  const ty1 = Math.floor(((view.y + view.h) / (256 * GEO.mpp) + GEO.tileY0) / s);
  const out: { key: string; href: string; x: number; y: number; size: number }[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      out.push({ key: `${z}/${ty}/${tx}`, href: TILE(z, ty, tx), x: (tx * s - GEO.tileX0) * 256 * GEO.mpp, y: (ty * s - GEO.tileY0) * 256 * GEO.mpp, size });
    }
  }
  return out.length > 160 ? [] : out;
}

/** Tiles at a zoom matched to the screen, over a coarse layer that fills gaps while the sharp ones load. */
export const SatelliteLayer = memo(function SatelliteLayer({ view, mppScreen }: { view: View; mppScreen: number }) {
  const zFine = Math.max(13, Math.min(18, Math.round(GEO.zoom - Math.log2(Math.max(0.05, mppScreen) / GEO.mpp))));
  const zCoarse = Math.max(12, zFine - 3);
  return (
    <g>
      {[zCoarse, zFine].map((z) => (
        <g key={z}>
          {tilesFor(view, z).map((t) => (
            <image key={t.key} href={t.href} x={t.x} y={t.y} width={t.size + 0.6} height={t.size + 0.6} preserveAspectRatio="none" />
          ))}
        </g>
      ))}
    </g>
  );
});
