import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Clapperboard, Download, Film, Grid2x2, Grid3x3, History, Image as ImageIcon, LayoutGrid, Play, Square, Trash2, Video } from 'lucide-react';
import { useBoot } from '../lib/app-store';
import { useLive } from '../lib/live';
import { useQuery } from '../lib/hooks';
import { del, qs } from '../lib/api';
import { bytes, dateTime, duration } from '../lib/format';
import { deleteClip, loadClip } from '../lib/idb';
import { downloadBlob } from '../lib/export';
import { usePalette } from '../lib/palette';
import { CAMERA_LABEL, can, type AlertRow, type CameraPosition } from '../../shared/types';
import { Tabs, useTabParam } from '../components/ui/tabs';
import { Badge, Button, Card, cn, EmptyState, PageHeader, SEVERITY_TONE, StatusPill } from '../components/ui/core';
import { SearchInput, Segmented, Select } from '../components/ui/form';
import { Dialog, confirmAction } from '../components/ui/overlay';
import { DataTable, type Col } from '../components/ui/table';
import { CameraTile } from '../components/camera/CameraTile';
import { PlaybackPlayer, QualityLegend } from '../components/camera/Playback';
import { TYPE_ICON } from '../components/machine/glyphs';

const TABS = ['live', 'playback', 'events', 'media'] as const;

