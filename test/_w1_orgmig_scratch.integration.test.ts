import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// Scratch check: the legacy single-tenant org_settings row (id='org') is re-homed onto DEFAULT_ORG
// by ensureOrgSchema, so an upgraded single-tenant deploy keeps its existing system prompt.
const dbUp = await dbReachable();
test('org_settings legacy singleton migrates to DEFAULT_ORG', { skip: dbUp ? false : SKIP_MESSAGE }, async () => {
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`CREATE TABLE IF NOT EXISTS org_settings (id text PRIMARY KEY DEFAULT 'org', system_prompt text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL DEFAULT '');`);
  await db.execute(sql`DELETE FROM org_settings WHERE id IN ('org','default');`);
  await db.execute(sql`INSERT INTO org_settings (id, system_prompt, updated_by) VALUES ('org','LEGACY-PROMPT','legacy');`);
  const { ensureOrgSchema, getOrgSystemPrompt } = await import('@/lib/store');
  await ensureOrgSchema();
  assert.equal(await getOrgSystemPrompt('default'), 'LEGACY-PROMPT', 'legacy prompt re-homed to DEFAULT_ORG');
  const left = await db.execute(sql`SELECT count(*)::int AS n FROM org_settings WHERE id='org'`);
  const rows = (left as unknown as { rows?: { n: number }[] }).rows ?? (left as unknown as { n: number }[]);
  assert.equal(Number(rows[0].n), 0, "no legacy id='org' row remains");
  await db.execute(sql`DELETE FROM org_settings WHERE id='default' AND updated_by='legacy';`);
});
