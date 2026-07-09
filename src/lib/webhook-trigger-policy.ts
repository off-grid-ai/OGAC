// ─── Webhook-trigger AUTH policy (PURE, zero-I/O) ─────────────────────────────────────────────────
//
// The universal INBOUND primitive: an external system POSTs to a per-tenant webhook and fires a
// governed run. This module owns the PURE, deterministic auth decision that sits in front of that:
// HMAC signature verification (constant-time), timestamp-window replay defence, and target-kind
// validation. The I/O half (trigger registry, vault secret, nonce store, run dispatch) lives in
// `webhook-triggers.ts` + the route; this is the unit-testable brain with no imports that touch I/O.
//
// Signing scheme (the contract we hand callers / Cloudflare Email Routing / integrators):
//   base      = `${timestamp}.${rawBody}`         (timestamp bound into the MAC ⇒ no re-timestamp replay)
//   signature = "sha256=" + HMAC_SHA256(secret, base) in lowercase hex
//   headers   = X-Offgrid-Signature: sha256=…   ·   X-Offgrid-Timestamp: <unix seconds or ms>
// Reject: missing/malformed signature, missing/expired timestamp (±window), or signature mismatch.
// Within-window duplicate replays are caught by the nonce store (the signature IS the nonce key).

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIG_PREFIX = 'sha256=';
export const DEFAULT_WINDOW_SEC = 300; // ±5 min clock skew / capture window

export type WebhookTargetKind = 'app' | 'agent';

export function isWebhookTargetKind(v: unknown): v is WebhookTargetKind {
  return v === 'app' || v === 'agent';
}

/** The exact bytes the HMAC is computed over. Exported so callers/tests sign identically. */
export function signingBase(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/** Compute the canonical `sha256=<hex>` signature for a body + timestamp under a secret. */
export function computeSignature(timestamp: string, rawBody: string, secret: string): string {
  return SIG_PREFIX + createHmac('sha256', secret).update(signingBase(timestamp, rawBody)).digest('hex');
}

/** Return the header value only if it's a well-formed `sha256=…` signature, else null. */
export function parseSigHeader(h: string | null | undefined): string | null {
  if (typeof h !== 'string') return null;
  const v = h.trim();
  return v.startsWith(SIG_PREFIX) && v.length > SIG_PREFIX.length ? v : null;
}

/** Is the caller-supplied timestamp within ±windowSec of now? Accepts unix seconds or milliseconds. */
export function withinWindow(
  timestamp: string | null | undefined,
  nowMs: number,
  windowSec: number = DEFAULT_WINDOW_SEC,
): boolean {
  const t = Number((timestamp ?? '').trim());
  if (!Number.isFinite(t) || t <= 0) return false;
  const tsMs = t < 1e12 ? t * 1000 : t; // heuristic: < 1e12 ⇒ seconds
  return Math.abs(nowMs - tsMs) <= windowSec * 1000;
}

export type VerifyResult = { ok: true; sig: string } | { ok: false; code: number; reason: string };

/**
 * The whole auth decision for an inbound webhook, PURE (secret + now passed in). Deterministic and
 * constant-time on the signature compare. The route resolves the secret from the vault + the nonce
 * check separately; everything else is decided here.
 */
export function verifyWebhook(opts: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string | null | undefined;
  nowMs: number;
  windowSec?: number;
}): VerifyResult {
  const windowSec = opts.windowSec ?? DEFAULT_WINDOW_SEC;
  if (!opts.secret) return { ok: false, code: 401, reason: 'no signing secret for this trigger' };
  const provided = parseSigHeader(opts.signature);
  if (!provided) return { ok: false, code: 401, reason: 'missing or malformed X-Offgrid-Signature' };
  if (!withinWindow(opts.timestamp, opts.nowMs, windowSec)) {
    return { ok: false, code: 401, reason: 'missing or expired X-Offgrid-Timestamp' };
  }
  const expected = computeSignature((opts.timestamp ?? '').trim(), opts.rawBody, opts.secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length guard first — timingSafeEqual throws on unequal lengths; the length itself isn't secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, code: 401, reason: 'signature mismatch' };
  }
  return { ok: true, sig: provided };
}
