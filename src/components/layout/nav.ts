import {
  Activity, BarChart3, FileBarChart, Fuel, LayoutDashboard, Map, Rotate3d, Settings2, Siren, Truck, Video, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  key: string;
  group: 'Operations' | 'Monitoring' | 'Insights' | 'System';
  description: string;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Command', icon: LayoutDashboard, key: 'd', group: 'Operations', description: 'Live KPIs, map and production trend' },
  { to: '/map', label: 'Live map', icon: Map, key: 'm', group: 'Operations', description: 'Every machine on the site plan' },
  { to: '/fleet', label: 'Fleet', icon: Truck, key: 'f', group: 'Operations', description: 'Machines, dispatch, crews, maintenance, downtime' },
  { to: '/production', label: 'Production', icon: BarChart3, key: 'p', group: 'Operations', description: 'Tonnes, TPH, loads and cycle times' },
  { to: '/sensors', label: 'Sensors', icon: Activity, key: 's', group: 'Monitoring', description: 'Live sensor panels and thresholds' },
  { to: '/cameras', label: 'Cameras', icon: Video, key: 'c', group: 'Monitoring', description: 'Live video, playback and event clips' },
  { to: '/surround', label: '360° view', icon: Rotate3d, key: 'v', group: 'Monitoring', description: '3D model and bird’s-eye surround view' },
  { to: '/fuel', label: 'Fuel', icon: Fuel, key: 'u', group: 'Monitoring', description: 'Levels, burn, refuels and anomalies' },
  { to: '/alerts', label: 'Alerts', icon: Siren, key: 'a', group: 'Monitoring', description: 'Live alarms and event history' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, key: 'r', group: 'Insights', description: 'Shift, daily and weekly reports' },
  { to: '/admin', label: 'Admin', icon: Settings2, key: 'x', group: 'System', description: 'Users, thresholds, targets and setup' },
];

export function navTitle(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV[0];
  return NAV.slice(1).find((n) => pathname.startsWith(n.to));
}
