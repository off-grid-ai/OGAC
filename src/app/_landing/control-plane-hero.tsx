'use client';

import { ArrowsOut, CornersIn, Pause, Play } from '@phosphor-icons/react/dist/ssr';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── The control-plane hero animation ─────────────────────────────────────────────────────────────
//
// A 16.3s seamless loop: a camera glides across the control-plane diagram while packets run its
// connectors, cards light in sequence, and the privacy gates pulse. Ported from the approved
// `control-plane-hero.jsx` prototype — the camera poses, packet paths, glow rectangles and scene
// timings are the author's, transcribed, not reinterpreted.
//
// WHAT WAS DROPPED FROM THE PROTOTYPE, AND WHY:
//   • the tweaks panel and playback bar — authoring tools; a landing page is not a video player.
//   • the separate avatar / device-screen <img> overlays — the prototype needed them because its SVG
//     shipped `<image>` tags with no href. The repo's generated SVG embeds them, so overlaying again
//     would double-draw.
//   • `window.__resources` / `window.OM_SCENES` globals — the scene list and asset paths are real
//     module data here.
//
// THEMED. The prototype was light-only with hard-coded hex. Both the artwork and the effect colours
// switch, because the poster depicts the console and the console has a dark mode.
//
// COSTS NOTHING WHEN UNSEEN: the loop is driven by one rAF that stops when the hero scrolls out of
// view or is paused, and `prefers-reduced-motion` renders a still frame with no timer at all.
//
// CONTROLS: click the stage (or Space) to pause, `Full screen` (or F) to fill the display. Pausing
// resumes from where it stopped rather than restarting the 16.3s cycle, which is why `elapsedRef`
// exists — a fresh rAF would otherwise snap the camera back to scene one.

const WORLD_W = 1535;
const WORLD_H = 1024;
const STAGE_W = 1600;
const STAGE_H = 900;

// ── scenes (from the prototype's OM_SCENES) — 16.3s total ──────────────────────────────────────
const SCENES = [
  { name: 'Overview', dur: 0.7 },
  { name: 'Edge', dur: 2.5 },
  { name: 'Control plane', dur: 4 },
  { name: 'No-code', dur: 3.5 },
  { name: 'Outcomes', dur: 4.8 },
  { name: 'Return', dur: 0.8 },
] as const;

const DUR = SCENES.map((s) => s.dur);
const TOTAL = DUR.reduce((a, b) => a + b, 0);
/** Start time of each scene. */
const CUM = DUR.reduce<number[]>((acc, d, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + DUR[i - 1]);
  return acc;
}, []);

// ── camera poses in world coordinates ──────────────────────────────────────────────────────────
interface Pose {
  s: number;
  x: number;
  y: number;
}
const P: Record<string, Pose> = {
  wide: { s: 0.879, x: 767.5, y: 512 },
  wideB: { s: 0.9, x: 767.5, y: 512 },
  edgeA: { s: 1.75, x: 330, y: 430 },
  edgeB: { s: 1.8, x: 330, y: 575 },
  conA: { s: 1.5, x: 781, y: 470 },
  conB: { s: 1.55, x: 781, y: 505 },
  ncA: { s: 1.9, x: 1225, y: 405 },
  ncB: { s: 1.95, x: 1230, y: 580 },
  outA: { s: 1.95, x: 480, y: 888 },
  outB: { s: 1.95, x: 1090, y: 888 },
};

const easeInOutSine = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2;

/** Piecewise interpolation over keyTimes → values with easing inside each span. */
function interp(p: number, keyTimes: readonly number[], values: readonly number[]): number {
  if (p <= keyTimes[0]) return values[0];
  const last = keyTimes.length - 1;
  if (p >= keyTimes[last]) return values[last];
  for (let i = 0; i < last; i++) {
    if (p <= keyTimes[i + 1]) {
      const span = keyTimes[i + 1] - keyTimes[i];
      const t = span === 0 ? 0 : (p - keyTimes[i]) / span;
      return values[i] + (values[i + 1] - values[i]) * easeInOutSine(t);
    }
  }
  return values[last];
}

