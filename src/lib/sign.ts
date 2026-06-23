import { createHmac, timingSafeEqual } from 'crypto';

// First-party provenance signing: an HMAC-SHA256 over the canonical (answer + citations) with a
// server key, so an exported answer is tamper-evident and offline-verifiable. C2PA Content
// Credentials / Sigstore are the heavier external upgrades (see the `provenance` capability).
const KEY = process.env.OFFGRID_SIGNING_KEY ?? 'offgrid-dev-signing-key';

function canonical(payload: unknown): string {
  return JSON.stringify(payload);
}

export function sign(payload: unknown): string {
  return `sig_${createHmac('sha256', KEY).update(canonical(payload)).digest('hex')}`;
}

export function verify(payload: unknown, signature: string): boolean {
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
