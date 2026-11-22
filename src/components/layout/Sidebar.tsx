import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NAV } from './nav';
import { Wordmark } from './Logo';
import { cn } from '../ui/core';
import { Tip } from '../ui/overlay';
import { useLive } from '../../lib/live';
import { useApp } from '../../lib/app-store';

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const openAlerts = useLive((s) => s.openAlerts.length);
  const critical = useLive((s) => s.openAlerts.filter((a) => a.severity === 'critical' && a.status === 'active').length);
  const site = useApp((s) => s.boot?.settings.site);
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <aside data-noprint className={cn('relative z-20 flex h-full shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-[232px]')}>
      <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Wordmark collapsed={collapsed} />
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {groups.map((g) => (
          <div key={g} className="mb-3">
            {!collapsed && <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{g}</p>}
            {NAV.filter((n) => n.group === g).map((n) => {
              const link = (
                <NavLink key={n.to} to={n.to} end={n.to === '/'}
                  className={({ isActive }) => cn('group relative mb-0.5 flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-accent/[0.12] text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg')}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute left-0 top-1.5 h-6 w-[3px] rounded-r bg-accent" />}
                      <n.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-accent' : '')} />
                      {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                      {n.to === '/alerts' && openAlerts > 0 && (
                        <span className={cn('tnum rounded-full px-1.5 text-[10px] font-semibold leading-4', critical ? 'bg-crit text-white' : 'bg-warn/20 text-warn',
                          collapsed && 'absolute right-1 top-0.5')}>{openAlerts}</span>
                      )}
                    </>
                  )}
                </NavLink>
              );
              return collapsed ? <Tip key={n.to} content={n.label} side="right">{link}</Tip> : link;
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2.5">
        {!collapsed && site && (
          <div className="mb-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
            <p className="truncate text-xs font-semibold">{site.name}</p>
            <p className="truncate text-[11px] text-muted">{site.commodity} · {site.location}</p>
          </div>
        )}
        <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-lg text-xs text-muted hover:bg-fg/[0.05] hover:text-fg">
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}
