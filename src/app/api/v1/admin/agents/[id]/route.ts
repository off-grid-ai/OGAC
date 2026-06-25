import { NextResponse } from 'next/server';
import { deleteCustomAgent, getCustomAgent, setCustomAgentEnabled } from '@/lib/store';

// PATCH { enabled } → toggle a user-authored agent. DELETE → remove it. Built-in agents are not
// stored in the DB, so these only affect custom agents (404 otherwise).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getCustomAgent(id))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof b?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  await setCustomAgentEnabled(id, b.enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getCustomAgent(id))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await deleteCustomAgent(id);
  return NextResponse.json({ ok: true });
}
