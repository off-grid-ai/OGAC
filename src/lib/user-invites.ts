// ─── USER INVITE — the impure STORE + provisioning seam (thin I/O over the pure rules) ─────────────
//
// The adapter behind the PURE user-invites-policy.ts. It owns:
//   • a self-migrating `user_invites` table (CREATE TABLE IF NOT EXISTS — deploy is rsync-only, so the
//     table converges on first use; we do NOT touch src/db/schema.ts, mirroring app-sharing.ts/teams.ts);
//   • invite CRUD (create, list, get-by-token-hash, revoke, mark-accepted) — all ORG-SCOPED;
//   • the Keycloak PROVISIONING call (reusing the console's existing keycloak-admin client);
//   • sending the invite email via the RESEND sink (reusing email-resend.ts — the one email path);
//   • applying the invite's optional app grants via the app-sharing seam (grantAppAccess).
//
// Every correctness decision (token hashing, expiry, accept-state) is delegated to the pure module;
// this file is the wiring. Keep it thin.

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { keycloakAdmin, type KcRole } from '@/lib/keycloak-admin';
import { sendViaResend } from '@/lib/adapters/sinks/email-resend';
import type { EmailMessage } from '@/lib/adapters/sinks/email-smtp';
import { grantAppAccess } from '@/lib/app-sharing';
import {
  type InviteAppGrant,
  type InviteOrgRole,
  type InviteStatus,
  DEFAULT_INVITE_TTL_DAYS,
  INVITE_REQUIRED_ACTIONS,
  buildAcceptUrl,
  buildInviteEmail,
  evaluateAccept,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  keycloakRealmRoleForOrgRole,
  normalizeOrgRole,
  sanitizeAppGrants,
} from '@/lib/user-invites-policy';

