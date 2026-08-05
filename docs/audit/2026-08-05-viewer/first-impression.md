# The First Five Minutes — viewer-demo audit

Audited as: a non-technical investor/angel, unguided, clicking the obvious things, at 1600px wide.
Both tenants: `--demo=insurer` (Suraksha Life, org_suraksha, role `viewer`) and `--demo=bank`
(Bharat Union Bank, org_bharat, role `viewer`), plus unauthenticated shots of the public landing page
and both `/signin` pages. Screenshots referenced below live alongside this file unless noted.

## Verdict for this section

Mixed, and the mix matters because this is the very first thing a stranger touches. The sign-in
credential box, the account menu's plain "VIEWER" label, and the `/overview` and `/work` information
architecture are genuinely good — a real, thought-through product, not a shell. But every one of
those good impressions is sitting three clicks away from a defect that would cost credibility on
sight: an unexplained acronym on the very first screen, a fully-armed "Add a data source" flow that
walks a viewer into a bare "Failed to add connector" toast, and — worst of all — the console's single
most important screen (`/overview`, on both tenants) prints either raw internal prompt/JSON text or a
literal unresolved PII-masking placeholder token in its "Recent activity" feed. None of these require
new engineering — they are copy, gating, and a rendering-field fix — but until they're fixed, an
unguided stranger reading `/overview` closely enough to trust it will hit at least one of them.

## BLOCKERS (cheapest first)

1. **Both `/signin` pages — "OGAC" shown twice, unexplained, before sign-in.**
   `suraksha-onprem-console.getoffgridai.co/signin`, `bharatunion-onprem-console.getoffgridai.co/signin`.
   Screenshots: `unauth/insurer_signin.png`, `unauth/bank_signin.png`. The top-left brand tag reads
   "Off Grid AI OGAC" and the sign-in card's own headline is just "OGAC" — an internal acronym with
   zero definition, where "Off Grid AI Console" would cost nothing and read as a real product. A
   stranger's very first data point about this company is an acronym they cannot parse. **Fix:**
   swap "OGAC" for the plain name in both spots — a two-line copy change.

2. **`/overview` (both tenants) — "Recent activity" prints a duplicated log line instead of real
   variety, on the bank tenant.** Screenshot: `scroll-overview-bank/scrolled-bottom.png`. The first
   four rows all read exactly `Cache check: what documents are required to support a reimbursement
   claim?` — no variation. Directly comparable to the insurer tenant's feed (finding 4, below), which
   shows five distinct, real-feeling claim rows. Both demo links go to strangers, and one home screen
   reads as recycled filler. **Fix:** de-duplicate consecutive identical seed rows, or collapse
   repeats into one row with a count.

3. **`/overview` (insurer tenant) — a masking placeholder token leaks to screen as a customer's
   name.** Screenshot: `scroll-overview/scrolled-bottom.png`, row: `THE REQUEST: Renewal due —
   [PERSON_fd7f1919], ₹69,000 premium TASK: Recommend a retention action`. `[PERSON_fd7f1919]` is an
   internal pseudonym placeholder that should have resolved to a display name before rendering. It
   both looks broken (a stray bracketed token on the homepage) and is a worse appropriateness smell
   than a real name would be — it visibly exposes the PII-masking mechanism, in the ugliest possible
   way, on the first screen a stranger sees. **Fix:** resolve the placeholder to its display alias
   before interpolating into the activity string, or drop the row if resolution fails — never print
   the raw token.

4. **`/overview` (insurer tenant) — the "Recent activity" feed prints raw internal prompt/JSON text,
   not a human summary.** Same screenshot as above. Rows read literally: `THE REQUEST: input: Death
   claim intimation received for policy SL-LIFE-5510288. Assess and route. raw:
   {"claimId":"CLM-2026-93006","policyN…` — prompt-scaffolding language ("THE REQUEST:", a dumped,
   truncated JSON blob) on the screen the founder is relying on to prove "everyday work into
   organizational intelligence." It reads as a debug log. **Fix:** render the existing human-readable
   summary field (the copy clearly has one — "Death claim intimation — policy SL-LIFE-5510288")
   instead of the raw prompt/JSON string.

