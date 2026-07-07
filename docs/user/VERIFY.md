# How it all works together — and how to know it's actually working

*Documented + verified 2026-07-07.* Start here if you're asking **"is this thing actually
doing what it says?"** This page ties the console's surfaces together by the **outcome** each one
delivers, and — for every outcome — gives you the one signal, visible **in the console**, that
proves it's working end-to-end. No plumbing. Just: what you get, and how you know it's real.

## The one rule that matters

**Green on the screen is not the same as working.** A page can load, look healthy, and still be
quietly handing you an *approximation* instead of the real thing. That already bit us once: the
quality-scoring screen looked fine and reported scores — but it was silently using a **fallback**
scorer, not the real one, so the numbers were rough guesses dressed up as measurements. Nothing on
the page screamed. The only tell was a small **engine tag** on each result.

So we built the console to **tell you the truth about itself**. Every surface that depends on
something behind it will show you, honestly, whether it's running on the real thing or a stand-in:

- **Ready / real** — the genuine engine answered. Trust the result.
- **Fallback / heuristic** — the real engine isn't reachable, so you're getting a clearly-labelled
  approximation. Useful, but not the measurement you think it is.
- **Not configured / configure** — it can't run at all, and the console tells you what's missing.

**The result is never faked.** If the real thing can't run, the console says so — it does not prop
up a number to look good. When you see a fallback tag where you expected the real thing, that's a
**gap**, and it goes in [`../VERIFICATION_GAPS.md`](../VERIFICATION_GAPS.md) to be fixed — not
hidden.

## The shape of it, in one breath

One console is your control room. Everything you and your team do — chatting, building apps,
governing, monitoring — happens here, and **your data never leaves your own machines**. Behind the
console sit the moving parts (the AI models, your connected data sources, the quality and safety
checks). You don't operate those by hand. You **point the console at them and it does the work** —
and this page is how you confirm each of those connections is actually live.

## The outcomes — and the signal that proves each one

For every capability: **what you get**, and **how to confirm it's real** (something you do in the
console and watch for).

### 1. Chat that answers from *your* knowledge
**You get:** ask a question, get an answer grounded in your own documents — with citations.
**Confirm it:** ask Chat something only your ingested material would know, and check the answer
carries **citations** you can click back to the source. A cited answer is proof it actually read
your knowledge — not the model guessing. No citations on a question your docs cover → retrieval
isn't reaching your knowledge (a gap).

### 2. Apps you build in plain language that actually run
**You get:** describe a business process in words → a running, governed app (the 5 screens: build →
input → running → review → reports).
**Confirm it:** build a tiny app, give it an input, and watch a **real run appear** with real output.
If the app has a human-approval step, the run should **pause and wait** for you on the Review screen,
then continue after you approve. A run that finishes instantly *without* pausing on a step you marked
for approval means the approval isn't wired (a gap).

### 3. Every answer routed to a live model
**You get:** the console picks a healthy model node for each request, automatically.
**Confirm it:** send any Chat message and get a reply. The reply should show **which model
answered**. If chat hangs or errors, the model edge isn't reachable — check the Services page next.

### 4. Connected data sources that report *real* numbers
**You get:** your databases and systems wired in, so apps and Chat can use them.
**Confirm it:** open a connected data source and run a **sync**. It should report **real row counts**
(e.g. "16,850 rows"), not zero and not a spinner that never resolves. Zeros or errors mean the
connection is configured but not actually reaching the source (a gap).

### 5. Quality gates that really measure
**You get:** run your AI outputs through quality and safety checks that pass/fail against a threshold.
**Confirm it:** run any eval and look at the **engine tag** on the result. **Real** = it was truly
measured. **Fallback/heuristic** = you're seeing an approximation and the real scorer isn't wired.
If *everything* shows fallback, quality scoring isn't live — that's the exact trap from "the one rule"
above, and it's a gap worth fixing before you trust a pass-rate.

### 6. Guardrails that really redact
**You get:** sensitive data (names, IDs, card numbers) caught and masked before it flows on.
**Confirm it:** in a masking/guardrail rule, use the **preview** with sample text that contains a
fake SSN or email — the sensitive part should come back **starred out**. If the preview passes
sensitive text through untouched, masking is running on a weaker floor than you expect (a gap).

### 7. Everything you do is on the record
**You get:** an accountability trail of who did what.
**Confirm it:** take an action (create something, delete something), open the **Audit Log**, and see
**that action appear**, attributed to you, within moments. An empty or stale audit log after a real
action means logging isn't capturing writes (a gap).

### 8. Health you can actually trust
**You get:** an honest up/down view of every service the console depends on.
**Confirm it:** open **Services**. Each row is a live probe — **up** means the console genuinely
reached it just now. Treat any **down** as real: it means a capability that leans on that service
will be degraded. The Services page is your first stop whenever another signal above looks off.

## The 60-second whole-platform confidence check

Run this when you want to know the platform is live end-to-end, not just "deployed":

1. **Automated sweep** — from a machine that can reach the console, run `npm run smoke`. It logs in,
   then creates / reads / runs / deletes real entities across the main surfaces and prints
   **PASS/FAIL per check**. All PASS = the core plumbing is wired. Any FAIL names the surface.
2. **Services page** — every row **up**. Any **down** → note it; the capabilities that depend on it
   (§4–6 above) will show fallbacks.
3. **One real thing on each surface** — walk §1–7 above quickly: a cited chat answer, a tiny app run,
   a data sync with real counts, an eval with a **real** engine tag, a masking preview that redacts,
   an audit entry for something you just did. Each honest signal green = genuinely working.

If all three pass, you're not guessing — you've *seen* it work.

## When a signal says "not wired"

That's the system doing its job, not a failure of the console — it's refusing to lie to you. Log it
in [`../VERIFICATION_GAPS.md`](../VERIFICATION_GAPS.md) (what you saw, on which surface) and it gets
picked up and fixed with evidence. A fallback you know about is fine; a fallback you *don't* know
about is the only real danger, and these signals exist so that never happens.

## Per-surface detail

This page is the map. Each surface has its own guide with the full **What · Why · When · How ·
How to check it's working** — see the [operator guide index](README.md).