function LiveWall() {
  const boot = useBoot();
  const machines = useLive((s) => s.machines);
  const p = usePalette();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [mode, setMode] = useState<'machine' | 'fleet'>(sp.get('machine') ? 'machine' : 'fleet');
  const [machineId, setMachineId] = useState(sp.get('machine') ?? boot.machines.find((m) => m.type === 'truck')?.id ?? boot.machines[0]?.id);
  const [position, setPosition] = useState<CameraPosition>('front');
  const [grid, setGrid] = useState<4 | 9 | 16>(9);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<{ machineId: string; position: CameraPosition } | null>(null);

  useEffect(() => {
    const m = sp.get('machine');
    if (m) {
      setMachineId(m);
      setMode('machine');
    }
    const cam = sp.get('cam') as CameraPosition | null;
    if (m && cam) setFocus({ machineId: m, position: cam });
  }, [sp]);

  const machineCams = boot.cameras.filter((c) => c.machineId === machineId && c.enabled);
  const fleetCams = boot.cameras.filter((c) => c.position === position && c.enabled);
  const pages = Math.max(1, Math.ceil(fleetCams.length / grid));
  const shown = fleetCams.slice(page * grid, page * grid + grid);
  const list = boot.machines.filter((m) => !q || m.id.toLowerCase().includes(q.toLowerCase()));
  const positions = [...new Set(boot.cameras.map((c) => c.position))] as CameraPosition[];

  const gridConfig = useMemo(() => {
    if (mode === 'machine') {
      const n = machineCams.length;
      if (n <= 1) return { cols: 1, rows: 1 };
      if (n <= 2) return { cols: 2, rows: 1 };
      if (n <= 4) return { cols: 2, rows: 2 };
      return { cols: 3, rows: 2 };
    }
    if (grid === 4) return { cols: 2, rows: 2 };
    if (grid === 16) return { cols: 4, rows: 4 };
    return { cols: 3, rows: 3 };
  }, [mode, machineCams.length, grid]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:h-[calc(100vh-215px)] lg:min-h-[500px]">
      <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line p-2.5"><SearchInput value={q} onChange={setQ} placeholder="Machine" /></div>
        <ul className="scroll-thin flex-1 min-h-0 overflow-y-auto p-1.5">
          {list.map((m) => {
            const Icon = TYPE_ICON[m.type];
            const l = machines[m.id];
            const n = boot.cameras.filter((c) => c.machineId === m.id).length;
            return (
              <li key={m.id}>
                <button type="button" onClick={() => { setMode('machine'); setMachineId(m.id); const nx = new URLSearchParams(sp); nx.set('machine', m.id); setSp(nx, { replace: true }); }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-fg/[0.04]', mode === 'machine' && machineId === m.id && 'bg-accent/[0.12]')}>
                  <Icon className="h-4 w-4" style={{ color: p.status[l?.st ?? 'offline'] }} />
                  <span className="flex-1 font-medium">{m.id}</span>
                  <span className="text-[11px] text-faint">{n} cam</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="mb-2.5 flex shrink-0 flex-wrap items-center gap-2">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'machine', label: 'One machine' }, { value: 'fleet', label: 'Fleet wall' }]} />
          {mode === 'fleet' ? (
            <>
              <Select aria-label="Camera position" value={position} onChange={(e) => { setPosition(e.target.value as CameraPosition); setPage(0); }} className="w-36">
                {positions.map((x) => <option key={x} value={x}>{CAMERA_LABEL[x]} cameras</option>)}
              </Select>
              <Segmented size="sm" value={grid} onChange={(g) => { setGrid(g); setPage(0); }} options={[
                { value: 4, label: <Grid2x2 className="h-3.5 w-3.5" />, title: '2 × 2' }, { value: 9, label: <Grid3x3 className="h-3.5 w-3.5" />, title: '3 × 3' }, { value: 16, label: <LayoutGrid className="h-3.5 w-3.5" />, title: '4 × 4' },
              ]} />
              <div className="ml-auto flex items-center gap-1 text-xs text-muted">
                <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
                <span className="tnum">Page {page + 1} / {pages}</span>
                <Button size="xs" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </>
          ) : machineId && (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="font-display text-base font-semibold">{machineId}</span>
              {machines[machineId] && <StatusPill status={machines[machineId].st} />}
              <span className="text-sm text-muted">{machines[machineId]?.act}</span>
              <Button size="sm" className="ml-auto" icon={<History className="h-3.5 w-3.5" />} onClick={() => navigate(`/cameras?tab=playback&machine=${machineId}`)}>Playback</Button>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 w-full overflow-hidden">
          {mode === 'machine' ? (
            machineCams.length ? (
              <div
                className="grid h-full w-full gap-2"
                style={{
                  gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${gridConfig.rows}, minmax(0, 1fr))`,
                }}
              >
                {machineCams.map((c) => (
                  <CameraTile key={c.id} machineId={c.machineId} position={c.position} fps={12} maxW={640} fitContainer onExpand={() => setFocus({ machineId: c.machineId, position: c.position })} />
                ))}
              </div>
            ) : <EmptyState title="No cameras on this machine" icon={<Video className="h-5 w-5" />} />
          ) : (
            <div
              className="grid h-full w-full gap-2"
              style={{
                gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridConfig.rows}, minmax(0, 1fr))`,
              }}
            >
              {shown.map((c) => (
                <CameraTile key={c.id} machineId={c.machineId} position={c.position} fps={grid === 16 ? 6 : 10} maxW={grid === 16 ? 360 : 480} fitContainer onExpand={() => setFocus({ machineId: c.machineId, position: c.position })} />
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 shrink-0 text-xs text-faint">Hover a feed for snapshot, record and full-screen controls. Feeds pause when scrolled out of view to keep the app fast.</p>
      </div>
      <Dialog open={Boolean(focus)} onOpenChange={(o) => { if (!o) { setFocus(null); const nx = new URLSearchParams(sp); nx.delete('cam'); setSp(nx, { replace: true }); } }} size="xl"
        title={focus ? `${focus.machineId} · ${CAMERA_LABEL[focus.position]} camera` : ''} description={focus ? machines[focus.machineId]?.act : undefined}
        footer={focus && <>
          <Button icon={<History className="h-4 w-4" />} onClick={() => navigate(`/cameras?tab=playback&machine=${focus.machineId}&cam=${focus.position}`)}>Open playback</Button>
          <Button variant="primary" onClick={() => navigate(`/fleet/${focus.machineId}`)}>Machine details</Button>
        </>}>
        {focus && <CameraTile machineId={focus.machineId} position={focus.position} fps={20} maxW={1280} />}
      </Dialog>
    </div>
  );
}

function PlaybackTab() {
  const boot = useBoot();
  const [sp, setSp] = useSearchParams();
  const machine = sp.get('machine') ?? boot.machines.find((m) => m.type === 'truck')?.id ?? boot.machines[0].id;
  const cam = (sp.get('cam') ?? undefined) as CameraPosition | undefined;
  const at = sp.get('at') ? Number(sp.get('at')) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Pick a machine, camera, date and time — then play, scrub or jump between events. Coloured bars show what the machine was doing.</p>
        <QualityLegend />
      </div>
      <PlaybackPlayer key={`${machine}-${at ?? ''}`} machineId={machine} position={cam} at={at}
        onMachineChange={(id) => { const n = new URLSearchParams(sp); n.set('machine', id); n.delete('at'); setSp(n, { replace: true }); }} />
    </div>
  );
}

function EventsTab() {
  const boot = useBoot();
  const navigate = useNavigate();
  const t = useLive((s) => Math.floor(s.t / 60_000) * 60_000);
  const [severity, setSeverity] = useState<'all' | 'critical' | 'warning'>('all');
  const [hours, setHours] = useState(24);
  const q = useQuery<{ rows: AlertRow[] }>(`/alerts${qs({ status: 'all', from: t - hours * 3_600_000, severity: severity === 'all' ? undefined : severity, limit: 500 })}`, { refreshMs: 20_000 });
  // only cameras that are switched on and recording have footage for an event clip
  const rows = (q.data?.rows ?? []).filter((a) => a.camera && boot.cameras.some((c) => c.machineId === a.machineId && c.position === a.camera && c.enabled && c.recording));
  const cols: Col<AlertRow>[] = [
    { key: 'ts', header: 'Time', width: '150px', sort: (a) => a.ts, cell: (a) => dateTime(a.ts, true) },
    { key: 'm', header: 'Machine', width: '100px', sort: (a) => a.machineId, cell: (a) => <span className="font-medium">{a.machineId}</span> },
    { key: 'sev', header: 'Severity', width: '100px', sort: (a) => a.severity, cell: (a) => <Badge tone={SEVERITY_TONE[a.severity]} dot>{a.severity}</Badge> },
    { key: 'title', header: 'Event', width: 'minmax(220px,2fr)', cell: (a) => <div className="min-w-0"><p className="truncate font-medium">{a.title}</p><p className="truncate text-xs text-muted">{a.message}</p></div> },
    { key: 'cam', header: 'Camera', width: '100px', cell: (a) => <Badge tone="info">{CAMERA_LABEL[a.camera!]}</Badge> },
    { key: 'clip', header: '', width: '120px', cell: (a) => <Button size="xs" variant="primary" icon={<Play className="h-3 w-3" />}
      onClick={() => navigate(`/cameras?tab=playback&machine=${a.machineId}&cam=${a.camera}&at=${a.ts - 15_000}`)}>Play clip</Button> },
  ];
  return (
    <Card flush title="Event clips" subtitle="Every alert is linked to the camera that saw it — playback starts 15 s before the event"
      actions={<div className="flex gap-2">
        <Segmented size="sm" value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'All' }, { value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }]} />
        <Segmented size="sm" value={hours} onChange={setHours} options={[{ value: 8, label: '8 h' }, { value: 24, label: '24 h' }, { value: 72, label: '3 d' }]} />
      </div>}>
      <DataTable columns={cols} rows={rows} rowKey={(a) => a.id} loading={q.loading} height="calc(100vh - 320px)" initialSort={{ key: 'ts', dir: 'desc' }}
        empty={<EmptyState title="No camera events" message="Event clips appear here when alerts are raised." icon={<Clapperboard className="h-5 w-5" />} />} />
    </Card>
  );
}

interface Snap { id: number; ts: number; createdAt: number; machineId: string; camera: string; userName: string; source: string }
interface Rec { id: number; machineId: string; camera: string; startTs: number; endTs: number; kind: string; sizeBytes: number; clientKey: string; userName: string; createdAt: number }

function MediaTab() {
  const boot = useBoot();
  const snaps = useQuery<Snap[]>('/snapshots');
  const recs = useQuery<Rec[]>('/recordings');
  const [view, setView] = useState<Snap | null>(null);
  const [video, setVideo] = useState<{ url: string; rec: Rec } | null>(null);
  const canOp = can(boot.user.role, 'operate');
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);
  const play = async (r: Rec) => {
    const blob = await loadClip(r.clientKey);
    if (!blob) { toast.error('This clip is stored in another browser', { description: 'Recordings are kept on the computer that recorded them.' }); return; }
    setVideo({ url: URL.createObjectURL(blob), rec: r });
  };
  const download = async (r: Rec) => {
    const blob = await loadClip(r.clientKey);
    if (!blob) { toast.error('Clip not found in this browser'); return; }
    downloadBlob(blob, `${r.machineId}-${r.camera}-${r.startTs}.webm`);
  };
  const removeRec = async (r: Rec) => {
    if (!(await confirmAction({ title: 'Delete this recording?', message: `${r.machineId} ${r.camera}, ${dateTime(r.startTs)}`, danger: true, confirmLabel: 'Delete' }))) return;
    await deleteClip(r.clientKey);
    await del(`/recordings/${r.id}`).catch(() => {});
    recs.reload();
  };
  const removeSnap = async (s: Snap) => {
    if (!(await confirmAction({ title: 'Delete this snapshot?', message: `${s.machineId} ${s.camera}`, danger: true, confirmLabel: 'Delete' }))) return;
    await del(`/snapshots/${s.id}`).catch((e) => toast.error(e.message));
    setView(null);
    snaps.reload();
  };
  const recCols: Col<Rec>[] = useMemo(() => [
    { key: 'ts', header: 'Recorded', width: '150px', sort: (r) => r.startTs, cell: (r) => dateTime(r.startTs, true) },
    { key: 'm', header: 'Camera', width: 'minmax(140px,1fr)', cell: (r) => <span className="font-medium">{r.machineId} · {r.camera}</span> },
    { key: 'k', header: 'Source', width: '100px', cell: (r) => <Badge tone={r.kind === 'manual' ? 'accent' : 'info'}>{r.kind === 'manual' ? 'live' : 'playback'}</Badge> },
    { key: 'd', header: 'Length', width: '90px', cell: (r) => duration(r.endTs - r.startTs) },
    { key: 's', header: 'Size', width: '90px', align: 'right', cell: (r) => <span className="tnum text-muted">{bytes(r.sizeBytes)}</span> },
    { key: 'u', header: 'By', width: '120px', cell: (r) => <span className="text-muted">{r.userName}</span> },
    { key: 'a', header: '', width: '150px', cell: (r) => (
      <div className="flex gap-1">
        <Button size="xs" variant="primary" icon={<Play className="h-3 w-3" />} onClick={() => play(r)}>Play</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Download" onClick={() => download(r)}><Download className="h-3.5 w-3.5" /></Button>
        {canOp && <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => removeRec(r)}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
    ) },
  ], [canOp]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-4">
      <Card title="Snapshots" subtitle={`${snaps.data?.length ?? 0} saved stills (live and playback)`}>
        {!snaps.data?.length ? <EmptyState title="No snapshots yet" message="Use the camera button on any live or recorded feed." icon={<ImageIcon className="h-5 w-5" />} /> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {snaps.data.map((s) => (
              <button key={s.id} type="button" onClick={() => setView(s)} className="group overflow-hidden rounded-xl border border-line bg-black text-left">
                <img src={`/api/snapshots/${s.id}/image`} alt={`${s.machineId} ${s.camera}`} loading="lazy" className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]" />
                <div className="bg-panel px-2 py-1.5"><p className="truncate text-xs font-medium">{s.machineId} · {s.camera}</p><p className="truncate text-[11px] text-muted">{dateTime(s.ts, true)}</p></div>
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card flush title="Recordings" subtitle="Clips you recorded — stored in this browser, listed for everyone">
        <DataTable columns={recCols} rows={recs.data ?? []} rowKey={(r) => r.id} loading={recs.loading}
          empty={<EmptyState title="No recordings" message="Press the red record button on a live feed, or Export clip in playback." icon={<Film className="h-5 w-5" />} />} />
      </Card>
      <Dialog open={Boolean(view)} onOpenChange={(o) => !o && setView(null)} size="xl" title={view ? `${view.machineId} · ${view.camera}` : ''}
        description={view ? `${dateTime(view.ts, true)} · ${view.source} · saved by ${view.userName}` : undefined}
        footer={view && <>
          {canOp && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => removeSnap(view)}>Delete</Button>}
          <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => { void fetch(`/api/snapshots/${view.id}/image`).then((r) => r.blob()).then((b) => downloadBlob(b, `${view.machineId}-${view.camera}-${view.ts}.jpg`)); }}>Download</Button>
        </>}>
        {view && <img src={`/api/snapshots/${view.id}/image`} alt="" className="w-full rounded-lg" />}
      </Dialog>
      <Dialog open={Boolean(video)} onOpenChange={(o) => { if (!o) setVideo(null); }} size="xl" title={video ? `${video.rec.machineId} · ${video.rec.camera}` : ''}>
        {video && <video src={video.url} controls autoPlay className="w-full rounded-lg bg-black" />}
      </Dialog>
    </div>
  );
}

export default function Cameras() {
  const [tab, setTab] = useTabParam(TABS, 'live');
  const cams = useBoot().cameras.length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Camera system" subtitle={`${cams} cameras across the fleet · live view, DVR playback, event clips and media`} icon={<Video className="h-5 w-5" />} />
      <Tabs id="cameras" value={tab} onChange={setTab} items={[
        { value: 'live', label: 'Live wall', icon: <Video className="h-4 w-4" /> },
        { value: 'playback', label: 'Playback', icon: <History className="h-4 w-4" /> },
        { value: 'events', label: 'Event clips', icon: <Clapperboard className="h-4 w-4" /> },
        { value: 'media', label: 'Snapshots & recordings', icon: <Square className="h-4 w-4" /> },
      ]} />
      {tab === 'live' && <LiveWall />}
      {tab === 'playback' && <PlaybackTab />}
      {tab === 'events' && <EventsTab />}
      {tab === 'media' && <MediaTab />}
    </div>
  );
}
