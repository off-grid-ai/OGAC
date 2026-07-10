# The Intelligent Enterprise — interaction design language

The console's _feel_ is the pitch. A CIO, CTO, or CISO clicking through should sense a different
level of quality before reading a word: restrained, premium, alive. This document is the shared
vocabulary that makes that cohesive — the motion principles, the "data-is-alive" rules, the depth
model, and a surface-by-surface mapping to specific animated components. It is the standard the
fan-out reuses so every surface elevates on _one_ rhythm, not ten improvisations.

The aesthetic does not change. Brutalist / terminal, Menlo mono, emerald and only emerald
(`#34D399` dark / `#059669` light), black/white with tiered neutral surfaces. Elevation means
**motion, depth, responsiveness, and data feeling alive — within that restraint.** If a change makes
the console louder or busier, it is wrong, however impressive.

> Source of truth for the aesthetic: `../brand/DESIGN_PHILOSOPHY.md` and the console
> `CLAUDE.md` design section. This document governs _interaction_, downstream of both — it never
> overrides a token or a brand rule.

---

## 1. Motion principles

Motion clarifies; it never decorates. Everything below is encoded once in
`src/lib/motion/timing.ts` (durations, easing, stagger, the reduced-motion decisions) and consumed
from there — never hardcode a duration or a curve.

### Durations (the restraint budget)

| Band       | Duration | Where it is used                                                        |
| ---------- | -------- | ----------------------------------------------------------------------- |
| **micro**  | 120 ms   | Press, toggle, checkbox, active-state flip — near-instant feedback.     |
| **hover**  | 240 ms   | Hover elevation, tab underline, focus ring, spotlight follow.           |
| **reveal** | 400 ms   | Surface / section entrance, BlurFade, one list-item's stagger unit.     |
| **data**   | 900 ms   | Count-up settle, beam sweeps — long enough to read as data _resolving_. |

### Easing

Cubic-bezier tuples in `EASE`; **no bounce anywhere** (bounce reads as playful).

- `standard` `[0.22, 1, 0.36, 1]` — the workhorse ease-out (hover, spotlight, beam).
- `entrance` `[0.16, 1, 0.3, 1]` — decelerates harder for reveals and list rises.
- `emphasized` `[0.33, 1, 0.68, 1]` — the settle for numbers / springs.

### The non-negotiables

- **Animate `transform` and `opacity` only** (add `filter: blur` sparingly for reveals). Never
  animate layout properties (width/height/top/left) — they cause jank, especially on scroll.
- **`prefers-reduced-motion` is ALWAYS honored.** `effectiveDuration()` collapses any reveal to an
  instant snap to the final state; `shouldAnimateLoop()` disables every looping/decorative animation
  entirely. The final value is _always_ painted — never hidden behind an animation that won't run.
  globals.css already zeroes CSS animation/transition durations under the media query; JS-driven
  motion must consult `useReducedMotion()` (every adopted primitive does).
- **Stagger is capped.** `staggerDelay(i)` plateaus after ~12 items so a long feed never makes the
  last row wait seconds. The happy tail is bounded.
- **One orchestrated moment beats scattered effects.** A surface gets _one_ signature motion (the
  count-up, the beam, the reveal) — not five competing ones.

---

## 2. Data-is-alive rules

The single highest-leverage feeling. Enterprise buyers read "alive data" as "this system is
actually running." Apply these mechanically:

- **Every headline numeric stat counts up** via `NumberTicker` (`src/components/ui/number-ticker.tsx`).
  It takes the surface's already-formatted string ("1,284", "$4.20", "80%", "7/7 up") and settles on
  it exactly — a drop-in for the static value. Non-numeric values (engine names, "n/a") render
  verbatim.
- **Every "data moves between things" gets `AnimatedBeam`** (`src/components/ui/animated-beam.tsx`):
  an emerald pulse travelling a curved connector — gateway → node, source → collection, pipeline
  stage → stage, trigger → run → sink. The static rail always renders (topology reads with motion
  off); the pulse loops only when motion is allowed.
- **Every feed / activity / trace stream uses `AnimatedList`** (`src/components/ui/animated-list.tsx`):
  rows settle in with a brief staggered rise so new items feel like they _arrive_.
- **Charts animate in** (line draws, bars grow from baseline) on first view, once — then hold. Use
  `AnimatedChart` (abui) or the shadcn `Chart` with an entrance. Never re-animate on every re-render.
- **Live status pulses, quietly.** A healthy/blocked indicator uses `AnimatedCircularProgress`
  (magic-ui) or a slow emerald `BorderBeam` (already in `ui/`) on the _one_ primary health card —
  not on every card.

---

## 3. Depth + focus

Dashboards are compositions, not tile walls. Depth comes from tiers and size, not shadow.

