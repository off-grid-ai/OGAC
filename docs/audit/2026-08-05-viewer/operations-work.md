# Operations & Work — viewer-demo audit

Shot from `/Users/user/wednesday/off-grid-ai/console` with `scripts/audit-shoot.mjs` (and two small
custom Playwright scripts for scroll/detail pages built the same way — same login flow, same demo
creds) at 1600px. Signed-in confirmations from the harness:

- insurer: `demo-insurer@getoffgridai.co`, role `viewer`, org `org_suraksha` (Suraksha Life) at
  `suraksha-onprem-console.getoffgridai.co`
- bank: `demo-bank@getoffgridai.co`, role `viewer`, org `org_bharat` (Bharat Union Bank) at
  `bharatunion-onprem-console.getoffgridai.co`

Screenshots in `.../scratchpad/audit-viewer/insurer/`, `/bank/`, `/insurer-detail/`, `/bank-detail/`.

## Verdict for this section

Work is the stronger half by a wide margin, and its best screen (`/work/tasks`, "My tasks") is
genuinely demo-ready. Operations is where this pass earned its keep: it surfaces the single most
severe class of finding in the whole audit — a platform-wide tenant list visible from BOTH tenants'
"read-only" logins, plus a second, independently-confirmed leak in Work's Artifacts/Prompts stores,
plus real infrastructure (admin usernames, absolute paths, `.local` hostnames, `launchd`/`plist`
internals, raw env var names) sitting in plain text on several Operations screens, plus one tenant
(bank) hitting a bare error banner on Edge. None of this is cosmetic. A technical buyer who spends
five minutes in Operations on either link right now will conclude the isolation story is not real —
that is a worse outcome than any amount of "looks unfinished." Fix the two leaks and the raw-infra
exposure before either link goes out again; everything else here is genuinely fixable in an afternoon.

## BLOCKERS (ranked, cheapest-first within each severity tier; the two leaks are tier 0 regardless of cost)

1. **CROSS-TENANT LEAK, CONFIRMED, WORST FINDING OF THE AUDIT — `/operations/admin/tenants` shows
   EVERY tenant on the platform, including a THIRD organization's name and internal host, to a
   viewer who is supposedly scoped to one tenant.**
   Screenshots: `insurer-detail/operations_admin_tenants.png` and
   `bank-detail/operations_admin_tenants.png` — byte-for-byte identical. Signed in as
   `demo-insurer@` (Suraksha Life) OR `demo-bank@` (Bharat Union Bank), Operations → Admin → Tenants
   renders a full "Tenant provisioning" table listing all three tenant orgs on this platform side by
   side: **Suraksha Life** (`suraksha-onprem-console.getoffgridai.co`, enterprise plan, its module
   list), **Bharat Union Bank** (`bharatunion-onprem-console.getoffgridai.co`, enterprise, its own
   different module list), and **Wednesday Solutions**
   (`wednesdaysol-onprem-console.getoffgridai.co`, standard plan, its module list) — a name that does
   not appear anywhere else in either demo tenant's data and reads as a real internal/other-customer
   org, not a fixture. A stranger with a public read-only link to ONE customer's demo can see that
   two OTHER named organizations exist, their internal console hostnames, their plan tier, and their
   feature entitlements. The page also renders a live "Add tenant" button and a delete (trash-can)
   icon per row — full tenant-lifecycle super-admin controls — armed and visible to a viewer.
   Why this outranks the Work leak below: it doesn't just show another tenant's *content*, it exposes
   the *existence and identity of other named customers* — the thing every one of these public demo
   links is supposed to keep private from the others. Smallest fix: this route/API must filter to the
   caller's own org (or 403 entirely for the `viewer` role, the same way other admin-only actions are
   already gated) — same root-cause shape as the other tenant-scoping bugs, but here the missing
   filter sits on the master tenant registry itself, so it is the highest-priority one to close.

