import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readSiemView } from '@/lib/siem-view';

// Admin SIEM read-back — the normalized security/audit event display model (events newest-first
// plus rollups: counts by outcome, top actors, blocked/denied). Best-effort: readSiemView never
// throws, so a { configured, data, error } envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readSiemView());
}