5. **`/overview` → "Add data source" quick action → Operations → Configuration → Adapters → "Add"
   → fully-armed form → submit → 403 → generic red toast "Failed to add connector."** This is the
   exact top-severity pattern the brief calls out, reproduced end to end, three clicks from the
   first screen a viewer sees. Screenshots: `ff5-insurer/overview.png` (the "Add data source" quick
   action, no restricted-state styling), `click-add-postgres3/after.png` (the "Add PostgreSQL"
   panel — full emerald "enabled" submit button, no read-only notice anywhere in the panel),
   `click-submit-postgres/after-submit.png` (after filling a DSN and submitting: a small red toast
   reading only "Failed to add connector," no mention of viewer/read-only/permissions — reads as the
   product being broken). **Fix:** `useViewerMode()` already exists
   (`src/components/ViewerModeProvider.tsx`, currently zero consumers per the brief) — gate the
   "Add data source" quick action and every per-connector "Add" button behind it (disabled +
   "Viewers can't add connectors" tooltip), and have the connectors save-path surface the 403's
   reason in the toast instead of a generic failure string. This same armed-then-403 shape likely
   repeats on every other "Add X" button in the product; this is one proven, reproducible instance.

## RISKS

- **`/work/tasks` (insurer) — "Policy Underwriting Assist" shows "Personal loan application" cases.**
  Screenshot: `ff5-insurer/work_tasks.png`. Under a card titled "Policy Underwriting Assist" (an
  insurance-sounding app name, on the life-insurer tenant) the two open cases read "Personal loan
  application — Ishaan Kulkarni, ₹2,37,000" and "…Priya Sharma, ₹13,68,000" — a banking product,
  not an insurance one. It doesn't clear the BLOCKER bar (a stranger has no baseline for what
  Suraksha's apps should be named), but on a second look it reads as either a labeling mistake or,
  worse, hints at the two demo tenants' seed data bleeding together — exactly the category of thing
  the brief says to prove or disprove. Worth a five-minute check that this is a genuinely
  insurer-scoped app, just named/seeded oddly, and not literally bank data on the insurer's org.
- **`/overview` "Add knowledge" quick action lands on a page with no visible "add" control.**
  Screenshot: `click2-Add_knowledge/after.png`. The CTA promises "Add knowledge"; the destination
  (`/data/knowledge` Collections) shows one existing collection card and no "+ New collection"
  button anywhere in the viewport — the label over-promises relative to the landing page.
- **The 404 page drops the entire app shell.** Screenshot: `ff5-insurer/nonexistent-route-xyz.png`. Every other authenticated screen carries the persistent
  sidebar, header, and "READ-ONLY DEMO" banner; hitting a bad URL (e.g. `/build`, which genuinely
  404s — it's a route-group folder with no `page.tsx`) strips all of that and drops the stranger onto
  a bare, unbranded page with a single "Go to overview" button. The copy on it is calm and fine; the
  sudden loss of the whole product chrome is the jarring part.

## Appropriateness findings

- **Internal acronyms on the public marketing site.** The landing page's scroll-driven section
  navigator (bottom bar, footer area) labels its three phases "EDGE INTELLIGENCE (OGAM / OGAD /
  DATA)", "ENTERPRISE AI CONTROL PLANE (OGAC)", "OUTCOMES THAT MOVE THE BUSINESS" — three undefined
  internal product-line acronyms sitting in the nav of the page a stranger sees *before* they've
  even signed in. Screenshot: `unauth/crops/scrolled_1.png` area (bottom bar). Same family of defect
  as BLOCKER 1, just lower-traffic (a stranger has to scroll to the animated diagram to see it).
