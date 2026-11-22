import { lazy, Suspense, useState } from 'react';
import { useUnits } from '../lib/units';
import { useSearchParams } from 'react-router-dom';
import { Box, Rotate3d, ScanEye, View } from 'lucide-react';
import { useBoot } from '../lib/app-store';
import { useLive } from '../lib/live';
import { CAMERA_LABEL, type CameraPosition } from '../../shared/types';
import { Card, EmptyState, PageHeader, Skeleton, StatusPill } from '../components/ui/core';
import { Checkbox, Segmented, Select } from '../components/ui/form';
import { CameraTile } from '../components/camera/CameraTile';
import { BirdsEyeView, PanoramaView } from '../components/camera/Surround360';
import type { ViewPreset } from '../components/three/Surround3D';

const Surround3D = lazy(() => import('../components/three/Surround3D'));
const RING: CameraPosition[] = ['front', 'right', 'rear', 'left'];

type Mode = 'panorama' | 'birdseye' | 'twin';

/** 360° views of one machine, built from its own surround cameras (plus an optional 3D digital twin). */
export function SurroundViews({ machineId, height = 560 }: { machineId: string; height?: number }) {
  const boot = useBoot();
  const cams = boot.cameras.filter((c) => c.machineId === machineId && c.enabled);
  const ring = RING.filter((p) => cams.some((c) => c.position === p));
  const [mode, setMode] = useState<Mode>('panorama');
  const [preset, setPreset] = useState<ViewPreset>('orbit');
  const [opts, setOpts] = useState({ cones: true, rings: true, labels: true, rotate: false });
  if (ring.length < 4) {
    return (
      <EmptyState icon={<ScanEye className="h-5 w-5" />} title="360° needs four surround cameras"
        message={`This machine has ${ring.length ? ring.map((r) => CAMERA_LABEL[r]).join(', ') : 'no'} surround camera${ring.length === 1 ? '' : 's'}. Fit or enable front, rear, left and right cameras in Admin › Machines & cameras.`} />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card flush title={mode === 'panorama' ? '360° camera view' : mode === 'birdseye' ? 'Bird’s-eye around view' : '3D digital twin'}
        subtitle={mode === 'panorama' ? 'Live front, right, rear and left cameras stitched into one ring — drag to look around'
          : mode === 'birdseye' ? 'Ground from the four cameras warped into a top-down view, with proximity zones'
            : 'Model driven by live sensor values, with camera coverage and nearby machines'}
        bodyClassName="p-3" actions={
          <Segmented size="sm" value={mode} onChange={setMode} options={[
            { value: 'panorama', label: <span className="inline-flex items-center gap-1"><View className="h-3.5 w-3.5" />360° cameras</span> },
            { value: 'birdseye', label: <span className="inline-flex items-center gap-1"><ScanEye className="h-3.5 w-3.5" />Bird’s-eye</span> },
            { value: 'twin', label: <span className="inline-flex items-center gap-1"><Box className="h-3.5 w-3.5" />3D twin</span> },
          ]} />
        }>
        {mode === 'panorama' && <PanoramaView key={machineId} machineId={machineId} height={height} />}
        {mode === 'birdseye' && (
          <div className="mx-auto w-full" style={{ height, maxWidth: height * 1.25 }}>
            <BirdsEyeView key={machineId} machineId={machineId} className="h-full w-full rounded-lg" />
          </div>
        )}
        {mode === 'twin' && (
          <div className="relative" style={{ height }}>
            <Suspense fallback={<Skeleton className="h-full" />}>
              <Surround3D key={machineId} machineId={machineId} cams={cams.map((c) => c.position)} showCones={opts.cones} showRings={opts.rings}
                showLabels={opts.labels} preset={preset} autoRotate={opts.rotate} />
            </Suspense>
            <div className="absolute right-3 top-3">
              <Segmented size="sm" value={preset} onChange={setPreset} options={[{ value: 'orbit', label: '3D' }, { value: 'top', label: 'Top' }, { value: 'front', label: 'Front' }, { value: 'rear', label: 'Rear' }]} />
            </div>
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg border border-line bg-panel/85 px-3 py-2 backdrop-blur">
              <Checkbox label="Camera coverage" checked={opts.cones} onChange={(v) => setOpts({ ...opts, cones: v })} />
              <Checkbox label="Proximity zones" checked={opts.rings} onChange={(v) => setOpts({ ...opts, rings: v })} />
              <Checkbox label="Sensor labels" checked={opts.labels} onChange={(v) => setOpts({ ...opts, labels: v })} />
              <Checkbox label="Auto-rotate" checked={opts.rotate} onChange={(v) => setOpts({ ...opts, rotate: v })} />
            </div>
          </div>
        )}
      </Card>
      <Card title="Surround cameras" subtitle="The four feeds the 360° view is built from">
        <div className="grid grid-cols-2 gap-2">
          {ring.map((c) => (
            <div key={`${machineId}-${c}`}>
              <CameraTile machineId={machineId} position={c} fps={10} maxW={400} />
              <p className="mt-1 text-center text-[11px] text-muted">{CAMERA_LABEL[c]}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function Surround() {
  const boot = useBoot();
  const [sp, setSp] = useSearchParams();
  const id = sp.get('machine') ?? boot.machines.find((m) => m.type === 'excavator')?.id ?? boot.machines[0].id;
  const m = useLive((s) => s.machines[id]);
  const U = useUnits();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="360° surround view" subtitle="See all around a machine through its own cameras" icon={<Rotate3d className="h-5 w-5" />}
        actions={
          <Select aria-label="Machine" value={id} onChange={(e) => setSp({ machine: e.target.value }, { replace: true })} className="w-56">
            {boot.machines.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.make} {x.model}</option>)}
          </Select>
        } />
      {m && (
        <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <span className="font-display text-base font-semibold">{m.id}</span><StatusPill status={m.st} />
          <span className="text-muted">{m.act}</span>
          <span className="text-muted">Speed <span className="tnum text-fg">{U.speed(m.spd)}</span></span>
          {m.s.payload !== undefined && <span className="text-muted">Payload <span className="tnum text-fg">{U.mass(m.s.payload)}</span></span>}
          {m.s.swing_angle !== undefined && <span className="text-muted">Swing <span className="tnum text-fg">{m.s.swing_angle}°</span></span>}
          <span className="text-muted">Operator <span className="text-fg">{m.op || '—'}</span></span>
        </div>
      )}
      <SurroundViews machineId={id} />
    </div>
  );
}
