'use client';

import { ArrowClockwise, ArrowsOut, CornersIn, Pause, Play } from '@phosphor-icons/react/dist/ssr';
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
/**
 * The largest camera scale at which the whole poster still fits the stage vertically.
 *
 * (900 - 2*PAD) / 1024. Above it the world is taller than the stage and `World`'s overflow:hidden cuts
 * the difference — and because the camera centres the world, the cut lands half on the poster's TOP,
 * which is its title and logo. The PAD also gives the logo and title actual breathing room instead of
 * sitting flush against the top edge of the frame.
 *
 * The opening scene pushes in from 0.879 to 0.9, so it crossed this line by ~22px and the title was
 * trimmed. In the original full-screen prototype that was an invisible hairline; at full bleed it reads
 * as the title being chopped. Clamping the WIDE poses to this value costs an imperceptible amount of
 * push-in and makes over-cropping structurally impossible. Zoomed poses (1.5–1.95) are left alone —
 * cropping is the entire point of a close-up.
 */
/** Breathing room, in stage px, kept between the poster and the frame edge at the wide poses. */
const STAGE_PAD = 26;
const MAX_WIDE_CAM = (STAGE_H - 2 * STAGE_PAD) / WORLD_H;

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
  stageW,
  cam: rawCam,
  gSec,
  em,
  pal,
  src,
}: Readonly<{ stageW: number; cam: Pose; gSec: number; em: Emphasis; pal: Palette; src: string }>) {
  // Clamp only the WIDE end. See MAX_WIDE_CAM: above it the poster is taller than the stage and the
  // overflow is cut half off its title.
  const cam =
    rawCam.s <= 1 && rawCam.s > MAX_WIDE_CAM ? { ...rawCam, s: MAX_WIDE_CAM } : rawCam;
  // Centre on the ACTUAL stage width, not the nominal 1600. The stage is as wide as the viewport now, so
  // this is what keeps the artwork centred while the extra width simply becomes room.
  const tx = stageW / 2 - cam.x * cam.s;
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
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState({ w: STAGE_W, h: STAGE_H });
  const [mounted, setMounted] = useState(false);
  // Starts false: the observer decides. Defaulting to true meant one frame of playback before it
  // reported, which is the same bug in miniature.
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  // The poster is ~400KB and is applied as a CSS background-image, so it has no load event and the
  // overlay layers (packets, glows, pulsing gates) would happily animate over empty space for the first
  // moment — which read as "a blank screen with some pulsating stuff". Preload it and hold the whole
  // world back until it has decoded.
  const [bgReady, setBgReady] = useState(false);
  // The pause control is the only signal that the stage responds to a click, so it glows until the
  // reader has used it once — then the hint retires for good.
  const [hinted, setHinted] = useState(true);
  // Bumped by Restart to force the frame loop's effect to re-run. Without it, resetting elapsedRef while
  // the loop is ALREADY RUNNING does nothing: the running effect captured `base` when it started, so the
  // next tick recomputes elapsed from the old base and stamps the reset straight back out.
  const [runKey, setRunKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const reduce = useRef(false);
  const elapsedRef = useRef(0);

  const toggleFullscreen = useCallback(async () => {
    const host = outerRef.current;
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

  // Scale the 1600x900 stage to whatever box the parent gives us.
  //
  // MEASURED EVERY FRAME, not only on resize. The scroll stage animates the parent's width/height via
  // motion values, and a ResizeObserver's delivery lagged that badly enough to matter: at full bleed the
  // stage was still being scaled for the pre-expansion 873px box (scale 0.947 instead of 1.02), which is
  // where the "title is cut off" clipping actually came from. Reading the live rect each frame is one
  // getBoundingClientRect per tick and cannot go stale.
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    // offsetWidth/Height, NOT getBoundingClientRect: the rotor is rotated 90° in portrait fullscreen, and
    // getBoundingClientRect returns the TRANSFORMED bounding box — so a 664x390 landscape rotor measured
    // as 390x664 and the stage got fitted to the portrait dimensions it only appears to occupy. The layout
    // box is what the stage actually lives in.
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    if (!width || !height) return;
    setBox((prev) => (Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height }));
    const next = Math.min(width / STAGE_W, height / STAGE_H);
    setScale((prev) => (Math.abs(prev - next) < 0.0005 ? prev : next));
  }, []);

  useEffect(() => {
    // Depends on `mounted` for the same reason: the rotor does not exist on the first render, so without
    // it this observed nothing and the fit never updated.
    const host = hostRef.current;
    if (!host) return;
    measure();
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
      // ALWAYS CONTAIN. Never crop the poster.
      //
      // This went the other way first. The stage was being letterboxed INSIDE a box that was itself
      // smaller than the viewport, so the page background showed through down both sides and it wasn't
      // 100vw. The fix for that was to make the host fill the viewport — not to switch to COVER, which
      // is what I did. Covering a 3:2 poster into a ~2:1 viewport crops ~70px off the top and bottom,
      // and the top of this poster is its title and logo. Losing those is far worse than any band.
      //
      // With the host filling the viewport and painting the poster's OWN background colour, contain
      // leaves no seam: the area beside the artwork is the same near-black (or near-white) the poster
      // itself sits on, so it reads as one continuous surface rather than a letterbox. That is why the
      // gutters were visible before and are not now — the difference was the host, not the fit.
      // Fit against WIDE_FIT_H, not STAGE_H — see that constant. These are the box's REAL measured
      // pixels, so browser chrome, a bookmarks bar or a mobile toolbar are already accounted for; that is
      // why the sizing is measured rather than expressed in vh.
      measure();
    });
    ro.observe(host);
    // Scroll drives the expansion, and the loop may be paused while it happens.
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure);
    };
  }, [fill, measure, mounted]);

  // Don't play until the stage is actually being looked at.
  //
  // The threshold is 0.45, not a hair above zero. At 0.05 a few pixels peeking past the fold was enough
  // to start the clock, so the 16.3s loop ran while effectively unseen and you arrived somewhere in the
  // middle of it — the establishing wide shot, which is the whole point of the opening beat, was already
  // gone. Requiring roughly half the stage in view means playback begins at frame 0 when the reader gets
  // there. It also stops the loop when they leave, and `elapsedRef` resumes rather than restarting.
  useEffect(() => {
    // The OUTER element, not the rotor. `hostRef` now lives inside `{mounted ? …}`, so it is null on the
    // first render — and this effect's [] deps meant it returned early and never observed anything, so
    // `visible` stayed false and the animation never started at all. The outer element always exists.
    const host = outerRef.current;
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
    const onChange = () => {
      setFullscreen(document.fullscreenElement === outerRef.current);
      // The box changes shape on entering/leaving fullscreen and on rotation; refit immediately rather
      // than waiting for the next frame, so there is no flash at the wrong size.
      requestAnimationFrame(measure);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, [measure]);

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
    if (!visible || paused || !bgReady || reduce.current) return;
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
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, paused, bgReady, measure, runKey]);

  const dark = resolvedTheme !== 'light';
  const pal = PALETTES[dark ? 'dark' : 'light'];
  const src = dark ? '/hero/control-plane-dark.svg' : '/hero/control-plane-light.svg';

  useEffect(() => {
    if (!mounted) return;
    let live = true;
    setBgReady(false);
    const img = new Image();
    img.src = src;
    const done = () => {
      if (live) setBgReady(true);
    };
    // `decode()` waits for the raster to be ready to paint, not merely downloaded — without it the
    // first painted frame can still be blank. Falls back to the load event where decode is missing.
    if (img.decode) img.decode().then(done, done);
    else {
      img.onload = done;
      img.onerror = done;
    }
    return () => {
      live = false;
    };
  }, [src, mounted]);

  // Reduced motion holds the loop at a composed wide frame rather than a random one.
  const { index, progress, gSec } = useMemo(
    () => (reduce.current ? { index: 0, progress: 0.5, gSec: 0 } : sceneAt(elapsed)),
    [elapsed],
  );
  const { cam, em } = useMemo(() => frameOf(index, progress, !reduce.current), [index, progress]);

  // Where the stage actually sits inside the outer box. The stage is letterboxed (contain), so the outer
  // element's corner is NOT the artwork's corner — anchoring the controls to `bottom-3 right-3` of the
  // outer dropped them into the empty band beside the poster, which reads as misaligned rather than as
  // floating controls. Inset them by the letterbox margin so they always overlay the artwork.
  // THE FIX FOR THE SIDE BANDS. The stage was a fixed 1600x900; letterboxing that 16:9 box into a 2.18:1
  // window is what produced ~178px of empty margin down each side — at EVERY camera pose, including the
  // zoomed ones where the artwork is far wider than the screen and should be spilling off both edges.
  // The stage is now as wide as the viewport requires, so it never needs letterboxing horizontally.
  const stageW = Math.max(STAGE_W, (box.w / Math.max(1, box.h)) * STAGE_H);
  const stageInsetX = Math.max(0, (box.w - stageW * scale) / 2);
  const stageInsetY = Math.max(0, (box.h - STAGE_H * scale) / 2);

  const label = paused ? 'Play the animation' : 'Pause the animation';
  return (
    <div
      ref={outerRef}
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
            onClick={() => {
              setPaused((p) => !p);
              setHinted(false);
            }}
            onKeyDown={onKeyDown}
            aria-label={label}
            aria-pressed={paused}
            className="absolute inset-0 z-10 cursor-pointer"
          />
          {/* THE ROTOR. In portrait fullscreen, CSS sizes this to the screen's LANDSCAPE dimensions
              (100vh x 100vw) and turns it 90° — see `.og-stage-rotor` in globals.css. That is the fallback
              for `screen.orientation.lock('landscape')`, which is the correct API and which iOS Safari
              does not implement: without it, fullscreen on a phone stayed portrait and fitted a 16:9 stage
              to the phone's WIDTH, leaving most of the screen empty.
              An earlier attempt did the rotation in JS off React state and silently never engaged — the
              state depended on a `fullscreenchange` event and a measurement arriving in an assumed order,
              and neither did. CSS keyed off `:fullscreen` cannot miss.
              `hostRef` is HERE, on the element that actually contains the stage, so the fit maths measures
              the rotated box and needs no rotation awareness of its own. */}
          <div ref={hostRef} className="og-stage-rotor absolute inset-0">
            <div
              style={{
                position: 'absolute',
                // Centre the stage: a display is rarely 16:9, so letterbox rather than crop.
                top: (box.h - STAGE_H * scale) / 2,
                left: (box.w - stageW * scale) / 2,
                width: stageW,
                height: STAGE_H,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }}
            >
              {bgReady ? <World stageW={stageW} cam={cam} gSec={gSec} em={em} pal={pal} src={src} /> : null}
            </div>
          </div>

          {/* Controls. Always present for keyboard/AT; visually revealed on hover or focus, and held
              visible while paused so the state is legible rather than implied by stillness.
              NO `backdrop-blur` here: a backdrop-filter inside a transformed, overflow-hidden ancestor
              forces its own compositing pass, and it painted a blank vertical band all the way up the
              stage above the buttons. Solid backgrounds instead. */}
          <div
            style={{ right: stageInsetX + 12, bottom: stageInsetY + 12 }}
            className={`absolute z-20 flex items-center gap-1.5 transition-opacity duration-200 ${
              // Always visible on touch (no hover to reveal them) and whenever paused, so the state is
              // legible rather than implied by stillness.
              paused || hinted
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setPaused((p) => !p);
                setHinted(false);
              }}
              aria-label={label}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-foreground ${
                hinted && !paused
                  ? 'og-hint-pulse border-primary/60 text-foreground'
                  : 'border-border text-muted-foreground shadow-sm'
              }`}
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
              onClick={() => {
                // Back to frame 0 and playing. All four matter: the ref (what the loop resumes from), the
                // state (what renders now), unpausing, and runKey — which restarts the loop's effect so it
                // re-reads the reset base instead of overwriting it on the next tick.
                elapsedRef.current = 0;
                setElapsed(0);
                setPaused(false);
                setHinted(false);
                setRunKey((k) => k + 1);
              }}
              aria-label="Restart the animation from the beginning"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            >
              <ArrowClockwise className="size-3 text-primary" weight="bold" />
              Restart
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? 'Exit full screen' : 'View full screen'}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shadow-sm hover:text-foreground md:hidden"
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
