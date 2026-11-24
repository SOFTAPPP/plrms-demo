import { memo, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Circle, Expand, Maximize, Square } from 'lucide-react';
import type { CameraPosition } from '../../../shared/types';
import { CAMERA_LABEL } from '../../../shared/types';
import { attachCamera, recordCanvas, type CameraHandle } from './engine';
import { liveCamState } from './liveState';
import { post } from '../../lib/api';
import { saveClip } from '../../lib/idb';
import { downloadBlob } from '../../lib/export';
import { useLive } from '../../lib/live';
import { useApp } from '../../lib/app-store';
import { can } from '../../../shared/types';
import { cn } from '../ui/core';
import { Tip } from '../ui/overlay';

export function cameraQuality(resolution?: string): string {
  if (resolution === '1280x720') return '720p';
  if (resolution === '2560x1440') return '1440p';
  return '1080p';
}

export async function saveSnapshot(canvas: HTMLCanvasElement, machineId: string, camera: string, ts: number, source: 'live' | 'playback') {
  const image = canvas.toDataURL('image/jpeg', 0.86);
  try {
    await post('/snapshots', { machineId, camera, ts, image, source });
    toast.success('Snapshot saved', {
      description: `${machineId} ${camera} · find it in Cameras > Media`,
      action: { label: 'Download', onClick: () => { void fetch(image).then((r) => r.blob()).then((b) => downloadBlob(b, `${machineId}-${camera}-${ts}.jpg`)); } },
    });
  } catch (err) {
    toast.error('Snapshot failed', { description: (err as Error).message });
  }
}

export async function storeRecording(blob: Blob, machineId: string, camera: string, startTs: number, endTs: number, kind: 'manual' | 'playback') {
  const key = `${machineId}-${camera}-${Date.now()}`;
  const stored = await saveClip(key, blob);
  try {
    await post('/recordings', { machineId, camera, startTs, endTs, kind, sizeBytes: blob.size, clientKey: key });
  } catch {
    /* metadata is optional for the download */
  }
  toast.success('Recording saved', {
    description: stored ? 'Available in Cameras > Media on this computer' : 'Browser storage unavailable — download it now',
    action: { label: 'Download', onClick: () => downloadBlob(blob, `${key}.webm`) },
  });
}

interface Props {
  machineId: string;
  position: CameraPosition;
  fps?: number;
  maxW?: number;
  className?: string;
  controls?: boolean;
  onExpand?: () => void;
  showLabel?: boolean;
  fitContainer?: boolean;
}

export const CameraTile = memo(function CameraTile({ machineId, position, fps = 12, maxW = 640, className, controls = true, onExpand, showLabel = true, fitContainer = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const handle = useRef<CameraHandle | null>(null);
  const recRef = useRef<{ stop: () => Promise<Blob | null>; start: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [full, setFull] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const role = useApp((s) => s.boot?.user.role);

  // the camera's own settings (Admin › Machines & cameras): enabled, continuous recording, resolution, frame rate
  const cam = useApp((s) => s.boot?.cameras.find((c) => c.machineId === machineId && c.position === position));
  const enabled = cam?.enabled ?? true;
  const continuous = cam?.recording ?? true;
  const quality = cameraQuality(cam?.resolution);
  const camFps = Math.min(fps, cam?.fps ?? fps);
  const settingsRef = useRef({ enabled, continuous, quality });
  settingsRef.current = { enabled, continuous, quality };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const label = `${machineId} ${CAMERA_LABEL[position].toUpperCase()}`;
    handle.current = attachCamera(canvas, () => {
      const set = settingsRef.current;
      const st = liveCamState(machineId, position, label, recordingRef.current || set.continuous, set.quality);
      if (st && !set.enabled) return { ...st, offline: true, notice: 'CAMERA DISABLED', recording: false };
      return st;
    }, { fps: full ? Math.max(camFps, 20) : camFps, maxW: full ? 1600 : maxW });
    return () => handle.current?.detach();
  }, [machineId, position, camFps, maxW, full]);

  useEffect(() => () => { void recRef.current?.stop(); }, []);

  const toggleRecord = async () => {
    const canvas = canvasRef.current!;
    if (recRef.current) {
      const r = recRef.current;
      recRef.current = null;
      setRecording(false);
      handle.current?.setForce(false);
      handle.current?.setFps(fps);
      const blob = await r.stop();
      if (blob) await storeRecording(blob, machineId, position, r.start, useLive.getState().t, 'manual');
      return;
    }
    handle.current?.setForce(true);
    handle.current?.setFps(Math.max(fps, 20));
    const r = recordCanvas(canvas, 20);
    if (!r) { toast.error('Recording is not supported in this browser'); return; }
    recRef.current = { ...r, start: useLive.getState().t };
    setRecording(true);
  };

  // Full screen fills the app window (works in the desktop app as well) and, in a browser,
  // also asks for real browser full screen.
  const fullscreen = () => {
    if (full) {
      setFull(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      return;
    }
    setFull(true);
    void wrapRef.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [full]);

  return (
    <div
      ref={wrapRef}
      data-fullscreen={full || undefined}
      className={cn(
        'group overflow-hidden bg-black',
        full
          ? 'fixed inset-0 z-[90] grid place-items-center'
          : cn(
              'relative rounded-xl border border-line',
              fitContainer ? 'h-full w-full' : '',
              className
            )
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'block',
          full ? 'aspect-video h-auto w-full' : fitContainer ? 'h-full w-full object-cover' : 'aspect-video h-auto w-full'
        )}
        style={full ? { width: 'min(100vw, calc(100vh * 16 / 9))' } : undefined}
        aria-label={`${machineId} ${position} camera, live`}
      />
      {full && <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-white/80">Esc or the full-screen button to close</p>}
      {showLabel && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="text-xs font-medium text-white">{machineId} · {CAMERA_LABEL[position]}</p>
        </div>
      )}
      {recording && <div className="absolute left-2 top-8 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">REC</div>}
      {controls && (
        <div className="absolute right-2 top-8 z-20 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {can(role, 'operate') && (
            <>
              <Tip content="Snapshot"><button type="button" aria-label="Take snapshot" className="grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
                onClick={() => saveSnapshot(canvasRef.current!, machineId, position, useLive.getState().t, 'live')}><Camera className="h-3.5 w-3.5" /></button></Tip>
              <Tip content={recording ? 'Stop recording' : 'Record clip'}><button type="button" aria-label={recording ? 'Stop recording' : 'Record'} className={cn('grid h-7 w-7 place-items-center rounded-md text-white', recording ? 'bg-red-600' : 'bg-black/60 hover:bg-black/80')}
                onClick={toggleRecord}>{recording ? <Square className="h-3 w-3 fill-current" /> : <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" />}</button></Tip>
            </>
          )}
          {onExpand && <Tip content="Open"><button type="button" aria-label="Open camera" className="grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80" onClick={onExpand}><Expand className="h-3.5 w-3.5" /></button></Tip>}
          <Tip content="Full screen"><button type="button" aria-label="Full screen" className="grid h-7 w-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80" onClick={fullscreen}><Maximize className="h-3.5 w-3.5" /></button></Tip>
        </div>
      )}
    </div>
  );
});