- **PAN + email shown in plaintext on the bank tenant's `/overview` activity feed** — row:
  `Summarise this applicant: PAN ABCDE1234F, email meera.malhotra@bharatunion.example.` (status:
  `blocked`). Screenshot: `scroll-overview-bank/scrolled-bottom.png`. On inspection this is very
  likely an intentional *demonstration* that the guardrails caught and blocked a PII-bearing prompt
  (`bharatunion.example` is the reserved fictional TLD, and the row is tagged "blocked", i.e. the
  system did the right thing) — so I don't believe this is a real leak. But the raw PAN-format
  string and a full email address are still rendered, unmasked, in a homepage activity list purely
  as request-preview text, which is a bad habit to have in the UI even when the underlying data is
  synthetic. Recommend masking the request preview text itself, not just blocking the outcome.
- No OSS engine name (Ragas, LLM Guard, OpenSearch, Langfuse, Redis, LiteLLM, OPA, Kestra, etc.),
  private IP, hostname, container name, or raw connection string was seen anywhere in this section's
  screens — `/signin`, `/overview`, `/work`, `/docs`, the nav, the account menu, the 404 page, or the
  landing page. That is a genuinely clean result given the brief's explicit warning that one such
  leak was live the same day.
- No other tenant's data was visible from either tenant in anything shot for this section.

## What is genuinely strong here

- The `/signin` "READ-ONLY DEMO" box (both tenants) is well done: plain-language explanation of what
  a viewer can and cannot do, copy-to-clipboard email/password, no amateur feel at all.
- The account/user menu states the role in plain text — "VIEWER" — right under the email. Honest,
  reassuring, exactly what this audience needs to see before they start clicking. Screenshot:
  `usermenu-insurer/usermenu.png`.
- `/overview` on both tenants is a real, personalized, non-zero dashboard: "Welcome back, Suraksha" /
  "…Bharat", a "4 cases are waiting for you to decide" callout with a real oldest-wait-time, a
  governance-posture row that explains its own zeros in words ("nothing stopped — all clear") rather
  than presenting naked zeroes, and a services list that is genuinely 7/7 up with real latencies.
- `/work` on both tenants is populated with tenant-appropriate, plausible project names (insurer:
  Indemnity claims review, Motor FNOL intake; bank: Collections — 90 DPD book, KYC re-verification
  drive) and real dates/conversation counts — this is not a "click New to get started" dead end on
  either tenant.
- `/work/tasks` "Who is covering" panel explains its empty state in words ("Nobody is marked away.
  If someone goes on leave, say so here…") instead of just showing nothing — the right pattern,
  applied correctly.
- Dark mode (toggled from `/overview`) is clean and fully on-brand — no unstyled flashes, no
  contrast failures. Screenshot: `theme-insurer/dark.png`.
- The primary nav (Overview, Work, Solutions, Data, AI Runtime, Governance, Insights, Operations) is
  entirely plain business language — no OSS engine name, no dead top-level item, and `/build` (which
  has no `page.tsx`) correctly 404s with a calm, on-brand error page rather than crashing.
- `docs/` (linked as "API docs & playground" at the bottom of the sidebar) opens to genuinely
  well-written, outcome-first product copy ("Think of it as AWS for AI") with a real embedded
  console screenshot — reads as a real company, not scaffolding.

## LATER

- The embedded console screenshot inside `/docs` shows "POLICY ENGINE: ABAC" where the live product
  now says "Policy-as-code" — a stale doc screenshot, cosmetic only.
- `/docs` page content column doesn't use the full 1600px width even accounting for the nav + TOC
  columns — noticeable but is a reading-column page, lower priority than the console's data screens.
- "AI Runtime" as a nav label is milder jargon than an OSS engine name but still more technical than
  the rest of the nav's plain language; consider whether a business reader parses it on sight.
- The landing page's animated "OGAM/OGAD/OGAC" scroll section has large solid-black gaps between
  some sub-sections in a scripted scroll-through capture; could not fully rule out this being a
  capture artifact of a scroll-pinned animation rather than a real layout bug in a live session — flag
  for a human to scroll through once and confirm either way.
