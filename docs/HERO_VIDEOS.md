# Hero videos — recording brief and flow spec

The landing hero is a product frame with a **floating pill bar** overlaying its bottom edge. Each
pill swaps the clip playing in the frame. Untouched, the five clips advance in sequence and the pill
bar advances with them, so a passive visitor watches the whole governed path in about 50 seconds
without clicking anything.

This file is the source of truth for **what gets recorded**. The copy that renders lives in
`src/lib/landing-copy.ts`; this document says what the footage must show.

---

## Why this shape

Portkey's version of this bar is a set of tabs over a screenshot. Ours is five **stops on one
path**, because that is the product claim: one governed path from enterprise data to an accountable
result. Three details carry that difference, and dropping any of them turns it back into a
screenshot carousel:

1. **The browser chrome stays fixed; only the content cross-dissolves.** Five clips must read as one
   product, not five screenshots.
2. **An emerald thread fills beneath the pills as each clip plays, and never resets** — it
   accumulates left to right across all five stops. Progress bar and metaphor in one object.
3. **On the fifth stop the frame pulls back** and the five stages connect, thread complete. This is
   the payoff: it is one system, not five tools.

## The pills

Names are taken verbatim from `LANDING.planes` in `src/lib/landing-copy.ts`, plus Review. They are
**not** a new taxonomy — we already have three in play (the hero layers, the planes, the section
kickers) and a fourth would drift. If a pill name changes, it changes in the copy file first.

The only deviation: the second plane is labelled **Runtime**, not "AI Runtime". Every other pill in
this pattern is one plain word, and "AI Runtime" reads like internal architecture.

| Pill | Icon (`@phosphor-icons/react`) | Caption under the frame |
|---|---|---|
| **Data** | `Database` | Your systems become reusable context. Nothing is exported to get there. |
| **Runtime** | `Path` | Many models, yours and cloud. No call reaches one without passing through here. |
| **Solutions** | `Sparkle` | A department builds a governed app in plain language. No code. |
| **Review** | `SealCheck` | A run pauses for a person, then finishes on its own. |
| **Operations** | `ChartLine` | See what ran, why it failed, and what it cost. Then prove it. |

Phosphor only — never lucide, per the design standard.

---

## The five clips

Order below is **playback order** (system order: data in, result out). The persuasion order is
different and is used for the written flows further down — that is deliberate, not an
inconsistency. Portkey does the same: pills follow architecture, captions follow outcomes.

Timings are what the edit needs, not how long the take runs. Record long, cut to these.

### 1 · Data — 10s

A question is asked. The answer returns with citations. A citation is clicked and lands on the
source row it came from.

- **The beat:** the landing on the source. Everything before it is setup.
- **Annotation fires:** on landing — `traced to source`
- **Surfaces:** Chat → Provenance → Knowledge
- **Must be visible:** the citation marker in the answer, and the same record highlighted at the
  destination. The viewer has to see that they are the same thing.

### 2 · Runtime — 8s

A request routes across models. One node is down. Traffic shifts to a healthy node and the request
completes.

- **The beat:** the reroute. The failure is the point.
- **Annotation fires:** at the reroute — `no call skips the gateway`
- **Surfaces:** AI Gateway → Fleet
- **Must be visible:** the down node in red, and the request still succeeding.
- **Why a failure:** everyone demos the happy path. Showing the product absorb a fault is what makes
  an infrastructure buyer believe it.

### 3 · Solutions — 12s

Someone types a process in plain language. An app materialises with its data already bound and rules
attached. They run it. A result comes back.

- **The beat:** the app appearing. Not a pre-built app being opened — someone typing, and something
  existing that did not exist before.
- **Annotation fires:** as the app appears — `no code written`
- **Surfaces:** Studio → app lifecycle → app runs
- **Must be visible:** the typed sentence, in full, readable at 1440px.
- **This is the expensive shot and the one worth doing properly.** It is the claim buyers disbelieve
  most, and it makes the other four credible. The remaining four are click-throughs on existing
  screens; this one is a real build, recorded live.