2. **CROSS-TENANT LEAK, CONFIRMED WITH SIDE-BY-SIDE PROOF — `/work/artifacts` is pixel-identical on
   both tenants, and it is bank-flavored content sitting on the insurer's account.**
   Screenshots: `insurer/work_artifacts.png` vs `bank/work_artifacts.png`. Both show the exact same 7
   artifacts, same titles, same rendered previews, same numbers, same "1–7 of 7 artifacts": "Claim
   Triage Decision Flow", "Fair-Practice Dunning Notice" (account ending **4471**, ₹3,11,500, 96 days
   past due, addressed "Dear Policyholder"), "Re-KYC Progress Card", "90-DPD Recovery Dashboard — Week
   31", "Exposure by Bucket" (identical bar chart, identical ₹ Cr values), "90-DPD priority list
   (SQL)" (`SELECT ... FROM collections_book WHERE days_past_due >= 90`), "Dunning notice template".
   "90-DPD" (days-past-due), "collections_book", and a lending dunning notice are bank/collections
   concepts a life insurer would never produce — so even setting the leak aside, this content is
   wrong for Suraksha Life on its own. The identical leak repeats on **`/work/prompts`**
   (`insurer/work_prompts.png` vs `bank/work_prompts.png`): the same prompt set — "Summarize & tag",
   "Extract to JSON", "Grounded answer with c…", "Meeting notes → action…", "Re-KYC gap summary",
   "Claim vs quota check", "Dunning notice — fair …" — each tagged `org` (implying org-scoped, not
   platform-shared) appears on both tenants. By contrast, `/work/chat`, `/work/projects`, and
   `/work/tasks` are each CONFIRMED correctly tenant-scoped (bank and insurer show wholly different
   projects, chats, and case queues) — which narrows this bug specifically to the Artifacts and
   Prompts stores, most likely one shared read path both go through without an org filter. Smallest
   fix: same class of fix as #1 — add the missing `orgId` scope to the artifacts and prompts list
   reads, then re-shoot both tenants to confirm divergent, tenant-appropriate content. (Minor,
   separate hygiene note: several prompts are also duplicated 2–3× within one tenant's own list —
   dedupe the seed data once the scoping is fixed.)

