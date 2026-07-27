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
  /** Which sink delivers. Slack needs no URL of its own, so this decides what "configured" means. */
  channel: AlertChannel;
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
  stored: { url: string; enabled: boolean; channel?: AlertChannel } | null,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDestination {
  if (stored) {
    const channel = toAlertChannel(stored.channel);
    if (!stored.enabled) return { url: null, source: 'console', paused: true, channel };
    // Only a webhook destination is defined by its URL. Slack holds its own incoming-webhook URL in
    // the vault, and email is defined by a recipient address — so requiring an http(s) URL here would
    // silently treat a perfectly good Slack destination as unconfigured.
    if (channel === 'slack') return { url: stored.url.trim() || null, source: 'console', paused: false, channel };
    if (channel === 'email' && stored.url.trim()) {
      return { url: stored.url.trim(), source: 'console', paused: false, channel };
    }
    const url = validAlertUrl(stored.url);
    if (url) return { url, source: 'console', paused: false, channel: 'webhook' };
  }
  const fallback = alertDestination(env);
  return fallback
    ? { url: fallback, source: 'env', paused: false, channel: 'webhook' }
    : { url: null, source: 'none', paused: false, channel: 'webhook' };
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
  channel: AlertChannel = 'webhook',
): Promise<AlertSendResult> {
  // Slack and email go through their own governed sinks, which hold their own credentials. Only the
  // webhook channel needs the signed transport below.
  if (channel === 'slack') return sendViaSlack(alert, orgId, destination, env, fetchImpl);
  if (channel === 'email') return sendViaEmail(alert, orgId, destination, env, fetchImpl);
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

// ─── channels: the same alert, delivered where the team already looks ─────────────────────────────
//
// A webhook is fine for machines, but an operator who needs to know their app's answers are sliding
// reads Slack or email. Both sinks already exist, resolve their own credentials, and are governed —
// so this routes to them rather than growing a third egress path.

export type AlertChannel = 'webhook' | 'slack' | 'email';

export const ALERT_CHANNELS: AlertChannel[] = ['webhook', 'slack', 'email'];

/** Narrow an arbitrary value to a supported channel, defaulting to the original webhook. PURE. */
export function toAlertChannel(value: unknown): AlertChannel {
  return ALERT_CHANNELS.includes(value as AlertChannel) ? (value as AlertChannel) : 'webhook';
}

export type TargetValidation = { ok: true; target: string } | { ok: false; reason: string };

/**
 * Validate the destination target for a channel. PURE.
 *
 * Each channel needs a different thing, and accepting the wrong one would store a destination that
 * fails only when a real regression tries to use it:
 *   • webhook — an http(s) endpoint we POST to.
 *   • email   — a recipient address.
 *   • slack   — nothing required (the Slack sink holds its own incoming-webhook URL); an optional
 *               channel override may be supplied.
 */
export function validateAlertTarget(channel: AlertChannel, value: unknown): TargetValidation {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (channel === 'webhook') {
    const url = validAlertUrl(raw);
    return url
      ? { ok: true, target: url }
      : { ok: false, reason: 'a webhook destination must be an http(s):// endpoint' };
  }
  if (channel === 'email') {
    // Deliberately permissive but not meaningless: one @, no spaces, a dot in the domain.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
      ? { ok: true, target: raw }
      : { ok: false, reason: 'an email destination must be a valid recipient address' };
  }
  // slack — an optional channel override, no target required.
  return { ok: true, target: raw };
}

/** The human message body for a Slack post or an email. PURE. */
export function alertMessageText(alert: QualityAlert, orgId: string): string {
  const headline = alertSubjectLine(alert);
  const scores = `Recent ${Math.round(alert.recentQuality * 100)}% vs ${Math.round(
    alert.baselineQuality * 100,
  )}% earlier.`;
  return [headline, '', alert.detail, scores, `Tenant: ${orgId}`].join('\n');
}

/** Deliver through the governed Slack sink, which resolves its own incoming-webhook URL. */
async function sendViaSlack(
  alert: QualityAlert,
  orgId: string,
  channelOverride: string | null | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<AlertSendResult> {
  try {
    const { postSlack } = await import('@/lib/adapters/sinks/slack');
    const res = await postSlack(
      { text: alertMessageText(alert, orgId), channel: channelOverride?.trim() || undefined },
      env,
      fetchImpl,
    );
    return { ok: res.ok, configured: res.configured, status: res.status, reason: res.reason };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: `Slack delivery failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Deliver through the governed email sink. The recipient is the operator-set destination. */
async function sendViaEmail(
  alert: QualityAlert,
  orgId: string,
  recipient: string | null | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<AlertSendResult> {
  const to = (recipient ?? '').trim();
  if (!to) {
    return { ok: false, configured: false, reason: 'Email alerts not configured — no recipient address.' };
  }
  try {
    const { sendViaResend } = await import('@/lib/adapters/sinks/email-resend');
    const res = await sendViaResend(
      { to, subject: alertSubjectLine(alert), text: alertMessageText(alert, orgId) },
      {},
      env,
      fetchImpl,
    );
    return { ok: res.ok, configured: res.configured, reason: res.reason ?? (res.ok ? 'delivered' : 'not delivered') };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: `Email delivery failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Is this resolved destination something we can actually deliver to? PURE.
 *
 * Channel-dependent on purpose: a Slack destination legitimately has no URL of its own (the sink
 * holds the incoming-webhook URL), so a `Boolean(url)` check would treat a working Slack setup as
 * unconfigured and silently skip every alert.
 */
export function destinationConfigured(resolved: ResolvedDestination): boolean {
  if (resolved.paused) return false;
  if (resolved.channel === 'slack') return resolved.source === 'console';
  return Boolean(resolved.url);
}
