# Evidence ledger — §12 table stakes and §10 flows, gated by a script

**The rule that makes this document worth reading.** A row is `VERIFIED` only when a replayable script
drives the REAL UI with REAL keystrokes and asserts on the artifact a user actually reads. The gate is
whatever the script says. My opinion is not an input. Where no script can be written, the row is `GAP`
by definition — not "probably fine", not "wired".

**Why it exists.** Every row I marked done this session got worse the moment the founder looked at it:
a citation footer reading `[1] source — part 1 · 0%` under a swept-and-signed-off module, an "all apps
have evaluations" claim off a `count(*)`, a "fixed" verdict off `grep -c`. The common shape is a proxy
reported as the goal. A script that reads the terminal artifact cannot make that substitution, so the
ledger cannot be more optimistic than the evidence.

## Row 1 status after the data fix — GAP (identity ceiling), cause identified

The fabricated citation payloads ARE gone. Verified in the database, not inferred:

```
messages with a linkable docId: 21          remaining "governed source" placeholders: 0
{"name":"Death-Claim Assessment SOP","docId":"00dfde9e-…","collectionId":"d93bff10-…",
 "position":0,"score":0.93}
```

`scripts/fix-seeded-citations.sql` (committed, replayable) matched each answer to a TOPICALLY correct
document from its own text — claims SOPs for the hospitalisation answers, the reimbursement policy for
the Training-quota answer, KYC documents for re-verification — because citing a real-but-irrelevant
document is the same lie in a better costume. The 9 messages that matched nothing were set to **no
citation** rather than a wrong one.

**The e2e row is still GAP, and the reason is identity, not rendering.** The script deep-links to
`conv_634a202ae6c5` — the exact conversation in the founder's screenshot — and reads no citation row.
That screenshot was taken as `mac@wednesday.is`; **chats are per-user scoped and the harness signs in as
`demo-bank`, so it sees an empty page.** The script is right and is looking at a conversation it is not
permitted to see.

To promote: point `CONV_ROUTE` at a conversation owned by the harness identity, or seed one. Two
corrections belong here, both mine:
- I reported "only 3 messages in the entire database have citations". That was my own `LIMIT 3` reported
  as a finding about the product. It was **30**.
- I deployed the renderer fix as though it addressed the founder's screenshot. It did not — the data did.
  The renderer work is correct and independent.

## The identity ceiling — why some rows CANNOT be promoted yet

Every demo identity configured on the box is a **viewer**:

```
OFFGRID_DEMO_VIEWER_EMAIL / _PASSWORD
OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL / _PASSWORD
OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL / _PASSWORD
```

There is no editor or admin credential, and `AUTH_DEV_LOGIN=false` in production. So **any row whose
proof requires a WRITE is unprovable by this harness today** — not because a script is missing, but
because no identity exists that is permitted to perform it. Those rows read `GAP (identity ceiling)`
and the correct next action is to provision a demo editor account, which is a seed/infra change rather
than product code.

This is the honest shape of the remaining work, and it is worth stating precisely because the
alternative is what I did three times on Flow 3: read a correct refusal as a broken feature. The
surfaces refuse cleanly and explain themselves — `"This account can explore the Builder but cannot make
changes."` A viewer-only harness can verify that governance WORKS; it cannot verify what governance
forbids it from doing.

Affected: Flow 3 (compile an app), Flow 6 (act on a review), Flow 8 (generate a pack), the create/rotate
controls under Security, and Row 1 (a chat owned by the harness identity).

### Exactly how to lift it

Passwords authenticate through **Keycloak ROPC** — `src/auth.config.ts` → `authenticatePassword()`, not a
DB row — so this is a Keycloak user creation, not a seed insert:

1. Create a Keycloak user in the console realm, e.g. `demo-editor@getoffgridai.co`, password set,
   email-verified, with the group/role that maps to an **editor** (see `src/lib/tenancy.ts` for the claim →
   role mapping, and `deploy/keycloak/` for the realm config).
