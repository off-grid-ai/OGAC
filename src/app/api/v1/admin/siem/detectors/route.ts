import { NextResponse } from 'next/server';
import { listDetectors } from '@/lib/adapters/opensearch-admin';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// SIEM security-analytics detectors (read-only) + their firing state (active/acknowledged alert
// counts). Degrades gracefully (supported:false + note) when the security-analytics plugin isn't
// installed on the deployed image — never faking data. Thin: auth, call the lib.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await listDetectors());
}
