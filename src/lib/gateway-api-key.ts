// Pure, zero-IO policy + shaping for Keycloak-backed gateway API keys (task #74).
//
// THE MODEL. The founder wants MANY named `x-api-key`s for the AI gateway, each ISSUED and
// BACKED BY KEYCLOAK — retiring the single static `OFFGRID_GATEWAY_API_KEY`. We do NOT run our
// own key store: every API key IS a dedicated Keycloak service-account client
// (client_credentials). The opaque key string an operator receives is:
//
//     ogk_<clientId>.<clientSecret>
//
// where `<clientId>` is itself prefixed `ogk-` so gateway keys are trivially separable from the
// broker's own service clients (offgrid-gateway, offgrid-fleet, …) and from the console's OIDC
// clients. The gateway aggregator verifies a key by parsing it and performing a client_credentials
// token exchange against Keycloak — success means the secret matches AND the client is enabled, so
// REVOKING a key is just disabling/deleting its client in Keycloak (single source of truth).
//
// Everything here is deterministic and side-effect free: parse/format/validate/mask + view shaping.
// The IO (create/list/delete via the Keycloak Admin API) lives in gateway-api-keys.ts.

// The opaque-key prefix an operator pastes into `x-api-key`.
export const GATEWAY_KEY_PREFIX = 'ogk_';
// The Keycloak clientId prefix that marks a client as a gateway API key (vs a service/OIDC client).
export const GATEWAY_KEY_CLIENT_PREFIX = 'ogk-';

// ── Key string format ───────────────────────────────────────────────────────

export interface ParsedApiKey {
  clientId: string;
  secret: string;
}

// Compose the opaque key handed to the operator once, on creation. `ogk_<clientId>.<secret>`.
export function formatApiKey(clientId: string, secret: string): string {
  return `${GATEWAY_KEY_PREFIX}${clientId}.${secret}`;
}

// Is this raw header value shaped like one of our gateway API keys? (Cheap prefix test — used by the
// aggregator to decide whether to attempt a client_credentials exchange vs treat it as a JWT/legacy.)
export function isGatewayApiKey(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.startsWith(GATEWAY_KEY_PREFIX) && raw.includes('.');
}

// Parse `ogk_<clientId>.<secret>` back into its parts. Returns null for anything malformed. The
// clientId is everything between the `ogk_` prefix and the FIRST dot; the secret is the remainder
// (secrets are base64url/uuid and never contain a dot in the clientId, but may in the secret — so we
// split on the first dot only). Both parts must be non-empty and the clientId must carry the
// `ogk-` client prefix, so a stray `ogk_` on some other token can never be mistaken for a key.
export function parseApiKey(raw: string | null | undefined): ParsedApiKey | null {
  if (!isGatewayApiKey(raw)) return null;
  const body = (raw as string).slice(GATEWAY_KEY_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot <= 0) return null;
  const clientId = body.slice(0, dot);
  const secret = body.slice(dot + 1);
  if (!clientId || !secret) return null;
  if (!clientId.startsWith(GATEWAY_KEY_CLIENT_PREFIX)) return null;
  return { clientId, secret };
}

// A short, non-secret preview for the list UI (never the full secret). Shows the prefix + clientId +
// a masked tail so an operator can recognize a key without it being usable.
export function keyPreview(raw: string): string {
  const parsed = parseApiKey(raw);
  if (!parsed) return `${raw.slice(0, 8)}…`;
  return `${GATEWAY_KEY_PREFIX}${parsed.clientId}.••••`;
}

// ── Name → clientId derivation + validation ───────────────────────────────────

const NAME_MAX = 64;

export interface KeyNameValidation {
  ok: boolean;
  error?: string;
  name?: string; // trimmed/normalized
}

// Validate the human label for a new key. Required, trimmed, length-bounded. The label is stored on
// the Keycloak client (name/description); it does NOT have to be unique — the clientId is what's
// unique, and we derive that with a random suffix so two keys can share a label.
export function validateKeyName(raw: string | null | undefined): KeyNameValidation {
  const name = (raw ?? '').trim();
  if (!name) return { ok: false, error: 'A name is required.' };
  if (name.length > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

// Turn a label into a URL/DNS-safe slug fragment for the clientId (lowercase, alnum + dashes,
// collapsed, bounded). Empty-safe: an unsluggable label yields 'key'.
export function slugifyKeyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'key';
}

// Derive a unique Keycloak clientId for a new key: `ogk-<slug>-<rand>`. `rand` is supplied by the
// caller (crypto in the adapter) so this stays pure/testable. Guarantees the `ogk-` prefix.
export function deriveKeyClientId(name: string, rand: string): string {
  const slug = slugifyKeyName(name);
  const suffix = (rand || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'x';
  return `${GATEWAY_KEY_CLIENT_PREFIX}${slug}-${suffix}`;
}

// ── Scope ─────────────────────────────────────────────────────────────────────
// A gateway API key is, by design, a gateway-audience credential — it authenticates calls to the AI
// gateway and nothing more (least privilege). We record the human-chosen scope label on the client
// for display, but the only capability a gateway key grants is gateway access. This keeps keys from
// silently becoming console-admin (unlike the broker's own offgrid-gateway client).
export const GATEWAY_KEY_SCOPE = 'gateway' as const;

// ── View shaping ────────────────────────────────────────────────────────────

// Raw Keycloak client fields we care about for a key row (subset of KcClient + our attributes).
export interface RawKeyClient {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  attributes?: Record<string, string[] | string | undefined>;
}

// The row the management UI renders. No secret ever appears here.
export interface GatewayKeyView {
  id: string; // Keycloak internal client id (for delete/secret routes)
  clientId: string; // ogk-… (the key's identity)
  name: string; // human label
  owner: string; // org/owner label, from attributes (best-effort)
  scope: string;
  status: 'active' | 'revoked';
  createdAt: string | null; // ISO, best-effort from attributes
  lastUsedAt: string | null; // ISO, best-effort (Keycloak offline-session, filled by adapter)
}

function attr(client: RawKeyClient, key: string): string | null {
  const v = client.attributes?.[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

// Is a raw client one of OUR gateway API keys? (clientId prefix test — the list route filters by this
// so broker/OIDC clients never leak into the keys UI even though they live in the same realm.)
export function isGatewayKeyClient(client: RawKeyClient): boolean {
  return typeof client.clientId === 'string' && client.clientId.startsWith(GATEWAY_KEY_CLIENT_PREFIX);
}

// Shape a raw Keycloak client into a key row. Pure. `lastUsedAt` is passed in by the adapter (it
// comes from a separate session lookup, or null). Status is 'revoked' when the client is disabled.
export function mapKeyClient(client: RawKeyClient, lastUsedAt: string | null = null): GatewayKeyView {
  return {
    id: client.id,
    clientId: client.clientId,
    name: (client.name ?? attr(client, 'label') ?? client.clientId).trim(),
    owner: attr(client, 'ownerOrg') ?? 'default',
    scope: attr(client, 'scope') ?? GATEWAY_KEY_SCOPE,
    status: client.enabled === false ? 'revoked' : 'active',
    createdAt: attr(client, 'createdAt'),
    lastUsedAt,
  };
}

// Sort key rows newest-first by createdAt (nulls last), then by clientId for stability. Pure.
export function sortKeyViews(rows: GatewayKeyView[]): GatewayKeyView[] {
  return [...rows].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : -1;
    const tb = b.createdAt ? Date.parse(b.createdAt) : -1;
    if (tb !== ta) return tb - ta;
    return a.clientId.localeCompare(b.clientId);
  });
}
