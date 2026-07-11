import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { rotateSigningKey } from '@/lib/provenance-ops';
import { currentOrgId } from '@/lib/tenancy';

// Rotate the provenance SIGNING KEY. The console cannot durably rewrite a server-managed env var /
// KMS from a web request, so this generates a fresh ed25519 keypair for the operator to install and
// returns the HONEST remaining step (install as OFFGRID_ED25519_PRIVATE_KEY + restart). It NEVER
// pretends the live key was swapped. Admin-gated and audited.
//
// GET  — preview: current key + what a rotation can/can't do (no keypair generated, not audited).
// POST — perform: generate a new keypair to install + return the plan (audited).

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { plan, currentPublicKey, algorithm } = rotateSigningKey();
  // Preview only — do not leak a generated private key on a read.
  return NextResponse.json({ plan, currentPublicKey, algorithm });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const result = rotateSigningKey();

  auditFromSession(gate, await currentOrgId(), {
    action: 'provenance.signing_key.rotate',
    resource: `signing:${result.algorithm}`,
    // The keypair was generated (ok). The live key is NOT swapped by this request — the operator
    // must install it; that honest caveat is carried in the response's plan.remainingStep.
    outcome: 'ok',
  });

  return NextResponse.json(result);
}
