import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, LayoutGrid, Maximize2, Plus, RotateCcw, X } from 'lucide-react';
import { useApp } from '../lib/app-store';
import type { WidgetLayoutItem } from '../lib/types';
import { WIDGETS, type WidgetKind } from '../components/dashboard/widgets';
import { Button, cn } from '../components/ui/core';
import { Menu, MenuItem, MenuLabel } from '../components/ui/overlay';
import { ErrorBoundary } from '../components/ErrorBoundary';

const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { id: 'kpis', kind: 'kpis', size: 'xl' },
  { id: 'map', kind: 'map', size: 'l' },
  { id: 'alerts', kind: 'alerts', size: 'm' },
  { id: 'production', kind: 'production', size: 'l' },
  { id: 'status', kind: 'status', size: 'm' },
  { id: 'loaders', kind: 'loaders', size: 'm' },
  { id: 'camera', kind: 'camera', size: 'm' },
  { id: 'shift', kind: 'shift', size: 'm' },
  { id: 'fuel', kind: 'fuel', size: 'm' },
  { id: 'activity', kind: 'activity', size: 'l' },
];

const SPAN: Record<WidgetLayoutItem['size'], string> = {
  s: 'col-span-12 md:col-span-6 xl:col-span-3',
  m: 'col-span-12 md:col-span-6 xl:col-span-4',
  l: 'col-span-12 xl:col-span-8',
  xl: 'col-span-12',
};
const NEXT_SIZE: Record<WidgetLayoutItem['size'], WidgetLayoutItem['size']> = { s: 'm', m: 'l', l: 'xl', xl: 's' };
const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Full width' };

function Tile({ item, editing, onRemove, onResize }: { item: WidgetLayoutItem; editing: boolean; onRemove: () => void; onResize: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editing });
  const W = WIDGETS[item.kind as WidgetKind];
  if (!W) return null;
  const Render = W.render;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(SPAN[item.size], 'relative min-w-0', isDragging && 'z-20 opacity-80', editing && 'rounded-[16px] ring-2 ring-dashed ring-accent/40 ring-offset-4 ring-offset-bg')}>
      {editing && (
        <div className="absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-elev px-1.5 py-1 shadow-lg">
          <button type="button" {...attributes} {...listeners} aria-label={`Drag ${W.title}`} className="grid h-6 w-6 cursor-grab place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg active:cursor-grabbing"><GripVertical className="h-3.5 w-3.5" /></button>
          <span className="px-1 text-[11px] font-medium">{W.title}</span>
          <button type="button" onClick={onResize} aria-label="Change size" title={`Size: ${SIZE_LABEL[item.size]}`} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-fg/10 hover:text-fg"><Maximize2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${W.title}`} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-crit/20 hover:text-crit"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className={cn('h-full', editing && 'pointer-events-none select-none')}>
        <ErrorBoundary compact><Render /></ErrorBoundary>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const saved = useApp((s) => s.boot?.prefs.layout);
  const saveLayout = useApp((s) => s.saveLayout);
  const site = useApp((s) => s.boot?.settings.site);
  const user = useApp((s) => s.boot?.user);
  const layout = useMemo(() => (saved?.length ? saved.filter((w) => w.kind in WIDGETS) : DEFAULT_LAYOUT), [saved]);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const missing = (Object.keys(WIDGETS) as WidgetKind[]).filter((k) => !layout.some((w) => w.kind === k));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.findIndex((w) => w.id === e.active.id);
    const to = layout.findIndex((w) => w.id === e.over!.id);
    saveLayout(arrayMove(layout, from, to));
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">{greet}, {user?.name.split(' ')[0]}</h1>
          <p className="text-sm text-muted">{site?.name} · {site?.company}</p>
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <>
              <Menu trigger={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={!missing.length}>Add widget</Button>}>
                <MenuLabel>Widgets</MenuLabel>
                {missing.map((k) => (
                  <MenuItem key={k} onSelect={() => saveLayout([...layout, { id: `${k}-${Date.now()}`, kind: k, size: WIDGETS[k].defaultSize }])}>{WIDGETS[k].title}</MenuItem>
                ))}
              </Menu>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => saveLayout(DEFAULT_LAYOUT)}>Reset</Button>
            </>
          )}
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon={editing ? <Check className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Customise'}
          </Button>
        </div>
      </div>
      {editing && <p className="rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-sm text-muted">Drag widgets by the handle to reorder, use the size button to resize, and × to remove. Changes are saved to your account.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className={cn('grid grid-cols-12 gap-4', editing && 'gap-y-8 pt-2')}>
            {layout.map((w) => (
              <Tile key={w.id} item={w} editing={editing}
                onRemove={() => saveLayout(layout.filter((x) => x.id !== w.id))}
                onResize={() => saveLayout(layout.map((x) => (x.id === w.id ? { ...x, size: NEXT_SIZE[x.size] } : x)))} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
