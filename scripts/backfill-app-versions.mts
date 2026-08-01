// ─── Give every existing app a v1 ──────────────────────────────────────────────────────────────────
//
// App version history is new, so on the day it ships every app has an empty History tab — and an empty
// history means there is nothing to roll BACK to, which is the half of the feature an operator needs
// when something has already gone wrong. This freezes the CURRENT spec of every app as v1, so the
// floor exists from the start.
//
// Run ON the box:
//   cd /Users/admin/offgrid/console && \
//     /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-app-versions.mts
//
// Idempotent: recordAppVersion no-ops when the latest snapshot already matches the live spec.

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { listApps } from '../src/lib/apps-store.ts';
import { recordAppVersion } from '../src/lib/app-versions-store.ts';

const orgs = await db.execute(sql`SELECT DISTINCT org_id FROM apps ORDER BY org_id`);
let written = 0;
let skipped = 0;

for (const row of orgs.rows as { org_id: string }[]) {
  const apps = await listApps(row.org_id);
  for (const app of apps) {
    const version = await recordAppVersion(
      app.id,
      app.orgId,
      {
        title: app.title,
        summary: app.summary,
        visibility: app.visibility,
        pipelineId: app.pipelineId ?? null,
        slug: app.slug ?? null,
        published: app.published,
        trigger: app.trigger,
        inputForm: app.inputForm ?? null,
        steps: app.steps as never,
        edges: app.edges,
      },
      app.ownerId,
      'Existing configuration at the time version history was introduced',
    );
    if (version) written++;
    else skipped++;
  }
  console.log(`${row.org_id}: ${apps.length} apps`);
}

const total = await db.execute(sql`SELECT count(*)::int AS n FROM app_versions`);
console.log(`\nwritten ${written}, already-current ${skipped}, rows now ${(total.rows[0] as { n: number }).n}`);
process.exit(0);
