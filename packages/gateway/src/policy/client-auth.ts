// client-auth policy — enterprise client token passthrough + token store (Mode B).
//
// Mode B: client authenticates to the gateway via Keycloak (Authorization: Bearer <kc-jwt>)
// AND supplies their own cloud-provider key in a dedicated x-provider-key header.
// The gateway forwards x-provider-key to the upstream verbatim; it never touches Authorization.
//
// This policy:
//   1. Reads x-provider-key (NOT Authorization — that's the Keycloak JWT)
//   2. Infers the provider/type from token shape
//   3. Stores each unique token seen with IP mapping (in-memory, capped)
//   4. Exposes the token store at /tokens for the console to sync + persist
//
// Token inference (best-effort, from public patterns — no decoding secrets):
//   - JWT:           header.payload.signature → decode header+payload (base64url, no verify)
//   - Anthropic:     sk-ant-…
//   - OpenAI:        sk-… / sk-proj-…
//   - Google AI:     AIza…
//   - AWS Bedrock:   AKIA… access key
//   - Azure OpenAI:  32-hex
//   - Hugging Face:  hf_…
//   - Cohere:        co-…
//   - Generic:       opaque
//
// Usage (ClusterOptions):
//   policies: [keycloakAuth(), clientAuth()]  // keycloak-auth must run first
import type { Policy, PolicyContext } from './types';

export interface ClientAuthOptions {
  /**
   * Max number of distinct tokens to keep in memory.
   * Oldest entries are evicted when the cap is hit. Default: 500.
   */
  maxTokens?: number;
}

export interface TokenEntry {
  /** Truncated token for display — never the full value. */
  preview: string;
  kind: 'bearer' | 'x-api-key';
  firstSeen: number;
  lastSeen: number;
  uses: number;
  inferred: InferredToken;
  /** All distinct client IPs that have used this token, with per-IP use counts. */
  ips: Record<string, number>;
}

export interface InferredToken {
  provider?: string;
  tokenType?: string;
  /** For JWTs: the decoded header + payload (no verification). */
  jwt?: {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
  notes?: string;
}

// ── Token inference ───────────────────────────────────────────────────────────

function b64urlDecode(s: string): string {
  // base64url → base64 → utf-8
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(pad, 'base64').toString('utf-8');
}

function tryParseJSON(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function inferToken(token: string): InferredToken {
  // JWT: three dot-separated base64url segments
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const header = tryParseJSON(b64urlDecode(parts[0]));
      const payload = tryParseJSON(b64urlDecode(parts[1]));
      if (header && payload) {
        const alg = String(header['alg'] || '');
        const iss = String(payload['iss'] || payload['issuer'] || '');
        let provider: string | undefined;
        if (iss.includes('anthropic')) provider = 'Anthropic';
        else if (iss.includes('openai')) provider = 'OpenAI';
        else if (iss.includes('googleapis') || iss.includes('google')) provider = 'Google';
        else if (iss.includes('azure') || iss.includes('microsoft')) provider = 'Azure';
        else if (iss.includes('amazon') || iss.includes('aws')) provider = 'AWS';
        return { tokenType: 'JWT', provider, jwt: { header, payload }, notes: `alg=${alg}${iss ? `, iss=${iss}` : ''}` };
      }
    } catch {
      /* not a JWT */
    }
  }

  // Anthropic
  if (token.startsWith('sk-ant-')) return { provider: 'Anthropic', tokenType: 'api-key' };

  // OpenAI
  if (token.startsWith('sk-proj-')) return { provider: 'OpenAI', tokenType: 'project-api-key' };
  if (token.startsWith('sk-') && token.length > 40) return { provider: 'OpenAI', tokenType: 'api-key' };

  // Google AI Studio / Gemini
  if (token.startsWith('AIza') && token.length === 39) return { provider: 'Google AI', tokenType: 'api-key' };

  // AWS IAM access key
  if (/^AKIA[A-Z0-9]{16}$/.test(token)) return { provider: 'AWS', tokenType: 'access-key-id', notes: 'IAM access key ID — likely paired with a secret key elsewhere' };