- **Dashboards use a Bento layout** (`src/components/ui/bento-grid.tsx`): a dense, full-width
  responsive grid where the primary cell spans 2×2 and the supporting stats are single cells. This
  directs the eye and fills the width (§9 of the philosophy) in one move.
- **The primary card gets a spotlight**: wrap its content in the existing `MagicCard` (emerald
  radial-follow, already tuned to brand) or Aceternity `CardSpotlight` / `Spotlight`. **Exactly one
  spotlight per surface** — the focal point. Everything around it stays flat.
- **Detail views get a subtle entrance, not a hard paint.** Use the existing `BlurFade` with
  `inView` (reveal band) on the detail header + first section; `motion-primitives/InView` for
  below-the-fold sections. Never a full-page fade that delays interactivity.

---

## 4. Surface entrances + transitions

- **Page / route reveal:** the global `PageTransition` (`og-page-enter`) already handles the
  route-level fade-up. Do not double-animate a page root on top of it.
- **Section reveal:** `BlurFade inView` per section, staggered with `staggerDelay(sectionIndex)`.
- **List / grid stagger:** `AnimatedList`, or `motion-primitives/AnimatedGroup` for a grid of cards.
- **Tab / in-page nav:** underline slides with the `hover` band; panel content cross-fades with
  `TransitionPanel` (motion-primitives). Navigation stays URL-driven (the nav rule) — motion is
  cosmetic over the real route change, never a substitute for it.

---

## 5. The restraint guardrails (what NOT to do)

Elevation must never cost usability, the coverage bar, or the brand. Reject:

- **No second accent, ever.** Emerald is the only accent. No rainbow, aurora, gradient-animation,
  neon, or colour-coded information. Banned components: `RainbowButton`, `AuroraText`,
  `AuroraBackground`, `NeonGradientCard`, `GoogleGeminiEffect`, `ColourfulText`, `AnimatedGradientText`.
- **No playful / decorative motion.** Banned: `Confetti`, `SparklesText`, `Sparkles`, `Meteors`,
  `ShootingStars`, `BubbleBackground`, `FireworksBackground`, `GravityStars`, `CoolMode`,
  `Ripple`-for-fun, `SmoothCursor`, `Pointer`, comic/scramble text toys.
- **No 3D / heavy WebGL.** Banned: `three.js`, `CobeGlobe`, `Globe`, `IconCloud`, `GitHubGlobe`,
  `MacbookScroll`, `ThreeDMarquee`, `ThreeDCardEffect`, `ShaderLensBlur`, `DitherShader`. They are
  slow, off-brand, and break the terminal register.
- **No motion on dense data tables.** Rows in a scannable table do **not** animate on hover or
  re-sort — motion there fights scanning. `AnimatedList` is for _feeds_ (chronological, low-density),
  not for the audit/policy/model tables operators read carefully.
- **No layout animation on scroll**, no parallax-heavy hero effects inside the console (that is
  landing-page language, not operator-console language).
- **Reduced motion is not optional.** A primitive that ignores it is a defect.
- **Performance + coverage bars hold.** Pure motion logic lives in `src/lib/motion/*` (unit-tested,
  ≥85% / actually 100%); the `.tsx` stays thin presentation. A heavy effect that drops frames on a
  1440px dashboard is rejected regardless of how it looks.

---

## 6. Surface → elevation → component mapping

Each console surface, what it is today, the elevation to apply, and the **specific** library
component(s) — deliberately diverse across the 397-component catalog, not the same five everywhere.
Component homes: `ui/` = already in the console; otherwise `magic-ui` / `aceternity` /
`motion-primitives` / `cult-ui` / `abui` / `animate-ui` / `eldora-ui` in the catalog.

