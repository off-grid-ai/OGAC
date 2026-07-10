// ADVERSARIAL — QA bug-hunt RED tests for the CONSOLE PIPELINES feature.
//
// These document CONFIRMED breaks found by adversarial probing (see docs/adversarial/pipelines.md and
// docs/GAPS_BACKLOG.md G-ADV-PIPE-*). Each is `.skip`ped so the shared suite stays GREEN, but each has
// been PROVEN to fail (assertion reflects the buggy TERMINAL artifact the code actually produces).
// Un-skip to reproduce the break. When the underlying gap is FIXED, flip the assertion + un-skip.
//
// They assert the enforced/terminal outcome (the resolved contract, the execution plan the executor
// carries out) from the real seams — NOT a shape.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// G-ADV-PIPE-1 — LOCAL egress leash does NOT enforce a local MODEL (cloud-model PII leak).
//
// A pipeline leashed to `local` for a PII data-class sets forceLocal=true / egress='local'. But
// buildRunPlan picks the model by string precedence (leash model → pipeline defaultModel → platform
// default) and NEVER classifies it as local vs cloud. If the routing rule pinned no explicit local
// model, chooseModel falls through to the pipeline's defaultModel — which may be a CLOUD model.
//
// The plan then reports egress:'local'/forceLocal:true to the caller + audit while naming a cloud
// model, and pipeline-execute-wiring.ts only adds an advisory `metadata:{egress:'local'}` HINT to the
// gateway body — it does NOT force a local model. So a PII-locked pipeline can send the raw prompt to
// a cloud model, contradicting pipeline-run-plan.ts's own docstring ("the executor never reaches a
// cloud model"). The console does not enforce the local leash on the model choice.
//
// ROOT CAUSE: src/lib/pipeline-run-plan.ts:70 buildRunPlan / :50 chooseModel — model choice is
//             independent of forceLocal; no local-model validation. Reported egress is decoupled from
//             the model actually called.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// G-ADV-PIPE-1 lives in pipeline-run-plan.ts (model-choice), owned by a DIFFERENT agent — left skipped
// here (out of this SECURITY-cluster-B file-set). Tracked in docs/GAPS_BACKLOG.md.
test.skip('ADVERSARIAL G-ADV-PIPE-1 — a LOCAL leash must not plan a CLOUD model', async () => {
  const { buildRunPlan } = await import('@/lib/pipeline-run-plan');
  type Verdict = import('@/lib/pipeline-enforcement').ModelCallVerdict;
  const verdict: Verdict = {
    allow: true,
    egress: 'local',
    forceLocal: true,
    requirePiiMasking: false,
    blockPromptInjection: false,
    requirePurpose: false,
    reason: 'leashed local for PII',
    noPipeline: false,
  };
  // Routing rule pinned NO local model (leashModel null); pipeline defaultModel is a cloud model.
  const plan = buildRunPlan(verdict, null, 'gpt-4o', 'gemma-local');

  // CORRECT behaviour: a forceLocal plan must resolve to a LOCAL model (never a cloud one), or refuse.
  // ACTUAL (buggy): plan.model === 'gpt-4o' while egress/forceLocal say local.
  assert.notEqual(
    plan.model,
    'gpt-4o',
    'BREAK: forceLocal/egress=local plan still names a CLOUD model — local leash not enforced on model choice',
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// G-ADV-PIPE-2 — a DEPRECATED / ARCHIVED bound pipeline STILL governs consumer runs.
//
// The lifecycle UI (pipeline-lifecycle-model.ts) promises on deprecate/archive: "consumers fall back
// to the org default". But resolveContract (pipeline-contract.ts) calls getPipeline() with NO status
// filter and builds a full enforceable contract regardless of lifecycle status. None of the consumer
// binding resolvers (resolveAgentBinding / resolveChatBinding in pipeline-run-glue.ts; the app-run /
// trigger / inbound-email routes) check status either. So a deprecated/archived pipeline keeps
// enforcing its (possibly stale) contract on chat/agent/app runs — the promised fallback never happens.
//
// ASYMMETRY: the PUBLIC provisioned API (POST /api/v1/pipeline/[id]/run:64) DOES gate
//            `status !== 'published'` → 409, but the internal consumer paths do NOT. Enforcement of the
//            lifecycle is inconsistent across consumer types.
//
// ROOT CAUSE: src/lib/pipeline-contract.ts:32 resolveContract — no lifecycle-status gate;
//             src/lib/pipeline-run-glue.ts:32/71 — resolvers ignore status.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const dbUp = await dbReachable();

// FIXED (isConsumable gate on resolveContract): a deprecated pipeline resolves to null → the consumer
// falls back to the org default. Un-skipped; PASSES after the fix. A published positive-control in the
// same test proves the gate isn't vacuously returning null for everything.
test(
  'ADVERSARIAL G-ADV-PIPE-2 — resolveContract must NOT govern a DEPRECATED pipeline (fall back to org default)',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createPipeline, updatePipeline, deletePipeline, publishPipeline } = await import(
      '@/lib/pipelines'
    );
    const { resolveContract } = await import('@/lib/pipeline-contract');
    const ORG = 'test-adv-pipe-deprecated';

    const p = await createPipeline(
      {
        name: 'Adv Deprecated',
        dataAllowlist: ['finance'],
        policyOverlay: { maxEgress: { level: 'local' } },
      },
      'owner@x.io',
      ORG,
    );
    t.after(async () => {
      await deletePipeline(p.id, ORG).catch(() => {});
    });

    // POSITIVE CONTROL: once PUBLISHED, resolveContract MUST yield an enforceable (non-null) contract —
    // else a gate that always returns null would pass the negative case vacuously.
    await publishPipeline(p.id, ORG, 'admin@x.io');
    const publishedContract = await resolveContract(p.id, ORG);
    assert.notEqual(
      publishedContract,
      null,
      'a PUBLISHED pipeline must resolve an enforceable contract (positive control)',
    );

    // NOW deprecate it: the contract must fall back to null (org default).
    await updatePipeline(p.id, { status: 'deprecated' }, ORG, 'admin@x.io');

    const contract = await resolveContract(p.id, ORG);

    // CORRECT behaviour: a deprecated pipeline should NOT resolve an enforceable contract for a
    // consumer (the run should fall back to the org default, per the deprecate hint).
    assert.equal(
      contract,
      null,
      'BREAK: a DEPRECATED pipeline still resolves an enforceable contract — no fallback to org default',
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// G-ADV-PIPE-3 — a DRAFT / IN_REVIEW pipeline (never approved, never gate-passed) governs+runs on
// internal consumers, bypassing the release gate the public API enforces.
//
// M1 release gate: publish only proceeds if the eval gate passes, and the public run route 409s any
// non-published pipeline. But an app/agent/chat bound to a pipeline still in `draft`/`in_review`
// resolves + enforces its contract (same resolveContract path, no status gate). An un-approved,
// un-gate-passed pipeline is therefore LIVE on those consumer paths.
//
// ROOT CAUSE: same as G-ADV-PIPE-2 — resolveContract / consumer resolvers ignore lifecycle status.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FIXED (isConsumable gate): a draft/in_review pipeline resolves to null on internal consumers, so the
// release gate can't be bypassed. Un-skipped; PASSES after the fix.
test(
  'ADVERSARIAL G-ADV-PIPE-3 — a DRAFT pipeline must not govern/run a consumer (release gate bypass)',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { createPipeline, deletePipeline } = await import('@/lib/pipelines');
    const { resolveContract } = await import('@/lib/pipeline-contract');
    const ORG = 'test-adv-pipe-draft';

    // Created without publishing → status defaults to 'draft'.
    const p = await createPipeline(
      { name: 'Adv Draft', dataAllowlist: ['finance'] },
      'owner@x.io',
      ORG,
    );
    t.after(async () => {
      await deletePipeline(p.id, ORG).catch(() => {});
    });

    const contract = await resolveContract(p.id, ORG);

    // CORRECT: a draft (never gate-passed) pipeline should not yield an enforceable/runnable contract
    // to a consumer. ACTUAL (buggy): it does — the internal paths run an unpublished pipeline.
    assert.equal(
      contract,
      null,
      'BREAK: a DRAFT pipeline resolves an enforceable contract for consumers — release gate bypassed on internal paths',
    );
  },
);