function camOf(p: number, keyTimes: readonly number[], poses: readonly Pose[]): Pose {
  return {
    s: interp(p, keyTimes, poses.map((q) => q.s)),
    x: interp(p, keyTimes, poses.map((q) => q.x)),
    y: interp(p, keyTimes, poses.map((q) => q.y)),
  };
}

const frac = (x: number) => x - Math.floor(x);
const sm = (x: number) => x * x * (3 - 2 * x);
/** A 0→1→0 pulse centred at `c` with half-width `w`. */
const bump = (p: number, c: number, w: number) => {
  const d = Math.abs(p - c);
  return d >= w ? 0 : sm(1 - d / w);
};
const plateau = (p: number, a: number, b: number, c: number, d: number) =>
  p <= a || p >= d ? 0 : p < b ? sm((p - a) / (b - a)) : p > c ? sm(1 - (p - c) / (d - c)) : 1;

// ── packet paths, traced from the diagram's dashed connectors ───────────────────────────────────
const PATHS: { pts: [number, number][]; off: number }[] = [
  { pts: [[298, 300], [332, 300], [342.5, 312], [342.5, 448], [342.5, 464], [438, 464]], off: 0 },
  { pts: [[298, 464], [438, 464]], off: 0 },
  { pts: [[302, 645], [326.5, 645]], off: 0 },
  { pts: [[298, 774], [332, 774], [342.5, 763], [342.5, 662]], off: 0 },
  { pts: [[1120, 464], [1160, 464], [1160, 324], [1200, 324]], off: 0.25 },
  { pts: [[1120, 464], [1200, 464]], off: 0.25 },
  { pts: [[1120, 464], [1160, 464], [1160, 614], [1200, 614]], off: 0.25 },
];
/** The two privacy gates. Packets fade out crossing them rather than drawing over the padlock. */
const LOCKS: [number, number][] = [
  [342.5, 464],
  [1160, 464],
];

function ptAt(pts: [number, number][], t: number): { x: number; y: number } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const r = segs[i] ? Math.min(1, d / segs[i]) : 0;
      return {
        x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r,
        y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r,
      };
    }
    d -= segs[i];
  }
  return { x: pts[0][0], y: pts[0][1] };
}

interface Palette {
  /** "r,g,b" of the accent, for rgba() composition. */
  accentRgb: string;
  accent: string;
  underline: string;
  bg: string;
  wire: string;
  wireInk: string;
}
const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    accentRgb: '21,159,53',
    accent: '#159f35',
    underline: '#0d6914',
    bg: '#fefefe',
    wire: '#2a2e2b',
    wireInk: '#111213',
  },
  dark: {
    accentRgb: '52,211,153',
    accent: '#34d399',
    underline: '#34d399',
    bg: '#0a0a0a',
    wire: '#8a8a8a',
    wireInk: '#f5f5f5',
  },
};

// ── emphasis: which cards are lit, per frame ───────────────────────────────────────────────────
interface Emphasis {
  edge: number[];
  lrac: number[];
  gov: number[];
  assure: number[];
  band: number;
  prompt: number;
  chips: number[];
  checks: number[];
  sme: number;
  out: number[];
  fin: number;
  title: number;
}
const EM0: Emphasis = {
  edge: [0, 0, 0],
  lrac: [0, 0, 0, 0],
  gov: [0, 0, 0],
  assure: [0, 0, 0, 0, 0],
  band: 0,
  prompt: 0,
  chips: [0, 0, 0, 0, 0, 0, 0, 0],
  checks: [0, 0, 0, 0, 0],
  sme: 0,
  out: [0, 0, 0],
  fin: 0,
  title: 0,
};

