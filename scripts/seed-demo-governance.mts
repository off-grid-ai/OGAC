// ─── Give the demo runs their governance trail ───────────────────────────────────────────────────────
//
// The seeded runs recorded data reads, an AI step, a human decision and an output — but no guardrail step and
// no provenance signature. So the console could not show the thing that actually distinguishes this product:
// a case looked like a spreadsheet row with a status.
//
// SCOPE: the two DEMO tenants only (org_bharat, org_suraksha). This writes representative governance content
// for a demo, at the founder's explicit direction — these are dummy tenants whose whole purpose is to show
// what a governed run looks like. It is NOT a mechanism for manufacturing governance on a real tenant, and the
// org filter is the guardrail on that.
//
// What it adds per run:
//   • a `guardrail` step before the AI step — PII masking and unsafe-content screening, the checks the
//     platform genuinely performs
//   • a provenance signature, so a finished case reads as tamper-evident
//
// Deterministic (hashed from the run id) so re-running produces identical content, and idempotent — a run
// that already has a guardrail step or a signature is left alone.
//
// RUN: npx tsx scripts/seed-demo-governance.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

type Step = { id: string; kind: string; label: string; status: string; outcome?: string; refs?: string[] };

/** Stable hex from a run id — a signature that is reproducible rather than random. */
function digest(id: string, salt = ''): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of `${id}${salt}`) {
    h ^= BigInt(ch.charCodeAt(0));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  let out = '';
  let v = h;
  for (let i = 0; i < 4; i++) {
    out += (v & 0xffffffffn).toString(16).padStart(8, '0');
    v = (v * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return out;
}

const GUARDRAIL_OUTCOMES = [
  'PII masked (PAN, account number) · no unsafe content · no prompt injection detected',
  'PII masked (PAN, Aadhaar) · no unsafe content · egress allowed by policy',
  'PII masked (account number, phone) · no unsafe content · within retention policy',
] as const;

const rows = (await db.execute(sql`
  SELECT id, status, steps, provenance FROM app_runs
  WHERE org_id IN ('org_bharat','org_suraksha') AND steps IS NOT NULL
`)) as unknown as {
  rows: { id: string; status: string; steps: Step[] | null; provenance: unknown }[];
};

let guarded = 0;
let signed = 0;

for (const row of rows.rows ?? []) {
  const steps = Array.isArray(row.steps) ? row.steps : [];
  if (steps.length === 0) continue;

  let next = steps;

  // ── Guardrail step, inserted before the first AI step (that is where screening belongs). ──
  if (!steps.some((s) => s.kind === 'guardrail')) {
    const at = steps.findIndex((s) => s.kind === 'agent');
    const insertAt = at >= 0 ? at : steps.length - 1;
    const outcome = GUARDRAIL_OUTCOMES[Number.parseInt(digest(row.id, 'g').slice(0, 4), 16) % GUARDRAIL_OUTCOMES.length];
    const guardrail: Step = {
      id: `sg_${digest(row.id, 'sid').slice(0, 6)}`,
      kind: 'guardrail',
      label: 'Safety and privacy checks',
      // A guardrail on a run that never finished should not claim to have passed.
      status: row.status === 'queued' ? 'queued' : 'done',
      outcome,
      refs: [],
    };
    next = [...steps.slice(0, insertAt), guardrail, ...steps.slice(insertAt)];
    guarded += 1;
  }

  // ── Provenance, only for a run that actually reached a result. ──
  const needsSignature = !row.provenance && ['done', 'error', 'cancelled'].includes(row.status);
  const provenance = needsSignature
    ? {
        signature: digest(row.id, 'sig'),
        algorithm: 'ed25519',
        publicKey: `og-demo-${digest(row.id, 'pk').slice(0, 12)}`,
        signedAt: new Date().toISOString(),
      }
    : null;
  if (provenance) signed += 1;

  if (next === steps && !provenance) continue;

  await db.execute(sql`
    UPDATE app_runs
    SET steps = ${JSON.stringify(next)}::jsonb
        ${provenance ? sql`, provenance = ${JSON.stringify(provenance)}::jsonb` : sql``}
    WHERE id = ${row.id}
  `);
}

console.log(`added a guardrail step to ${guarded} runs · signed ${signed} finished runs`);
