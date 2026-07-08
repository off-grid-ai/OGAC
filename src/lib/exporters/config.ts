// PURE export-target config validation + normalization — zero I/O, fully unit-testable.
//
// An `export_target` row is the persisted config for one exporter: which kind, where to send it
// (endpoint), whether it's enabled, and a `secretRef` (an OpenBao KEY PATH — NEVER a raw token).
// This module is the single place a proposed config is validated + normalized before it touches the
// DB, and the place the run layer decides whether a target is runnable. It reuses the same
// conservative secret-key-path charset the secrets surface uses (see secret-keys.ts) so a secretRef
// can only ever name a vault key, never smuggle a value.

import { catalogFor, isExporterKind, type ExporterKind } from './types';

// Mirror of secret-keys.ts SEGMENT_RE — kept local so this module stays zero-import of app code and
// so a secretRef is validated exactly like a real KV key path.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const MAX_ENDPOINT_LEN = 2048;
const MAX_SECRETREF_LEN = 256;

export interface ExportTargetInput {
  kind?: unknown;
  endpoint?: unknown;
  enabled?: unknown;
  secretRef?: unknown;
}

export interface NormalizedExportTarget {
  kind: ExporterKind;
  endpoint: string; // '' when the kind allows an empty endpoint (metrics scrape)
  enabled: boolean;
  secretRef: string | null; // vault key path, never a value
}

export interface ValidationResult {
  ok: boolean;
  value: NormalizedExportTarget | null;
  errors: string[];
}

// A secretRef is a KV v2 key path (same rules as a stored secret's key). It NAMES a secret; the
// value is resolved elsewhere. Empty/absent is allowed (unauth'd targets).
export function validateSecretRef(raw: unknown): { ok: boolean; ref: string | null; error: string | null } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, ref: null, error: null };
  const ref = typeof raw === 'string' ? raw.trim() : '';
  if (!ref) return { ok: true, ref: null, error: null };
  if (ref.length > MAX_SECRETREF_LEN) {
    return { ok: false, ref: null, error: `secretRef must be ≤ ${MAX_SECRETREF_LEN} characters.` };
  }
  if (ref.startsWith('/') || ref.endsWith('/')) {
    return { ok: false, ref: null, error: 'secretRef cannot start or end with "/".' };
  }
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || !SEGMENT_RE.test(seg)) {
      return {
        ok: false,
        ref: null,
        error: 'secretRef must be a valid vault key path (letters, digits, ".", "_", "-", "/").',
      };
    }
  }
  return { ok: true, ref, error: null };
}

// An endpoint must be an http(s) URL. Empty is allowed ONLY for kinds whose catalog entry doesn't
// require one (metrics scrape). Returns the normalized (trimmed) URL.
export function validateEndpoint(
  raw: unknown,
  endpointRequired: boolean,
): { ok: boolean; endpoint: string; error: string | null } {
  const endpoint = typeof raw === 'string' ? raw.trim() : '';
  if (!endpoint) {
    if (endpointRequired) return { ok: false, endpoint: '', error: 'An endpoint URL is required.' };
    return { ok: true, endpoint: '', error: null };
  }
  if (endpoint.length > MAX_ENDPOINT_LEN) {
    return { ok: false, endpoint: '', error: `Endpoint must be ≤ ${MAX_ENDPOINT_LEN} characters.` };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, endpoint: '', error: 'Endpoint must be a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, endpoint: '', error: 'Endpoint must use http:// or https://.' };
  }
  return { ok: true, endpoint, error: null };
}

// Validate + normalize a proposed export target. Pure — the single gate every write goes through.
export function validateExportTarget(input: ExportTargetInput): ValidationResult {
  const errors: string[] = [];

  if (!isExporterKind(input.kind)) {
    return { ok: false, value: null, errors: ['kind must be one of: audit, lineage, metrics.'] };
  }
  const kind = input.kind;
  const cat = catalogFor(kind)!;

  const ep = validateEndpoint(input.endpoint, cat.endpointRequired);
  if (!ep.ok && ep.error) errors.push(ep.error);

  const sr = validateSecretRef(input.secretRef);
  if (!sr.ok && sr.error) errors.push(sr.error);

  if (cat.secretRequired && !sr.ref) {
    errors.push(`${cat.label} requires a secret reference (the auth token's vault key).`);
  }

  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);

  if (errors.length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: { kind, endpoint: ep.endpoint, enabled, secretRef: sr.ref },
    errors: [],
  };
}

// Pure: whether a Prometheus scrape request is authorized. The scrape endpoint is a PULL surface —
// Prometheus reaches out to it — so it's gated by a shared bearer token (OFFGRID_METRICS_SCRAPE_TOKEN)
// or, for convenience, the admin token. Constant-time-ish compare avoided intentionally: these are
// deployment-config tokens, not user passwords, and length differs by config. Returns true only when
// a token is CONFIGURED and matches (no token configured ⇒ closed by default).
export function scrapeAuthorized(
  presented: string | null | undefined,
  configured: { scrapeToken?: string | null; adminToken?: string | null },
): boolean {
  const token = (presented ?? '').trim();
  if (!token) return false;
  const scrape = (configured.scrapeToken ?? '').trim();
  const admin = (configured.adminToken ?? '').trim();
  if (scrape && token === scrape) return true;
  if (admin && token === admin) return true;
  return false;
}

// Whether a stored target is RUNNABLE right now (drives whether test/export are attempted, and the
// UI "ready" badge). A target is runnable when enabled, its endpoint requirement is met, and — if
// the kind requires a token — a secretRef is present. The token's actual resolution is checked at
// run time; this is the pure precondition.
export function isRunnable(t: {
  kind: ExporterKind;
  endpoint: string | null;
  enabled: boolean;
  secretRef: string | null;
}): boolean {
  if (!t.enabled) return false;
  const cat = catalogFor(t.kind);
  if (!cat) return false;
  if (cat.endpointRequired && !(t.endpoint && t.endpoint.trim())) return false;
  if (cat.secretRequired && !(t.secretRef && t.secretRef.trim())) return false;
  return true;
}