/** The camera + emphasis for a scene index and its 0..1 progress. */
function frameOf(index: number, progress: number, cameraMoves: boolean): { cam: Pose; em: Emphasis } {
  const still = (poses: readonly Pose[], keys: readonly number[]) =>
    cameraMoves ? camOf(progress, keys, poses) : P.wide;
  switch (SCENES[index].name) {
    case 'Overview':
      return { cam: still([P.wide, P.wideB], [0, 1]), em: EM0 };
    case 'Edge':
      return {
        cam: still([P.wideB, P.edgeA, P.edgeB], [0, 0.3, 1]),
        em: {
          ...EM0,
          edge: [bump(progress, 0.42, 0.14), bump(progress, 0.62, 0.14), bump(progress, 0.82, 0.13)],
        },
      };
    case 'Control plane':
      return {
        cam: still([P.edgeB, P.conA, P.conB], [0, 0.25, 1]),
        em: {
          ...EM0,
          lrac: [
            bump(progress, 0.3, 0.1),
            bump(progress, 0.41, 0.1),
            bump(progress, 0.52, 0.1),
            bump(progress, 0.63, 0.1),
          ],
          gov: [bump(progress, 0.74, 0.12), bump(progress, 0.74, 0.12), bump(progress, 0.74, 0.12)],
          assure: [0, 1, 2, 3, 4].map((i) => bump(progress, 0.85 + i * 0.018, 0.05)),
          band: bump(progress, 0.94, 0.055),
        },
      };
    case 'No-code':
      return {
        cam: still([P.conB, P.ncA, P.ncB], [0, 0.25, 1]),
        em: {
          ...EM0,
          prompt: bump(progress, 0.32, 0.1),
          chips: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => bump(progress, 0.42 + i * 0.035, 0.05)),
          checks: [0, 1, 2, 3, 4].map((i) => bump(progress, 0.72 + i * 0.035, 0.05)),
          sme: bump(progress, 0.92, 0.06),
        },
      };
    case 'Outcomes':
      return {
        cam: still([P.ncB, P.outA, P.outB], [0, 0.35, 1]),
        em: {
          ...EM0,
          out: [bump(progress, 0.45, 0.12), bump(progress, 0.6, 0.12), bump(progress, 0.75, 0.12)],
          fin: bump(progress, 0.88, 0.08),
        },
      };
    default:
      return {
        cam: still([P.outB, P.wide, P.wide], [0, 0.78, 1]),
        em: { ...EM0, title: plateau(progress, 0.35, 0.55, 0.88, 0.98) },
      };
  }
}

/** Elapsed seconds → scene index + progress, looping. */
function sceneAt(elapsed: number): { index: number; progress: number; gSec: number } {
  const gSec = elapsed % TOTAL;
  let index = SCENES.length - 1;
  for (let i = 0; i < SCENES.length; i++) {
    if (gSec < CUM[i] + DUR[i]) {
      index = i;
      break;
    }
  }
  return { index, progress: (gSec - CUM[index]) / DUR[index], gSec };
}

