import { useMemo } from 'react';
import { Command } from 'cmdk';
import * as D from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, Keyboard, LogOut, Moon, Siren, User, Video } from 'lucide-react';
import { NAV } from './nav';
import { useApp } from '../../lib/app-store';
import { useLive } from '../../lib/live';
import { TYPE_ICON } from '../machine/glyphs';
import { TYPE_LABEL, can } from '../../../shared/types';
import { StatusPill } from '../ui/core';

const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg aria-selected:bg-accent/12 aria-selected:text-fg';
const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint';

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const boot = useApp((s) => s.boot);
  const theme = useApp((s) => s.theme);
  const { setPaletteOpen, setTheme, setDemoOpen, setShortcutsOpen, logout } = useApp.getState();
  const navigate = useNavigate();
  // A snapshot taken when the palette opens. Following the live feed changed every item's search text
  // twice a second, so cmdk re-sorted the list and the page re-laid itself out hundreds of times a second while typing.
  const live = useMemo(() => (open ? useLive.getState().machines : null), [open]);
  const alerts = useMemo(() => (open ? useLive.getState().openAlerts : null), [open]);
  if (!boot) return null;
  const go = (to: string) => {
    setPaletteOpen(false);
    navigate(to);
  };
  return (
    <D.Root open={open} onOpenChange={setPaletteOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <D.Content className="panel fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden bg-elev p-0 focus:outline-none">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search machines, operators, pages and actions</D.Description>
          <Command label="Global search" loop>
            <Command.Input autoFocus placeholder="Search machines, operators, pages, actions…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-sm text-fg placeholder:text-faint focus:outline-none" />
            <Command.List className="scroll-thin max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">No results.</Command.Empty>
              <Command.Group heading="Pages" className={group}>
                {NAV.map((n) => (
                  <Command.Item key={n.to} value={`page ${n.label} ${n.description}`} onSelect={() => go(n.to)} className={item}>
                    <n.icon className="h-4 w-4 text-muted" /> <span className="flex-1">{n.label}</span>
                    <span className="text-xs text-faint">g {n.key}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Machines" className={group}>
                {boot.machines.map((m) => {
                  const Icon = TYPE_ICON[m.type];
                  const l = live?.[m.id];
                  return (
                    <Command.Item key={m.id} value={`machine ${m.id} ${m.name} ${m.model} ${m.make} ${TYPE_LABEL[m.type]} ${l?.op ?? ''}`} onSelect={() => go(`/fleet/${m.id}`)} className={item}>
                      <Icon className="h-4 w-4 text-muted" />
                      <span className="w-20 font-medium">{m.id}</span>
                      <span className="flex-1 truncate text-muted">{m.make} {m.model}</span>
                      {l && <StatusPill status={l.st} />}
                    </Command.Item>
                  );
                })}
              </Command.Group>
              <Command.Group heading="Cameras" className={group}>
                {boot.machines.slice(0, 40).map((m) => (
                  <Command.Item key={`cam-${m.id}`} value={`camera video ${m.id}`} onSelect={() => go(`/cameras?machine=${m.id}`)} className={item}>
                    <Video className="h-4 w-4 text-muted" /> Cameras · {m.id}
                  </Command.Item>
                ))}
              </Command.Group>
              {alerts && alerts.length > 0 && (
                <Command.Group heading="Open alerts" className={group}>
                  {alerts.slice(0, 15).map((a) => (
                    <Command.Item key={a.id} value={`alert ${a.title} ${a.machineId} ${a.message}`} onSelect={() => go(`/alerts?focus=${a.id}`)} className={item}>
                      <Siren className={a.severity === 'critical' ? 'h-4 w-4 text-crit' : 'h-4 w-4 text-warn'} />
                      <span className="flex-1 truncate">{a.title} · {a.machineId}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Operators" className={group}>
                {boot.operators.map((o) => (
                  <Command.Item key={o.id} value={`operator ${o.name} ${o.employeeNo}`} onSelect={() => go(`/fleet/operators?q=${encodeURIComponent(o.name)}`)} className={item}>
                    <User className="h-4 w-4 text-muted" /> <span className="flex-1">{o.name}</span><span className="text-xs text-faint">{o.employeeNo} · Shift {o.shift}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={group}>
                <Command.Item value="action toggle theme dark light" className={item} onSelect={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPaletteOpen(false); }}>
                  <Moon className="h-4 w-4 text-muted" /> Switch to {theme === 'dark' ? 'light' : 'dark'} theme
                </Command.Item>
                {can(boot.user.role, 'manage') && (
                  <Command.Item value="action demo control scenarios speed" className={item} onSelect={() => { setPaletteOpen(false); setDemoOpen(true); }}>
                    <FlaskConical className="h-4 w-4 text-muted" /> Open demo control
                  </Command.Item>
                )}
                <Command.Item value="action keyboard shortcuts help" className={item} onSelect={() => { setPaletteOpen(false); setShortcutsOpen(true); }}>
                  <Keyboard className="h-4 w-4 text-muted" /> Keyboard shortcuts
                </Command.Item>
                <Command.Item value="action sign out logout" className={item} onSelect={() => { setPaletteOpen(false); void logout(); }}>
                  <LogOut className="h-4 w-4 text-muted" /> Sign out
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