  // Azure cognitive / OpenAI resource key: 32 hex chars
  if (/^[0-9a-f]{32}$/i.test(token)) return { provider: 'Azure', tokenType: 'resource-key' };

  // Hugging Face
  if (token.startsWith('hf_')) return { provider: 'Hugging Face', tokenType: 'api-token' };

  // Cohere
  if (token.startsWith('co-')) return { provider: 'Cohere', tokenType: 'api-key' };

  // Mistral
  if (/^[a-zA-Z0-9]{32}$/.test(token) && token.length === 32) return { provider: 'Mistral (possible)', tokenType: 'api-key', notes: 'Matches Mistral key pattern — 32 alphanumeric chars' };

  return { tokenType: 'opaque', notes: `length=${token.length}` };
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class TokenStore {
  // key = hash of the token value (never store raw)
  private readonly byHash = new Map<string, TokenEntry>();
  private readonly insertOrder: string[] = [];

  constructor(private readonly cap: number) {}

  private hash(token: string): string {
    // Simple deterministic non-cryptographic fingerprint (not for security — just dedup).
    // We never need to recover the token from the hash.
    let h = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = (Math.imul(h, 0x01000193)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  private preview(token: string): string {
    // Show enough to correlate across logs without exposing the secret.
    if (token.length <= 8) return '***';
    return `${token.slice(0, 6)}…${token.slice(-4)}`;
  }

  record(token: string, kind: 'bearer' | 'x-api-key', ip?: string): TokenEntry {
    const h = this.hash(token);
    const now = Date.now();
    const existing = this.byHash.get(h);
    if (existing) {
      existing.lastSeen = now;
      existing.uses += 1;
      if (ip) existing.ips[ip] = (existing.ips[ip] || 0) + 1;
      return existing;
    }
    // Evict oldest if at cap
    if (this.insertOrder.length >= this.cap) {
      const oldest = this.insertOrder.shift()!;
      this.byHash.delete(oldest);
    }
    const entry: TokenEntry = {
      preview: this.preview(token),
      kind,
      firstSeen: now,
      lastSeen: now,
      uses: 1,
      inferred: inferToken(token),
      ips: ip ? { [ip]: 1 } : {},
    };
    this.byHash.set(h, entry);
    this.insertOrder.push(h);
    return entry;
  }

  list(): (TokenEntry & { fingerprint: string })[] {
    return [...this.byHash.entries()]
      .map(([fingerprint, entry]) => ({ fingerprint, ...entry }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  get size(): number {
    return this.byHash.size;
  }
}

// ── Policy factory ────────────────────────────────────────────────────────────

export function clientAuth(opts: ClientAuthOptions = {}): Policy & { tokens: TokenStore } {
  const gatewayKey = process.env.OFFGRID_GATEWAY_API_KEY || '';
  const store = new TokenStore(opts.maxTokens ?? 500);

  const policy: Policy & { tokens: TokenStore } = {
    name: 'client-auth',
    tokens: store,

    pre(ctx: PolicyContext): void {
      const headers = (ctx.meta._inboundHeaders || {}) as Record<string, string>;

      // Mode B: client supplies their own cloud-provider key in x-provider-key.
      // Authorization is reserved for the Keycloak JWT — don't read it here.
      const providerKey = String(headers['x-provider-key'] || '');
      if (!providerKey) return;

      const token = providerKey.trim();
      const kind: 'bearer' | 'x-api-key' = 'x-api-key';

      // Ignore the gateway's own key if someone accidentally sends it here.
      if (gatewayKey && token === gatewayKey) return;

      const entry = store.record(token, kind, ctx.clientIp);
      // Surface the inferred metadata on the context for sinks / post-policies.
      ctx.clientToken = { value: token, kind };
      ctx.meta['clientTokenPreview'] = entry.preview;
      ctx.meta['clientTokenInferred'] = entry.inferred;
    },
  };

  return policy;
}
