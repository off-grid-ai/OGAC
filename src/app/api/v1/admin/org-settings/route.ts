import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import {
  getChatBindingGovernance,
  getOrgSystemPrompt,
  setChatBindingGovernance,
  setOrgSystemPrompt,
} from '@/lib/store';

// Org-wide settings — the system prompt injected into every chat + the GOVERNED chat-binding
// (org-default chat pipeline + the SET of pipelines a user may pick per-project). Admin-only.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Per-tenant (SECURITY WAVE 1): read only the caller's org settings — was a single shared row.
  const org = await currentOrgId();
  const [systemPrompt, chatBinding] = await Promise.all([
    getOrgSystemPrompt(org),
    getChatBindingGovernance(org),
  ]);
  return NextResponse.json({ systemPrompt, chatBinding });
}

export async function PUT(req: Request) {
  // requireAdmin already enforces the admin role AND accepts the service bearer token (the standard
  // gate every other admin route uses). The previous extra `auth()` session re-check rejected the
  // service-token path (auth() is null for a bearer request), making this route inconsistently
  // stricter than the rest — dropped so it matches. (gap PA-14)
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const by = gate.user.email ?? 'admin';
  const org = await currentOrgId();
  const b = (await req.json().catch(() => null)) as {
    systemPrompt?: unknown;
    defaultChatPipelineId?: unknown;
    chatPipelineAllowlist?: unknown;
  } | null;
  if (!b) return NextResponse.json({ error: 'body required' }, { status: 400 });

  // System-prompt update (kept for back-compat with the existing OrgInstructionsEditor).
  if (b.systemPrompt !== undefined) {
    if (typeof b.systemPrompt !== 'string') {
      return NextResponse.json({ error: 'systemPrompt must be a string' }, { status: 400 });
    }
    await setOrgSystemPrompt(b.systemPrompt, by, org);
    auditFromSession(gate, org, {
      action: 'org.settings.change',
      resource: 'org:system-prompt',
      outcome: 'ok',
    });
  }

  // Chat-binding governance update (org-default chat pipeline + available-for-chat set).
  if (b.defaultChatPipelineId !== undefined || b.chatPipelineAllowlist !== undefined) {
    const defaultChatPipelineId =
      typeof b.defaultChatPipelineId === 'string' && b.defaultChatPipelineId
        ? b.defaultChatPipelineId
        : null;
    const allowlist = Array.isArray(b.chatPipelineAllowlist)
      ? b.chatPipelineAllowlist.filter((x): x is string => typeof x === 'string')
      : [];
    await setChatBindingGovernance({ defaultChatPipelineId, allowlist }, by, org);
    auditFromSession(gate, org, {
      action: 'org.settings.change',
      resource: 'org:chat-pipeline-binding',
      outcome: 'ok',
    });
  }

  return NextResponse.json({ ok: true });
}
