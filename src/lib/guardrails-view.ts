// Guardrails / PII surface read-back — the PURE display model + a thin adapter reader.
//
// The normalizer is dependency-free (zero imports of Next / auth / DB / aliases), so it's
// unit-testable in isolation with no mocks — the same SOLID seam as tenancy-policy.ts. Given the
// active guardrails adapter meta, its health, and an optional sample scan result,
// buildGuardrailsView produces a stable, display-ready model: which engine is active, whether it's
// reachable, the entity types it can surface, and a live scan result when one is supplied. The I/O
// (reading the active adapter + probing health through the registry) is the thin reader at the
// bottom. Nothing here throws or persists.
//
// THERE IS NO LOCAL SCAN HERE ANY MORE (G-F2). This module used to export `demoScan`, a private
// two-pattern (email + phone) regex that the guardrails route called for its "test a string" box.
// That made it a THIRD PII implementation next to the real regex floor and the real engine — and the
// weakest one, while the response it fed advertised `engine: "llm-guard"`. An operator who typed a
// PAN saw it pass and reasonably concluded the platform's own "Mask PAN in every output" policy
// worked. The route now scans through the real adapter, so what an operator tests is what
// enforcement actually does, and the duplicate detector is gone rather than left to drift.

// ─── Pure display model ─────────────────────────────────────────────────────

// Entity types each engine can surface. Presidio's analyzer recognizes a broad catalog (a
// representative set — the live service may report more or fewer).
export const REGEX_ENTITY_TYPES = ['EMAIL_ADDRESS', 'PHONE_NUMBER'] as const;

// The domestic types the always-on floor GUARANTEES, on every engine (see lib/pii-floor.ts). These
// are not a claim about the remote engine's own scanners — they are types the platform masks itself,
// before the engine is called, so they hold even when a scanner-based engine enumerates nothing.
// Reporting `[]` here told an operator the platform recognized no Indian PII while it was in fact
// masking all four.
export const FLOOR_ENTITY_TYPES = ['IN_PAN', 'IN_AADHAAR', 'IN_IFSC', 'UPI_ID'] as const;
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

// The normalized active-guardrails engine. 'presidio' + 'llm-guard' are the remote detectors (they
// reach a service and can be unreachable); every other adapter id normalizes to the always-on 'regex'
// floor. (The generic bring-your-own 'http-guardrail' seam also normalizes to a remote engine.)
export type GuardrailsEngine = 'presidio' | 'llm-guard' | 'http-guardrail' | 'regex';

// The remote engines — reach a backing service, so they are "configured" only once a URL is set and
// can be "unreachable". Everything else is the always-on regex floor.
const REMOTE_ENGINES: readonly GuardrailsEngine[] = ['presidio', 'llm-guard', 'http-guardrail'];

export interface GuardrailsView {
  engine: GuardrailsEngine; // the active guardrails engine (normalized)
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

// The active adapter id → the normalized engine. The remote detectors (Presidio, LLM Guard, the
// generic http-guardrail seam) keep their own id; every other id (the first-party 'checks' spine,
// unknown, absent) normalizes to the always-on regex floor.
function engineOf(adapterId: string): GuardrailsEngine {
  return (REMOTE_ENGINES as readonly string[]).includes(adapterId)
    ? (adapterId as GuardrailsEngine)
    : 'regex';
}

// A remote engine reaches a backing service (can be unreachable + needs a configured URL).
// Presidio enumerates predefined entity types; a scanner-based remote does not expose a fixed entity
// list, so we never claim its internals — but the domestic FLOOR runs on every engine, so its
// guaranteed types are always included. De-duplicated, because Presidio's catalog and the floor can
// name the same type.
function entityTypesFor(engine: GuardrailsEngine, remote: boolean): readonly string[] {
  const base =
    engine === 'presidio' ? PRESIDIO_ENTITY_TYPES : remote ? [] : REGEX_ENTITY_TYPES;
  return [...new Set([...base, ...FLOOR_ENTITY_TYPES])];
}

function isRemoteEngine(engine: GuardrailsEngine): boolean {
  return (REMOTE_ENGINES as readonly string[]).includes(engine);
}

function normalizeDemo(
  raw: RawScanResult | null | undefined,
  input: string,
): GuardrailsDemo | undefined {
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
  const remote = isRemoteEngine(engine);
  // A remote engine is "configured" once its backing service URL (embedUrl) is set; the regex floor
  // needs no service, so it is configured by definition.
  const configured = remote ? Boolean(str(m.embedUrl)) : true;
  return {
    engine,
    adapterId,
    vendor: str(
      m.vendor,
      engine === 'presidio' ? 'Microsoft Presidio' : 'Off Grid AI checks spine',
    ),
    license: str(m.license, engine === 'presidio' ? 'MIT' : 'first-party'),
    description: str(m.description),
    // The always-on regex floor is reachable by definition; only a remote engine can be unreachable.
    reachable: remote ? reachable === true : true,
    configured,
    // Presidio enumerates its predefined types; a scanner-based remote exposes no fixed list so we
    // never claim its internals — but the domestic floor's guaranteed types always apply.
    entityTypes: [...entityTypesFor(engine, remote)],
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
