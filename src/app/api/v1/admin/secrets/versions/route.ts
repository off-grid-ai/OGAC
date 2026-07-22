import { NextResponse } from 'next/server';
import {
  baoDeleteVersions,
  baoDestroyVersions,
  baoRotate,
  baoUndeleteVersions,
  baoVersions,
  openBaoConfigured,
} from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { isConnectorCredentialPath } from '@/lib/connector-secret-policy';
import { validateKeyPath } from '@/lib/secret-keys';
import { scopeSecretKey } from '@/lib/secret-scope';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function connectorCredentialConflict(): NextResponse {
  return NextResponse.json(
    {
      error: 'Connector credentials are managed from their data source.',
      manageAt: '/data/sources',
    },
    { status: 409 },
  );
}

// KV v2 versioning + rotation for a single key. Returns VERSION METADATA only (version numbers,
// timestamps, deleted/destroyed state) — never a secret value. Rotation POSTs a new value (which
// is write-only, forwarded to the adapter, never echoed). Destructive version ops (destroy) require
// an explicit list of version numbers.

function parseVersions(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => {
      if (typeof n === 'number') return Math.floor(n);
      if (typeof n === 'string') return Number.parseInt(n, 10);
      return Number.NaN;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
}

function guard(): NextResponse | null {
  if (!openBaoConfigured()) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  return null;
}

// GET ?key=... → version history for the key.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const v = validateKeyPath(new URL(req.url).searchParams.get('key'));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (isConnectorCredentialPath(v.key)) return connectorCredentialConflict();
  const blocked = guard();
  if (blocked) return blocked;
  try {
    // TENANT ISOLATION: read version metadata only within this tenant's `<org>/` namespace.
    const versions = await baoVersions(scopeSecretKey(await currentOrgId(), v.key));
    return NextResponse.json({ key: v.key, versions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// POST { key, action, value?, versions? }
//   action 'rotate'   → write a new version (value required); destroyPrior[] optional (hard-destroy)
//   action 'delete'   → soft-delete versions[] (recoverable)
//   action 'undelete' → recover versions[]
//   action 'destroy'  → hard-destroy versions[] (irreversible)
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as {
    key?: unknown;
    action?: unknown;
    value?: unknown;
    versions?: unknown;
    destroyPrior?: unknown;
  } | null;
  const v = validateKeyPath(b?.key);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (isConnectorCredentialPath(v.key)) return connectorCredentialConflict();
  const blocked = guard();
  if (blocked) return blocked;

  // TENANT ISOLATION: every version op targets the org-namespaced stored key, so a tenant can only
  // rotate/delete/destroy secrets within its own `<org>/` namespace.
  const key = scopeSecretKey(await currentOrgId(), v.key);
  try {
    switch (b?.action) {
      case 'rotate': {
        if (typeof b.value !== 'string' || b.value.length === 0) {
          return NextResponse.json({ error: 'value (non-empty string) required' }, { status: 400 });
        }
        const result = await baoRotate(key, b.value, parseVersions(b.destroyPrior));
        return NextResponse.json({ ok: true, key: v.key, version: result.version }, { status: 201 });
      }
      case 'delete':
        await baoDeleteVersions(key, parseVersions(b.versions));
        return NextResponse.json({ ok: true, key: v.key });
      case 'undelete':
        await baoUndeleteVersions(key, parseVersions(b.versions));
        return NextResponse.json({ ok: true, key: v.key });
      case 'destroy':
        await baoDestroyVersions(key, parseVersions(b.versions));
        return NextResponse.json({ ok: true, key: v.key });
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
