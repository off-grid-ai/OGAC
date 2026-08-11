// ─── Demo seed: a SECOND dynamic-database role (audit-readonly) ──────────────────────────────────
//
// WHY. /governance/secrets/dynamic-database lists configured OpenBao database roles and lets an
// operator mint short-lived creds against one (GET/POST /api/v1/admin/secrets/dynamic-db →
// src/lib/adapters/secrets.ts baoDbRoles/baoDbCreds). Role CREATION is NOT a console-owned write
// path at all — the console only lists roles an operator already configured in OpenBao and issues
// creds against them (mirrors the KV secret VALUES: OpenBao is the system of record, the console is
// a thin read/issue layer over it). Before this script, both tenants saw exactly ONE role
// ("demo-readonly", default_ttl 3600s) — real, but thin.
//
// NOTE ON SCOPE: `baoDbRoles()` lists EVERY role in the `database` secrets engine with no per-org
// filter, so a role is visible to every tenant's dynamic-database page identically (a structural fact
// of the product, not something this seed changes). A second, generically-named role reads as more
// real on BOTH tenants without mixing bank/insurer domain data into it.
//
// WHAT. A second role, `audit-readonly` — the same read-only grants as `demo-readonly` but a
// shorter default/max TTL (1800s/7200s vs 3600s/14400s), representing a tighter-scoped credential an
// auditor or compliance reviewer would be issued vs. a general demo-readonly grant.
//
// HOW. Writes directly to OpenBao's own config API (`PUT /v1/database/roles/<name>`) using
// OFFGRID_OPENBAO_URL + OFFGRID_OPENBAO_TOKEN from the environment — the real system of record for
// this resource, since the console exposes no create-role UI. Mirrors the connection the existing
// `demo-readonly` role already uses (`db_name: console-pg`, read the live role first if you need to
// confirm the connection name on a fresh box: `GET /v1/database/roles/demo-readonly`).
//
// IDEMPOTENT: checks whether `audit-readonly` already exists (GET) before writing; if present with
// the same shape, does nothing (a PUT would be idempotent anyway, but we still skip + report so a
// re-run's output is honest about what changed).
//
// RUN (on the box, .env.local loaded, or anywhere with network access + the OpenBao token):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-openbao-audit-role.mts
const BAO_URL = (process.env.OFFGRID_OPENBAO_URL ?? 'http://127.0.0.1:8200').replace(/\/$/, '');
const BAO_TOKEN = process.env.OFFGRID_OPENBAO_TOKEN;
const DB_MOUNT = process.env.OFFGRID_OPENBAO_DB_MOUNT ?? 'database';
const ROLE_NAME = 'audit-readonly';
const DB_NAME = process.env.OFFGRID_OPENBAO_DB_CONNECTION ?? 'console-pg';
const DB_TARGET = process.env.OFFGRID_OPENBAO_DB_TARGET ?? 'offgrid_console';

if (!BAO_TOKEN) {
  console.error('[seed:openbao-audit-role] OFFGRID_OPENBAO_TOKEN is required.');
  process.exit(1);
}

async function bao(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BAO_URL}/v1/${path}`, {
    ...init,
    headers: { 'X-Vault-Token': BAO_TOKEN!, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function main(): Promise<void> {
  const existing = await bao(`${DB_MOUNT}/roles/${ROLE_NAME}`);
  if (existing.ok) {
    console.log(`[seed:openbao-audit-role] "${ROLE_NAME}" already exists on mount "${DB_MOUNT}" — skipping.`);
    return;
  }

  const body = {
    db_name: DB_NAME,
    default_ttl: '1800s',
    max_ttl: '7200s',
    creation_statements: [
      `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';`,
      `GRANT CONNECT ON DATABASE ${DB_TARGET} TO "{{name}}";`,
      `GRANT USAGE ON SCHEMA public TO "{{name}}";`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{name}}";`,
    ],
    revocation_statements: [
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "{{name}}";`,
      `REVOKE ALL PRIVILEGES ON SCHEMA public FROM "{{name}}";`,
      `REVOKE CONNECT ON DATABASE ${DB_TARGET} FROM "{{name}}";`,
      `DROP ROLE IF EXISTS "{{name}}";`,
    ],
  };

  const res = await bao(`${DB_MOUNT}/roles/${ROLE_NAME}`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    console.error(`[seed:openbao-audit-role] FAILED (HTTP ${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  console.log(`[seed:openbao-audit-role] created "${ROLE_NAME}" on mount "${DB_MOUNT}" (db_name=${DB_NAME}).`);
}

main().catch((e) => {
  console.error('[seed:openbao-audit-role] FATAL', e);
  process.exit(1);
});
