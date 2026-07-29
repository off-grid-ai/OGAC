'use client';

import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

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
// view, and `prefers-reduced-motion` renders a still frame with no timer at all.

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

export function ControlPlaneHero() {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const reduce = useRef(false);

  useEffect(() => {
    setMounted(true);
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Scale the 1600x900 stage to whatever width the hero column gives us.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / STAGE_W);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Don't burn a frame loop on a hero nobody is looking at.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || reduce.current) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      setElapsed((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const dark = resolvedTheme !== 'light';
  const pal = PALETTES[dark ? 'dark' : 'light'];
  const src = dark ? '/hero/control-plane-dark.svg' : '/hero/control-plane-light.svg';

  // Reduced motion holds the loop at a composed wide frame rather than a random one.
  const { index, progress, gSec } = useMemo(
    () => (reduce.current ? { index: 0, progress: 0.5, gSec: 0 } : sceneAt(elapsed)),
    [elapsed],
  );
  const { cam, em } = useMemo(() => frameOf(index, progress, !reduce.current), [index, progress]);

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden rounded-xl border border-border"
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}`, background: pal.bg }}
    >
      {mounted ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: STAGE_W,
            height: STAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <World cam={cam} gSec={gSec} em={em} pal={pal} src={src} />
        </div>
      ) : null}
    </div>
  );
}
