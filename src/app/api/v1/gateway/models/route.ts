import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { MODEL_CATALOG, fleetModelTags, mergeFleetServed } from '@/lib/model-catalog';

export const dynamic = 'force-dynamic';

// Model-spec catalog for the routing-rule picker (Task #128). Returns the curated catalog
// reconciled against the LIVE fleet SSOT (`fleet_nodes.model` routing tags), so `servedOnFleet`
// reflects what the fleet is ACTUALLY serving right now — not just static assumptions. Admin only.
//
// Thin I/O seam: the merge/filter logic is the PURE model-catalog module; this route only reads the
// DB and delegates. If the fleet table can't be read we still return the static catalog (with its
// static servedOnFleet flags reconciled against an EMPTY live set → all false) rather than 500, so
// the picker degrades gracefully.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let tags: string[] = [];
  let fleetReadable = true;
  try {
    const rows = await db
      .select({ model: fleetNodes.model, role: fleetNodes.role })
      .from(fleetNodes);
    tags = fleetModelTags(rows);
  } catch {
    fleetReadable = false;
  }

  const models = mergeFleetServed(MODEL_CATALOG, tags);
  return NextResponse.json({
    object: 'list',
    data: models,
    fleetServedTags: tags,
    fleetReadable,
  });
}
