import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  type SuppressionInput,
  type SuppressionRule,
  validateSuppression,
} from '@/lib/siem-suppress-policy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Console-owned SIEM suppression store (I/O adapter). Pure rules live in siem-suppress-policy.ts.
// The `siem_suppressions` table is created idempotently on first use (files.ts / policy-rules.ts
// pattern) so the module deploys over SSH with no migration step and without touching schema.ts.

let ensurePromise: Promise<void> | null = null;
export async function ensureSiemSuppressSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS siem_suppressions (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        kind text NOT NULL,
        pattern text NOT NULL,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS siem_suppressions_org_idx ON siem_suppressions (org_id);`,
    );
  })();
  return ensurePromise;
}

interface Row {
  id: string;
  kind: string;
  pattern: string;
  note: string;
  created_at: string | Date;
}

function toRule(r: Row): SuppressionRule {
  return {
    id: r.id,
    kind: r.kind as SuppressionRule['kind'],
    pattern: r.pattern,
    note: r.note,
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at) ?? '',
  };
}

export async function listSuppressions(orgId: string = DEFAULT_ORG): Promise<SuppressionRule[]> {
  await ensureSiemSuppressSchema();
  const res = await db.execute(sql`
    SELECT id, kind, pattern, note, created_at FROM siem_suppressions
    WHERE org_id = ${orgId} ORDER BY created_at DESC;
  `);
  return (res.rows as unknown as Row[]).map(toRule);
}

export async function createSuppression(
  input: SuppressionInput,
  orgId: string = DEFAULT_ORG,
): Promise<{ ok: boolean; rule?: SuppressionRule; error?: string }> {
  const v = validateSuppression(input);
  if (!v.ok || !v.value) return { ok: false, error: v.error };
  await ensureSiemSuppressSchema();
  const id = `sup_${randomUUID().slice(0, 8)}`;
  await db.execute(sql`
    INSERT INTO siem_suppressions (id, org_id, kind, pattern, note)
    VALUES (${id}, ${orgId}, ${v.value.kind}, ${v.value.pattern}, ${v.value.note ?? ''});
  `);
  return {
    ok: true,
    rule: { id, kind: v.value.kind, pattern: v.value.pattern, note: v.value.note ?? '', createdAt: '' },
  };
}

export async function deleteSuppression(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureSiemSuppressSchema();
  const res = await db.execute(sql`
    DELETE FROM siem_suppressions WHERE id = ${id} AND org_id = ${orgId};
  `);
  return (res.rowCount ?? 0) > 0;
}
