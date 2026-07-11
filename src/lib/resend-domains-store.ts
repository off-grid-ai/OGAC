// ─── Sending-domain registry (I/O half) — stores ONLY {domain, status, records} ───────────────────
//
// The PURE normalization (Resend response → {domain,status,records}) lives in resend-domains.ts. This
// module owns the additive, self-migrating `resend_domains` table (org-scoped) that remembers which
// domains an org has registered so the console can list them + re-check status without re-registering.
// We store NO secrets here (the API key is vaulted) and NO DNS of the customer's — only the records
// Resend told us to HAND to the customer, plus the id + status. Self-migrating (CREATE TABLE IF NOT
// EXISTS), memoized like the other ensure* helpers.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { DomainDnsRecord, DomainStatus, SendingDomain } from '@/lib/resend-domains';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

let ensurePromise: Promise<void> | null = null;
export function ensureResendDomainSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS resend_domains (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        domain text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        region text,
        records jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS resend_domains_org_idx ON resend_domains (org_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  org_id: string;
  domain: string;
  status: string;
  region: string | null;
  records: unknown;
  created_at: string | Date;
}

function rowToDomain(r: Row): SendingDomain {
  return {
    id: r.id,
    domain: r.domain,
    status: r.status as DomainStatus,
    region: r.region ?? undefined,
    records: Array.isArray(r.records) ? (r.records as DomainDnsRecord[]) : [],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Upsert a registered/refreshed domain for an org (stores only {domain,status,records}). */
export async function upsertResendDomain(orgId: string, d: SendingDomain): Promise<void> {
  await ensureResendDomainSchema();
  const org = orgId || DEFAULT_ORG;
  const records = JSON.stringify(d.records ?? []);
  await db.execute(sql`
    INSERT INTO resend_domains (id, org_id, domain, status, region, records, updated_at)
    VALUES (${d.id}, ${org}, ${d.domain}, ${d.status}, ${d.region ?? null}, ${records}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      records = EXCLUDED.records,
      region = EXCLUDED.region,
      updated_at = now()
  `);
}

export async function listResendDomains(orgId: string): Promise<SendingDomain[]> {
  await ensureResendDomainSchema();
  const res = await db.execute(sql`
    SELECT id, org_id, domain, status, region, records, created_at
    FROM resend_domains WHERE org_id = ${orgId || DEFAULT_ORG} ORDER BY created_at DESC
  `);
  return (res.rows as unknown as Row[]).map(rowToDomain);
}

export async function getResendDomain(id: string, orgId: string): Promise<SendingDomain | null> {
  await ensureResendDomainSchema();
  const res = await db.execute(sql`
    SELECT id, org_id, domain, status, region, records, created_at
    FROM resend_domains WHERE id = ${id} AND org_id = ${orgId || DEFAULT_ORG} LIMIT 1
  `);
  const row = (res.rows as unknown as Row[])[0];
  return row ? rowToDomain(row) : null;
}

/** Delete a domain registration row (org-scoped). Returns true if a row was removed. */
export async function deleteResendDomainRow(id: string, orgId: string): Promise<boolean> {
  await ensureResendDomainSchema();
  const res = await db.execute(sql`
    DELETE FROM resend_domains WHERE id = ${id} AND org_id = ${orgId || DEFAULT_ORG}
  `);
  return (res.rowCount ?? 0) > 0;
}
