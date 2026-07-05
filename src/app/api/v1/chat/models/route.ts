import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isDenied } from '@/lib/chat-governance';

export const dynamic = 'force-dynamic';

import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

// The models the chat model-picker offers — proxied from the gateway/aggregator so the browser
// never hits it directly. Falls back to a single default if the gateway doesn't enumerate.
// eslint-disable-next-line complexity
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/models`, {
      cache: 'no-store',
      headers: gatewayHeaders(),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const all = (data?.data ?? []).map((m: { id: string; capabilities?: string[] }) => ({
      id: m.id,
      vision: (m.capabilities ?? []).includes('vision'),
      image: (m.capabilities ?? []).includes('image-generation'),
    }));
    // RBAC gate: hide models this role is denied (abacRules resource 'chat.model'). Admins see all.
    const role = session.user.role ?? 'viewer';
    const models = [];
    for (const m of all) {
      if (!(await isDenied(role, 'chat.model', m.id))) models.push(m);
    }
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({
      models: [],
      error: 'gateway_unreachable',
      gatewayUrl: GATEWAY_URL,
    });
  }
}
