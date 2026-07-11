// ─── WhatsApp trigger adapter (Builder Epic #103, Phase 4C) — ON-PREM GATEWAY ONLY ───────────────
//
// The WhatsApp trigger fires an app-run from an inbound WhatsApp message. AIR-GAP SAFE (risk #4):
// there is NO Meta cloud API here. The ONLY integration is via a SELF-HOSTED WhatsApp gateway the
// operator runs and points us at with OFFGRID_WHATSAPP_URL (e.g. a WAHA / on-prem bridge on the LAN).
// Unconfigured → the trigger is DISABLED ("coming soon") and every method reports that honestly. We
// never reach for graph.facebook.com or any cloud endpoint.
//
// This module is the INTERFACE + the on-prem-gateway impl:
//   • whatsappTriggerStatus()   — is it available/coming-soon + why (drives the console badge).
//   • ingestWhatsAppMessage()   — normalize an inbound message the gateway POSTed to us + funnel it
//     through submitAppRun (the SAME governed entry point). Refuses when unconfigured.
//   • pollWhatsAppGateway()     — pull-mode: ask the on-prem gateway for new messages, dispatch each.
//     (Push-mode is a route that would call ingestWhatsAppMessage; both share the same governed path.)
//
// SOLID: config + payload shaping are PURE (trigger-dispatch.ts, unit-tested); this is the thin I/O.

import { submitAppRun } from '@/lib/adapters/apprun';
import { newAppRunId } from '@/lib/app-run';
import { getAppBySlug } from '@/lib/apps-store';
import {
  buildTriggerInput,
  whatsappConfigFromEnv,
  type WhatsAppConfig,
  type WhatsAppPayload,
} from '@/lib/trigger-dispatch';

export interface WhatsAppTriggerStatus {
  available: boolean;
  comingSoon: boolean;
  reason: string;
  gateway?: string;
}

export interface WhatsAppDispatchResult {
  ok: boolean;
  runId?: string;
  reason?: 'disabled' | 'no-app' | 'not-published' | 'wrong-trigger' | 'error';
  error?: string;
}

// ─── whatsappTriggerStatus — the honest availability badge ────────────────────────────────────────
export function whatsappTriggerStatus(env: NodeJS.ProcessEnv = process.env): WhatsAppTriggerStatus {
  const cfg = whatsappConfigFromEnv(env);
  if (!cfg.ok) return { available: false, comingSoon: true, reason: cfg.reason };
  return {
    available: true,
    comingSoon: false,
    reason: 'On-prem WhatsApp gateway configured.',
    gateway: cfg.config!.url,
  };
}

export function isWhatsAppTriggerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return whatsappConfigFromEnv(env).ok;
}

// ─── ingestWhatsAppMessage — normalize + funnel through submitAppRun ──────────────────────────────
// Route an inbound message to the app whose slug it targets. Convention: the message routes by an
// explicit `app` field (the gateway sets it from a keyword/menu) or a leading `#slug` in the text.
export function appSlugForWhatsApp(msg: WhatsAppPayload & { app?: string }): string | null {
  if (typeof msg.app === 'string' && msg.app.trim()) {
    return msg.app.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }
  const tag = /^#([a-z0-9_-]+)\b/i.exec((msg.text ?? '').trim());
  return tag ? tag[1].toLowerCase() : null;
}

export async function ingestWhatsAppMessage(
  msg: WhatsAppPayload & { app?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhatsAppDispatchResult> {
  if (!isWhatsAppTriggerConfigured(env)) {
    return { ok: false, reason: 'disabled', error: whatsappConfigFromEnv(env).reason };
  }
  const slug = appSlugForWhatsApp(msg);
  if (!slug) return { ok: false, reason: 'no-app', error: 'no target app in message' };
  const app = await getAppBySlug(slug);
  if (!app) return { ok: false, reason: 'no-app', error: `app not found: ${slug}` };
  if (!app.published) return { ok: false, reason: 'not-published', error: 'app is not published' };
  if (app.trigger?.kind !== 'whatsapp') {
    return { ok: false, reason: 'wrong-trigger', error: 'app is not a whatsapp-triggered app' };
  }
  try {
    const input = buildTriggerInput('whatsapp', msg);
    const runId = newAppRunId();
    await submitAppRun(app, input, { orgId: app.orgId, actor: 'trigger:whatsapp', runId });
    return { ok: true, runId };
  } catch (e) {
    return { ok: false, reason: 'error', error: (e as Error).message };
  }
}

// ─── pollWhatsAppGateway — pull new messages from the on-prem gateway, dispatch each ──────────────
// Talks ONLY to cfg.url (the operator's gateway). Expects a simple JSON contract: GET {url}/messages
// → { messages: WhatsAppPayload[] }. Graceful: disabled/unreachable → reported, never throws.
export interface WhatsAppPollResult {
  configured: boolean;
  fetched: number;
  dispatched: number;
  errors: string[];
  note?: string;
}

export async function pollWhatsAppGateway(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhatsAppPollResult> {
  const cfgResult = whatsappConfigFromEnv(env);
  if (!cfgResult.ok) {
    return { configured: false, fetched: 0, dispatched: 0, errors: [], note: cfgResult.reason };
  }
  const cfg = cfgResult.config!;
  const errors: string[] = [];
  let fetched = 0;
  let dispatched = 0;
  try {
    const messages = await fetchGatewayMessages(cfg);
    fetched = messages.length;
    for (const m of messages) {
      const r = await ingestWhatsAppMessage(m, env);
      if (r.ok) dispatched++;
      else if (r.reason === 'error') errors.push(r.error ?? 'dispatch error');
    }
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { configured: true, fetched, dispatched, errors };
}

async function fetchGatewayMessages(cfg: WhatsAppConfig): Promise<Array<WhatsAppPayload & { app?: string }>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${cfg.url}/messages`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { messages?: unknown };
  return Array.isArray(data.messages) ? (data.messages as Array<WhatsAppPayload & { app?: string }>) : [];
}
