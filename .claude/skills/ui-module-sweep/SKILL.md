---
name: ui-module-sweep
description: Visually test the console ONE MODULE at a time — enumerate its routes from the router, screenshot every route and in-page state, click the buttons, fix what does not make sense, mint replayable e2es, then report. Use when there is no queued work; this is the fallback activity, never a substitute for a real task.
---

# UI module sweep

Founder's instruction, verbatim in intent:

> "The moment you run out of work, start visual testing… figure out all the different routes, child routes,
> grandchildren routes in the application, take screenshots of those and validate whether they make sense…
> click on each of the different buttons and see if it's doing the right thing. That's the only way. And you
> have to break it by module. Finish off one module completely, mint the e2es for it, make it replayable, fix
> all the issues, then give a report. Then move to the next and follow the same process. **But do this only
> when you don't have work.**"

## When to run this

**Only when the queue is empty.** It is the fallback, not a detour from real work. If there is a live defect,
a founder request, or a roadmap item in flight, do that instead.

## The rule that makes this worth doing

**Enumerate from the router. Never type a route from what a screen is called.**

In one session, four invented URLs came back 404 and were nearly filed as four product defects; guessed table
names produced three more false findings. A sweep that invents its own targets manufactures findings, which is
worse than not sweeping. Same for tables and API paths: read `src/app/api`, read `src/db/schema.ts`.

## Use the existing harness

`scripts/sanity-crawl-v2.mjs` already does the crawl: static routes, dynamic templates × ids discovered from
list-page anchors, in-page `[role=tab]` / subnav state clicks, BFS anchors, and a mobile pass at 390×844. It is
READ-ONLY — it never clicks Save/Delete/Run.

`scripts/ui-sweep.mjs --emit` generates the two input files it expects (`STATIC_ROUTES`, `DYNAMIC_TEMPLATES`)
straight from `src/app`, so the route list is never hand-maintained.

Do not write a third crawler. Extend one of these.

## Per-module procedure

1. **Enumerate** — `node scripts/ui-sweep.mjs --list --module <name>`. Record the count; it is the denominator
   for the report.
2. **Crawl + screenshot** every route and every in-page state, desktop and mobile.
3. **Read every screenshot.** This is the part that cannot be automated away — today's real defects were found
   by looking, not by assertions: raw JSON where a table belonged, a heading contradicting its own query,
   a scope selector rendered as a project, a button pushed off-screen by a missing `min-w-0`.
4. **Exercise the buttons** a reader would press. Non-destructive first (tabs, disclosures, filters, pagination).
   Destructive ones (Save/Delete/Run/Publish) only against a disposable entity you created for the purpose.
5. **Fix what does not make sense**, at the source. A heading that disagrees with its query is a code bug, not
   a copy bug.
6. **Mint the e2e** so the fix is replayable: assert the CROSSING, not the sides — the thing that actually broke.
7. **Report** (below), then move to the next module.

## What counts as "does not make sense"

Each of these was a real defect, so treat each as a checklist item:

- **Raw JSON on screen** where a person must read data (`[{"id":1,…}]`, `{"columns":[…],"rows":[[…]]}`).
- **A heading that contradicts its query** — "for this pipeline" while filtering by app id; "All chats"
  filtering to chats with *no* project.
- **Engineering vocabulary**: `connector-query`, `data-domain`, raw ids, `mysql`, `langfuse`, `opensearch`,
  and any OSS product name. Ratchet: `scripts/check-hero-vocabulary.mjs`.
- **Empty state that is actually a bug** — "0 attached" / "(0)" while the data exists under a different scope.
  Always check the DB before believing an empty state, and check the QUERY before believing the DB.
- **Placeholder content presented as real** — "sample query 3" expecting the pipeline's own name. Worse than
  empty: it averages meaningless rows into a score.
- **Layout**: content pushed outside its container (missing `min-w-0` on a flex child), a full-page
  `mx-auto max-w-2xl` wasting a wide screen, horizontal body scroll.
- **Duplicate entries** in a picker — usually a filter that is broader than its label
  (`listEvalDefs(null)` meaning "any row with no app" rather than "the library").
