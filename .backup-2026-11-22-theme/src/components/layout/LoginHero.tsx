// Sign-in hero: open-pit mining footage (excavators loading haul trucks) cross-fading with a slow zoom.
// Same clips and behaviour as the PLRMS sign-in page: AI-generated (Google AI Studio, Gemini Omni Flash) in 4K and
// encoded at 1920x1080, 24 fps, 80% speed, exactly CLIP_MS long, a keyframe every 2 s (sources in Desktop/hero-src).
// AV1 WebM first (about half the size), H.264 MP4 for browsers without AV1. Posters are WebP.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '../ui/core';

const SLIDES = [
  { id: 48993, title: 'Loading at the face', text: 'Every bucket weighed as the excavator loads the truck' },
  { id: 45817, title: 'Haul road', text: 'Payload, cycle time and haul distance for every load' },
  { id: 45822, title: 'Pit ramp', text: 'Fleet positions and activity across the site' },
  { id: 45904, title: 'Muck pile', text: 'Bucket weights and passes per load, shift by shift' },
];
// Every clip is exactly CLIP_MS long and plays once. The cross-fade runs over the last FADE_MS of the current clip,
// so the next shot is already moving while this one ends: nothing freezes on a last frame and nothing loops.
const CLIP_MS = 8500;
const FADE_MS = 1200;
const SHOW_MS = CLIP_MS - FADE_MS;

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Data-saver browsers get the still posters instead of video. */
const saveData = Boolean((navigator as any).connection?.saveData);

