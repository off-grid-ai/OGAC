import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { provitTokens } from '@/db/schema';

// Provit integration tokens. A user mints one (bound to org + identity), hands it to their Provit
// instance, and Provit pushes with it — the console attributes the data to that org (org-visible).
// Only the hash is stored; the plaintext (prefix `pvt_`) is returned once.

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ProvitTokenBinding { id: string; orgId: string; ownerId: string }

export async function mintToken(orgId: string, ownerId: string, label: string): Promise<{ id: string; token: string }> {
  const id = `pvt_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(24).toString('base64url');
  const token = `${id}.${secret}`;               // id.secret — id is a lookup hint, hash covers both
  await db.insert(provitTokens).values({ id, tokenHash: sha256(token), orgId, ownerId, label });
  return { id, token };
}

/** Verify a Bearer value against the store. Returns the org/owner binding, or null. */
export async function verifyToken(token: string): Promise<ProvitTokenBinding | null> {
  if (!token || !token.startsWith('pvt_')) return null;
  const rows = await db.select().from(provitTokens).where(
    and(eq(provitTokens.tokenHash, sha256(token)), eq(provitTokens.revoked, false)),
  ).limit(1);
  const row = rows[0];
  if (!row) return null;
  void db.update(provitTokens).set({ lastUsedAt: new Date() }).where(eq(provitTokens.id, row.id)); // fire-and-forget
  return { id: row.id, orgId: row.orgId, ownerId: row.ownerId };
}

export async function listTokens(orgId: string) {
  return db.select({ id: provitTokens.id, label: provitTokens.label, ownerId: provitTokens.ownerId, createdAt: provitTokens.createdAt, lastUsedAt: provitTokens.lastUsedAt, revoked: provitTokens.revoked })
    .from(provitTokens).where(eq(provitTokens.orgId, orgId)).orderBy(desc(provitTokens.createdAt)).limit(100);
}

export async function revokeToken(id: string, orgId: string): Promise<void> {
  await db.update(provitTokens).set({ revoked: true }).where(and(eq(provitTokens.id, id), eq(provitTokens.orgId, orgId)));
}
