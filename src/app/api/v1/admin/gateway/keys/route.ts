import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { generateVirtualKey, listVirtualKeys } from '@/lib/litellm';
import {
  buildKeyGenerateBody,
  type KeyInput,
  shapeKeyList,
  validateKeyInput,
} from '@/lib/litellm-key-policy';

export const dynamic = 'force-dynamic';

// Gateway virtual keys — LiteLLM's DB-backed FinOps (per-key budget + RPM/TPM), managed from the
// console. GET lists the keys with spend/budget/utilization; POST mints a new key with limits.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const rows = shapeKeyList(await listVirtualKeys());
  return NextResponse.json({ object: 'list', data: rows });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => ({}))) as KeyInput;
  const v = validateKeyInput(body);
  if (!v.ok) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  try {
    const created = (await generateVirtualKey(buildKeyGenerateBody(body))) as { key?: string };
    return NextResponse.json({ created: true, key: created.key ?? null }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
