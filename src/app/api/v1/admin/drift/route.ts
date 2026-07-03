import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readDriftView } from '@/lib/drift-view';

// Admin drift read-back — the normalized drift display model (overall verdict + per-feature drift
// status/score + windows + last-checked). Best-effort: readDriftView never throws, so a
// { data, error } envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readDriftView());
}
