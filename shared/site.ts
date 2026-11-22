// Mine site geometry in metres (x to the east, y to the south, z = elevation).
// Used by the simulator for routing and by the browser for the live map.

export interface SiteNode {
  id: string;
  x: number;
  y: number;
  z: number;
  zone: string;
  /** a named stopping point: loading face, dump, facility */
  kind?: 'face' | 'dump' | 'crusher' | 'rom' | 'fuel' | 'workshop' | 'parking' | 'water' | 'junction';
  material?: 'ore' | 'waste';
}

export interface SiteEdge {
  a: string;
  b: string;
  /** speed limit km/h */
  limit: number;
}

export interface SiteZone {
  id: string;
  name: string;
  kind: 'pit' | 'dump' | 'crusher' | 'rom' | 'fuel' | 'workshop' | 'parking' | 'water' | 'drill' | 'stockpile';
  points: [number, number][];
  label: [number, number];
}

// The site is laid over real satellite imagery of an open-pit iron-ore mining area in eastern India.
// Coordinates are metres from the north-west corner of the imagery (Web Mercator, zoom 16 tile 48328/28631).
export const SITE_SIZE = { w: 4531, h: 3399 };
export const GEO = { lat0: 22.15179557539776, lon0: 85.4736328125, tileX0: 48328, tileY0: 28631, zoom: 16, mpp: 2.2126067024799467 };
export const PIT_CENTER = { x: 2790, y: 1380, rx: 360, ry: 560 };
export const BENCH_COUNT = 7;

export const NODES: SiteNode[] = [
  { id: 'PF', x: 2790, y: 1600, z: -120, zone: 'Pit floor', kind: 'junction' },
  { id: 'B100', x: 2905, y: 1560, z: -100, zone: 'Main ramp', kind: 'junction' },
  { id: 'B80', x: 2945, y: 1395, z: -80, zone: 'Main ramp', kind: 'junction' },
  { id: 'B60', x: 2820, y: 1255, z: -60, zone: 'Main ramp', kind: 'junction' },
  { id: 'B40', x: 2680, y: 1350, z: -40, zone: 'Main ramp', kind: 'junction' },
  { id: 'B20', x: 2630, y: 1585, z: -20, zone: 'Main ramp', kind: 'junction' },
  { id: 'EXIT', x: 2515, y: 1770, z: 0, zone: 'Pit exit', kind: 'junction' },
  { id: 'N40', x: 2770, y: 1110, z: -40, zone: 'North bench', kind: 'junction' },
  { id: 'W40', x: 1420, y: 1560, z: -20, zone: 'West pit ramp', kind: 'junction' },
  { id: 'S80', x: 1780, y: 2440, z: -10, zone: 'South haul road', kind: 'junction' },
  { id: 'S60', x: 1350, y: 1300, z: -40, zone: 'West pit bench', kind: 'junction' },
  { id: 'F-N1', x: 2880, y: 1010, z: -40, zone: 'Face N1', kind: 'face', material: 'ore' },
  { id: 'F-N2', x: 3030, y: 1480, z: -80, zone: 'Face N2', kind: 'face', material: 'ore' },
  { id: 'F-C', x: 2700, y: 1510, z: -120, zone: 'Face C', kind: 'face', material: 'waste' },
  { id: 'F-S1', x: 1480, y: 1040, z: -60, zone: 'Face S1', kind: 'face', material: 'waste' },
  { id: 'F-S2', x: 1860, y: 2830, z: -30, zone: 'Face S2', kind: 'face', material: 'waste' },
  { id: 'F-W1', x: 1560, y: 1270, z: -50, zone: 'Face W1', kind: 'face', material: 'ore' },
  { id: 'JX', x: 1975, y: 1815, z: 0, zone: 'Haul road', kind: 'junction' },
  { id: 'CRJ', x: 1860, y: 1720, z: 0, zone: 'Haul road', kind: 'junction' },
  { id: 'CR', x: 1790, y: 1630, z: 8, zone: 'Primary crusher', kind: 'crusher' },
  { id: 'ROM', x: 1700, y: 1790, z: 4, zone: 'ROM pad', kind: 'rom', material: 'ore' },
  { id: 'WDJ', x: 2040, y: 2040, z: 5, zone: 'Haul road', kind: 'junction' },
  { id: 'WD', x: 2180, y: 2240, z: 25, zone: 'Waste dump south', kind: 'dump' },
  { id: 'FBJ', x: 1475, y: 2400, z: 0, zone: 'Service road', kind: 'junction' },
  { id: 'FB', x: 1385, y: 2355, z: 0, zone: 'Fuel bay', kind: 'fuel' },
  { id: 'WF', x: 1950, y: 2680, z: 0, zone: 'Water fill', kind: 'water' },
  { id: 'WS', x: 1200, y: 2400, z: 0, zone: 'Workshop', kind: 'workshop' },
  { id: 'AD', x: 2265, y: 1680, z: 0, zone: 'Admin & plant offices', kind: 'parking' },
  { id: 'PJ', x: 2300, y: 1795, z: 0, zone: 'Haul road', kind: 'junction' },
];