export const LoginHero = memo(function LoginHero({
  className,
  copyrightText = 'Winteg Technologies · STRATA',
}: {
  className?: string;
  copyrightText?: string;
}) {
  const still = useMedia('(prefers-reduced-motion: reduce)') || saveData;
  const [index, setIndex] = useState(0);
  // the clip fading out: it keeps playing and zooming until the fade ends
  const [prev, setPrev] = useState(-1);
  // read by the delayed reset below and by the visibility handler, which run outside a render
  const indexRef = useRef(index);
  indexRef.current = index;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  // A snapshot of the exact frame on screen, laid over the clip while the tab is away and until the clip has drawn
  // that same moment again. Chrome shuts down a hidden tab's video decoder; on return it restarts from the keyframe
  // before, which showed black and replayed the last second or two. The clip is put back on its exact frame
  // (resumeAt), and the zoom, progress bar and slide timer stay paused (frozen) until it is really showing.
  const frames = useRef<(HTMLCanvasElement | null)[]>([]);
  const resumeAt = useRef<number | null>(null);
  const [frozen, setFrozen] = useState(false);
  // bumped each time the tab hides, so a watcher from an earlier return does nothing
  const epoch = useRef(0);

  // A hidden tab (or minimised window) freezes the slideshow where it is: the clip, its zoom and the progress bar all
  // pause together and carry on from the same frame on return, so nothing skips, restarts or shows black.
  useEffect(() => {
    const onVis = () => {
      const away = document.visibilityState === 'hidden';
      if (away) {
        epoch.current++;
        const i = indexRef.current;
        const v = videos.current[i];
        const c = frames.current[i];
        // Away again before the clip came back: the snapshot that is up is still the picture to return to.
        if (v && c && c.hidden && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext('2d')?.drawImage(v, 0, 0);
          resumeAt.current = v.currentTime;
          c.hidden = false;
        }
        if (c && !c.hidden) setFrozen(true);
      }
      setHidden(away);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Next shot SHOW_MS after the current clip really starts moving, but never onto a clip that has not loaded yet:
  // on a slow line it would fade in black.
  useEffect(() => {
    if (still || hidden || frozen) return;
    const cleanups: (() => void)[] = [];
    const current = videos.current[index];
    const advance = () => {
      setPrev(index);
      setIndex((index + 1) % SLIDES.length);
    };
    const begin = () => {
      const id = window.setTimeout(
        () => {
          const next = videos.current[(index + 1) % SLIDES.length];
          if (!next || next.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return advance();
          next.addEventListener('canplay', advance, { once: true });
          cleanups.push(() => next.removeEventListener('canplay', advance));
        },
        Math.max(0, SHOW_MS - (current?.currentTime ?? 0) * 1000),
      );
      cleanups.push(() => clearTimeout(id));
    };
    if (!current || (!current.paused && current.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)) {
      begin();
    } else {
      // count from the first played frame, not from the click on a slow line; give up waiting after 3 s
      let started = false;
      const go = () => {
        if (started) return;
        started = true;
        begin();
      };
      current.addEventListener('playing', go, { once: true });
      const fallback = window.setTimeout(go, 3000);
      cleanups.push(() => {
        current.removeEventListener('playing', go);
        clearTimeout(fallback);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [index, still, hidden, frozen]);

  // only the visible clip decodes; the next one is preloaded so the cross-fade starts on a real frame
  useEffect(() => {
    const current = videos.current[index];
    const thaw = (i: number) => {
      const c = frames.current[i];
      if (c && !c.hidden) {
        c.hidden = true;
        c.width = 0; // frees the snapshot
      }
    };
    const timers: number[] = [];
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === index) {
        if (still || hidden) {
          v.pause();
          return;
        }
        const c = frames.current[i];
        if (c && !c.hidden) {
          // back on the frame the snapshot shows, then lift it once the clip has drawn that moment or later
          const at = resumeAt.current;
          if (at !== null && Math.abs(v.currentTime - at) > 0.04) v.currentTime = at;
          const mine = epoch.current;
          const done = () => {
            if (epoch.current !== mine) return;
            thaw(i);
            setFrozen(false);
          };
          if (typeof v.requestVideoFrameCallback === 'function') {
            const watch = () =>
              v.requestVideoFrameCallback((_now, frame) => {
                if (epoch.current !== mine) return;
                if (at === null || frame.mediaTime >= at - 0.1) done();
                else watch();
              });
            watch();
          } else {
            v.addEventListener('playing', done, { once: true });
          }
          timers.push(window.setTimeout(done, 3000));
        }
        v.play().catch(() => {});
        return;
      }
      thaw(i);
      if (hidden) {
        v.pause();
        return;
      }
      // the clip fading out keeps playing through the fade; others rewind for their next turn
      timers.push(
        window.setTimeout(() => {
          if (i !== indexRef.current && i !== prevRef.current) {
            v.pause();
            v.currentTime = 0;
          } else if (i === prevRef.current && i !== indexRef.current) {
            v.pause();
          }
        }, FADE_MS + 100),
      );
    });
    // The next clip starts downloading once the visible one has enough to play through. Loading both at once
    // split a slow connection in two, so the first shot took twice as long to appear.
    const next = videos.current[(index + 1) % SLIDES.length];
    const loadNext = () => {
      if (next && next.preload !== 'auto') {
        next.preload = 'auto';
        next.load();
      }
    };
    const clear = () => timers.forEach((t) => clearTimeout(t));
    if (!current || current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      loadNext();
      return clear;
    }
    current.addEventListener('canplaythrough', loadNext, { once: true });
    return () => {
      clear();
      current.removeEventListener('canplaythrough', loadNext);
    };
  }, [index, still, hidden]);

  const slide = SLIDES[index];
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-[#06090d]', className)} aria-hidden>
      {SLIDES.map((s, i) =>
        still ? (
          <img
            key={s.id}
            src={`/hero/${s.id}.webp`}
            alt=""
            decoding="async"
            className={cn('absolute inset-0 h-full w-full object-cover', i === index ? 'opacity-100' : 'opacity-0')}
          />
        ) : (
          <div
            key={s.id}
            className={cn(
              'absolute inset-0 [transition:opacity_1.2s_ease]',
              i === index
                ? 'animate-hero-zoom opacity-100 will-change-transform'
                : i === prev
                  ? 'animate-hero-zoom opacity-0'
                  : 'opacity-0',
              (hidden || frozen) && '[animation-play-state:paused]',
            )}
          >
            <video
              ref={(el) => {
                videos.current[i] = el;
              }}
              // only the first clip needs a poster; each later one is preloaded before it fades in
              poster={i === 0 ? `/hero/${s.id}.webp` : undefined}
              muted
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              preload={i === 0 ? 'auto' : 'none'}
              className="absolute inset-0 h-full w-full object-cover"
            >
              <source src={`/hero/${s.id}.webm`} type='video/webm; codecs="av01.0.05M.08"' />
              <source src={`/hero/${s.id}.mp4`} type="video/mp4" />
            </video>
            <canvas
              ref={(el) => {
                frames.current[i] = el;
              }}
              hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        ),
      )}
      {/* legibility: dark at the top for the headline, and at the bottom for the caption */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,9,13,0.92)_0%,rgba(6,9,13,0.55)_32%,rgba(6,9,13,0.15)_55%,rgba(6,9,13,0.35)_75%,rgba(6,9,13,0.95)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_50%,transparent_40%,rgba(6,9,13,0.55)_100%)]" />

      {/* Bottom Left: Unified Telemetry Card and Copyright cleanly stacked */}
      <div className="absolute bottom-6 sm:bottom-8 lg:bottom-10 left-6 sm:left-10 lg:left-14 z-10 flex flex-col gap-3 sm:gap-3.5 max-w-md sm:max-w-lg pointer-events-none">
        {/* Unified Card: title, live ping, progress bars, and description all in one cohesive element */}
        <div
          key={slide.id}
          className="animate-pop rounded-2xl border border-white/15 bg-black/75 px-4 py-3 backdrop-blur-md shadow-2xl pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-4">
            <p className="m-0 flex items-center gap-2 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
              <span className="relative flex h-2 w-2">
                {!still && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                )}
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Live · {slide.title}
            </p>
            {/* Integrated Shot Progress Bars */}
            <div className="flex gap-1.5 items-center">
              {SLIDES.map((s, i) => (
                <span key={s.id} className="h-1 w-6 sm:w-7 overflow-hidden rounded-full bg-white/25">
                  <span
                    className={cn(
                      'block h-full w-full origin-left rounded-full bg-accent',
                      i === index
                        ? still
                          ? ''
                          : cn('animate-hero-progress', (hidden || frozen) && '[animation-play-state:paused]')
                        : i < index
                          ? 'opacity-60'
                          : 'scale-x-0',
                    )}
                  />
                </span>
              ))}
            </div>
          </div>
          <p className="m-0 mt-1.5 font-mono text-xs sm:text-sm text-white/90">{slide.text}</p>
        </div>

        {/* Copyright cleanly positioned below the card without overlapping */}
        <p className="m-0 text-[10px] sm:text-xs text-white/50 tracking-wider">
          &copy; {new Date().getFullYear()} {copyrightText}
        </p>
      </div>
    </div>
  );
});