3. **`/operations/edge` on the BANK tenant is a bare error banner, not a page.** Screenshot:
   `bank/operations_edge.png` (compare `insurer/operations_edge.png`, fully populated). The entire
   content area reads only: "Could not reach the edge status API. Retry after the edge is
   available." — no numbers, no posture panel, nothing else. This is the brief's BLOCKER pattern by
   name ("an error banner... anything that fails on the first obvious click"), and it is specific to
   the bank link — the insurer's identical page works. Because both links go out, the bank pitch
   looks like it's running on flakier infrastructure than the insurer's, from the very first click
   into Operations. Smallest fix: at minimum, never show the raw "Could not reach the edge status
   API" sentence — a transient probe failure should read as "Edge metrics unavailable right now,"
   and the underlying probe (worth checking whether it's resolving a host that only answers from one
   tenant's network path) should be fixed so this isn't reproducible on demand.

4. **`/operations/edge` (insurer tenant) — "10 WAF blocks" sits directly under "WAF: off."**
   Screenshot: `insurer/operations_edge.png`. The stat strip reads "11 blocked / 10 WAF blocks / 1
   rate-limited"; the "Protection posture" panel immediately below reads "WAF: off, Rate limit: not
   configured, Rules: none." A technical reader sees a system claiming to have blocked traffic with a
   control that is admittedly off — reads as a fake number or a broken toggle, and it poisons trust in
   every other number on the page. Given 10 real blocked-as-WAF events exist, the posture card is
   more likely the one under-reporting reality (WAF is actually doing something) than the counter
   being fake. Smallest fix: either stop labeling those 10 as "WAF blocks" while the posture reads
   off (fold them into generic "blocked by edge rules"), or fix the posture toggle to reflect what's
   actually enabled.

5. **`/operations` and `/operations/runs` (insurer tenant only) — `[autotest] Claim event feed ·
   Assess claim risk` rows sit at the very top of both the platform "Recent activity" feed and the
   Runs table.** Screenshots: `insurer/operations.png`, `insurer/operations_runs.png`. Four
   consecutive identical `[autotest]`-prefixed rows are the first thing a viewer sees under "Recent
   activity," and again the first four rows of `/operations/runs` — literal QA seed data, the exact
   "placeholder/test data" pattern the brief calls a BLOCKER on sight. Confirmed tenant-specific: the
   bank tenant's equivalent screens (`bank/operations.png`, `bank/operations_runs.png`) show none of
   this — real "Reimbursement Approval" rows instead. Smallest fix: strip any row whose name starts
   with `[autotest]` from both the dashboard feed and the default Runs view, or don't seed it at all.

6. **`/work/tasks` and `/operations/runs` (bank tenant) — several case rows are raw, unformatted
   field dumps sitting right next to properly humanized rows in the same list.** Screenshot:
   `bank/work_tasks.png`, "Reimbursement Approval" card. Four consecutive rows read literally `Meera
   Malhotra · submitted · ₹41,346.44 · 2025-09-16 · started 2…` and one reads `Vendor 140 · open ·
   76,557` — compare the row directly above them, `Reimbursement Approval — Sanjay Rao, ₹37,562`,
   which is exactly the "Case, Person, Amount" pattern a non-technical operator reads at a glance. The
   same raw string reappears verbatim as a run subtitle on `bank/operations_runs.png`, so the bug is
   in the seed data itself, not one view's formatting. This is the brief's "a case with no readable
   subject" BLOCKER, sitting inside the exact card (12 of the tenant's 19 waiting cases) a bank-tenant
   viewer opens from the Work badge in one click. Smallest fix: apply the same subject template
   ("{Case type} — {Person}, ₹{amount}") already used for the well-formed rows to these records.

7. **`/operations/backups` — real admin username, absolute file path, and internal daemon/host
   details stated outright on the primary panel, identical on both tenants (backups are host-level,
   not tenant-scoped at all).** Screenshot: `insurer/operations_backups.png` /
   `bank/operations_backups.png` (identical). The "OFF-BOX REPLICATION" tile reads
   `admin@offgrid-g6.local:/Users/admin/offgrid/b…`; the page header reads "Backups live on S1
   (/Users/admin/offgrid/backups)"; the Schedule panel reads "co.getoffgridai.backup is a
   system-domain daemon... Manage the plist on S1." A real admin username, a `.local` mDNS hostname,
   an absolute filesystem path, and `launchd`/`plist` internals, all on the face of the screen — the
   exact class of thing the workspace's own operating rule ("on-prem is a dummy, SSH is the risk")
   says must stay off any public-facing surface. Smallest fix: replace with an abstracted description
   ("replicated off-box nightly," "system-managed backup daemon") and move the literal host/path into
   a details/tooltip, or drop it. (Separately, worth noting for the record, not fixing here: this page
   being byte-identical on both tenants confirms backups genuinely aren't tenant-scoped — expected for
   host-level infra, but it does mean a bank viewer and an insurer viewer are looking at the same raw
   box identity, which undercuts each customer's "your own private on-prem cloud" pitch a little.)

8. **`/operations/nodes` and every `/operations/services/[id]` detail page — a raw `.local` hostname
   and port sits in plain text as "Host" / "Primary endpoint," repeated across ~7 node cards and every
   service detail page checked** (`offgrid-g1.local:7878`, `offgrid-s1.local:4000`,
   `offgrid-s1.local:8002`, `offgrid-s1.local:8080`, `offgrid-s1.local:9200`, etc.). Screenshots:
   `insurer/operations_nodes.png`, `insurer-detail/operations_services_litellm.png`,
   `..._opensearch.png`, `..._ragas.png`, `..._keycloak.png`. This is private LAN addressing for the
   founder's own boxes, verbatim, two clicks from Operations. Smallest fix: show a friendly node
   label/region as the primary line, keep the literal hostname:port behind a details toggle.

9. **`/operations/config` (and its twin route `/operations/configuration`, same page) — a raw
   environment-variable editor is the Settings screen: every field is labeled with its literal env var
   name, and two non-secret fields show real internal hostnames in plain text.** Screenshot:
   `insurer/operations_config.png`. Field labels read `OFFGRID_GATEWAY_URL`, `OFFGRID_GATEWAY_API_KEY`,
   `OFFGRID_GATEWAY_CONTROL_URL`, `OFFGRID_INFERENCE_PROVIDER`, `OFFGRID_LITELLM_URL`,
   `OFFGRID_LITELLM_MASTER_KEY`, `DATABASE_URL` — this is precisely the brief's "env var names on
   screen" BLOCKER, and it's not an edge case, it's the whole page (45 settings, all labeled this way).
   "LiteLLM" itself also appears four times as visible text ("LiteLLM URL," "LiteLLM master key," plus
   the two env var names) — the one OSS name that escaped the otherwise-thorough `publicLabel()`
   treatment applied everywhere else in Operations (see Strong section below). The non-secret
   "Legacy gateway URL" and "LiteLLM URL" fields show `http://offgrid-s1.local:8800/` and
   `http://offgrid-s1.local:4000/` in the clear, unmasked, always-visible (no reveal needed). Smallest
   fix: show a human label ("Gateway address," "Model-router address") with the env var name as
   secondary/tooltip text, not the primary label; mask or genericize the two plain-text URL fields the
   same way the secret fields already are. (Genuinely well done, worth calling out separately below:
   the actual secret VALUES — API keys, master key, DATABASE_URL — are correctly masked, and the
   reveal endpoint (`/api/v1/admin/config/reveal`) is server-side gated to return a fixed redacted
   placeholder for the `viewer` role specifically, never the real secret. That part of this exact
   surface is already secure; it's the labels and two plain URL fields that leak.)

## RISKS

- **`/operations/services` and `/operations/services/capability-map` read as an internal engineering
  self-audit, not a customer-facing status page.** Screenshot:
  `insurer-detail/operations_services.png`. Copy like "35/43 probes non-failing," "Current audits /
  Stale audits / Pending audits," "seeded workflow use," and "49-entry contract matched" assumes the
  reader is on the build team. It's not wrong information, but it reads as us grading our own
  homework rather than reporting status to a buyer. Also on this page, the pill badges (`DEPLOY_`,
  `REACHA_`, `FUNCTI_`, `CONSOL_`) are visibly clipped mid-word on every card — reads as broken/unstyled
  chrome regardless of what they'd say unclipped.
- **`/operations/health` (Metrics Explorer) and `/operations/health/logs` name their underlying query
  engines and languages directly.** Screenshots: `insurer/operations_health.png`,
  `insurer/operations_health_logs.png`. "Explore live PromQL metrics from VictoriaMetrics," a
  placeholder example `otelcol_receiver_accepted_spans` (raw OpenTelemetry Collector metric name), and
  the Logs page's "Running the VictoriaLogs default retention... a deploy flag, not a runtime
  setting" plus a LogsQL syntax cheat-sheet. None of these exact names are on the brief's explicit
  list, but they're the same class of thing (the list does include `vmalert`, VictoriaMetrics' own
  alerting binary) — a business reader can't parse any of them. Fix via the same `publicLabel()`
  pattern already used for the Services registry.
- **Destructive-looking buttons are fully "armed" in appearance across Operations, even though the
  write-block actually works.** Verified in code, not just by inspection: `ViewerWriteInterceptor`
  (`src/components/ViewerWriteInterceptor.tsx`) wraps `window.fetch` globally for the `viewer` role and
  intercepts every non-GET call to `/api/*`, returning the same 403 the server would and showing a
  "This is a read-only demo" toast — genuinely well-built, and it covers `/operations/backups`' "Run
  backup now"/"Prune"/"Delete" and `/operations/admin`'s "Save org instructions" and "Add tenant"
  correctly (all real `fetch(..., {method: 'POST'|'DELETE'})` calls). But nothing in the UI marks these
  buttons as disabled beforehand — a bright green "Run backup now," a red "Delete" per backup row, and
  an "Add tenant" / trash-can icon on the tenant table all look fully live to a stranger who has no way
  to know the click will bounce until they try it. The brief calls this out explicitly: the affordance
  itself is alarming even when the block works. Cheapest fix: `useIsViewer()` already exists
  (`src/components/ViewerModeProvider.tsx`) — wire it into these specific buttons to render disabled
  with a small "read-only" tag, matching the pattern the brief says is currently at zero consumers for
  buttons.
- **`/operations/health/metrics/alerts` shows 0 firing, 0 pending, and 0 alerting/recording rules
  configured at all.** Screenshot: `insurer/operations_health_metrics_alerts.png`. Not wrong, but for
  a platform pitching production-grade operations, "zero alert rules exist" is a visible gap a
  technical reader will notice on the second click.
- **`/operations` "Runs needing attention: 32" on the bank tenant** (`bank/operations.png`,
  `bank/operations_runs.png`, Total 229 / Failed 32) is a real ~14% failure rate sitting on the
  landing dashboard in red. Worth checking whether these are genuine seeded failures or leftover test
  noise before either link goes out again — a large red number on the first screen invites the
  question "is this reliable?"

## Appropriateness findings (leaks, exposure, jargon — summary; details are inline in BLOCKERS above)

- Cross-tenant: `/operations/admin/tenants` (BLOCKER #1, all tenants + hostnames + super-admin
  controls) and `/work/artifacts` + `/work/prompts` (BLOCKER #2, identical content both tenants).
- Internal infra on screen: `/operations/backups` (admin username, absolute path, `.local` host,
  `launchd`/`plist`), `/operations/nodes` + service detail pages (`.local` hostnames/ports),
  `/operations/config` (raw env var names as field labels, two unmasked internal URLs).
- OSS engine names on the face of the screen: "LiteLLM" (Services card + Settings, 4×),
  "VictoriaMetrics"/"VictoriaLogs"/PromQL/LogsQL/`otelcol_*` (Platform health). Everything else in the
  Services directory (opensearch → "Log Search & SIEM", keycloak → "Identity & SSO", qdrant → "Vector
  Search", ragas → "RAG Evaluation", temporal → "Durable Workflows", etc.) is correctly humanized —
  see Strong section.
- No PII-that-reads-as-real was found beyond the fictional Indian BFSI convention already in use
  (Sanjay Rao, Priya Sharma, Ishaan Kulkarni, etc. — consistent with the sanctioned synthetic-data
  convention).

## What is genuinely strong here (point a stranger at these)

- **`/work/tasks` ("My tasks") is the best screen in this whole audit, on both tenants.** Screenshots:
  `insurer/work_tasks.png`, `bank/work_tasks.png`. Readable case subjects ("Death claim assessment —
  nominee Sneha Pillai, ₹12,50,000 sum assured," "Personal loan application — Priya Sharma, ₹13,68,000"
  on the insurer; "KYC & Re-KYC Verification — Ananya Gupta, ₹33,122" on the bank), oldest-first
  urgency with day counts, and honest edge-case copy: "No decision target is set for 2 processes, so
  nothing will ever flag as late" and a "Who is covering" delegation panel that says plainly "Nobody
  is marked away... otherwise their cases sit in the queue with nobody watching them." This is exactly
  the failure-vs-emptiness honesty the workspace holds itself to, and it's the one page to open first
  if someone asks "does this actually work for a normal person."
- **`/work` and `/work/projects` are correctly tenant-scoped with domain-appropriate content** —
  Suraksha Life gets "Indemnity claims review," "Motor FNOL intake," "Policyholder service"; Bharat
  Union Bank gets "Collections — 90 DPD book," "KYC re-verification drive," "Retail lending queries" —
  each with real, sensible per-project system instructions ("Cite the policy wording for every
  exclusion you rely on" vs "Follow RBI fair-practices language, never threaten, never imply legal
  action that has no basis"). Good evidence the platform is genuinely multi-tenant where it matters.
- **`/operations/admin` (Organization) is a strong, real page**, not a placeholder: it shows Suraksha
  Life's actual governed system prompt in plain English ("All amounts in INR. Never expose
  PAN/Aadhaar in the clear. Cite IRDAI/DPDP policy. Route claims/underwriting decisions to a human.")
  — concrete proof of the governance pitch, not a marketing claim about it.
- **`/operations/configuration/messaging` has excellent, outcome-first copy**: "The API key is stored
  in the secrets vault and never displayed... Outbound email is PII-masked and egress-leashed before
  it leaves the box." This is the brief's "outcomes, not functionality" rule executed correctly.
- **The Services directory's OSS-name masking (`publicLabel()`) is thorough where it's applied** —
  spot-checked opensearch, keycloak, qdrant, ragas, temporal detail pages; all render clean
  business-facing names ("Log Search & SIEM," "Identity & SSO," "Vector Search," "RAG Evaluation,"
  "Durable Workflows") with zero OSS branding on the page. Only LiteLLM slipped through.
- **The read-only write-block is real, not decorative.** `ViewerWriteInterceptor` intercepts at
  `window.fetch` for every non-GET `/api/*` call platform-wide, returns the same 403 body the server
  would, and shows one consistent toast instead of 200+ different raw failure messages. Verified this
  covers Operations' most alarming buttons (backup run/prune/delete, tenant add/delete, org-instruction
  save). The gap is purely visual (buttons aren't marked disabled), not functional.
- **`/operations/backups`' own restore flow is correctly non-destructive by design** — clicking
  "Restore" fetches a dry-run "restore plan" (a GET), it does not restore; the actual apply step (not
  reached in this pass) would go through the same POST interceptor.

## LATER

- `/operations/api-docs` (redirects to `/runtime/api`) is solid and well-labeled (Secrets store,
  Vector store, Data lineage — no OSS names) but loses the Operations breadcrumb/sidebar entirely on
  redirect, which is a slightly jarring context switch.
- `/operations/configuration/messaging`'s "Sending domains: none yet" and "Inbound email: disabled" are
  legitimate but permanent-looking empty states for this demo; low priority since Operations is a
  technical-buyer surface, not the non-technical Work audience the brief weighs empty states most
  harshly for.
- Both tenants' `/work/files` show a folder literally named "demo" — minor tell that this is a seeded
  environment, cosmetic only.
- `/operations/services` and `/operations/services/capability-map` truncate their pill badges
  (`DEPLOY_`, `REACHA_`, etc.) at 1600px — likely a `max-width`/`overflow` fix, not investigated further.
</content>