2. Add `OFFGRID_DEMO_EDITOR_EMAIL` / `_PASSWORD` to `.env.local` on the box (runtime config, never in git).
3. Run the write-path rows against it: `DEMO_USER=demo-editor@getoffgridai.co npm run e2e`.
   `signIn()` already takes the identity as a parameter, so no script changes are needed.

Do NOT lift it by relaxing a permission check to make a test pass. The refusals are the product working;
five GAPs are the honest price of not having an identity permitted to do the thing.

## Gates

| Gate | Meaning |
|---|---|
| `VERIFIED` | A script in `test/e2e/` drives the UI and asserts the artifact. Evidence path in the row. |
| `WIRED` | Code and route exist; no script asserts the artifact. **Not** a claim that it works. |
| `GAP` | Absent, broken, or unscriptable. Unscriptable IS a gap. |
| `GAP (identity ceiling)` | A script exists and runs, but proving the row needs a write and only viewer credentials exist. Unproven, NOT broken — see the section above. |
| `GAP (target unresolved)` | A script exists but has not been pointed at the right route yet. Says nothing about the product. |

## Harness rules (learned the hard way, non-negotiable)

1. **Never `fill()` a React-controlled input.** It sets the DOM value without updating state, so the
   app's own guard fires and the test reports a product defect that does not exist. This cost a
   fabricated `CONFIRMED` gap (G-195, withdrawn). Use `pressSequentially`.
2. **A test asserting "nothing happened" must first prove it can make something happen.**
3. **Never assert on a word that can match when the feature is absent.** `getByText(/^Sources$/i)`
   returned 1 on a page with no assistant answer at all. Assert on the ROW — the `<li>` carrying a
   `[n]` marker, its link, its href.
4. **Assert the crossing, not the sides.** Seven boundary bugs this session typechecked because both
   sides were individually correct while the field was dropped in transit.
5. **A failure must never present as emptiness.** Any row whose script cannot distinguish "we could not
   measure" from "the answer is zero" is `GAP`.
6. **Read the screenshot.** A green typecheck, an HTTP 200 and a row count have never once told anyone
   whether a screen makes sense.

## Targets resolved — and three REAL candidate defects fall out

Re-ran the four unresolved-target rows against their correct routes. One passed; the other three now
point at the product rather than at my regex, which is the distinction this ledger exists to make.

```
VERIFIED  s12-developer-experience  /operations/api-docs  17 rows, "public API surface, grouped by area"

WITHDRAWN — flow3-natural-language-app was NOT a defect. Twice.
  Final state: `GAP  refused (disabled=true) — Flow 3 needs a WRITE-CAPABLE identity; set DEMO_USER to an
  editor. Refusal wording: "This account can explore the Builder but cannot make changes."`

  The product is CORRECT. `AppBuilder.tsx:820` renders `{!canCreate ? <p>{accessMessage}</p> : null}` and
  `builder-surface-access.ts` supplies the sentence above. The control is disabled because the identity is
  read-only, and the surface explains exactly that. Nothing to fix.

  I reported this as a defect twice, escalating each time, and was wrong both times:
  1. "compile produced nothing in 90s" — a loose `/build/i` had matched the sidebar's **Build nav item**, so
     the script clicked navigation and fired zero requests.
  2. "disabled and never says why" — my verdict quoted the first 170 characters of the page and the
     explanation sits below that. Then my `explained` regex missed the real wording too, and only the
     sentence I extracted for the verdict revealed the message was present all along.

  THE PATTERN, stated plainly because it is the whole reason this ledger exists: three times in one row I
  reported the product broken when my instrument was wrong — a mis-scoped locator, a truncated sample, an
  over-narrow regex. Each felt like evidence. **A GAP means "my script did not see it", and only a resolved
  target plus a read artifact can turn that into a claim about the product.** Any row I promote to DEFECT
  without both is worth less than nothing, because it sends someone to fix working code.

  To make Flow 3 provable: run it as an editor identity (`DEMO_USER=<editor> npm run e2e flow3`). Until an
  editor account is wired into the harness the row stays GAP — unproven, NOT broken.

CANDIDATE DEFECT  s12-security-secrets  /governance/secrets/mounts
  5 mounts render with PATH / TYPE / DESCRIPTION, and there is NO create/enable/rotate control. Per the
  full-CRUD rule in CLAUDE.md a read-only management page is the bare minimum, not a finished feature.

CANDIDATE DEFECT  s12-identity-access  /governance/access
  5 user rows, a Roles column header, and no role VALUES anywhere in the text. The column exists (that
  part of my earlier correction stands) but the users may carry no roles — on an access-control page that
  is worth confirming against the DB before assuming the UI is at fault.

STILL UNRESOLVED TARGET  s12-security-egress
  /runtime/api-budgets rendered the KEYS page ("API keys and credentials"). §12's egress control has not
  been located yet. Not a verdict on the product.
```

