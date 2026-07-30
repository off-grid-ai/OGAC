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

## Honesty bar

Report the gate, never inflate. A screenshot you did not read is not a verified screen — and a DB count is not
a verified surface. Both mistakes were made in one session; the founder caught the second one by opening the
page himself.
