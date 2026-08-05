# Audit — Work + Workspace (the human's side of the platform)

Date: 2026-08-05
Scope: `src/app/(console)/work/**`, `src/app/(console)/workspace/**`, plus
`src/lib/{app-work-queue,review-*,hitl,approval,waiting-digest,cockpit-digest,case-*,chat*,projects,artifacts}`
and `src/app/api/v1/admin/{work,app-runs,chat,projects,artifacts}/**`.

Question the audit must answer: **can a non-technical department officer safely do the work routed to them here?**

Status: IN PROGRESS — findings appended as confirmed.

## Coverage so far
- READ: `work/page.tsx`, `work/tasks/page.tsx`, `lib/my-work-reader.ts`, `lib/my-work.ts` (partial),
  `lib/with-timeout.ts`, `api/v1/admin/my-work/count/route.ts`.
- PENDING: decision screen (`solutions/apps/[id]/runs/[runId]`), `app-work-queue.ts`, review-inbox,
  approvals/self-approval, chat/projects/artifacts, workspace/*, screenshots.

## Findings

### W6 — BLOCKER (live evidence) — The nav badge says 9, the queue page says 5, and the 4 missing cases are real work nobody can reach.
Persona: **non-technical officer** (which number do I trust?), **technical operator** (abandoned work is invisible), **QA**.

Measured on the shared dev server as `dev@offgrid.local` (2026-08-05):

| source | value |
|---|---|
| `GET /api/v1/admin/my-work/count` | `{"available":true,"waiting":9,"oldestDays":30}` |
| `/work/tasks` heading (screenshot `/tmp/audit/work/work_tasks.png`) | *"5 cases are waiting for you to decide."* |
| sidebar badge in the same screenshot | `My tasks  9` |

Enumerating the runs (`GET /api/v1/admin/app-runs?limit=200`, filtered to `awaiting_human`) shows exactly
why: 4 of the 9 belong to app ids that `listApps` does not return —
`eyat_reimbursement_553aa949`, `…_91689e1f` (app `app_d9f008e3`), `…_8cb6f3a9`, `…_c3f9f616`
(app `app_4108cf57`), all waiting since 2026-07-09.

- `src/lib/my-work-reader.ts:44-46` deliberately drops them: *"A run whose app has been deleted cannot be
  acted on … and **it is counted nowhere else either**."* That justification is **false today** —
  `src/app/api/v1/admin/my-work/count/route.ts:34` counts every `awaiting_human` run with no app filter,
  and that count is what the nav badge renders next to the very link that hides them.
- Consequence for the officer: the badge that exists to tell them work arrived over-reports by 80%, so it
  trains them to distrust it — the exact failure the badge was built to fix.
- Consequence for the operator: **four cases have been paused for 27 days with no surface anywhere that
  lists them.** They are not "deleted work", they are orphaned work; there is no reassign, no re-home,
  no cancel path for them in this section.

### W7 — HIGH — Approve is a one-click, no-confirmation, no-undo action in a list row, and what it will DO is only stated after it is done.
Persona: **non-technical officer** ("what happens if I approve?" / "can I undo?"), **UX/QA** (consequence before the press).

`src/components/build/CaseDecision.tsx` renders `Approve` / `Reject` inline on the queue row
(`:146-159`) and posts straight to the review route — **no confirm step, no summary of the effect**.
The consequences only appear afterwards, in a toast that fades: *"Approved — the case continues."*
(`:57-62`). Approving resumes the workflow's remaining steps, which is where side-effecting action and
sink steps live (create/update a record in a connected system, send the email/WhatsApp) — so a
mis-click is an external, irreversible write. There is **no undo**: the only reversal in the store is
`markAppRunCancelled`, restricted to `running|awaiting_human|queued` (`src/lib/app-run-store.ts:152`),
i.e. it cannot touch a run you have just approved to completion.

The material for a proper pre-press statement already exists and is unused here:
`planActionImpact` (`src/lib/action-contract.ts:184-212`) returns exactly the plain-language sentence
needed — *"Update record for X. Nothing has been changed."* plus `sideEffects` and an egress
classification. The **bulk** bar does the right thing (`describeBatch(...)`,
`src/components/build/BulkDecideBar.tsx:76`, "includes the age of the oldest, so a batch cannot quietly
sweep up something long-forgotten") — so the single-case path is the weaker of the two, which is
backwards: single-case approval is the one an officer does fifty times a day on autopilot.
Also `Reject` with no reason is one click and permanent (`:145-152`) while `This was wrong` demands a
reason — the destructive-and-silent path is the easiest one.

### W1 — BLOCKER — The queue page throws away the "did the read succeed?" flag, so an outage renders as a green "Nothing is waiting for a decision right now."
Persona: **non-technical officer** (also QA/QC — failure-as-emptiness), **technical operator**.

`src/lib/my-work-reader.ts:22-27` exists specifically to prevent this and says so:

> `complete` — False when either underlying read failed. *A failed read must never present as an empty
> queue: "nothing is waiting for you" is the single most dangerous thing this platform can say
> incorrectly, because the reader stops looking.*

The reader swallows both failures into `[]` (`my-work-reader.ts:31-38`) and reports them only via
`complete`. The **primary queue page never reads it**:

- `src/app/(console)/work/tasks/page.tsx:42` — `const { cases, summaries } = await readMyWork(orgId, now);`
  (`complete` destructured away; the string "complete" appears nowhere in the file.)
- Consequence: if `listApps` or `listAppRunsView` throws, `work.groups` is empty and the page renders
  `work/tasks/page.tsx:206-215`: a **primary-coloured tick** and *"Nothing is waiting for a decision
  right now."* — an affirmative, reassuring lie. If apps also fail, it additionally shows
  `:240-249` "Nothing is set up for you yet", blaming the app builder for an outage.

Two neighbouring surfaces get this right, which proves the flag is usable and this page is the outlier:
`src/app/(console)/overview/page.tsx:144` (`workLead(myWork.work, myWork.complete)`) and
`src/app/api/v1/admin/my-work/count/route.ts:25-32` (returns `{available:false}` rather than 0).
So the nav badge can be honestly blank while the queue page it links to says everything is fine.

### W2 — HIGH — A failed SLA-rule read silently reclassifies every overdue case as "no promise", killing the overdue banner and the ordering.
Persona: **non-technical officer** (can't tell urgent from stale — the explicit question), **CISO** (SLA breach evidence).

`src/app/(console)/work/tasks/page.tsx:51`
```ts
const slaRules = await slaRuleMap(orgId).catch(() => ({}) as Record<string, SlaRule>);
```
`{}` is indistinguishable from "this org set no targets". Downstream, `slaStatus(...)` with an
undefined rule returns state `no-promise`, so: the red/amber per-case badge is suppressed
(`:180-181` returns null), `summariseBreaches` produces no message so the overdue banner disappears
(`:104`), and `slaWeight` flattens the sort (`:158-160`) — the queue silently loses its
prioritisation. This is the same defect class as W1 one layer down: a store outage presents as
"nothing is late". The `catch(() => null)` on `listCover` at `:62` is at least documented as
best-effort and only hides a panel; the SLA one changes displayed judgement.

### W3 — BLOCKER — THE RACE: the approve/reject write has no status precondition, so two reviewers can both decide the same case and the run resumes twice.
Persona: **CISO**, **technical operator**, **QA** (missing "already decided by someone else" state).

The review route reads the run, checks `canReview(run)` (`apps/runs/[id]/review/route.ts:74-79`), then
resumes. The resume persists through `persistAppRun`, whose write is an **unconditional** upsert:

`src/lib/app-run-store.ts:108-124`
```ts
await db.insert(appRuns).values(values).onConflictDoUpdate({
  target: appRuns.id,
  set: { status: values.status, steps: values.steps, outcome: values.outcome, ... },   // no WHERE
});
```
There is no `where status = 'awaiting_human'` and no version/etag. `canReview` is a **read-then-write
with no compare-and-set**, so two reviewers who both loaded the paused case both pass the check and
both call `resumeAppRun` → the downstream steps (including side-effecting action/sink steps) execute
**twice**, and the second write silently overwrites the first reviewer's recorded decision and
`steps[].reviewer`. The first decision, and its author, are gone from the row.

This is provably an omission and not a platform limit: the two neighbouring writes in the same file
do it correctly —
- `markAppRunCancelled` `src/lib/app-run-store.ts:148-154` (`inArray(status, ['running','awaiting_human','queued'])`, returns whether a row moved),
- `escalateAppRun` `src/lib/app-run-store.ts:183` (`eq(appRuns.status,'awaiting_human')`), and the route
  turns a no-op into a plain 409 *"This run is no longer awaiting a decision."* (`review/route.ts:93-98`).

So **escalate is safe against the race and approve is not.** The non-concurrent case is also poor:
a reviewer who opens a stale queue row and approves gets `review/route.ts:76` verbatim —
`"run is done, not awaiting a human decision"` — engine-flavoured text naming an internal status,
not "someone else has already decided this".

### W4 — BLOCKER — Nobody can approve-their-own-work-check, because the platform never records who started a run.
Persona: **CISO** (the explicit question), **non-technical officer** (trusts the control exists).

- `app_runs` (`src/db/schema.ts:1087-1130`) has `orgId, appId, status, trigger, input, steps, outcome,
  appVersion, dataClassification, lawfulBasis, policyVersion, finishedAt` — and **no requester /
  startedBy / actor column**. `grep -n actor src/lib/app-run-store.ts` returns nothing.
- The approval gate `evaluateAppAccess` / `evaluateApprovalAuthority`
  (`src/lib/app-access-policy.ts:192-296`) compares the caller against *approverRoles*,
  *approverUsers* and a numeric threshold. Its inputs are `(policy, caller, action, requestAttrs)` —
  `requestAttrs` is the run's **input payload**, not its author. Nothing in the signature can express
  "not the maker".
- `grep -rni "self-approv|separation of dut|four.eyes"` over `src/` → **zero hits.** The only
  maker-checker code (`src/lib/action-contract.ts:188-236`) checks that an approval STEP exists and
  was approved, never *by whom* relative to the maker.
- Note the aggravating factor in `app-access-policy.ts:256` + `:267`: the app **owner bypasses the
  RBAC/ABAC gate entirely**, so the owner of an app can approve runs of that app in all cases where no
  `approval` block is configured — and `:198` says an absent `approval` block means *"any caller who
  passed RBAC for approve may approve"*.

**Answer to the audit's question: yes — a person can approve their own work, and no record exists that
would let anyone detect it afterwards.** For a claims/tax approval queue this is the finding that
fails the section on its own.

### W5 — HIGH — The audit ledger records THAT a run was reviewed, never WHICH WAY.
Persona: **CISO** (non-repudiation).

`apps/runs/[id]/review/route.ts:236-240` writes the same event for both outcomes:
```ts
auditFromSession(gate, orgId, { action: 'app.run.review', resource: `app_run:${id}`, outcome: 'ok' });
```
`AuditEventInput` (`src/lib/audit-event.ts:132-145`) has no `details`/`metadata` field, so the
decision cannot be attached — approve and reject are indistinguishable in the ledger (contrast the
escalation path, which at least gets its own action name `app.run.escalated`, `:102`). The decision
itself lives only in the **mutable** `app_runs.steps[].reviewer`/outcome JSON, which W3 shows can be
overwritten by a later writer with no trace. Attribution therefore exists in the happy path
(reviewer email on the step, actor on the audit event) but is **not non-repudiable**: the ledger row
can't say what was approved, and the row that can is overwritable.
