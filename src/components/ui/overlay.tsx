import type { ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import * as M from '@radix-ui/react-dropdown-menu';
import * as T from '@radix-ui/react-tooltip';
import * as P from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { Button, cn } from './core';

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content className={cn('panel fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col bg-elev focus:outline-none', w)}>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="font-display text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X className="h-4 w-4" /></Button></D.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Drawer({ open, onOpenChange, title, description, children, footer, width = 'max-w-md' }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line-strong bg-elev shadow-2xl focus:outline-none', width)}>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="font-display text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">Panel</D.Description>}
            </div>
            <D.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X className="h-4 w-4" /></Button></D.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="panel z-50 min-w-48 bg-elev p-1 text-sm">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item disabled={disabled} onSelect={onSelect}
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-fg/[0.07]', danger ? 'text-crit' : 'text-fg')}>
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</M.Label>;
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md border border-line-strong bg-elev px-2 py-1 text-xs text-fg shadow-lg">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;

export function Popover({ trigger, children, align = 'end', className }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={8} className={cn('panel z-50 bg-elev focus:outline-none', className)}>{children}</P.Content>
      </P.Portal>
    </P.Root>
  );
}

// ---------------------------------------------------------------- confirm dialog (promise based)

interface ConfirmReq { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }
const useConfirmStore = create<{ req: ConfirmReq | null }>(() => ({ req: null }));

export function confirmAction(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  const close = (v: boolean) => {
    req?.resolve(v);
    useConfirmStore.setState({ req: null });
  };
  return (
    <Dialog open={Boolean(req)} onOpenChange={(o) => !o && close(false)} title={req?.title ?? ''} size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
        <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{req?.confirmLabel ?? 'Confirm'}</Button>
      </>}>
      <div className="text-sm text-muted">{req?.message}</div>
    </Dialog>
  );
}
