import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn, EmptyState, Skeleton } from './core';

export interface Col<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => number | string | null | undefined;
  width?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface Props<T> {
  columns: Col<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** fixed height enables row virtualisation */
  height?: number | string;
  rowHeight?: number;
  selectedKey?: string | number | null;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty, initialSort, height, rowHeight = 44, selectedKey, className, rowClassName }: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const f = col.sort;
    const out = [...rows].sort((a, b) => {
      const va = f(a);
      const vb = f(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return va < vb ? -1 : 1;
    });
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  const template = columns.map((c) => c.width ?? 'minmax(90px,1fr)').join(' ');
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = height !== undefined && sorted.length > 40;
  const v = useVirtualizer({
    count: virtual ? sorted.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const header = (
    <div role="row" className="sticky top-0 z-10 grid min-w-fit items-center gap-3 border-b border-line bg-panel-2/95 px-4 text-[11px] font-medium uppercase tracking-wider text-muted backdrop-blur" style={{ gridTemplateColumns: template, height: 36 }}>
      {columns.map((c) => {
        const active = sort?.key === c.key;
        return (
          <div key={c.key} role="columnheader" className={cn('flex min-w-0 items-center gap-1', c.align === 'right' && 'justify-end', c.align === 'center' && 'justify-center')}>
            {c.sort ? (
              <button type="button" className="inline-flex items-center gap-1 truncate uppercase tracking-wider hover:text-fg"
                onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' })}>
                {c.header}
                {active && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              </button>
            ) : <span className="truncate">{c.header}</span>}
          </div>
        );
      })}
    </div>
  );

  const renderRow = (row: T, style?: React.CSSProperties) => {
    const k = rowKey(row);
    return (
      <div key={k} role="row" style={{ gridTemplateColumns: template, minHeight: rowHeight, ...style }}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
        className={cn('grid min-w-fit items-center gap-3 border-b border-line px-4 text-sm', onRowClick && 'cursor-pointer hover:bg-fg/[0.035] focus:bg-fg/[0.05] focus:outline-none',
          selectedKey === k && 'bg-accent/[0.07]', rowClassName?.(row))}>
        {columns.map((c) => (
          <div key={c.key} role="cell" className={cn('min-w-0 py-2', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.cell(row)}</div>
        ))}
      </div>
    );
  };

  return (
    <div ref={scrollRef} role="table" className={cn('scroll-thin relative overflow-auto', className)} style={{ height, maxHeight: height }}>
      {header}
      {loading && !rows.length ? (
        <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : !sorted.length ? (
        empty ?? <EmptyState title="Nothing to show" message="Try a different filter or time range." />
      ) : virtual ? (
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => renderRow(sorted[vi.index], { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: rowHeight }))}
        </div>
      ) : (
        sorted.map((r) => renderRow(r))
      )}
    </div>
  );
}