| Surface (route)                       | What it is today                                                             | Elevation                                                                                                                                                                | Components                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview** (`/overview`)            | Operator command center: posture tiles, blocking feed, cost grid, activity   | Bento layout; posture tiles **count up** (done — reference app); blocking + activity feeds arrive staggered; one spotlight on the posture card                            | `ui/BentoGrid`, `ui/NumberTicker` ✅, `ui/AnimatedList`, `ui/MagicCard` (spotlight), `ui/BlurFade`                                                                            |
| **Gateway · AI** (`/gateway/ai`)      | Inference endpoint: model matrix, node health + latency                      | Node **topology beams** (gateway → each node); health as circular progress; latency numbers tick                                                                         | `ui/AnimatedBeam`, `magic-ui/AnimatedCircularProgress`, `ui/NumberTicker`, `abui/AnimatedChart` (latency)                                                                     |
| **Gateway · Registry / Services**     | Provider cards; services directory table                                     | Provider cards reveal as a group; health-probe status pulses on the primary only                                                                                         | `motion-primitives/AnimatedGroup`, `ui/BorderBeam` (primary health), `ui/BlurFade`                                                                                            |
| **Fleet / Devices** (`/gateway/…`)    | Edge device roster, online/offline, MDM actions, stat band                   | **Device topology beams** (control-plane → devices); stat band ticks; online count as circular progress. Table itself stays static.                                      | `ui/AnimatedBeam`, `magic-ui/AnimatedCircularProgress`, `ui/NumberTicker`                                                                                                    |
| **Build · Studio** (`/build/studio`)  | App/agent authoring: stat band, agent grid, app list                         | Stat band ticks; agent grid cards hover-lift + reveal-as-group; the 5-screen app lifecycle (Build/Input/Runs/Review/Reports) cross-fades between screens                  | `ui/NumberTicker`, `motion-primitives/AnimatedGroup`, `ui/MagicCard`, `motion-primitives/TransitionPanel` (lifecycle), `cult-ui/DirectionAwareTabs`                          |
| **Build · Agents** (`/build/agents`)  | Agent roster grid; run queue                                                 | Grid reveal; run-queue rows arrive staggered; running-agent card has a live border beam                                                                                  | `motion-primitives/AnimatedGroup`, `ui/AnimatedList` (run queue), `ui/BorderBeam` (active run)                                                                               |
| **Pipelines** (`/build/pipelines`)    | Governed contracts: card grid → detail with stage timeline + 11 sub-tabs     | **Stage timeline as a tracing beam** down the stages; stage nodes light in sequence; sub-tabs cross-fade                                                                  | `abui/TimelineSteps` / `abui/TimelineGantt`, `ui/AnimatedBeam` (stage → stage), `motion-primitives/TransitionPanel`, `motion-primitives/ScrollProgress`                      |
| **Data** (`/data`)                    | Connectors, ingest jobs, PII masking, catalog, DSAR erasure, vector index    | **Ingest flow beams** (connector → catalog → vector index); health band ticks; reindex/erasure show determinate progress; masking toggles micro-feedback                 | `ui/AnimatedBeam` (data flow), `ui/NumberTicker`, `magic-ui/AnimatedCircularProgress` (reindex), `animate-ui/Switch` (masking)                                               |
| **Governance** (`/governance`)        | Policy editor + history, routing rules, RBAC users, secrets, audit           | Policy editor JSON preview types in on save; routing-rule evaluation animates the matched path; audit **feed** arrives staggered. Rules/users **tables stay static.**    | `motion-primitives/TextEffect` (preview), `ui/AnimatedList` (audit feed), `ui/BlurFade`; **no** row motion on the tables                                                     |
| **Insights** (`/insights`)            | Eval scores, drift (PSI), online judge, Langfuse traces, thresholds          | Eval **score chart draws in**; drift alert band shifts tone with a fade; **trace feed** arrives staggered; Langfuse waterfall expands smoothly                            | `abui/AnimatedChart` / `shadcn/Chart`, `ui/AnimatedList` (traces), `motion-primitives/Disclosure` (waterfall rows), `ui/NumberTicker` (scores)                               |
| **Operations · Admin** (`/operations`)| Org instructions, pipeline binding, roles, adapters, flags, tenants, ABAC    | ABAC tester animates the **decision path** (allow/deny) as a beam; flag toggles micro-feedback; confirmation modals morph in. Config tables stay static.                  | `ui/AnimatedBeam` (ABAC decision), `animate-ui/Switch` (flags), `cult-ui/FamilyDrawer` / `motion-primitives/MorphingDialog` (confirm), `ui/NumberTicker` (tenant counts)     |
| **Provit** (`/provit`)                | Visual-QA product: repo modules, run behavior, vision judging                | Intelligence panel **streams** results in; repo grid reveals as a group; run status uses a multi-step loader; status badge pulses                                        | `motion-primitives/TextEffect` (streaming), `motion-primitives/AnimatedGroup`, `aceternity/MultiStepLoader` (run), `ui/AnimatedShinyText` (status)                          |
| **Workspace · Chat** (`/workspace/chat`)| Full-height chat: threads, tools, artifacts, citations                     | Assistant response **types/streams**; thinking block shimmers while working; tool calls reveal as a staggered list; scroll-to-latest is smooth                            | `motion-primitives/TextShimmer` (thinking), `magic-ui/TypingAnimation` (stream), `ui/AnimatedList` (tool calls), `ui/BlurFade` (new message)                                 |
| **Workspace · Projects / Knowledge**  | Card grids → detail pages; org corpus collections                            | Card grids reveal as a group + hover-lift → detail; add-to-collection sheet slides                                                                                       | `motion-primitives/AnimatedGroup`, `ui/MagicCard`, `animate-ui/Sheet` / `ui/form-sheet`                                                                                     |
| **Workspace · Artifacts / Storage**   | Saved outputs list; file-tree browser                                        | Artifact cards reveal; storage file-tree expands smoothly with disclosure. Dense file rows stay static.                                                                  | `magic-ui/FileTree`, `motion-primitives/Disclosure`, `ui/BlurFade`                                                                                                          |

