// ─── WhatsApp OUTBOUND sink — send a message via the ON-PREM WhatsApp gateway ─────────────────────
//
// Deliver an app-run's outcome as a WhatsApp message. AIR-GAP SAFE (risk #4) — the mirror of the
// WhatsApp TRIGGER adapter (adapters/triggers/whatsapp-onprem.ts): there is NO Meta cloud API here.
// The ONLY integration is via the SELF-HOSTED gateway the operator runs and points us at with
// OFFGRID_WHATSAPP_URL (a WAHA / on-prem bridge on the LAN). Unconfigured → the sink degrades HONESTLY
// ("not configured"), never a fake success and never a reach for graph.facebook.com.
//
// Because the gateway is on the operator's own LAN, this is an AIR-GAPPED transport: the egress leash
// doesn't apply (there's no cloud egress), exactly like the SMTP sink. The run path still runs the
// shared sink governance (planSinkGovernance) — masking is skipped honestly if the detector is down
// since the body never leaves the box.
//
// SOLID: config parsing is the SAME pure whatsappConfigFromEnv the trigger uses (one authority, no
// drift); buildWhatsAppSend is PURE + unit-tested. This file's only I/O is the single fetch.

import { whatsappConfigFromEnv, type WhatsAppConfig } from '@/lib/trigger-dispatch';

// ─── send-payload shaping (PURE) ─────────────────────────────────────────────────────────────────
export interface WhatsAppSendBody {
  to: string;
  text: string;
}

/**
 * Shape the outbound send body for the on-prem gateway. PURE. Normalizes the recipient (strips
 * spaces/dashes a human might type into the config; keeps a leading +) and passes the text through.
 */
export function buildWhatsAppSend(to: string, text: string): WhatsAppSendBody {
  const normalized = (to ?? '').trim().replace(/[\s-]+/g, '');
  return { to: normalized, text: text ?? '' };
}

// ─── result ───────────────────────────────────────────────────────────────────────────────────────
export interface WhatsAppSendResult {
  ok: boolean;
  configured: boolean;
  reason: string;
  status?: number;
}

/** Is the WhatsApp OUTBOUND sink usable? Needs the on-prem gateway URL (same config as the trigger). */
export function isWhatsAppSinkConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return whatsappConfigFromEnv(env).ok;
}

// ─── send (I/O) — the thin fetch to the on-prem gateway. Never throws; returns a typed result. ─────
/**
 * Send a message via the operator's on-prem WhatsApp gateway. Talks ONLY to cfg.url (the host THEY
 * configured). Contract: POST {url}/send { to, text } → 2xx on accepted. HONEST degrade: no gateway
 * URL → { configured:false }; no recipient → configured-but-refused; a non-2xx → { ok:false }.
 *
 * GOVERNANCE NOTE: masking (when required) is applied by the RUN PATH before this is called (via
 * planSinkGovernance), so `text` is already the governed body. Air-gapped → no egress leash applies.
 */
export async function sendWhatsApp(
  to: string,
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppSendResult> {
  const cfgResult = whatsappConfigFromEnv(env);
  if (!cfgResult.ok) return { ok: false, configured: false, reason: cfgResult.reason };
  if (!to?.trim()) {
    return { ok: false, configured: true, reason: 'no recipient — the WhatsApp sink needs a `to` number' };
  }
  const cfg = cfgResult.config!;
  const body = buildWhatsAppSend(to, text);
  try {
    const res = await fetchImpl(`${cfg.url}/send`, {
      method: 'POST',
      headers: sendHeaders(cfg),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        configured: true,
        status: res.status,
        reason: `WhatsApp gateway send failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`,
      };
    }
    return { ok: true, configured: true, status: res.status, reason: `sent via on-prem WhatsApp gateway (${res.status})` };
  } catch (e) {
    return { ok: false, configured: true, reason: `WhatsApp gateway send failed: ${(e as Error).message}` };
  }
}

function sendHeaders(cfg: WhatsAppConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  return headers;
}
