import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  credentialInventory,
  provisionableServices,
  type CredentialSecretInput,
  validateCredentialSecret,
} from '@/lib/service-credential-provisioning';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Move a service credential OUT of a plaintext env file and INTO OpenBao (Phase B of
// docs/INTEGRATION_ARCHITECTURE.md), from the console rather than by editing `.env.local` over SSH.
//
// Secrets are WRITE-ONLY here: GET reports whether each service's credential is vaulted and which
// source is actually in force, and never returns a secret value. A console that can read back the
// secrets it stores is a second copy of them.

/** GET — per-service credential inventory: plan, whether it is vaulted, and what is in force. */
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    object: 'service_credential_inventory',
    services: await credentialInventory(),
  });
}

/** PUT — store a service credential in OpenBao. The value is never echoed back. */
export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Partial<CredentialSecretInput> | null;
  const check = validateCredentialSecret(body);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  const orgId = await currentOrgId();
  try {
    const { storeCredentialSecret } = await import('@/lib/service-credential-provisioning');
    await storeCredentialSecret(check.value);
    auditFromSession(gate, orgId, {
      action: 'service-credential.set',
      resource: `service-credential:${check.value.service}`,
      outcome: 'ok',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `could not store the credential: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Report the resulting state, not the secret.
  const services = await credentialInventory();
  return NextResponse.json({
    object: 'service_credential',
    service: check.value.service,
    stored: true,
    state: services.find((s) => s.service === check.value.service) ?? null,
  });
}

/** DELETE — remove a vaulted credential (the deployment falls back to env, or to no auth). */
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const service = new URL(req.url).searchParams.get('service') ?? '';
  if (!provisionableServices().includes(service)) {
    return NextResponse.json(
      { error: `unknown or non-provisionable service: ${service || '(missing)'}` },
      { status: 400 },
    );
  }

  const orgId = await currentOrgId();
  try {
    const { removeCredentialSecret } = await import('@/lib/service-credential-provisioning');
    const removed = await removeCredentialSecret(service);
    auditFromSession(gate, orgId, {
      action: 'service-credential.delete',
      resource: `service-credential:${service}`,
      outcome: removed ? 'ok' : 'not-found',
    });
    return NextResponse.json({ object: 'service_credential', service, removed });
  } catch (err) {
    return NextResponse.json(
      { error: `could not remove the credential: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
