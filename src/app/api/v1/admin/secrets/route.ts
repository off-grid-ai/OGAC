import { NextResponse } from 'next/server';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { isConnectorCredentialPath } from '@/lib/connector-secret-policy';
import { normalizeKeyList, validateKeyPath } from '@/lib/secret-keys';
import { orgSecretPrefix, scopeSecretKey, scopeSecretKeyList } from '@/lib/secret-scope';
import { readSecretsView } from '@/lib/secrets-view';
import { currentOrgId } from '@/lib/tenancy';

function connectorCredentialConflict(): NextResponse {
  return NextResponse.json(
    {
      error: 'Connector credentials are managed from their data source.',
      manageAt: '/data/sources',
    },
    { status: 409 },
  );
}

// OpenBao secrets management. Stores connector/tool credentials and virtual-key secrets in
// OpenBao KV v2 via the openBaoSecrets adapter. Secret VALUES are never returned by GET — only
// key NAMES (normalized) plus a STATUS model (reachable/sealed/version/mounts) — so callers see
// what's stored and the store's health without any secret material ever leaving OpenBao.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Read-only STATUS/METADATA model (sys endpoints only — never a secret value).
  const { data: status, error } = await readSecretsView();
  if (!openBaoConfigured() || !openBaoSecrets.list) {
    return NextResponse.json({ configured: false, keys: [], status, error });
  }
  // TENANT ISOLATION (SURFACE-2): list only THIS tenant's `<org>/` namespace so the UI never shows a
  // sibling tenant's `org_*/` folder. The adapter LISTs under the prefix (OpenBao returns keys
  // relative to it); scopeSecretKeyList is a defensive belt that also drops anything outside the
  // namespace should a backend ever return absolute keys. Default org → no prefix (single-tenant).
  const org = await currentOrgId();
  const prefix = orgSecretPrefix(org);
  const raw = await openBaoSecrets.list(prefix || undefined);
  // When scoped, the adapter already returns tenant-relative keys; only strip when a returned key
  // still carries the absolute prefix (belt-and-suspenders). Root keys under a namespaced org that
  // don't belong to it are dropped by scopeSecretKeyList.
  const relative = prefix
    ? raw.map((k) => (k.startsWith(prefix) ? k : `${prefix}${k}`))
    : raw;
  const keys = normalizeKeyList(scopeSecretKeyList(org, prefix ? relative : raw));
  return NextResponse.json({ configured: true, keys, status, error });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  // Value must be a non-empty string, but is NEVER validated for content, echoed, logged, or
  // returned — only forwarded to the adapter's set().
  if (!b || typeof b.value !== 'string' || b.value.length === 0) {
    return NextResponse.json({ error: 'value (non-empty string) required' }, { status: 400 });
  }
  const v = validateKeyPath(b.key);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (isConnectorCredentialPath(v.key)) return connectorCredentialConflict();
  if (!openBaoConfigured() || !openBaoSecrets.set) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    // TENANT ISOLATION: write into THIS tenant's `<org>/` namespace. The client sends a tenant-
    // relative key; scopeSecretKey prepends the org prefix, so a tenant can never write outside its
    // own namespace (even by typing an absolute path). Echo the RELATIVE key the client knows.
    const org = await currentOrgId();
    await openBaoSecrets.set(scopeSecretKey(org, v.key), b.value);
    auditFromSession(gate, org, {
      action: 'secret.write',
      resource: `secret:${scopeSecretKey(org, v.key)}`,
      outcome: 'ok',
    });
    // Echo only the KEY name back — never the value.
    return NextResponse.json({ ok: true, key: v.key }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const v = validateKeyPath(new URL(req.url).searchParams.get('key'));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (isConnectorCredentialPath(v.key)) return connectorCredentialConflict();
  if (!openBaoConfigured() || !openBaoSecrets.remove) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    // TENANT ISOLATION: delete only within THIS tenant's `<org>/` namespace (scopeSecretKey prefixes
    // the client's relative key) — a tenant cannot delete another org's secret by absolute path.
    const org = await currentOrgId();
    await openBaoSecrets.remove(scopeSecretKey(org, v.key));
    auditFromSession(gate, org, {
      action: 'secret.write',
      resource: `secret:${scopeSecretKey(org, v.key)}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, key: v.key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