function Glow({
  x,
  y,
  w,
  h,
  r,
  v,
  rgb,
}: Readonly<{ x: number; y: number; w: number; h: number; r?: number; v: number; rgb: string }>) {
  if (v < 0.02) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 2,
        top: y - 2,
        width: w + 4,
        height: h + 4,
        borderRadius: (r ?? 8) + 2,
        border: `1.5px solid rgba(${rgb},${0.55 * v})`,
        boxShadow: `0 0 20px rgba(${rgb},${0.28 * v}), inset 0 0 24px rgba(${rgb},${0.07 * v})`,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

function Packets({ gSec, pal }: Readonly<{ gSec: number; pal: Palette }>) {
  // One traversal per quarter-loop → four cycles per loop, so it closes seamlessly.
  const u = gSec / (TOTAL / 4);
  const dots: React.ReactNode[] = [];
  PATHS.forEach((p, i) => {
    // Two-way traffic: one packet out, one back.
    [frac(u + p.off), 1 - frac(u + p.off + 0.5)].forEach((t, j) => {
      const pt = ptAt(p.pts, t);
      let op = Math.min(1, (j ? 1 - t : t) / 0.1, (j ? t : 1 - t) / 0.1);
      for (const [lx, ly] of LOCKS) {
        const d = Math.hypot(pt.x - lx, pt.y - ly);
        op *= Math.max(0, Math.min(1, (d - 21) / 8));
      }
      if (op < 0.03) return;
      dots.push(
        <div
          key={`${i}-${j}`}
          style={{
            position: 'absolute',
            left: pt.x - 3,
            top: pt.y - 3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: pal.accent,
            opacity: 0.9 * op,
            boxShadow: `0 0 8px 2px rgba(${pal.accentRgb},0.45)`,
          }}
        />,
      );
    });
  });
  return <>{dots}</>;
}

function Ambient({ gSec, pal }: Readonly<{ gSec: number; pal: Palette }>) {
  const lockOsc = 0.5 + 0.5 * Math.sin(2 * Math.PI * gSec * (4 / TOTAL));
  const blink = Math.sin(2 * Math.PI * gSec * (17 / TOTAL)) > 0 ? 1 : 0.25;
  const lock = (x: number, y: number) => (
    <div
      key={x}
      style={{
        position: 'absolute',
        left: x - 18.5,
        top: y - 18.5,
        width: 37,
        height: 37,
        borderRadius: '50%',
        boxShadow: `0 0 ${10 + 10 * lockOsc}px rgba(${pal.accentRgb},${0.25 + 0.25 * lockOsc})`,
        pointerEvents: 'none',
      }}
    />
  );
  return (
    <>
      {lock(342.5, 464)}
      {lock(1160, 464)}
      {/* The connector from OTHER DATA SOURCES up into the feedback list (Usage Patterns), with its
          arrowhead. The poster SVG does not contain this run — the prototype drew it by hand in the
          SVG's own dashed style, and I dropped it when porting out of a misplaced worry about
          double-drawing. It is not a decoration: it is the line that closes the loop, showing enterprise
          data feeding back into what the edge learns. Themed via the palette's wire colours (which
          existed for this and were otherwise unused). */}
      <svg
        width={WORLD_W}
        height={WORLD_H}
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
      >
        <circle cx="298" cy="774" r="3.2" fill={pal.wireInk} />
        <path
          d="M302 774 H332 A10 10 0 0 0 342.5 763.5 V664"
          fill="none"
          stroke={pal.wire}
          strokeWidth="1.2"
          strokeDasharray="2.4 2.6"
          strokeLinecap="round"
        />
        <path
          d="M338.1 666 L342.5 660 L346.9 666"
          fill="none"
          stroke={pal.wireInk}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* The "Running" dot inside the OGAM phone. */}
      <div
        style={{
          position: 'absolute',
          left: 201.5 - 4.4,
          top: 394.5 - 4.4,
          width: 8.8,
          height: 8.8,
          borderRadius: '50%',
          background: pal.accent,
          opacity: blink,
          boxShadow: blink > 0.5 ? `0 0 7px rgba(${pal.accentRgb},0.7)` : 'none',
        }}
      />
    </>
  );
}

