// Guardrails / PII surface read-back — the PURE display model + a thin adapter reader.
//
// The normalizer and the demo regex floor below are dependency-free (zero imports of Next / auth /
// DB / aliases), so they're unit-testable in isolation with no mocks — the same SOLID seam as
// tenancy-policy.ts. Given the active guardrails adapter meta, its health, and an optional sample
// scan result, buildGuardrailsView produces a stable, display-ready model: which engine is active
// (presidio | regex), whether it's reachable, the entity types it can surface, and a live demo
// result when one is supplied. The I/O (reading the active adapter + probing health through the
// registry) is the thin reader at the bottom. Nothing here throws or persists.

// ─── Demo regex floor (pure, zero-import) ────────────────────────────────────
// A read-only mirror of the always-on first-party PII floor, kept here so the "test a string" demo
// box needs no network and no service. Two anchored globals — email + phone. We use `.replace`
// (never `.test`) because a global regex advances/persists `lastIndex`, which would make alternate
// calls start mid-string and silently miss PII; `replace` resets `lastIndex` to 0 on completion, so
// the shared regex is safe to reuse and a changed string is an exact "was there a hit" signal.
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE = /\b\+?\d[\d ()-]{7,}\d\b/g;

export interface DemoScanResult {
  hits: boolean;
  entities: string[];
  redacted: string;
  engine: string;
}

// Detect-and-redact in one pass. Non-string input degrades to an empty scan rather than throwing.
export function demoScan(text: unknown): DemoScanResult {
  const input = typeof text === 'string' ? text : '';
  const entities: string[] = [];
  let redacted = input;

  const afterEmail = redacted.replace(EMAIL, '[EMAIL]');
  if (afterEmail !== redacted) entities.push('EMAIL_ADDRESS');
  redacted = afterEmail;

  const afterPhone = redacted.replace(PHONE, '[PHONE]');
  if (afterPhone !== redacted) entities.push('PHONE_NUMBER');
  redacted = afterPhone;

  return { hits: entities.length > 0, entities, redacted, engine: 'regex' };
}

// ─── Pure display model ─────────────────────────────────────────────────────

// Entity types each engine can surface. The regex floor detects exactly two; Presidio's analyzer
// recognizes a broad catalog (a representative set — the live service may report more or fewer).
export const REGEX_ENTITY_TYPES = ['EMAIL_ADDRESS', 'PHONE_NUMBER'] as const;
export const PRESIDIO_ENTITY_TYPES = [
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'PERSON',
  'CREDIT_CARD',
  'US_SSN',
  'IBAN_CODE',
  'IP_ADDRESS',
  'LOCATION',
  'DATE_TIME',
  'URL',
] as const;

export interface GuardrailsDemo {
  input: string; // the text that was scanned (echoed for display)
  hits: boolean; // whether any entity was detected
  entities: string[]; // detected entity types
  redacted?: string; // redacted text when the engine returns one
  engine: string; // the engine that produced this demo result
}

export interface GuardrailsView {
  engine: 'presidio' | 'regex'; // the active guardrails engine (normalized)
  adapterId: string; // the raw active adapter id (e.g. 'checks' | 'presidio')
  vendor: string;
  license: string;
  description: string;
  reachable: boolean; // presidio health probe; the always-on regex floor is always true
  configured: boolean; // whether the active engine has a backing service URL set
  entityTypes: string[]; // entity types the active engine can surface
  demo?: GuardrailsDemo; // a live demo scan, when one was provided
}

// The loose meta shape we accept — mirrors AdapterMeta, but every field is optional so a malformed
// or partial meta degrades to safe defaults rather than throwing.
export interface RawGuardrailsMeta {
  id?: unknown;
  vendor?: unknown;
  license?: unknown;
  description?: unknown;
  embedUrl?: unknown;
}

// A loose scan-result shape — matches both the demo floor's DemoScanResult and the adapter PiiResult.
export interface RawScanResult {
  hits?: unknown;
  entities?: unknown;
  redacted?: unknown;
  engine?: unknown;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

// The active adapter id → the normalized engine. Presidio is the only non-regex engine; every
// other id (the first-party 'checks' spine, unknown, absent) normalizes to the regex floor.
function engineOf(adapterId: string): 'presidio' | 'regex' {
  return adapterId === 'presidio' ? 'presidio' : 'regex';
}

function normalizeDemo(raw: RawScanResult | null | undefined, input: string): GuardrailsDemo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entities = Array.isArray(raw.entities)
    ? raw.entities.filter((e): e is string => typeof e === 'string')
    : [];
  return {
    input,
    hits: raw.hits === true || entities.length > 0,
    entities,
    redacted: typeof raw.redacted === 'string' ? raw.redacted : undefined,
    engine: str(raw.engine, 'regex'),
  };
}

/**
 * Produce the guardrails display model. Never throws on malformed input.
 *
 * @param meta      the active guardrails adapter meta (loose shape; null → safe defaults)
 * @param reachable the active engine's health probe result (the regex floor is always reachable)
 * @param demo      an optional sample scan result to surface as a live demo
 * @param demoInput the text that produced `demo` (echoed for display)
 */
export function buildGuardrailsView(
  meta: RawGuardrailsMeta | null | undefined,
  reachable: boolean,
  demo?: RawScanResult | null,
  demoInput = '',
): GuardrailsView {
  const m = meta && typeof meta === 'object' ? meta : {};
  const adapterId = str(m.id, 'checks');
  const engine = engineOf(adapterId);
  // Only Presidio reaches a remote; it's "configured" once its embedUrl is set. The regex floor
  // needs no backing service, so it is configured by definition.
  const configured = engine === 'presidio' ? Boolean(str(m.embedUrl)) : true;
  return {
    engine,
    adapterId,
    vendor: str(m.vendor, engine === 'presidio' ? 'Microsoft Presidio' : 'Off Grid checks spine'),
    license: str(m.license, engine === 'presidio' ? 'MIT' : 'first-party'),
    description: str(m.description),
    // The always-on regex floor is reachable by definition; only Presidio can be unreachable.
    reachable: engine === 'presidio' ? reachable === true : true,
    configured,
    entityTypes: [...(engine === 'presidio' ? PRESIDIO_ENTITY_TYPES : REGEX_ENTITY_TYPES)],
    demo: normalizeDemo(demo, demoInput),
  };
}

// ─── Thin reader (I/O) ──────────────────────────────────────────────────────

// Read live guardrails status through the existing registry entries — no new wiring. Presidio is
// reachable only when its health probe passes; the first-party regex floor is always on. Any error
// (registry import, health throw) degrades to the safe default (regex engine, reachable), so the
// surface never breaks the page. An optional demo scan is threaded straight into the pure builder.
export async function readGuardrailsView(
  demo?: RawScanResult | null,
  demoInput = '',
): Promise<GuardrailsView> {
  try {
    const { getPii } = await import('@/lib/adapters/registry');
    const active = getPii();
    let reachable = true;
    try {
      reachable = active.health ? await active.health() : true;
    } catch {
      reachable = false;
    }
    return buildGuardrailsView(active.meta, reachable, demo, demoInput);
  } catch {
    return buildGuardrailsView(null, true, demo, demoInput);
  }
}
