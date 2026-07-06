// ─── Trigger substrate (Builder Epic #103, Phase 2B) — PURE, zero-I/O ───────────────────────────
//
// Every trigger is a DIFFERENT WAY TO START THE SAME governed app-run. This module owns the pure
// rules: validate + normalize a TriggerSpec per kind, derive a webhook's inbound path, decide which
// kinds are actually configured vs "coming soon" (on-prem-safe: email/whatsapp are disabled without
// on-prem gateway config — they never silently reach for the cloud). No I/O: the adapters that
// actually run a poller / register a webhook / create a schedule live elsewhere (app-schedules.ts +
// Phase 4C adapters) and call these functions to validate input.
//
// SOLID: this mirrors temporal-schedules.ts (pure validation) — it even REUSES isValidCron from
// there for the `schedule` kind so cron correctness has one source of truth, not two.

import type { TriggerKind, TriggerSpec } from '@/lib/app-model';
import { isValidCron } from '@/lib/temporal-schedules';

export type { TriggerKind, TriggerSpec } from '@/lib/app-model';

// ─── Which kinds are wired end-to-end today vs. gated on on-prem config ─────────────────────────
// on-demand + webhook + schedule are fully wired (webhook = a real inbound POST route in Phase 4C;
// schedule = app-schedules.ts here). email + whatsapp REQUIRE on-prem gateway config to be enabled —
// they are "coming soon" until that config is present, and are NEVER auto-enabled (air-gap safety).
export const CONFIGURED_TRIGGER_KINDS: readonly TriggerKind[] = ['on-demand', 'webhook', 'schedule'];
export const COMING_SOON_TRIGGER_KINDS: readonly TriggerKind[] = ['email', 'whatsapp'];
const ALL_TRIGGER_KINDS: readonly TriggerKind[] = [
  'on-demand',
  'webhook',
  'email',
  'whatsapp',
  'schedule',
];

/** Is this trigger kind wired end-to-end (not gated on absent on-prem config)? */
export function isConfiguredKind(kind: TriggerKind): boolean {
  return CONFIGURED_TRIGGER_KINDS.includes(kind);
}

/** Is this a valid, known trigger kind? */
export function isTriggerKind(v: unknown): v is TriggerKind {
  return typeof v === 'string' && ALL_TRIGGER_KINDS.includes(v as TriggerKind);
}

// ─── validateTrigger — per-kind validity rules ───────────────────────────────────────────────────
export interface TriggerValidation {
  ok: boolean;
  errors: string[];
  /** True when the kind is valid but requires on-prem config not yet provided. */
  comingSoon: boolean;
}

export function validateTrigger(spec: TriggerSpec | undefined): TriggerValidation {
  const errors: string[] = [];
  if (!spec || !isTriggerKind(spec.kind)) {
    return {
      ok: false,
      comingSoon: false,
      errors: [`trigger.kind must be one of: ${ALL_TRIGGER_KINDS.join(', ')}`],
    };
  }
  const cfg = spec.config ?? {};
  switch (spec.kind) {
    case 'on-demand':
      // No config needed — the default trigger. Anything extra is ignored.
      break;
    case 'webhook':
      // A webhook may carry an explicit slug/path override; if present it must be path-safe.
      if (cfg.slug !== undefined && !isPathSafe(cfg.slug)) {
        errors.push('webhook trigger: config.slug must be a URL-safe token (a-z 0-9 - _)');
      }
      break;
    case 'schedule': {
      const cron = cfg.cron;
      if (typeof cron !== 'string' || !isValidCron(cron)) {
        errors.push('schedule trigger: config.cron must be a valid 5-/6-field cron or an @macro');
      }
      break;
    }
    case 'email':
      // On-prem IMAP poller config (host/mailbox). Validity is shape-only here; the poller adapter
      // (Phase 4C) verifies reachability. Kind is valid but gated → comingSoon.
      break;
    case 'whatsapp':
      // On-prem gateway only; disabled without config. Kind valid but gated → comingSoon.
      break;
  }
  const comingSoon = COMING_SOON_TRIGGER_KINDS.includes(spec.kind);
  return { ok: errors.length === 0, errors, comingSoon };
}

// ─── normalizeTrigger — coerce a raw trigger into a clean TriggerSpec (or throw) ──────────────────
// Drops unknown config keys per kind so a persisted trigger carries only what its kind uses.
export function normalizeTrigger(raw: unknown): TriggerSpec {
  const r = (raw ?? {}) as { kind?: unknown; config?: unknown };
  const kind = r.kind;
  if (!isTriggerKind(kind)) {
    throw new Error(`trigger.kind must be one of: ${ALL_TRIGGER_KINDS.join(', ')}`);
  }
  const rawCfg = (r.config ?? {}) as Record<string, unknown>;
  let config: Record<string, unknown> | undefined;
  switch (kind) {
    case 'webhook':
      config = rawCfg.slug !== undefined ? { slug: sanitizePathToken(String(rawCfg.slug)) } : undefined;
      break;
    case 'schedule': {
      const cron = typeof rawCfg.cron === 'string' ? rawCfg.cron.trim() : '';
      if (!isValidCron(cron)) throw new Error('schedule trigger: valid config.cron required');
      config = { cron };
      break;
    }
    case 'email':
      config = pickStrings(rawCfg, ['host', 'mailbox', 'folder', 'from']);
      break;
    case 'whatsapp':
      config = pickStrings(rawCfg, ['gateway', 'number']);
      break;
    case 'on-demand':
    default:
      config = undefined;
  }
  return config && Object.keys(config).length ? { kind, config } : { kind };
}

// ─── webhookPathFor — the inbound path a webhook trigger listens on ───────────────────────────────
// Deterministic: an app's webhook receives at /api/v1/app/<slug>/run (the real inbound POST in Phase
// 4C). A trigger config.slug overrides the app slug (so one app can expose a distinct webhook path).
export function webhookPathFor(appSlug: string | undefined, trigger?: TriggerSpec): string {
  const override =
    trigger?.kind === 'webhook' && typeof trigger.config?.slug === 'string'
      ? trigger.config.slug
      : undefined;
  const slug = sanitizePathToken(override || appSlug || '');
  return slug ? `/api/v1/app/${slug}/run` : '/api/v1/app/run';
}

// ─── cronOf — extract the cron expression from a schedule trigger (null if not a schedule) ────────
export function cronOf(trigger: TriggerSpec | undefined): string | null {
  if (trigger?.kind !== 'schedule') return null;
  const cron = trigger.config?.cron;
  return typeof cron === 'string' && isValidCron(cron) ? cron : null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────
function isPathSafe(v: unknown): boolean {
  return typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v);
}

function sanitizePathToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128);
}

function pickStrings(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (typeof obj[k] === 'string' && (obj[k] as string).trim()) out[k] = (obj[k] as string).trim();
  }
  return out;
}
