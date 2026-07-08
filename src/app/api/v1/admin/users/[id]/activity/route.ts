import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';
import {
  type ActivityFilters,
  type ActivityKind,
  type ActivityVerdict,
  buildActivityPage,
} from '@/lib/user-activity';
import { readUserActivity } from '@/lib/user-activity-reader';

export const dynamic = 'force-dynamic';

const KINDS: readonly ActivityKind[] = [
  'chat',
  'agent-run',
  'app-run',
  'query',
  'governance',
  'action',
];
const VERDICTS: readonly ActivityVerdict[] = [
  'allowed',
  'blocked',
  'redacted',
  'denied',
  'error',
  'unknown',
];

function parseFilters(url: URL): ActivityFilters {
  const kindRaw = url.searchParams.get('kind') ?? '';
  const verdictRaw = url.searchParams.get('verdict') ?? '';
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ActivityKind) : 'all';
  const verdict = (VERDICTS as readonly string[]).includes(verdictRaw)
    ? (verdictRaw as ActivityVerdict)
    : 'all';
  const pageNum = Number(url.searchParams.get('page'));
  const sizeNum = Number(url.searchParams.get('size'));
  return {
    kind,
    verdict,
    q: url.searchParams.get('q') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
    size: Number.isFinite(sizeNum) && sizeNum >= 1 ? sizeNum : undefined,
  };
}

// GET /api/v1/admin/users/:id/activity — the unified, time-ordered activity of ONE user (every prompt,
// chat, query, and app/agent run), with content + governance verdict. Admin-gated (only an admin can
// see another user's activity) and org-scoped. Best-effort: a source being down yields fewer rows,
// never a 500.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const org = await currentOrgId();

  // Resolve the user's attribution identity (email + username) from the identity provider. The URL
  // handle is the Keycloak user id; attribution keys off the email/username the producers recorded.
  const kc = keycloakAdmin();
  let email = '';
  let username = '';
  if (kc) {
    try {
      const user = await kc.getUser(id);
      if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });
      email = (user.email ?? '').trim();
      username = (user.username ?? '').trim();
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  } else {
    // No IdP configured — treat the URL handle itself as the attribution id (dev / break-glass).
    email = id;
  }

  const primary = email || username || id;
  const aliases = [email, username, id].filter((s) => s && s !== primary);

  const raw = await readUserActivity({ email: primary, aliases, org });
  const filters = parseFilters(new URL(req.url));
  const result = buildActivityPage(raw, filters);

  return NextResponse.json({
    configured: true,
    subject: { id, email, username },
    ...result,
  });
}
