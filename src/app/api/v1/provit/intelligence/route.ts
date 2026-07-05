import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { currentPrincipal, provitAbacAllows } from '@/lib/provit-access';
import { getIngestStatus, getRepos, startMap } from '@/lib/provit-intelligence';

export const dynamic = 'force-dynamic';

// Provit INTELLIGENCE ENGINE — console-brokered. Thin handler; all shaping is in
// src/lib/provit-intelligence.ts. Inherits the console's RBAC gate (requireUser) + Provit ABAC.
//
// GET  /api/v1/provit/intelligence          → Provit's mapped repos + the live map-job status.
// POST /api/v1/provit/intelligence { repo } → kick Provit's map-a-repo (ingest) on a public repo.

export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  if (!(await provitAbacAllows(p, 'read'))) {
    return NextResponse.json({ repos: [], status: null }, { headers: { 'cache-control': 'no-store' } });
  }
  const [repos, status] = await Promise.all([getRepos(), getIngestStatus()]);
  return NextResponse.json({ repos: repos.repos, error: repos.error, status }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  if (!(await provitAbacAllows(p, 'write'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { repo?: string };
  const r = await startMap(String(b.repo ?? ''));
  if (!r.started) return NextResponse.json({ error: r.error ?? 'map failed' }, { status: r.status ?? 502 });
  return NextResponse.json({ started: true, repo: r.repo });
}