Legend: ✅ = shipped in this spec's reference application.

---

## 7. The adopted primitives (this spec)

Landed in `src/components/ui/`, each a thin presentation layer over pure, unit-tested logic in
`src/lib/motion/*` (SOLID: the decision is testable and reused; the component is glue). All honor
reduced motion.

| Primitive         | File                                | Pure logic                | Purpose                                            |
| ----------------- | ----------------------------------- | ------------------------- | -------------------------------------------------- |
| **NumberTicker**  | `ui/number-ticker.tsx`              | `lib/motion/count-up.ts`  | Count-up on any pre-formatted stat string.         |
| **AnimatedBeam**  | `ui/animated-beam.tsx`              | `lib/motion/beam-geometry.ts` | Emerald pulse along a curved node-to-node connector. |
| **AnimatedList**  | `ui/animated-list.tsx`              | `lib/motion/timing.ts`    | Staggered arrival for feeds / activity / traces.   |
| **BentoGrid**     | `ui/bento-grid.tsx`                 | (composes `BlurFade`)     | Dense, full-width dashboard depth layout.          |

Shared timing tokens for _all_ of the above and the fan-out: `lib/motion/timing.ts`
(`DURATION`, `EASE`, `STAGGER_STEP`, `staggerDelay`, `effectiveDuration`, `shouldAnimateLoop`).

Reference application: `NumberTicker` is wired into the Overview posture tiles
(`src/app/(console)/overview/overview-components.tsx`).

---

## 8. The fan-out plan

Prioritized by _visitor impact_ — the surfaces a CIO/CTO/CISO hits first on the demo tour lead.
Each workstream is a **disjoint file-set** so three can run in parallel without merge conflict. Each
reuses the primitives above (DRY) and adds new tests only for any new pure logic it introduces.

**Round 1 — the first impression (highest impact)**

1. **Overview dashboard** — `app/(console)/overview/**`. Convert to `BentoGrid`; spotlight the
   posture card; `AnimatedList` for blocking + activity feeds. (NumberTicker already done.)
2. **Gateway + Fleet topology** — `app/(console)/gateway/**`. `AnimatedBeam` node/device topologies;
   `AnimatedCircularProgress` health; ticking latency. _New pure logic:_ topology layout (node
   positions) → `lib/motion/topology.ts` (tested).
3. **Workspace · Chat** — `app/(console)/workspace/chat/**`. Streaming/typing response, shimmer
   thinking block, staggered tool calls.

**Round 2 — the governance story (the differentiator)**

4. **Insights / observability** — `app/(console)/insights/**`. Animated score chart, staggered trace
   feed, smooth waterfall disclosure.
5. **Governance** — `app/(console)/governance/**`. Policy-preview typing, routing-path animation,
   audit feed. (Tables stay static — enforce the guardrail.)
6. **Pipelines** — `app/(console)/build/pipelines/**`. Tracing-beam stage timeline, sub-tab
   cross-fade, scroll progress.

**Round 3 — the depth**

7. **Build · Studio + Agents** — `app/(console)/build/studio/**`, `app/(console)/build/agents/**`.
   Stat ticks, grid reveals, lifecycle cross-fade, active-run border beam.
8. **Data plane** — `app/(console)/data/**`. Ingest-flow beams, determinate reindex/erasure progress,
   masking-toggle micro-feedback.
9. **Operations · Admin + Provit + Workspace rest** — `app/(console)/operations/**`,
   `app/(console)/provit/**`, `app/(console)/workspace/{projects,knowledge,artifacts,storage}/**`.
   ABAC decision beam, streaming intelligence, grid reveals, file-tree disclosure.

**Sweep (after each round):** verify the round's surfaces integrate, screenshot each on a wide
viewport, confirm reduced-motion still snaps, and hold typecheck / build / depcruise / coverage.

---

## 9. Contributor checklist (paste into any fan-out PR)

- [ ] Uses the adopted primitives / `lib/motion/timing.ts` tokens — no hardcoded duration or curve.
- [ ] Any new pure motion logic lives in `src/lib/motion/*` and is unit-tested (≥85%).
- [ ] `transform`/`opacity` only; no layout animation; no scroll jank.
- [ ] `prefers-reduced-motion` honored (JS via `useReducedMotion`, CSS via the media query).
- [ ] Emerald is the only accent; none of the banned components (§5) are used.
- [ ] Dense tables are **not** animated on hover / re-sort.
- [ ] One orchestrated moment per surface, not five.
- [ ] Wide-viewport screenshot attached; reduced-motion snap verified.
- [ ] `npm run typecheck && npm run build && npm run depcruise && npm run coverage` green.