function World({
  cam,
  gSec,
  em,
  pal,
  src,
}: Readonly<{ cam: Pose; gSec: number; em: Emphasis; pal: Palette; src: string }>) {
  const tx = STAGE_W / 2 - cam.x * cam.s;
  const ty = STAGE_H / 2 - cam.y * cam.s;
  const chipXY = (i: number) => ({
    x: i % 2 ? 1367 : 1231,
    y: [435, 480.5, 526, 571.5][Math.floor(i / 2)],
  });
  const g = (p: Omit<Parameters<typeof Glow>[0], 'rgb'>) => <Glow {...p} rgb={pal.accentRgb} />;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: pal.bg }}>
      <div
        style={{
          position: 'absolute',
          width: WORLD_W,
          height: WORLD_H,
          transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          backgroundImage: `url(${src})`,
          backgroundSize: `${WORLD_W}px ${WORLD_H}px`,
        }}
      >
        <Packets gSec={gSec} pal={pal} />
        <Ambient gSec={gSec} pal={pal} />
        {/* edge column */}
        {g({ x: 30, y: 241.5, w: 258, h: 268, r: 10, v: em.edge[0] })}
        {g({ x: 30, y: 523.5, w: 258, h: 198, r: 10, v: em.edge[1] })}
        {g({ x: 21.5, y: 734.5, w: 275, h: 80, r: 14, v: em.edge[2] })}
        {/* Learn / Remember / Act / Control */}
        {g({ x: 600, y: 290, w: 112, h: 72, v: em.lrac[0] })}
        {g({ x: 717, y: 290, w: 107, h: 72, v: em.lrac[1] })}
        {g({ x: 834, y: 290, w: 102, h: 72, v: em.lrac[2] })}
        {g({ x: 951, y: 290, w: 106, h: 72, v: em.lrac[3] })}
        {/* governance rows */}
        {g({ x: 598, y: 432.5, w: 492, h: 45, v: em.gov[0] })}
        {g({ x: 598, y: 483.5, w: 492, h: 45, v: em.gov[1] })}
        {g({ x: 598, y: 534.5, w: 492, h: 45, v: em.gov[2] })}
        {/* continuous assurance + reliability band */}
        {em.assure.map((v, i) => (
          <Glow
            key={`a${i}`}
            x={594 + i * 101.6}
            y={634}
            w={93.6}
            h={61}
            r={7}
            v={v}
            rgb={pal.accentRgb}
          />
        ))}
        {g({ x: 586.5, y: 720.5, w: 515, h: 52, r: 10, v: em.band })}
        {/* no-code panel */}
        {g({ x: 1236, y: 276.5, w: 180, h: 80, v: em.prompt })}
        {em.chips.map((v, i) => {
          const c = chipXY(i);
          return <Glow key={i} x={c.x} y={c.y} w={122} h={39} r={7} v={v} rgb={pal.accentRgb} />;
        })}
        {em.checks.map((v, i) => (
          <Glow
            key={`c${i}`}
            x={1233}
            y={674 + i * 17}
            w={155}
            h={16.4}
            v={0.85 * v}
            rgb={pal.accentRgb}
          />
        ))}
        {g({ x: 1268, y: 777, w: 162, h: 17, r: 4, v: em.sme })}
        {/* outcomes band */}
        {g({ x: 294, y: 832, w: 236, h: 108, v: em.out[0] })}
        {g({ x: 554, y: 832, w: 232, h: 108, v: em.out[1] })}
        {g({ x: 853, y: 832, w: 244, h: 108, v: em.out[2] })}
        {g({ x: 1153.5, y: 827.5, w: 340, h: 127, r: 10, v: em.fin })}
        {/* the underline drawing itself beneath "Multiply outcomes." */}
        <div
          style={{
            position: 'absolute',
            left: 941,
            top: 134,
            width: 147,
            height: 2,
            background: pal.underline,
            transform: `scaleX(${em.title})`,
            transformOrigin: 'left',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

export function ControlPlaneHero({ fill = false }: Readonly<{ fill?: boolean }> = {}) {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState({ w: STAGE_W, h: STAGE_H });
  const [mounted, setMounted] = useState(false);
  // Starts false: the observer decides. Defaulting to true meant one frame of playback before it
  // reported, which is the same bug in miniature.
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const reduce = useRef(false);
  const elapsedRef = useRef(0);

  const toggleFullscreen = useCallback(async () => {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement) {
      // Release the orientation lock before leaving, or the phone can stay stuck landscape.
      try {
        (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.();
      } catch {
        /* not supported — nothing to release */
      }
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await host.requestFullscreen?.().catch(() => undefined);
    // The stage is 16:9, so on a phone fullscreen is only useful in landscape. Orientation lock
    // REQUIRES fullscreen first, hence the ordering. iOS Safari does not implement it — there the
    // fullscreen still works and the user rotates the device themselves, so this must not throw.
    try {
      await (
        screen.orientation as unknown as { lock?: (o: string) => Promise<void> }
      )?.lock?.('landscape');
    } catch {
      /* unsupported or refused — fullscreen is still correct, just not auto-rotated */
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Scale the 1600x900 stage to whatever width the hero column gives us.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
      // COVER in `fill` mode, CONTAIN otherwise.
      //
      // `fill` is the scroll stage growing to the whole viewport, and a viewport is almost never 16:9
      // — a 1920x940 window with CONTAIN scaled the stage to 1670 wide and centred it, leaving ~125px
      // of page background down each side. That is not 100vw, and the gutter's edge reads as the
      // animation being clipped. Covering means the stage genuinely fills the viewport and the
      // overflow is cropped at the true screen edge, which is what full-bleed means.
      //
      // Elsewhere (the contained card, and mobile landscape fullscreen) CONTAIN is right: the card is
      // already 16:9 so the two agree, and on a 19.5:9 phone covering would crop ~18% of the diagram's
      // height — losing its title and its bottom band — where letterboxing shows the whole thing.
      const fit = fill ? Math.max : Math.min;
      setScale(fit(width / STAGE_W, height / STAGE_H));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [fill]);

  // Don't play until the stage is actually being looked at.
  //
  // The threshold is 0.45, not a hair above zero. At 0.05 a few pixels peeking past the fold was enough
  // to start the clock, so the 16.3s loop ran while effectively unseen and you arrived somewhere in the
  // middle of it — the establishing wide shot, which is the whole point of the opening beat, was already
  // gone. Requiring roughly half the stage in view means playback begins at frame 0 when the reader gets
  // there. It also stops the loop when they leave, and `elapsedRef` resumes rather than restarting.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.45),
      // Several thresholds so the callback fires across the range rather than only at the boundary —
      // with a single threshold a fast scroll can skip straight past it and never report.
      { threshold: [0, 0.25, 0.45, 0.7, 1] },
    );
    io.observe(host);
    return () => io.disconnect();
  }, []);

  // Track fullscreen so the button reflects reality even when exited with Escape or the OS chrome.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === hostRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Space toggles playback, F toggles fullscreen — only while the animation has focus, so the keys
  // stay available to the rest of the page.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
      }
    },
    [toggleFullscreen],
  );

  useEffect(() => {
    if (!visible || paused || reduce.current) return;
    let raf = 0;
    let start: number | null = null;
    // Resume from the paused position: without carrying `elapsedRef` the loop would restart the
    // 16.3s cycle from scene one every time it was unpaused or scrolled back into view.
    const base = elapsedRef.current;
    const tick = (now: number) => {
      start ??= now;
      const next = base + (now - start) / 1000;
      elapsedRef.current = next;
      setElapsed(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, paused]);

  const dark = resolvedTheme !== 'light';
  const pal = PALETTES[dark ? 'dark' : 'light'];
  const src = dark ? '/hero/control-plane-dark.svg' : '/hero/control-plane-light.svg';

  // Reduced motion holds the loop at a composed wide frame rather than a random one.
  const { index, progress, gSec } = useMemo(
    () => (reduce.current ? { index: 0, progress: 0.5, gSec: 0 } : sceneAt(elapsed)),
    [elapsed],
  );
  const { cam, em } = useMemo(() => frameOf(index, progress, !reduce.current), [index, progress]);

  const label = paused ? 'Play the animation' : 'Pause the animation';
  return (
    <div
      ref={hostRef}
      className={`group relative w-full overflow-hidden border-border bg-[var(--stage-bg)] ${
        fullscreen || fill ? 'rounded-none border-0' : 'rounded-xl border'
      } ${fill ? 'h-full' : ''}`}
      style={
        {
          // In fullscreen the element fills the display, and in `fill` mode the scroll wrapper owns
          // the box — a fixed aspect ratio would fight both.
          ...(fullscreen || fill ? {} : { aspectRatio: `${STAGE_W} / ${STAGE_H}` }),
          '--stage-bg': pal.bg,
        } as React.CSSProperties
      }
    >
      {mounted ? (
        <>
          {/* Click anywhere on the stage to pause or resume; Space does the same when focused. */}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            onKeyDown={onKeyDown}
            aria-label={label}
            aria-pressed={paused}
            className="absolute inset-0 z-10 cursor-pointer"
          />
          <div
            style={{
              position: 'absolute',
              // Centre the stage: fullscreen displays are rarely 16:9, so letterbox rather than crop.
              top: (box.h - STAGE_H * scale) / 2,
              left: (box.w - STAGE_W * scale) / 2,
              width: STAGE_W,
              height: STAGE_H,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <World cam={cam} gSec={gSec} em={em} pal={pal} src={src} />
          </div>

          {/* Controls. Always present for keyboard/AT; visually revealed on hover or focus, and held
              visible while paused so the state is legible rather than implied by stillness. */}
          <div
            className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 transition-opacity duration-200 ${
              // Always visible on touch (no hover to reveal them) and whenever paused, so the state is
              // legible rather than implied by stillness.
              paused
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={label}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            >
              {paused ? (
                <Play className="size-3 text-primary" weight="fill" />
              ) : (
                <Pause className="size-3 text-primary" weight="fill" />
              )}
              {paused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? 'Exit full screen' : 'View full screen'}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground md:hidden"
            >
              {fullscreen ? (
                <CornersIn className="size-3 text-primary" weight="bold" />
              ) : (
                <ArrowsOut className="size-3 text-primary" weight="bold" />
              )}
              {fullscreen ? 'Exit' : 'Full screen'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
