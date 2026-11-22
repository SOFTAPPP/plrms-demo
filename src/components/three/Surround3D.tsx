// Interactive 3D surround view: procedural machine models animated from live sensor values.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraPosition, MachineLive, MachineType } from '../../../shared/types';
import { CAMERA_LABEL } from '../../../shared/types';
import { useLive } from '../../lib/live';
import { nearbyOf } from '../camera/liveState';

export type ViewPreset = 'orbit' | 'top' | 'front' | 'rear';

const YELLOW = '#e3a51c';
const DARK = '#22262b';
const TYRE = '#141414';
const STEEL = '#5a6068';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#7c6a55';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + Math.random() * 60;
    g.fillStyle = `rgba(${v + 20},${v},${v - 25},${Math.random() * 0.35})`;
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, Math.random() * 3.5, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(40,30,20,0.22)';
  g.lineWidth = 14;
  for (const y of [150, 205, 330, 385]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Text label drawn into a canvas texture on a sprite: always faces the camera, no DOM involved. */
function SpriteLabel({ text, position, color = '#ffffff', bg = 'rgba(0,0,0,0.72)', height = 1.1 }: { text: string; position: [number, number, number]; color?: string; bg?: string; height?: number }) {
  // A new canvas and texture per text: a texture's size is fixed once uploaded to the GPU.
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    const fs = 44;
    const font = `600 ${fs}px "JetBrains Mono Variable", ui-monospace, monospace`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 36;
    const h = fs + 26;
    canvas.width = w;
    canvas.height = h;
    g.font = font;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(0, 0, w, h, 14);
    g.fill();
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 18, h / 2 + 2);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return { texture: t, aspect: w / h };
  }, [text, color, bg]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

function Wheel({ position, r, w, spin }: { position: [number, number, number]; r: number; w: number; spin: React.RefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => { if (ref.current) ref.current.rotation.z = -spin.current! / r; });
  return (
    <mesh ref={ref} position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[r, r, w, 28]} />
      <meshStandardMaterial color={TYRE} roughness={0.95} />
    </mesh>
  );
}

