// keycloak-auth policy — JWT validation + scope-based routing for both human
// users and machine clients (OAuth2 client credentials).
//
// Flow:
//   1. Extract Bearer token from Authorization header
//   2. Validate signature + claims against Keycloak JWKS (cached, no round-trip)
//   3. Extract scopes → model routing hints, rate tier, allowed models
//   4. Put client identity on ctx for observability + downstream policies
//
// Scopes the gateway understands (set these on the Keycloak client/role):
//   model:<name>     — client may access this model family (e.g. model:openai, model:qwythos)
//   mode:cloud       — route to cloud provider (requires gateway to have upstream keys)
//   mode:local       — route to local node only
//   tier:<name>      — rate tier hint (fast / standard / batch) for finops
//
// If no model scope is present the client can access everything (open policy).
// Deny overrides allow: if a scope says model:openai but the request asks for qwythos
// and no model:qwythos scope is present, the request is denied.
import { getValidator, keycloakConfigFromEnv, type JWTClaims, type KeycloakConfig } from '../cluster/keycloak';
import type { Policy, PolicyContext } from './types';

export interface KeycloakAuthOptions {
  /** Override Keycloak config (defaults to env vars OFFGRID_KEYCLOAK_URL/REALM/CLIENT_ID). */
  config?: KeycloakConfig;
  /**
   * What to do when Keycloak is configured but the token is missing or invalid.
   * 'deny'    → 401 (default — enforcing mode)
   * 'warn'    → log to ctx.meta and continue (permissive / migration mode)
   */
  onFailure?: 'deny' | 'warn';
  /**
   * When true, enforce model scope claims. When false (default), scopes are
   * recorded for observability but don't block requests.
   */
  enforceScopes?: boolean;
}

export function keycloakAuth(opts: KeycloakAuthOptions = {}): Policy {
  const cfg = opts.config ?? keycloakConfigFromEnv();
  const onFailure = opts.onFailure ?? 'deny';
  const enforceScopes = opts.enforceScopes ?? false;

  return {
    name: 'keycloak-auth',

    async pre(ctx: PolicyContext): Promise<void> {
      if (!cfg) return; // Keycloak not configured — pass through

      const headers = (ctx.meta._inboundHeaders ?? {}) as Record<string, string>;
      const auth = String(headers['authorization'] ?? '');

      if (!auth.startsWith('Bearer ')) {
        if (onFailure === 'deny') {
          ctx.deny = { status: 401, message: 'Keycloak Bearer token required', policy: 'keycloak-auth' };
        }
        return;
      }

      const token = auth.slice(7).trim();
      let claims: JWTClaims;
      try {
        claims = await getValidator(cfg).verify(token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'invalid token';
        if (onFailure === 'deny') {
          ctx.deny = { status: 401, message: `Keycloak token invalid: ${msg}`, policy: 'keycloak-auth' };
        } else {
          ctx.meta['keycloakError'] = msg;
        }
        return;
      }

      // Parse scopes
      const scopes = (claims.scope ?? '').split(' ').filter(Boolean);
      const modelScopes = scopes.filter((s) => s.startsWith('model:')).map((s) => s.slice(6));
      const modeScopes = scopes.filter((s) => s.startsWith('mode:')).map((s) => s.slice(5));
      const tier = scopes.find((s) => s.startsWith('tier:'))?.slice(5) ?? 'standard';

      // Realm + resource roles
      const realmRoles = claims.realm_access?.roles ?? [];
      const resourceRoles = Object.values(claims.resource_access ?? {}).flatMap((r) => r.roles ?? []);
      const allRoles = [...new Set([...realmRoles, ...resourceRoles])];

      // Identity on ctx
      ctx.clientId = claims.azp ?? claims.sub;
      ctx.clientScopes = scopes;
      ctx.meta['keycloakSub'] = claims.sub;
      ctx.meta['keycloakClient'] = claims.azp;
      ctx.meta['keycloakEmail'] = claims.email ?? claims.preferred_username;
      ctx.meta['keycloakRoles'] = allRoles;
      ctx.meta['keycloakTier'] = tier;
      ctx.meta['keycloakModelScopes'] = modelScopes;
      ctx.meta['keycloakModeScopes'] = modeScopes;

      if (!enforceScopes || !modelScopes.length) return;

      // Scope enforcement: requested model must match at least one model scope.
      const requested = (ctx.model ?? '').toLowerCase();
      const allowed = modelScopes.some((m) => {
        if (m === '*') return true;
        // e.g. scope "openai" matches model "gpt-4o", "openai/*"
        // scope "qwythos" matches model containing "qwythos"
        return requested.includes(m) || m === 'any';
      });

      if (!allowed) {
        ctx.deny = {
          status: 403,
          message: `Model "${ctx.model}" not permitted by token scopes (allowed: ${modelScopes.join(', ')})`,
          policy: 'keycloak-auth',
        };
      }
    },
  };
}
