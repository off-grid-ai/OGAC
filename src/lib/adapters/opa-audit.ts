// OPA audit adapter — the thin NETWORK seam for the compliance surface.
//
// Reads the deployed OPA's config / status / loaded policies so the console can honestly report:
//   GET /v1/config   → configured bundles + whether the decision-log plugin ships anywhere
//   GET /v1/status   → per-bundle activation revision (only when the status plugin is enabled)
//   GET /v1/policies → the Rego modules actually loaded (the honest "active policy set" when policy
//                      is loaded via the policy API rather than a signed remote bundle)
//
// SOLID/DRY: all shaping lives in the PURE opa-audit.ts; this file is only fetch + JSON + honest
// unreachable/error states. Base URL is OFFGRID_OPA_URL — the SAME env the policy adapter reads.
// When it is unset every reader returns `{ reachable: false }` so the UI degrades honestly (never
// fabricates a bundle or an activation).

import {
  type BundleStatusSummary,
  type LoadedPolicySummary,
  type OpaConfigSummary,
  normalizeBundleStatus,
  normalizeLoadedPolicies,
  normalizeOpaConfig,
} from '@/lib/opa-audit';

const TIMEOUT_MS = 4000;

function baseUrl(): string | undefined {
  return process.env.OFFGRID_OPA_URL;
}

export interface OpaUnreachable {
  reachable: false;
  reason: string;
}

function unreachable(reason: string): OpaUnreachable {
  return { reachable: false, reason };
}

async function getJson(path: string): Promise<{ ok: true; body: unknown } | OpaUnreachable> {
  const base = baseUrl();
  if (!base) return unreachable('OFFGRID_OPA_URL not set');
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // OPA returns non-2xx for some diagnostic endpoints (e.g. /v1/status when the plugin is off) but
    // still ships a useful JSON body — parse it and let the pure normalizer decide.
    const body = await res.json().catch(() => null);
    if (body === null && !res.ok) return unreachable(`OPA ${res.status}`);
    return { ok: true, body };
  } catch (e) {
    return unreachable((e as Error).message);
  }
}

export async function readOpaConfig(): Promise<
  { reachable: true; config: OpaConfigSummary } | OpaUnreachable
> {
  const res = await getJson('/v1/config');
  if (!('ok' in res)) return res;
  return { reachable: true, config: normalizeOpaConfig(res.body) };
}

export async function readBundleStatus(): Promise<
  { reachable: true; status: BundleStatusSummary } | OpaUnreachable
> {
  const res = await getJson('/v1/status');
  if (!('ok' in res)) return res;
  return { reachable: true, status: normalizeBundleStatus(res.body) };
}

export async function readLoadedPolicies(): Promise<
  { reachable: true; policies: LoadedPolicySummary[] } | OpaUnreachable
> {
  const res = await getJson('/v1/policies');
  if (!('ok' in res)) return res;
  return { reachable: true, policies: normalizeLoadedPolicies(res.body) };
}

// One combined read for the bundles surface — config + activation status + loaded policies. Each is
// independent so a partial OPA (status plugin off) still yields the parts that ARE available.
export interface OpaBundleView {
  configured: boolean; // is OFFGRID_OPA_URL set + OPA reachable for config?
  reason: string; // honest note when a part is unavailable
  config: OpaConfigSummary | null;
  status: BundleStatusSummary | null;
  policies: LoadedPolicySummary[];
}

export async function readBundleView(): Promise<OpaBundleView> {
  const [cfg, status, policies] = await Promise.all([
    readOpaConfig(),
    readBundleStatus(),
    readLoadedPolicies(),
  ]);
  const configured = 'reachable' in cfg && cfg.reachable === true;
  return {
    configured,
    // When not configured, `cfg` is necessarily the OpaUnreachable branch — surface its reason.
    reason: configured ? '' : (cfg as OpaUnreachable).reason,
    config: 'config' in cfg ? cfg.config : null,
    status: 'status' in status ? status.status : null,
    policies: 'policies' in policies ? policies.policies : [],
  };
}