## §10 flow run (`test/e2e/flows.mjs` + `flow3-natural-language-app.mjs`)

```
VERIFIED  flow1-enterprise-setup      /governance/access     136 rows, identity + "Email Name Status Roles Actions"
VERIFIED  flow2-connect-data-source   /data/integrations     147 rows, 24 controls, adapter wiring visible
VERIFIED  flow4-build-from-template   /solutions/library     130 rows, reusable BFSI blueprints w/ owner+outcome
VERIFIED  flow5-use-an-application    /solutions/apps        160 rows, 26 controls
VERIFIED  flow7-investigate-failure   /build/apps/runs       529 rows, 201 controls, 3/3 queues ready
VERIFIED  s12-deployment              /operations            146 rows, service health + restart/probe
GAP       flow3-natural-language-app  /build/studio          no description input — TARGETING: the composer is
                                                             likely /solutions/apps/new or /solutions/apps/forge
```

### CORRECTION — `s12-identity-access` was my error, not a defect

Last turn I flagged it as "may be a real defect — 5 users render and no role vocabulary appears."
`flow1-enterprise-setup` hits the SAME route and reads `Email Name Status **Roles** Actions` with 136
rows. The Roles column exists. My `must` pattern demanded role VALUES (`admin|editor|viewer|member`)
which the demo users may not use, and I reported the page as suspect on the strength of my own regex.

Recorded because it is the session's defect in miniature: an assertion that fails tells you about the
assertion first. A GAP is a question, never a verdict on the product.

## §12 subsection run (`test/e2e/s12-surfaces.mjs`, 10 rows)

```
VERIFIED  s12-observability-traces  /insights/ai            TRACE RECORDS 100, governed count, 4 rows
VERIFIED  s12-model-operations      /runtime                gateway/provider + readiness state
VERIFIED  s12-agent-operations      /build/agent-runs       203 rows, 3/3 queues ready, re-probe control
VERIFIED  s12-data-connectors       /data                   7 rows, 9 management actions
VERIFIED  s12-reliability-health    /operations             service health + state vocabulary
VERIFIED  s12-policy-decisions      /governance/policies/decision-logs  DECISIONS 1 ALLOWED 0 DENIED 1
GAP       s12-identity-access       /governance/access      5 users render; role vocabulary not in view
GAP       s12-security-egress       /governance/egress      15 rows but page is CLOUD-MODEL egress, not
                                                            network destination allowlists; acts=0
GAP       s12-security-secrets      /governance/secrets/overview  REACHABLE Yes + SEAL STATUS render, but
                                                            no create/rotate control on the overview
GAP       s12-developer-experience  /docs                   user docs, not the API surface
```

