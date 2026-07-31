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

## Gates

| Gate | Meaning |
|---|---|
| `VERIFIED` | A script in `test/e2e/` drives the UI and asserts the artifact. Evidence path in the row. |
| `WIRED` | Code and route exist; no script asserts the artifact. **Not** a claim that it works. |
| `GAP` | Absent, broken, or unscriptable. Unscriptable IS a gap. |

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
| 1 — Enterprise setup | GAP | — | — |
| 2 — Connect a data source | GAP | — | — |
| 3 — Create an app in natural language | GAP | — | clarifying questions are unit-tested; no UI script |
| 4 — Build from a template | GAP | — | — |
| 5 — Use an application | GAP | — | — |
| 6 — Review and approve | GAP | `flow6-review-approve.mjs` | `items=0 actionButtons=0 risk=false evidence=false` on /build/review — **queue is empty, so the flow is unproven, not proven-broken.** Needs a pending run seeded first; do not "fix" the page until an item exists. |
| 7 — Investigate failure | GAP | — | — |
| 8 — Compliance export | GAP | `flow8-compliance-export.mjs` | /governance/evidence/export is about **exporters** (Splunk/Purview/Grafana), not evidence packs: `"No exporters yet…"`. Either the flow lives elsewhere (`/governance/evidence`, `/governance/reports`) and my script targets the wrong route, or the pack generator does not exist. **Resolve which before touching code.** |
| 9 — Node intelligence | DESCOPED | — | founder parked OGAM/OGAD 2026-07-30 |

### §12 Technical table stakes

Each subsection below is expanded row-by-row as its script is written. Rows are only listed once a
script exists or a real attempt established it as unscriptable — an unexpanded subsection is `GAP`
wholesale, which is the honest default.

| Subsection | Rows | Gate |
|---|---|---|
| Deployment | 10 | GAP |
| Identity and access | 11 | GAP — `s12-identity-access`: 5 users render, role vocabulary absent from view. Verify whether roles are shown per user; if not, real defect. |
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