- **A score with no evidence behind it** — "3/3 passed" that cannot name the three rules.

## Report format

```
MODULE: <name>          routes <n> (static <a>, dynamic <b>)   states captured <c>
FIXED       — defect → root cause → the assertion that now guards it
OPEN        — defect → where it is → why it was not fixed
NEEDS OWNER — decisions only a human can make (data, policy, ambiguity)
E2E         — spec files added, and what property each pins
```

State the denominator. "Swept 23 of 23 Workspace routes" is evidence; "swept Workspace" is not.

## The verification standard (founder, 2026-07-30)

> "You're supposed to verify as a principal UI/UX specialist that has spent 20 years building enterprise
> products for BFSI and regulated ecosystems — whether this makes sense, is consistent, easy to understand,
> and the best user experience."

**This is a judgement, not a measurement.** The failure mode it corrects, which recurred four times in one
session: verifying the cheapest observable that plausibly correlates with the goal, then reporting the GOAL as
verified.

| What was checked | What was claimed | What was actually true |
|---|---|---|
| `grep -c min-w-0` | "the sheet is fixed" | The class was present; the sheet still rendered wrong |
| `count(DISTINCT app_id) = 11` | "all apps have evals" | Rows existed; the surface showed "0 attached" |
| Add button's x ≤ viewport width | "fixed" | Inside the viewport, and still visually crude |
| `OK: /signin 200` | "deployed" | One route answered; a committed fix was never built |

Every one of those is the same defect this codebase keeps producing — a proxy standing in for evidence. A score
with no cases behind it. A green gate that cannot name its rules. "Sent" for mail that never left.

**So ask, of every screen, in this order:**
1. **Does it make sense?** Would a department user know what this is for without being told?
2. **Is it consistent?** Same spacing, control heights, empty-state treatment and vocabulary as its siblings.
   Mismatched control heights read as broken before anyone reads a word.
3. **Is it easy to understand?** Is the primary action obvious, and does every label mean what it says?
4. **Is it the best experience available?** Not merely "not broken" — a functional screen that looks crude is
   not done in a regulated enterprise product, where the UI is the trust signal.
5. **Would a BFSI reviewer trust it?** Placeholder data, an unexplained refusal, or a number with no evidence
   behind it destroys that trust faster than a missing feature.

A measurement can support this judgement. It can never replace it. "The button is inside the viewport" is not
"this is a good panel."

## Honesty bar

Report the gate, never inflate. A screenshot you did not read is not a verified screen — and a DB count is not
a verified surface. Both mistakes were made in one session; the founder caught the second one by opening the
page himself.

## The blind spot that made a swept module still broken: routes are not artifacts

I swept Workspace by enumerating routes and screenshotting them, reported the module done, and the
founder then found `[1] source — part 1 · 0%` under a grounded chat answer within minutes. A citation
that named no document, showed an internal chunk index, asserted 0% relevance for a source it was
citing, and could not be clicked.

**It was never in a single screenshot I took, because it does not exist until a run produces it.**
Route enumeration captures SHELLS — the page, its empty state, its panels. The thing an operator
actually reads and is asked to trust is GENERATED: an answer with citations, a run's step evidence, a
compiled spec, a review's risk levels, an exported report, a delivered email. A sweep that only visits
URLs will pass a module whose entire output layer is wrong.

So a module is not swept until, for every surface that produces output, the sweep has **caused real
output to exist and then read it**:

- Send a message that actually retrieves, and read the citation footer — names, links, scores.
- Run an app end to end, and read every step's evidence panel, not just the run list.
- Trigger the empty, the partial, and the failed variant. A failed read must never render as "no rows"
  and an unknown number must never render as `0`.
- Follow every link the artifact offers. A link that 404s or points at an id of the wrong kind is the
  same defect as no link — I linked to `/data/knowledge/[id]` only after checking that `[id]` is a
  COLLECTION id, because I had already invented four URLs earlier in the session.

If a surface's output cannot be generated in the sweep, say so in the report as an unswept surface.
Do not let "all routes screenshotted" stand in for "the module works" — that is the same
proxy-for-the-goal substitution this skill's first section is about, one level up.