**Three of those four GAPs are almost certainly MY TARGETING, not the product** — and saying so is the
point of the two-cause rule above. `/docs` is user documentation; the API surface is the sidebar's "API
docs & playground". Secrets create/rotate lives on the sub-pages (`/mounts`, `/keys`), not the overview.
`/governance/egress` governs which outside MODELS may be used, which is a different claim from §12's
network egress control. Each needs its route resolved before a single line of product code is touched.
`s12-identity-access` is the one to check first — 5 users render, so if roles genuinely are not shown
next to a user, that IS a defect worth fixing.

## Current run

```
2/5 rows VERIFIED · 3 GAP        (npm run e2e)
VERIFIED  s12-audit-trail        rows=50 attributed=true · 200 events / 7 actors / 38 actions
VERIFIED  s12-evaluation         definitions=46 score=true threshold=true runControl=2
GAP       citation-provenance    no citation row rendered within 90s
GAP       flow6-review-approve   items=0 — empty queue, flow unproven (not proven-broken)
GAP       flow8-compliance-export  route holds exporters, not evidence packs — target unresolved
```

**A GAP has two very different causes and the ledger must say which:** the feature is absent, or the
script could not reach it (wrong route, no data). Conflating them is how a healthy surface gets
"fixed" and a broken one gets excused. Each GAP row below states which it is.

## Ledger

Status of every row is `GAP` until a script promotes it. Scripts live in `test/e2e/<row-slug>.mjs` and
are runnable individually; `npm run e2e` runs the suite and prints the gate per row.

### §10 Flows

| Flow | Gate | Script | Evidence |
|---|---|---|---|
| 1 — Enterprise setup | VERIFIED | `flows.mjs` | /governance/access — 136 rows, identity providers + per-user Roles column + invite control |
| 2 — Connect a data source | VERIFIED | `flows.mjs` | /data/integrations — 147 rows, 24 controls, adapter wiring + status visible |
| 3 — Create an app in natural language | GAP | `flow3-natural-language-app.mjs` | no description input at /build/studio. **TARGETING** — retry at /solutions/apps/new and /solutions/apps/forge before concluding anything |
| 4 — Build from a template | VERIFIED | `flows.mjs` | /solutions/library — 130 rows of reusable BFSI blueprints carrying owner + outcome hypothesis |
| 5 — Use an application | VERIFIED | `flows.mjs` | /solutions/apps — 160 rows, 26 controls |
| 6 — Review and approve | GAP | `flow6-review-approve.mjs` | `items=0 actionButtons=0 risk=false evidence=false` on /build/review — **queue is empty, so the flow is unproven, not proven-broken.** Needs a pending run seeded first; do not "fix" the page until an item exists. |
| 7 — Investigate failure | VERIFIED | `flows.mjs` | /build/apps/runs — 529 rows, 201 controls, 3/3 queues ready |
| 8 — Compliance export | GAP | `flow8-compliance-export.mjs` | /governance/evidence/export is about **exporters** (Splunk/Purview/Grafana), not evidence packs: `"No exporters yet…"`. Either the flow lives elsewhere (`/governance/evidence`, `/governance/reports`) and my script targets the wrong route, or the pack generator does not exist. **Resolve which before touching code.** |
| 9 — Node intelligence | DESCOPED | — | founder parked OGAM/OGAD 2026-07-30 |

### §12 Technical table stakes

Each subsection below is expanded row-by-row as its script is written. Rows are only listed once a
script exists or a real attempt established it as unscriptable — an unexpanded subsection is `GAP`
wholesale, which is the honest default.