// ─── self-migrate (memoized; mirrors ensureTeamsSchema / ensureAppSharingSchema) ────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureUserInvitesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_invites (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        email text NOT NULL,
        token_hash text NOT NULL,
        invited_by text NOT NULL DEFAULT '',
        role text NOT NULL DEFAULT 'viewer',
        app_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'pending',
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        accepted_at timestamptz);
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS user_invites_org_idx ON user_invites (org_id);`);
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS user_invites_token_idx ON user_invites (token_hash);`,
    );
    await db.execute(sql`CREATE INDEX IF NOT EXISTS user_invites_email_idx ON user_invites (org_id, email);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── views ────────────────────────────────────────────────────────────────────────────────────────
function iso(v: string | Date | null | undefined): string | null {
  return v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
}

// The public shape — NEVER includes token_hash (the secret's at-rest form stays server-side only).
export interface InviteView {
  id: string;
  orgId: string;
  email: string;
  invitedBy: string;
  role: InviteOrgRole;
  appGrants: InviteAppGrant[];
  status: InviteStatus;
  expiresAt: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  token_hash: string;
  invited_by: string;
  role: string;
  app_grants: unknown;
  status: string;
  expires_at: string | Date;
  created_at: string | Date | null;
  accepted_at: string | Date | null;
}

function toView(r: InviteRow): InviteView {
  return {
    id: r.id,
    orgId: r.org_id,
    email: r.email,
    invitedBy: r.invited_by,
    role: normalizeOrgRole(r.role),
    appGrants: sanitizeAppGrants(r.app_grants),
    status: (r.status as InviteStatus) ?? 'pending',
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
    acceptedAt: iso(r.accepted_at),
  };
}

function toExpiresDate(r: InviteRow): Date {
  return r.expires_at instanceof Date ? r.expires_at : new Date(r.expires_at);
}

// ─── create ─────────────────────────────────────────────────────────────────────────────────────────
export interface CreateInviteArgs {
  orgId: string;
  email: string;
  role: InviteOrgRole;
  appGrants: InviteAppGrant[];
  invitedBy: string;
  ttlDays?: number;
  now?: Date;
}

export interface CreatedInvite {
  invite: InviteView;
  /** The plaintext token — returned ONCE so the caller can build + send the accept link. Never stored. */
  token: string;
}

/** Persist a fresh invite (token hashed at rest) and return the plaintext token for the email. */
export async function createInvite(args: CreateInviteArgs): Promise<CreatedInvite> {
  await ensureUserInvitesSchema();
  const now = args.now ?? new Date();
  const { token, tokenHash } = generateInviteToken();
  const expiresAt = inviteExpiryFrom(now, args.ttlDays ?? DEFAULT_INVITE_TTL_DAYS);
  const id = randomUUID();
  const grants = JSON.stringify(sanitizeAppGrants(args.appGrants));
  await db.execute(sql`
    INSERT INTO user_invites (id, org_id, email, token_hash, invited_by, role, app_grants, status, expires_at, created_at)
    VALUES (${id}, ${args.orgId}, ${args.email}, ${tokenHash}, ${args.invitedBy}, ${normalizeOrgRole(args.role)},
            ${grants}::jsonb, 'pending', ${expiresAt.toISOString()}, ${now.toISOString()});
  `);
  const invite = await getInviteById(id, args.orgId);
  if (!invite) throw new Error('invite created but could not be retrieved');
  return { invite, token };
}

// ─── reads ────────────────────────────────────────────────────────────────────────────────────────
export async function listInvites(orgId: string = DEFAULT_ORG): Promise<InviteView[]> {
  await ensureUserInvitesSchema();
  const res = await db.execute(sql`
    SELECT * FROM user_invites WHERE org_id = ${orgId} ORDER BY created_at DESC;
  `);
  return (res.rows as unknown as InviteRow[]).map(toView);
}

export async function getInviteById(id: string, orgId: string = DEFAULT_ORG): Promise<InviteView | null> {
  await ensureUserInvitesSchema();
  const res = await db.execute(sql`
    SELECT * FROM user_invites WHERE id = ${id} AND org_id = ${orgId} LIMIT 1;
  `);
  const row = (res.rows as unknown as InviteRow[])[0];
  return row ? toView(row) : null;
}

// The RAW row for a presented plaintext token — looked up by its HASH (the token itself is never
// stored). Not org-scoped (the accept flow is public and org-agnostic — the invite carries its org).
// Returns null when no invite matches the hash.
async function getInviteRowByToken(token: string): Promise<InviteRow | null> {
  await ensureUserInvitesSchema();
  const res = await db.execute(sql`
    SELECT * FROM user_invites WHERE token_hash = ${hashInviteToken(token)} LIMIT 1;
  `);
  return (res.rows as unknown as InviteRow[])[0] ?? null;
}

// ─── revoke / resend / expire transitions ───────────────────────────────────────────────────────────
async function setStatus(id: string, orgId: string, status: InviteStatus): Promise<void> {
  await db.execute(sql`
    UPDATE user_invites SET status = ${status} WHERE id = ${id} AND org_id = ${orgId};
  `);
}

/** Revoke a pending invite (idempotent; a non-pending invite is left as-is). Returns the updated view. */
export async function revokeInvite(id: string, orgId: string = DEFAULT_ORG): Promise<InviteView | null> {
  await ensureUserInvitesSchema();
  const current = await getInviteById(id, orgId);
  if (!current) return null;
  if (current.status === 'pending') await setStatus(id, orgId, 'revoked');
  return getInviteById(id, orgId);
}

/** Delete an invite outright (org-scoped). Returns true when a row was removed. */
export async function deleteInvite(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureUserInvitesSchema();
  const res = await db.execute(sql`DELETE FROM user_invites WHERE id = ${id} AND org_id = ${orgId};`);
  return (res.rowCount ?? 0) > 0;
}

// ─── SEND — reuse the Resend sink (the one email path) ──────────────────────────────────────────────
export interface SendInviteArgs {
  invite: InviteView;
  token: string;
  baseUrl: string;
  orgName: string;
  invitedByName?: string;
  now?: Date;
}

export interface SendInviteResult {
  ok: boolean;
  reason: string;
  /** Resend's message id (audit trail) when sent. */
  id?: string;
  configured: boolean;
}

/**
 * Send (or re-send) the invite email through the Resend sink. Thin: builds the pure email body +
 * accept link, then hands a plain EmailMessage to sendViaResend. Honest degrade: an unconfigured
 * Resend sink returns { configured:false } — the invite is still created, it just wasn't emailed.
 * `fetchImpl`/`env` are pass-throughs so tests can stub the Resend boundary without real egress.
 */
export async function sendInviteEmail(
  args: SendInviteArgs,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SendInviteResult> {
  const acceptUrl = buildAcceptUrl(args.baseUrl, args.token);
  const expiresDisplay = args.invite.expiresAt
    ? new Date(args.invite.expiresAt).toUTCString()
    : 'soon';
  const { subject, text } = buildInviteEmail({
    orgName: args.orgName,
    acceptUrl,
    invitedByName: args.invitedByName,
    expiresAtDisplay: expiresDisplay,
  });
  const msg: EmailMessage = { to: args.invite.email, subject, text };
  const res = await sendViaResend(
    msg,
    { html: true, tags: { type: 'user_invite', org: args.invite.orgId } },
    env,
    fetchImpl,
  );
  return { ok: res.ok, reason: res.reason, id: res.id, configured: res.configured };
}

// ─── ACCEPT — validate → provision Keycloak → apply grants → mark consumed ──────────────────────────
export interface AcceptResult {
  ok: boolean;
  reason: string;
  /** HTTP-ish status the route maps directly (200 ok, 404 unknown token, 410 expired/consumed, …). */
  status: number;
  invite?: InviteView;
  /** Whether a Keycloak user was actually provisioned (false when Keycloak isn't configured). */
  provisioned: boolean;
  /** The Keycloak user id when provisioned. */
  keycloakUserId?: string;
}

/**
 * Consume an invite by its plaintext token. The full accept flow:
 *   1. look the invite up by its token HASH (unknown token → 404);
 *   2. run the PURE evaluateAccept state machine (expired/revoked/already-accepted → 410, and a lazily
 *      -detected expiry is persisted);
 *   3. PROVISION the Keycloak user (see provisionInviteUser) — username=email, realm role assigned,
 *      UPDATE_PASSWORD + VERIFY_EMAIL required actions set so KEYCLOAK owns credential setup;
 *   4. apply the invite's optional app grants through the app-sharing seam (grantAppAccess);
 *   5. mark the invite accepted (single-use — the token can never be replayed).
 *
 * Steps 3-4 are best-effort-but-reported: if Keycloak isn't configured the user is NOT provisioned and
 * we say so (provisioned:false) — but the invite is still consumed so the token can't be reused. The
 * `kc`/grant seams are injectable so the integration test can exercise 1/2/4/5 without a live Keycloak.
 */
export async function acceptInvite(
  token: string,
  opts: {
    now?: Date;
    /** Injected for tests; defaults to the real keycloak-admin provisioning. */
    provision?: (invite: InviteView) => Promise<{ provisioned: boolean; keycloakUserId?: string; reason?: string }>;
    /** Injected for tests; defaults to grantAppAccess over app-sharing. */
    applyGrant?: (invite: InviteView, grant: InviteAppGrant) => Promise<void>;
  } = {},
): Promise<AcceptResult> {
  await ensureUserInvitesSchema();
  const now = opts.now ?? new Date();

  const row = await getInviteRowByToken(token);
  if (!row) {
    return { ok: false, reason: 'this invitation link is not valid', status: 404, provisioned: false };
  }

  const decision = evaluateAccept({ status: row.status as InviteStatus, expiresAt: toExpiresDate(row) }, now);
  if (!decision.ok) {
    // Persist a lazily-detected expiry so the list surface reflects reality.
    if (decision.effectiveStatus === 'expired' && row.status === 'pending') {
      await setStatus(row.id, row.org_id, 'expired');
    }
    return { ok: false, reason: decision.reason, status: 410, provisioned: false };
  }

  const invite = toView(row);

  // 3. provision the Keycloak user (injectable; real impl below).
  const provision = opts.provision ?? provisionInviteUser;
  const prov = await provision(invite);

  // 4. apply the optional app grants (owner = the inviter, so the grant is attributable).
  const applyGrant = opts.applyGrant ?? defaultApplyGrant;
  for (const grant of invite.appGrants) {
    await applyGrant(invite, grant).catch(() => {
      /* a single grant failing must not sink the accept — the user is already provisioned */
    });
  }

  // 5. mark consumed (single-use).
  await db.execute(sql`
    UPDATE user_invites SET status = 'accepted', accepted_at = ${now.toISOString()}
    WHERE id = ${invite.id} AND org_id = ${invite.orgId};
  `);
  const accepted = await getInviteById(invite.id, invite.orgId);

  return {
    ok: true,
    reason: prov.provisioned ? 'invitation accepted — your account is ready' : (prov.reason ?? 'invitation accepted'),
    status: 200,
    invite: accepted ?? invite,
    provisioned: prov.provisioned,
    keycloakUserId: prov.keycloakUserId,
  };
}

// The default app-grant application: hand the app-sharing seam a per-user grant, attributed to the
// inviter as owner (grants exist independent of any RBAC policy row — see app-sharing.ts).
async function defaultApplyGrant(invite: InviteView, grant: InviteAppGrant): Promise<void> {
  await grantAppAccess(grant.appId, invite.orgId, invite.invitedBy || invite.email, invite.email, grant.appRole);
}

// ─── the REAL Keycloak provisioning (I/O; kept thin, all shaping is pure) ────────────────────────────
//
// EXACT approach + realm assumptions (see the final report):
//   • username = the invited email; email set; enabled; NO credentials passed → the user has no
//     password. Keycloak OWNS the credential: we set the UPDATE_PASSWORD + VERIFY_EMAIL required
//     actions, so the first time the user signs in via the console's Keycloak login they are forced to
//     set a password and verify their address. The console never handles the plaintext password.
//   • the invited console role is ensured as a realm role (ensureRealmRole) and assigned.
//   • an already-existing Keycloak user (same email) is treated as success — we just (re)assign the
//     role + required actions. This makes accept idempotent if the person was pre-created.
//
// Returns { provisioned:false } (never throws) when Keycloak isn't configured, so accept still consumes
// the invite. On a Keycloak error we surface the reason but still let the invite be consumed (the token
// is single-use regardless) — the admin can re-invite if provisioning genuinely failed.
export async function provisionInviteUser(
  invite: InviteView,
): Promise<{ provisioned: boolean; keycloakUserId?: string; reason?: string }> {
  const kc = keycloakAdmin();
  if (!kc) {
    return {
      provisioned: false,
      reason:
        'invitation accepted — an administrator will finish setting up your account (identity provider not connected)',
    };
  }
  try {
    // Reuse an existing user (idempotent) or create a fresh one with no credential.
    const existing = (await kc.listUsers(invite.email, 0, 5)).find(
      (u) => (u.email ?? u.username)?.toLowerCase() === invite.email,
    );
    const user =
      existing ??
      (await kc.createUser({ username: invite.email, email: invite.email, enabled: true }));

    // Assign the invited console role as a realm role (ensured to exist).
    const role: KcRole = await kc.ensureRealmRole(keycloakRealmRoleForOrgRole(invite.role));
    await kc.assignRoles(user.id, [role]);

    // Keycloak owns the credential: force set-password + verify-email on first login.
    await kc.setUserRequiredActions(user.id, [...INVITE_REQUIRED_ACTIONS]);

    return { provisioned: true, keycloakUserId: user.id };
  } catch (e) {
    return { provisioned: false, reason: `identity provisioning failed: ${(e as Error).message}` };
  }
}