### 4 · Review — 12s

A run executes and **stops mid-execution**. A person sees the context, edits a value, approves. The
run resumes and completes on its own.

- **The beat:** the pause. A run that stops by itself is the most under-demoed thing in AI right now.
- **Annotation fires:** at the pause — `waiting for a human`
- **Surfaces:** Review inbox → app runs
- **Must be visible:** the run status changing to paused, then back to running after approval.

### 5 · Operations — 10s

A live quality score drops on real traffic. Drift is flagged. The trace opens. Controls are shown
mapped to a framework.

- **The beat:** the flag.
- **Annotation fires:** at the flag — `caught before your users`
- **Surfaces:** Observability → pipeline drift → Regulatory
- **Must be visible:** the score before and after, so the drop is a change and not just a low number.

**Total: ~52s.** Long enough to tell the story, short enough that the loop restarts before anyone
leaves.

---

## Recording spec

- **Viewport** 1440×900, 2× DPR. Browser chrome cropped out — the page draws its own frame.
- **Capture** 60fps, deliver 30.
- **Cursor visible, and slow.** Human speed, not editor speed. This is the single thing that makes
  this pattern feel real rather than rendered.
- **One tenant per clip.** Cross-cutting between the bank and the insurer mid-flow reads as two
  different products.
- **Delivery:** one file per clip, H.264 **and** WebM, ≤3MB each, plus a **poster frame** per clip.

Self-hosting is fine and requires no config change — CSP already allows `media-src 'self'`
(`next.config.mjs`). No CDN. Only the active clip loads; the rest stay `preload="none"`. A
`prefers-reduced-motion` path falls back to the poster frames, which doubles as the fallback if a
clip fails to load.

## Traps — all of these are on screen today

1. **Internal hostnames.** The gateway screen shows `http://offgrid-s1.local:8800//v1`. Point the
   demo at the public host before recording. (Also note the `//v1` double slash.)
2. **Underlying engine names.** Several surfaces expose the open-source components underneath. Any
   frame showing one breaks the rule that we sell the outcome, not the mechanism.
3. **Synthetic data must read Indian BFSI** — INR, PAN, IFSC, Indian names, plausible
   banks/NBFCs/insurers. One `john.doe@acme.com` in frame undoes the "seeded bank and insurer"
   claim.
4. **No zero states.** An empty chart or a `0` in frame kills the shot. Seed before recording.
5. **No real customer data.** Obvious, but the demo tenants are the only safe source.

---

## User flows

The same five, ordered by **persuasion** rather than system order. This is the order to use in a
deck, a call, or any narrated walkthrough.

| # | Flow | Claim it proves | Why it lands |
|---|---|---|---|
| 1 | A department builds a working app by describing it | Non-technical staff create governed capability | The claim buyers disbelieve most, and the only one that reframes cost |
| 2 | An answer you can check | Grounded results with provenance | Kills "how do I trust it" with a click, not a paragraph |
| 3 | An unsafe action gets stopped | Control is enforced, not advisory | The moment a risk officer leans in. Show the refusal, not the success |
| 4 | A person decides the thing that needs judgment | Humans at decisions, not every step | Resolves "AI acting unsupervised" without slowing the demo |
| 5 | Quality slips and you find out first | Accountability over time | The difference between a pilot and production |

Flow 3 (an unsafe action blocked) has **no clip of its own** in the hero — Runtime and Operations
carry parts of it. If the hero ever grows to six pills, a Governance pill showing a guardrail firing
and the block landing in the audit trail is the one to add, and it is the strongest remaining shot.

---

## Status

- Brief written; **no footage recorded yet.**
- Pill/caption data **not yet in** `landing-copy.ts` — add `LANDING.hero.stages` when the hero shell
  is built, reusing `planes` names so nothing is restated.
- The hero shell can be built and verified against poster frames before any clip exists.
