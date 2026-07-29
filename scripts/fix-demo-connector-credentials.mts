// ─── Give every demo SQL connector a credential it can actually connect with ──────────────────────────
//
// `con_f5c959` (org_bharat) carried the endpoint `mysql://policyadmin@127.0.0.1:3307/policyadmin` — no
// password — while its sibling in the SAME org carried `policyadmin:policyadmin`. So the reimbursement app's
// quota read connected password-less and was refused, and the console reported that as "No rows returned",
// which the agent then read as "this employee has no quota" and declined the claim.
//
// The code no longer lies about that (a failed read is now an error naming its cause). This fixes the data
// half: the password goes into the VAULT — the designed path — rather than being inlined into the endpoint,
// so the row stays credential-free and the run exercises the same credential resolution a real tenant uses.
//
// Scoped to the two demo orgs. Idempotent: a connector that already resolves a secret is left alone.
//
// RUN (on the server, where the vault and the DB are): npx tsx scripts/fix-demo-connector-credentials.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { persistConnectorSecret, resolveConnectorSecret } from '../src/lib/connector-secrets.ts';
import { detectDialect, testConnection } from '../src/lib/connector-exec.ts';

/** The demo sources' passwords. Demo box, all OSS, no real data — see the deployment notes. */
const DEMO_PASSWORD: Record<string, string> = {
  mysql: 'policyadmin',
  postgres: 'offgrid',
};

const rows = (await db.execute(sql`
  SELECT id, org_id, type, endpoint FROM connectors
  WHERE org_id IN ('org_bharat','org_suraksha')
`)) as unknown as { rows: { id: string; org_id: string; type: string; endpoint: string }[] };

for (const row of rows.rows ?? []) {
  const dialect = detectDialect(row.type, row.endpoint);
  if (dialect !== 'mysql' && dialect !== 'postgres' && dialect !== 'mssql') continue;

  // Does the endpoint already carry a password (user:pass@)? Then nothing to fix.
  const inline = /^[a-z+]+:\/\/[^:/@]+:[^@]+@/.test(row.endpoint);
  const vaulted = await resolveConnectorSecret(row.id, row.org_id).catch(() => null);

  if (inline || vaulted) {
    const probe = await testConnection({ ...row, type: row.type, endpoint: row.endpoint, orgId: row.org_id });
    console.log(`${row.id} (${row.org_id}): ${inline ? 'inline' : 'vaulted'} credential — ${probe.ok ? 'connects' : `FAILS: ${probe.message}`}`);
    continue;
  }

  const password = DEMO_PASSWORD[dialect];
  if (!password) {
    console.log(`${row.id} (${row.org_id}): no credential and no known demo password — left alone`);
    continue;
  }

  await persistConnectorSecret(row.id, row.org_id, password);
  // Prove it: resolve the credential the way a run does and open a real connection.
  const probe = await testConnection({ type: row.type, endpoint: row.endpoint, id: row.id, orgId: row.org_id });
  console.log(`${row.id} (${row.org_id}): vaulted a credential — ${probe.ok ? 'connects' : `STILL FAILS: ${probe.message}`}`);
}