function TruckModel({ m, spin, water }: { m: MachineLive; spin: React.RefObject<number>; water?: boolean }) {
  const body = useRef<THREE.Group>(null);
  const tilt = m.act.startsWith('Tipping') ? 0.85 : 0;
  useFrame((_, dt) => { if (body.current) body.current.rotation.z += (tilt - body.current.rotation.z) * Math.min(1, dt * 1.5); });
  const fill = Math.min(1.15, (m.s.payload_pct ?? 0) / 100);
  return (
    <group>
      <mesh position={[0, 1.9, 0]} castShadow receiveShadow><boxGeometry args={[11.5, 1.2, 4.2]} /><meshStandardMaterial color={DARK} roughness={0.7} /></mesh>
      <mesh position={[4.6, 3.5, 2.1]} castShadow><boxGeometry args={[2.4, 2.2, 2.4]} /><meshStandardMaterial color={YELLOW} roughness={0.5} metalness={0.2} /></mesh>
      <mesh position={[5.1, 3.7, 2.1]}><boxGeometry args={[1.5, 1.2, 2.45]} /><meshStandardMaterial color="#2c3e50" roughness={0.1} metalness={0.6} /></mesh>
      <mesh position={[5.3, 2.8, -0.6]} castShadow><boxGeometry args={[1.6, 1.6, 3.6]} /><meshStandardMaterial color={YELLOW} /></mesh>
      {water ? (
        <mesh position={[-1.2, 4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[1.9, 1.9, 8.5, 32]} /><meshStandardMaterial color="#d7d2c4" metalness={0.3} roughness={0.4} /></mesh>
      ) : (
        <group ref={body} position={[-5.4, 2.6, 0]}>
          <group position={[4.6, 0, 0]}>
            <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[9.6, 0.35, 6.6]} /><meshStandardMaterial color={YELLOW} roughness={0.55} /></mesh>
            <mesh position={[0, 2.5, 3.2]} castShadow><boxGeometry args={[9.6, 2.4, 0.3]} /><meshStandardMaterial color={YELLOW} /></mesh>
            <mesh position={[0, 2.5, -3.2]} castShadow><boxGeometry args={[9.6, 2.4, 0.3]} /><meshStandardMaterial color={YELLOW} /></mesh>
            <mesh position={[4.8, 3, 0]} castShadow><boxGeometry args={[0.3, 3.4, 6.6]} /><meshStandardMaterial color={YELLOW} /></mesh>
            <mesh position={[5.4, 4.6, 0]} castShadow><boxGeometry args={[1.6, 0.25, 6.8]} /><meshStandardMaterial color={YELLOW} /></mesh>
            {fill > 0.02 && (
              <mesh position={[0, 1.6 + fill * 1.2, 0]} scale={[4.2 * Math.sqrt(fill), fill * 1.9, 2.9 * Math.sqrt(fill)]} castShadow>
                <sphereGeometry args={[1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color="#6e563f" roughness={1} flatShading />
              </mesh>
            )}
          </group>
        </group>
      )}
      <Wheel position={[4.2, 1.8, 2.6]} r={1.8} w={1.3} spin={spin} />
      <Wheel position={[4.2, 1.8, -2.6]} r={1.8} w={1.3} spin={spin} />
      <Wheel position={[-3.4, 1.8, 2.2]} r={1.8} w={1.3} spin={spin} />
      <Wheel position={[-3.4, 1.8, 3.5]} r={1.8} w={1.3} spin={spin} />
      <Wheel position={[-3.4, 1.8, -2.2]} r={1.8} w={1.3} spin={spin} />
      <Wheel position={[-3.4, 1.8, -3.5]} r={1.8} w={1.3} spin={spin} />
    </group>
  );
}

function DiggerModel({ m, shovel }: { m: MachineLive; shovel: boolean }) {
  const house = useRef<THREE.Group>(null);
  const boom = useRef<THREE.Group>(null);
  const stick = useRef<THREE.Group>(null);
  const live = useRef(m);
  live.current = m;
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 4);
    const s = live.current.s;
    if (house.current) house.current.rotation.y += ((-(s.swing_angle ?? 0) * Math.PI) / 180 - house.current.rotation.y) * k;
    if (boom.current) boom.current.rotation.z += (((s.boom_angle ?? 25) * Math.PI) / 180 - boom.current.rotation.z) * k;
    if (stick.current) stick.current.rotation.z += (((s.stick_angle ?? -50) * Math.PI) / 180 - stick.current.rotation.z) * k;
  });
  const fill = Math.min(1.1, (m.s.bucket_fill ?? 0) / 100);
  return (
    <group>
      {[-3, 3].map((z) => (
        <mesh key={z} position={[0, 1, z]} castShadow receiveShadow><boxGeometry args={[9, 2, 1.8]} /><meshStandardMaterial color={DARK} roughness={0.9} /></mesh>
      ))}
      <mesh position={[0, 2.3, 0]}><cylinderGeometry args={[2.4, 2.4, 0.6, 24]} /><meshStandardMaterial color={STEEL} /></mesh>
      <group ref={house} position={[0, 2.6, 0]}>
        <mesh position={[-1.2, 1.9, 0]} castShadow receiveShadow><boxGeometry args={[7.5, 3.6, 6]} /><meshStandardMaterial color={YELLOW} roughness={0.55} /></mesh>
        <mesh position={[-4.8, 1.7, 0]} castShadow><boxGeometry args={[1.4, 3, 5.6]} /><meshStandardMaterial color={DARK} /></mesh>
        <mesh position={[2.2, 4.4, 2.1]} castShadow><boxGeometry args={[2.2, 2, 2]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[2.9, 4.5, 2.1]}><boxGeometry args={[0.9, 1.3, 2.05]} /><meshStandardMaterial color="#2c3e50" metalness={0.6} roughness={0.1} /></mesh>
        <group ref={boom} position={[2.4, 2.4, 0]}>
          <mesh position={[shovel ? 3.6 : 4, 0, 0]} castShadow><boxGeometry args={[shovel ? 7.2 : 8, 1.2, 1.4]} /><meshStandardMaterial color={YELLOW} /></mesh>
          <group ref={stick} position={[shovel ? 7.2 : 8, 0, 0]}>
            <mesh position={[2.6, 0, 0]} castShadow><boxGeometry args={[5.2, 0.9, 1.1]} /><meshStandardMaterial color={YELLOW} /></mesh>
            <group position={[5.4, -0.4, 0]}>
              <mesh castShadow><boxGeometry args={[2.4, 2.2, 3.4]} /><meshStandardMaterial color={STEEL} roughness={0.6} metalness={0.4} /></mesh>
              {fill > 0.05 && (
                <mesh position={[0, 1.1, 0]} scale={[1, fill, 1]}><sphereGeometry args={[1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#6e563f" flatShading /></mesh>
              )}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function SimpleModel({ type, m, spin }: { type: MachineType; m: MachineLive; spin: React.RefObject<number> }) {
  if (type === 'dozer') {
    return (
      <group>
        {[-1.9, 1.9].map((z) => <mesh key={z} position={[0, 0.8, z]} castShadow><boxGeometry args={[6, 1.6, 1]} /><meshStandardMaterial color={DARK} /></mesh>)}
        <mesh position={[-0.4, 2.2, 0]} castShadow><boxGeometry args={[4.6, 1.8, 3]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[-1.2, 3.8, 0]} castShadow><boxGeometry args={[2, 1.6, 2.2]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[3.6, 1.3, 0]} castShadow><boxGeometry args={[0.5, 2.4, 5.2]} /><meshStandardMaterial color={STEEL} metalness={0.5} /></mesh>
        <mesh position={[-3.4, 0.9, 0]} rotation={[0, 0, 0.5]} castShadow><boxGeometry args={[1.6, 0.4, 0.4]} /><meshStandardMaterial color={STEEL} /></mesh>
      </group>
    );
  }
  if (type === 'drill') {
    const depth = m.s.drill_depth ?? 0;
    return (
      <group>
        {[-1.8, 1.8].map((z) => <mesh key={z} position={[0, 0.8, z]} castShadow><boxGeometry args={[7, 1.6, 1]} /><meshStandardMaterial color={DARK} /></mesh>)}
        <mesh position={[-0.6, 2.4, 0]} castShadow><boxGeometry args={[6, 1.8, 3.4]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[-2.4, 4.2, 1]} castShadow><boxGeometry args={[2, 1.8, 1.6]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[2.8, 8, 0]} castShadow><boxGeometry args={[0.9, 13, 0.9]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[2.8, 6 - Math.min(5, depth / 3), 0]}><cylinderGeometry args={[0.18, 0.18, 12, 10]} /><meshStandardMaterial color={STEEL} metalness={0.6} /></mesh>
      </group>
    );
  }
  if (type === 'loader') {
    const lift = ((m.s.boom_angle ?? 20) - 20) / 30;
    const fill = Math.min(1.1, (m.s.bucket_fill ?? 0) / 100);
    return (
      <group>
        <mesh position={[-2.2, 2.4, 0]} castShadow><boxGeometry args={[5, 2.4, 3.6]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[1.4, 2.2, 0]} castShadow><boxGeometry args={[2.6, 2, 3.2]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[-0.4, 4.6, 0]} castShadow><boxGeometry args={[2, 2, 2.4]} /><meshStandardMaterial color={YELLOW} /></mesh>
        <mesh position={[4.2, 1.6 + lift * 3.5, 0]} castShadow><boxGeometry args={[1.6, 1.8, 5.2]} /><meshStandardMaterial color={STEEL} metalness={0.4} /></mesh>
        {fill > 0.05 && <mesh position={[4.2, 2.5 + lift * 3.5, 0]} scale={[0.8, fill * 0.9, 2.4]}><sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#6e563f" flatShading /></mesh>}
        <Wheel position={[1.6, 1.4, 2]} r={1.4} w={1} spin={spin} />
        <Wheel position={[1.6, 1.4, -2]} r={1.4} w={1} spin={spin} />
        <Wheel position={[-2.6, 1.4, 2]} r={1.4} w={1} spin={spin} />
        <Wheel position={[-2.6, 1.4, -2]} r={1.4} w={1} spin={spin} />
      </group>
    );
  }
  // light vehicle
  return (
    <group>
      <mesh position={[0, 1, 0]} castShadow><boxGeometry args={[4.8, 0.9, 1.9]} /><meshStandardMaterial color="#f1f1ee" /></mesh>
      <mesh position={[0.6, 1.8, 0]} castShadow><boxGeometry args={[2.2, 0.9, 1.8]} /><meshStandardMaterial color="#f1f1ee" /></mesh>
      <mesh position={[0.8, 1.8, 0]}><boxGeometry args={[1.8, 0.7, 1.85]} /><meshStandardMaterial color="#2c3e50" metalness={0.6} roughness={0.1} /></mesh>
      <mesh position={[-1.8, 3, 0.7]}><cylinderGeometry args={[0.03, 0.03, 3, 6]} /><meshStandardMaterial color="#888" /></mesh>
      <mesh position={[-1.8, 4.4, 0.85]}><boxGeometry args={[0.02, 0.4, 0.3]} /><meshStandardMaterial color="#ff6b00" /></mesh>
      {[[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]].map(([x, z]) => <Wheel key={`${x}${z}`} position={[x, 0.45, z]} r={0.45} w={0.3} spin={spin} />)}
    </group>
  );
}

const CAM_MOUNT: Record<CameraPosition, { pos: [number, number, number]; dir: number; tilt: number; color: string }> = {
  front: { pos: [6.5, 4.5, 0], dir: 0, tilt: -0.35, color: '#22d3ee' },
  rear: { pos: [-6.5, 3.5, 0], dir: Math.PI, tilt: -0.45, color: '#a78bfa' },
  left: { pos: [0, 4, -3.6], dir: Math.PI / 2, tilt: -0.75, color: '#34d399' },
  right: { pos: [0, 4, 3.6], dir: -Math.PI / 2, tilt: -0.75, color: '#f472b6' },
  cabin: { pos: [4.6, 4.2, 2.1], dir: Math.PI, tilt: 0, color: '#fbbf24' },
  bucket: { pos: [6, 6, 0], dir: 0, tilt: -0.6, color: '#fb923c' },
  tray: { pos: [3, 7.5, 0], dir: Math.PI, tilt: -1.1, color: '#fb923c' },
};

function CoverageCone({ position, label, scale }: { position: CameraPosition; label: boolean; scale: number }) {
  const c = CAM_MOUNT[position];
  const len = position === 'cabin' ? 2.2 : 14 * scale;
  return (
    <group position={c.pos.map((v) => v * scale) as [number, number, number]} rotation={[0, c.dir, 0]}>
      <group rotation={[0, 0, c.tilt]}>
        <mesh position={[len / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[len * 0.62, len, 4, 1, true]} />
          <meshBasicMaterial color={c.color} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh><sphereGeometry args={[0.28, 12, 12]} /><meshBasicMaterial color={c.color} /></mesh>
        {label && <SpriteLabel text={CAMERA_LABEL[position]} position={[0.8, 1.1, 0]} color="#0b0b0c" bg={c.color} height={0.9} />}
      </group>
    </group>
  );
}

function ProximityRings({ scale }: { scale: number }) {
  const rings: [number, string][] = [[10, '#ef4444'], [20, '#f59e0b'], [35, '#22c55e']];
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      {rings.map(([r, c]) => (
        <mesh key={r}>
          <ringGeometry args={[r * scale - 0.25, r * scale, 96]} />
          <meshBasicMaterial color={c} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function Nearby({ machineId }: { machineId: string }) {
  const machines = useLive((s) => s.machines);
  const me = machines[machineId];
  const list = useMemo(() => (me ? nearbyOf(me, Object.values(machines), 70) : []), [me, machines]);
  return (
    <group>
      {list.map((o) => {
        const big = o.type === 'truck' || o.type === 'water';
        const size: [number, number, number] = o.type === 'lv' ? [4.8, 1.8, 1.9] : big ? [11, 5.5, 6.5] : [8, 4.5, 6];
        const other = machines[o.id];
        const rel = other ? ((-(other.h - me!.h)) * Math.PI) / 180 : 0;
        return (
          <group key={o.id} position={[o.fwd, size[1] / 2, -o.left]} rotation={[0, rel, 0]}>
            <mesh castShadow><boxGeometry args={size} /><meshStandardMaterial color={o.type === 'lv' ? '#f1f1ee' : YELLOW} transparent opacity={0.85} /></mesh>
            <SpriteLabel text={`${o.id} · ${Math.hypot(o.fwd, o.left).toFixed(0)} m`} position={[0, size[1] / 2 + 1.6, 0]} height={1.3} />
          </group>
        );
      })}
    </group>
  );
}

function SensorLabels({ m }: { m: MachineLive }) {
  const items: { pos: [number, number, number]; text: string; warn?: boolean }[] = [];
  if (m.type === 'truck' && m.tp) {
    const wheels: [number, number, number][] = [[4.2, 0.4, 3.4], [4.2, 0.4, -3.4], [-3.4, 0.4, 4.4], [-3.4, 0.4, 1.4], [-3.4, 0.4, -1.4], [-3.4, 0.4, -4.4]];
    wheels.forEach((p, i) => items.push({ pos: p, text: `${m.tp![i].toFixed(0)} psi · ${m.tt![i].toFixed(0)}°`, warn: m.tp![i] < 88 }));
    items.push({ pos: [-1, 8, 0], text: `Payload ${(m.s.payload ?? 0).toFixed(0)} t (${m.s.payload_pct ?? 0}%)`, warn: (m.s.payload_pct ?? 0) > 105 });
  }
  if (m.type === 'shovel' || m.type === 'excavator' || m.type === 'loader') {
    items.push({ pos: [0, 9.5, 0], text: `Hyd ${m.s.hyd_pressure ?? 0} bar · Bucket ${m.s.bucket_fill ?? 0}%`, warn: (m.s.hyd_pressure ?? 0) > 360 });
  }
  items.push({ pos: [3, 6.8, -2.5], text: `Engine ${(m.s.engine_temp ?? 0).toFixed(0)}°C · ${m.s.rpm ?? 0} rpm`, warn: (m.s.engine_temp ?? 0) > 105 });
  items.push({ pos: [-3, 5.5, -3], text: `Fuel ${(m.s.fuel_level ?? 0).toFixed(0)}%`, warn: (m.s.fuel_level ?? 100) < 15 });
  return (
    <group>
      {items.map((it, i) => (
        <SpriteLabel key={i} text={it.text} position={it.pos} bg={it.warn ? 'rgba(220,38,38,0.92)' : 'rgba(0,0,0,0.72)'} height={0.95} />
      ))}
    </group>
  );
}

function CameraRig({ preset, scale }: { preset: ViewPreset; scale: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const d = 34 * scale;
    const pos: Record<ViewPreset, [number, number, number]> = {
      orbit: [d * 0.9, d * 0.6, d * 0.9], top: [0.01, d * 1.9, 0], front: [d * 1.2, d * 0.35, 0], rear: [-d * 1.2, d * 0.35, 0],
    };
    camera.position.set(...pos[preset]);
    camera.lookAt(0, 2, 0);
  }, [preset, camera, scale]);
  return null;
}

function Scene({ machineId, cams, showCones, showRings, showLabels, preset, autoRotate }: SurroundProps) {
  const m = useLive((s) => s.machines[machineId]);
  const spin = useRef(0);
  const speed = useRef(0);
  speed.current = m?.spd ?? 0;
  useFrame((_, dt) => { spin.current += (speed.current / 3.6) * dt; });
  const tex = useMemo(() => groundTexture(), []);
  const groundRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const mat = groundRef.current?.material as THREE.MeshStandardMaterial | undefined;
    if (mat?.map) mat.map.offset.x = spin.current / 40;
  });
  if (!m) return null;
  const scale = m.type === 'lv' ? 0.45 : m.type === 'dozer' || m.type === 'drill' ? 0.75 : 1;
  return (
    <>
      <color attach="background" args={['#101010']} />
      <fog attach="fog" args={['#101010', 90, 220]} />
      <hemisphereLight args={['#dfe8f3', '#4a3c2c', 0.9]} />
      <directionalLight position={[30, 50, 20]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      <gridHelper args={[160, 32, '#3b4654', '#252d38']} position={[0, 0.03, 0]} />
      <group scale={scale}>
        {m.type === 'truck' || m.type === 'water' ? <TruckModel m={m} spin={spin} water={m.type === 'water'} />
          : m.type === 'shovel' || m.type === 'excavator' ? <DiggerModel m={m} shovel={m.type === 'shovel'} />
            : <SimpleModel type={m.type} m={m} spin={spin} />}
        {showLabels && <SensorLabels m={m} />}
      </group>
      {showCones && cams.map((c) => <CoverageCone key={c} position={c} label={showLabels} scale={scale} />)}
      {showRings && <ProximityRings scale={scale} />}
      <Nearby machineId={machineId} />
      <CameraRig preset={preset} scale={scale} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={8} maxDistance={140} maxPolarAngle={Math.PI / 2.05}
        autoRotate={autoRotate} autoRotateSpeed={0.6} target={[0, 2, 0]} />
    </>
  );
}

export interface SurroundProps {
  machineId: string;
  cams: CameraPosition[];
  showCones: boolean;
  showRings: boolean;
  showLabels: boolean;
  preset: ViewPreset;
  autoRotate: boolean;
}

export default function Surround3D(props: SurroundProps) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 42, near: 0.5, far: 600, position: [30, 20, 30] }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}
