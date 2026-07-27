// ─── DELIVERING A QUALITY ALERT — reusing the proven signed egress, not a second one ──────────────
//
// The actions-out webhook transport is already live and proven: an operator-set destination, an HMAC
// signature over the exact serialized bytes, and a signing secret from the vault. This reuses those
// primitives (resolveWebhookSecret + signWebhookBody) rather than growing a parallel egress path with
// its own signing story.
//
// What it deliberately does NOT reuse is buildWebhookPayload: that payload is app-run shaped
// (runId/appId/outcome), and bending a quality alert into those fields would be a shape-hack that
// makes both payloads drift. A different event gets its own honest shape, over the same transport.

import {
  resolveWebhookSecret,
  signWebhookBody,
} from '@/lib/adapters/sinks/webhook';
import { alertSubjectLine, type QualityAlert } from '@/lib/qa/quality-alert-plan';

export const QUALITY_ALERT_EVENT = 'offgrid.quality_regression';

export interface QualityAlertPayload {
  event: string;
  sentAt: string;
  orgId: string;
  kind: QualityAlert['kind'];
  subjectId: string;
  subject: string;
  detail: string;
  recentQuality: number;
  baselineQuality: number;
  dimensions: string[];
}

/** Shape the alert payload. PURE + deterministic given `sentAt` — these exact bytes get signed. */
export function buildQualityAlertPayload(
  alert: QualityAlert,
  orgId: string,
  sentAt: string,
): QualityAlertPayload {
  return {
    event: QUALITY_ALERT_EVENT,
    sentAt,
    orgId,
    kind: alert.kind,
    subjectId: alert.subjectId,
    subject: alertSubjectLine(alert),
    detail: alert.detail,
    recentQuality: alert.recentQuality,
    baselineQuality: alert.baselineQuality,
    dimensions: alert.dimensions,
  };
}

/**
 * A usable alert destination, or null. PURE — the ONE rule for what counts as a valid destination,
 * shared by the env fallback, the stored setting, and the route that validates operator input. Two
 * copies of this check would eventually disagree about which URLs are acceptable.
 *
 * Only http(s) is accepted: the air-gap guarantee is that we POST exactly where the operator said,
 * and nowhere a `file:`/`gopher:` style scheme could redirect us.
 */
export function validAlertUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** The env-configured fallback destination. PURE. */
export function alertDestination(env: NodeJS.ProcessEnv = process.env): string | null {
  return validAlertUrl(env.OFFGRID_QUALITY_ALERT_WEBHOOK);
}

/** Where a stored destination can come from, for reporting which one is in force. */
export type DestinationSource = 'console' | 'env' | 'none';

export interface ResolvedDestination {
  url: string | null;
  source: DestinationSource;
  /** Set when a destination exists but the operator has paused it — not the same as unconfigured. */
  paused: boolean;
}

/**
 * Decide which destination wins. PURE.
 *
 * The console setting beats the env var so an operator can retarget alerts without shell access, and
 * the env var remains a working fallback for fleets configured before this existed. A PAUSED console
 * destination silences alerts outright rather than falling through to the env — otherwise pausing in
 * the UI would appear to do nothing on a box that still has the env var set.
 */
export function resolveDestination(
  stored: { url: string; enabled: boolean } | null,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDestination {
  if (stored) {
    const url = validAlertUrl(stored.url);
    if (!stored.enabled) return { url: null, source: 'console', paused: true };
    if (url) return { url, source: 'console', paused: false };
  }
  const fallback = alertDestination(env);
  return fallback
    ? { url: fallback, source: 'env', paused: false }
    : { url: null, source: 'none', paused: false };
}

export interface AlertSendResult {
  ok: boolean;
  /** false ⇒ no destination or no signing secret. NOT a failure — the operator simply has not opted in. */
  configured: boolean;
  status?: number;
  signature?: string;
  reason: string;
}

/**
 * POST one alert to the operator's destination, HMAC-signed. NEVER throws.
 *
 * Unconfigured is reported as `configured:false`, never as success — an alerting path that silently
 * pretends to have delivered is worse than no alerting at all.
 */
export async function sendQualityAlert(
  alert: QualityAlert,
  orgId: string,
  destination?: string | null,
  now: () => Date = () => new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlertSendResult> {
  // An explicit destination (the console setting, resolved by the caller) wins; absent one, fall back
  // to the env var so fleets configured before the console setting existed keep working.
  const url = validAlertUrl(destination) ?? alertDestination(env);
  if (!url) {
    return {
      ok: false,
      configured: false,
      reason: 'Quality alerts not configured — set a destination in the console (or OFFGRID_QUALITY_ALERT_WEBHOOK).',
    };
  }
  const secret = await resolveWebhookSecret(env);
  if (!secret) {
    return {
      ok: false,
      configured: false,
      reason: 'Quality alerts not configured — no signing secret (vault webhook_secret or OFFGRID_WEBHOOK_SECRET).',
    };
  }

  const body = JSON.stringify(buildQualityAlertPayload(alert, orgId, now().toISOString()));
  const signature = signWebhookBody(body, secret);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-offgrid-event': QUALITY_ALERT_EVENT,
        'x-offgrid-signature': signature,
      },
      body,
    });
    return {
      ok: res.ok,
      configured: true,
      status: res.status,
      signature,
      reason: res.ok ? 'delivered' : `destination returned ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      signature,
      reason: `destination unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