export const EDGES: SiteEdge[] = [
  { a: 'PF', b: 'B100', limit: 35 },
  { a: 'B100', b: 'B80', limit: 35 },
  { a: 'B80', b: 'B60', limit: 35 },
  { a: 'B60', b: 'B40', limit: 35 },
  { a: 'B40', b: 'B20', limit: 35 },
  { a: 'B20', b: 'EXIT', limit: 35 },
  { a: 'B60', b: 'N40', limit: 30 },
  { a: 'N40', b: 'F-N1', limit: 25 },
  { a: 'B80', b: 'F-N2', limit: 25 },
  { a: 'PF', b: 'F-C', limit: 25 },
  { a: 'EXIT', b: 'PJ', limit: 50 },
  { a: 'PJ', b: 'JX', limit: 50 },
  { a: 'PJ', b: 'AD', limit: 20 },
  { a: 'JX', b: 'CRJ', limit: 40 },
  { a: 'CRJ', b: 'CR', limit: 25 },
  { a: 'CRJ', b: 'ROM', limit: 25 },
  { a: 'CRJ', b: 'W40', limit: 40 },
  { a: 'W40', b: 'S60', limit: 30 },
  { a: 'S60', b: 'F-W1', limit: 25 },
  { a: 'S60', b: 'F-S1', limit: 25 },
  { a: 'JX', b: 'WDJ', limit: 50 },
  { a: 'WDJ', b: 'WD', limit: 35 },
  { a: 'WDJ', b: 'S80', limit: 45 },
  { a: 'S80', b: 'F-S2', limit: 30 },
  { a: 'S80', b: 'WF', limit: 25 },
  { a: 'S80', b: 'FBJ', limit: 35 },
  { a: 'FBJ', b: 'FB', limit: 20 },
  { a: 'FB', b: 'WS', limit: 20 },
];

export const NODE_BY_ID: Record<string, SiteNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));

/** Irregular bench outline k (0 = pit rim) as a closed polygon. */
export function benchOutline(k: number, steps = 72): [number, number][] {
  const s = 1 - k * 0.13;
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = 1 + 0.06 * Math.sin(3 * t + 1 + k * 0.2) + 0.04 * Math.sin(5 * t + 2) + 0.025 * Math.cos(7 * t + k * 0.4);
    pts.push([PIT_CENTER.x + Math.cos(t) * PIT_CENTER.rx * s * r, PIT_CENTER.y + Math.sin(t) * PIT_CENTER.ry * s * r]);
  }
  return pts;
}

function rect(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function blob(cx: number, cy: number, rx: number, ry: number, seed: number, steps = 28): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = 1 + 0.09 * Math.sin(3 * t + seed) + 0.05 * Math.cos(5 * t + seed * 2);
    pts.push([cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r]);
  }
  return pts;
}

export const ZONES: SiteZone[] = [
  { id: 'pit', name: 'Main pit', kind: 'pit', points: benchOutline(0), label: [2790, 780] },
  { id: 'dump', name: 'Waste dump south', kind: 'dump', points: blob(2200, 2250, 230, 180, 1.3), label: [2200, 2470] },
  { id: 'crusher', name: 'Primary crusher', kind: 'crusher', points: rect(1735, 1585, 115, 85), label: [1790, 1570] },
  { id: 'rom', name: 'ROM pad', kind: 'rom', points: rect(1615, 1740, 170, 110), label: [1700, 1880] },
  { id: 'stock1', name: 'Ore stockpile', kind: 'stockpile', points: blob(1560, 1830, 70, 50, 2.1), label: [1520, 1910] },
  { id: 'fuel', name: 'Fuel bay', kind: 'fuel', points: rect(1325, 2310, 120, 85), label: [1385, 2290] },
  { id: 'water', name: 'Water fill', kind: 'water', points: rect(1900, 2640, 100, 80), label: [1950, 2620] },
  { id: 'workshop', name: 'Workshop', kind: 'workshop', points: rect(1110, 2350, 180, 110), label: [1200, 2335] },
  { id: 'parking', name: 'Admin & plant offices', kind: 'parking', points: rect(2195, 1625, 140, 90), label: [2265, 1610] },
  { id: 'drill', name: 'Drill bench N', kind: 'drill', points: rect(2800, 860, 270, 120), label: [2935, 845] },
];

/** Drill pattern origin: drills step across this grid. */
export const DRILL_PATTERN = { x: 2815, y: 875, cols: 12, rows: 5, spacing: 22 };

/** Shortest path between two node ids (Dijkstra on the road graph). */
export function shortestPath(from: string, to: string): string[] {
  if (from === to) return [from];
  const adj = new Map<string, { id: string; d: number }[]>();
  for (const e of EDGES) {
    const a = NODE_BY_ID[e.a];
    const b = NODE_BY_ID[e.b];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ id: e.b, d });
    adj.get(e.b)!.push({ id: e.a, d });
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) { best = d; cur = id; }
    }
    open.delete(cur);
    if (cur === to) break;
    for (const n of adj.get(cur) ?? []) {
      const nd = best + n.d;
      if (nd < (dist.get(n.id) ?? Infinity)) {
        dist.set(n.id, nd);
        prev.set(n.id, cur);
        open.add(n.id);
      }
    }
  }
  if (!prev.has(to)) return [from];
  const path = [to];
  let p = to;
  while (prev.has(p)) { p = prev.get(p)!; path.unshift(p); }
  return path;
}

export function edgeLimit(a: string, b: string): number {
  const e = EDGES.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return e?.limit ?? 30;
}

export function pathLength(ids: string[]): number {
  let d = 0;
  for (let i = 1; i < ids.length; i++) {
    const a = NODE_BY_ID[ids[i - 1]];
    const b = NODE_BY_ID[ids[i]];
    d += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return d;
}

/** Name of the area a point is in, for "Zone" labels. */
export function zoneAt(x: number, y: number): string {
  let best = 'Haul road';
  let bd = Infinity;
  for (const n of NODES) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = n.zone; }
  }
  if (x > 2800 && x < 3070 && y > 860 && y < 980) return 'Drill bench N';
  if (bd > 160) {
    const dx = (x - PIT_CENTER.x) / PIT_CENTER.rx;
    const dy = (y - PIT_CENTER.y) / PIT_CENTER.ry;
    return dx * dx + dy * dy < 1 ? 'Main pit' : 'Surface';
  }
  return best;
}
