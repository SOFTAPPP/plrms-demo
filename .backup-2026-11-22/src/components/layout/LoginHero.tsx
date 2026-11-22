// Sign-in hero: real open-pit mining footage (excavators loading haul trucks) cross-fading with a slow zoom.
// Clips: Mixkit free stock video licence, see public/footage/CREDITS.md.
import { memo, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../ui/core';

const SLIDES = [
  { id: 48993, title: 'Loading at the face', text: 'Excavator EX-01 · 3-pass load into TRK-104' },
  { id: 45817, title: 'Haul road', text: 'TRK-210 · 218 t payload · 34 km/h' },
  { id: 45822, title: 'Pit ramp', text: 'Loaded descent · speed and grade monitored' },
  { id: 45904, title: 'Muck pile', text: 'EX-02 · bucket fill 96 % · cycle 28 s' },
];
const SHOW_MS = 7000;

export const LoginHero = memo(function LoginHero({ className }: { className?: string }) {
  const still = Boolean(useReducedMotion());
  const [index, setIndex] = useState(0);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), SHOW_MS);
    return () => clearInterval(id);
  }, [still]);

  // only the visible clip decodes; the next one is preloaded so the cross-fade starts on a real frame
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === index && !still) {
        v.currentTime = 0;
        v.play().catch(() => {});
      } else {
        window.setTimeout(() => { if (i !== index) v.pause(); }, 1300);
      }
    });
    const next = videos.current[(index + 1) % SLIDES.length];
    if (next && next.preload !== 'auto') { next.preload = 'auto'; next.load(); }
  }, [index, still]);

  const slide = SLIDES[index];
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-[#06090d]', className)} aria-hidden>
      {SLIDES.map((s, i) => (
        <video key={s.id} ref={(el) => { videos.current[i] = el; }} src={`/hero/${s.id}.mp4`} poster={`/hero/${s.id}.jpg`}
          muted loop playsInline preload={i === 0 ? 'auto' : 'none'}
          className={cn('absolute inset-0 h-full w-full object-cover will-change-[opacity,transform]',
            i === index ? 'scale-[1.09] opacity-100 [transition:opacity_1.2s_ease,transform_9s_linear]' : 'scale-100 opacity-0 [transition:opacity_1.2s_ease,transform_0s_linear_1.2s]',
            still && 'transition-none')} />
      ))}
      {/* legibility: dark at the top for the headline, and at the bottom for the caption */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,9,13,0.92)_0%,rgba(6,9,13,0.55)_32%,rgba(6,9,13,0.15)_55%,rgba(6,9,13,0.35)_75%,rgba(6,9,13,0.95)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_50%,transparent_40%,rgba(6,9,13,0.55)_100%)]" />

      {/* live caption for the current shot */}
      <div className="absolute bottom-24 left-12 right-12 flex items-end justify-between gap-6">
        <div key={slide.id} className="animate-pop rounded-xl border border-white/12 bg-black/45 px-4 py-3 backdrop-blur-md">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
            Live · {slide.title}
          </p>
          <p className="mt-1 font-mono text-sm text-white">{slide.text}</p>
        </div>
        <div className="flex gap-1.5 pb-1">
          {SLIDES.map((s, i) => (
            <span key={s.id} className="h-1 w-8 overflow-hidden rounded-full bg-white/20">
              <span className={cn('block h-full w-full origin-left rounded-full bg-[var(--accent)]', i === index ? (still ? '' : 'animate-[hero-progress_7s_linear_forwards]') : i < index ? 'opacity-60' : 'scale-x-0')} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
