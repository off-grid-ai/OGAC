import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { PRESIDIO_ENCRYPT_KEY_SECRET } from '@/lib/presidio-anonymizers';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Lifecycle of the org's Presidio AES key for the `encrypt` anonymizer operator.
//
// The key is SECRET MATERIAL: it is generated HERE (server-side CSPRNG), written straight to the
// secrets store, and NEVER returned by any endpoint, echoed to a client, or written to a file — the
// operator only ever learns *whether* a key is configured. This is what makes a keyless `encrypt`
// policy spec safe to persist: the intent lives in the policy row, the key lives only in the vault.
//
// A 24-byte CSPRNG value base64-encodes to 32 ASCII characters = a valid AES-256 key length (Presidio
// accepts 16/24/32 BYTES).
function generateAesKey(): string {
  return randomBytes(24).toString('base64');
}

async function secrets() {
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  return openBaoSecrets;
}

/** Is a key resolvable (vault first, env bootstrap second)? Never reveals the value. */
async function keyConfigured(): Promise<boolean> {
  try {
    const vaulted = await (await secrets()).get(PRESIDIO_ENCRYPT_KEY_SECRET);
    if (typeof vaulted === 'string' && vaulted.trim()) return true;
  } catch {
    /* vault unreachable — fall through to the env bootstrap */
  }
  return Boolean(process.env.OFFGRID_PRESIDIO_ENCRYPT_KEY?.trim());
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    configured: await keyConfigured(),
    note: 'The AES key is generated server-side and held in the secrets store. It is never returned. Without a key, an encrypt operator degrades to masking (the value is still redacted, never plaintext).',
  });
}

/** Generate (or rotate) the key. Returns only whether one is now configured — never the material. */
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const store = await secrets();
  if (!store.set) {
    return NextResponse.json({ error: 'secrets backend is not writable' }, { status: 503 });
  }
  const rotated = await keyConfigured();
  try {
    await store.set(PRESIDIO_ENCRYPT_KEY_SECRET, generateAesKey());
  } catch (e) {
    return NextResponse.json(
      { error: `could not store the key: ${(e as Error).message}` },
      { status: 502 },
    );
  }
  auditFromSession(gate, orgId, {
    action: rotated ? 'governance.masking.encrypt-key.rotate' : 'governance.masking.encrypt-key.create',
    resource: `secret:${PRESIDIO_ENCRYPT_KEY_SECRET}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: true, rotated });
}

/** Remove the key. Encryption then degrades to masking (fail safe), which the surface reports. */
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  try {
    const store = await secrets();
    if (store.remove) await store.remove(PRESIDIO_ENCRYPT_KEY_SECRET);
  } catch {
    /* best-effort */
  }
  auditFromSession(gate, orgId, {
    action: 'governance.masking.encrypt-key.remove',
    resource: `secret:${PRESIDIO_ENCRYPT_KEY_SECRET}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: await keyConfigured() });
}