| Subsection | Rows | Gate |
|---|---|---|
| Deployment | 10 | partly VERIFIED — `s12-deployment`: /operations, 146 rows, service health + restart/probe controls. |
| Identity and access | 11 | partly VERIFIED — `flow1-enterprise-setup` reads `Email Name Status Roles Actions` over 136 rows. The earlier `s12-identity-access` GAP was my regex, not the product (see CORRECTION). |
| Security | 17 | GAP — two rows scripted, both unresolved-target (see run above). Egress + secrets routes need resolving. |
| Reliability | 14 | partly VERIFIED — `s12-reliability-health`: service health + state vocabulary on /operations. |
| Data | 13 | partly VERIFIED — `s12-data-connectors`: 7 rows, 9 management actions on /data. |
| Model operations | 17 | partly VERIFIED — `s12-model-operations`: gateway/provider + readiness on /runtime. |
| Agent operations | 14 | partly VERIFIED — `s12-agent-operations`: 203 runs, 3/3 queues ready, re-probe + cancel controls. |
| Evaluation | 15 | **partly VERIFIED** — `s12-evaluation.mjs`: `definitions=46 score=true threshold=true runControl=2`. Golden datasets / quality thresholds / release-gate surface all render measured values. Remaining rows in the subsection still GAP. |
| Observability | 13 | partly VERIFIED — `s12-observability-traces`: TRACE RECORDS 100 with governed split on /insights/ai. |
| Compliance | 10 | **partly VERIFIED** — `s12-audit-trail.mjs`: `rows=50 attributed=true`, 200 events / 7 actors / 38 actions, each row carrying actor+action+outcome. "Immutable or append-only audit trail" is evidenced. Remaining rows still GAP. |
| Developer experience | 15 | GAP — `s12-developer-experience` targeted /docs (user docs). Retarget at the API playground. |

### Row 1 — Citation provenance (§8I "Cited", §12 Observability "Data lineage", §9 "Trust through visibility")

**Gate: GAP — by script, not by opinion.** `npm run e2e citation` reports:

```
GAP  citation-provenance  no citation row rendered within 90s — the answer carried no provenance
```

Script: `test/e2e/citation-provenance.mjs`. It signs in, types a real question by keystroke into a
knowledge-bearing chat, and asserts the citation `<li>`: that it names a document, that the name is a
followable link matching `/data/knowledge/…` or `/work/projects/…`, and that no `0%` appears. All three
must hold; the verdict quotes the row text and href it read.

**ROOT CAUSE FOUND, and it is not the renderer.** The persisted citations in the demo data are
placeholders I seeded myself:

```json
[{"ref":"pipeline context","source":"governed source"}]
```

No `name`, no `docId`, no `position`, no `score` — from `scripts/seed-workspace-demo.sql`. The old
renderer dressed these up as `[1] source · part 1 · 0%`; the new renderer degrades honestly to
`Unnamed document`. Both are wrong for a compliance surface: a fabricated provenance claim in the
account buyers are shown.

Ruled out with a query, so nobody re-investigates it: the documents DO have names — 35/35 in
`org_knowledge_docs`, e.g. `KYC Master Direction (RBI) v3.2.pdf`. Ingest is fine.

Also true and worse: only **3 messages in the entire database carry any citations at all**, so
"Private conversations grounded in approved company context" — the subtitle on that very page — is not
demonstrable from the demo data.

**To promote:** replace the seeded citation payloads with joins against real `org_knowledge_docs` rows
(name, docId, collectionId, position, score), re-seed, and re-run the script until it prints VERIFIED.

The display layer and both retrievers now carry document identity, and the fabricated name / false `0%`
/ internal chunk index are gone — but that is `WIRED`, not `VERIFIED`, and the visible result is still
useless to a reviewer. Honest beats false; neither is finished.

Open question that decides where the real defect is, **unanswered**: do the knowledge documents have
names at all? If `org_knowledge_docs.name` / `chat_documents.name` are empty, the footer is a symptom
and the defect is at ingest. Blocked on a working DB client on the box — `psql` is absent and a script
in `/tmp` cannot resolve `pg` (must run from `~/console` so node resolves `node_modules`).

**Promotion requires:** a script that signs in, sends a real question by keystroke into a
knowledge-bearing chat, waits for the assistant row, and asserts the citation `<li>` contains a named
document, an `href`, and either a real percentage or no percentage at all.
