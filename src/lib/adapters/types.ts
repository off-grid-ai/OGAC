// The adapter layer — capability ports that decouple the console from any single OSS tool.
// Each underlying system (the gateway, an observability backend, a secrets store) is reached
// only through a port interface, so swapping the implementation is a registry change, not a
// rewrite. `render` declares how the tool's own UI is surfaced: we build it native, embed it
// behind SSO, or it has no UI at all (headless). This is what keeps the OSS swappable and in
// sync without us maintaining a fork.
export type Capability =
  | 'inference'
  | 'observability'
  | 'secrets'
  | 'guardrails'
  | 'grounding'
  | 'retrieval'
  | 'policy'
  | 'identity'
  | 'lineage'
  | 'caching'
  | 'siem'
  | 'flags'
  | 'provenance'
  | 'bi'
  | 'sandbox'
  | 'evals'
  | 'drift'
  | 'mdm';

export type RenderMode = 'native' | 'embed' | 'headless';

// Lifecycle of an adapter's integration. 'active' (default, omitted) = wired and doing real work
// in-path; 'planned' = listed on the roadmap but NOT yet executed in-path (configure-to-activate),
// surfaced honestly in the UI/docs so nothing claims to work that doesn't.
export type AdapterStatus = 'active' | 'planned';

export interface AdapterMeta {
  id: string;
  capability: Capability;
  vendor: string;
  license: string;
  render: RenderMode;
  embedUrl?: string;
  description: string;
  status?: AdapterStatus;
}

export type SpanAttrs = Record<string, string | number | boolean | undefined>;

// ─── Ports ────────────────────────────────────────────────────────────────────
export interface InferencePort {
  meta: AdapterMeta;
  embed(text: string): Promise<number[]>;
  health(): Promise<boolean>;
}

export interface ObservabilityPort {
  meta: AdapterMeta;
  emitSpan(name: string, attrs: SpanAttrs): void;
}

export interface SecretsPort {
  meta: AdapterMeta;
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
  // Optional write/enumerate surface — implemented by KMS adapters (OpenBao). The env adapter is
  // read-only, so a caller must feature-detect (writable === true) before relying on these.
  writable?: boolean;
  set?(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
  // `prefix` (optional) scopes the enumeration to one KV folder — used to isolate a tenant's
  // `<org>/` namespace so listing never returns sibling tenants' folders. Returns keys RELATIVE to
  // the prefix (as OpenBao's LIST does). Absent/empty prefix lists the mount root (single-tenant).
  list?(prefix?: string): Promise<string[]>;
}

// Grounding / attribution — verify a generated answer against its cited sources. Standalone:
// it works over ANY sources handed to it, with no dependency on the Brain or any store. A
// customer can adopt grounding to verify their own RAG stack without buying the knowledge base.
export interface GroundingSource {
  id?: string;
  text: string;
}

export interface ClaimVerdict {
  claim: string;
  supported: boolean;
  score: number;
  source?: string;
}

export interface GroundingResult {
  score: number;
  verdicts: ClaimVerdict[];
  truncated?: number;
}

export interface GroundingPort {
  meta: AdapterMeta;
  verify(answer: string, sources: GroundingSource[]): Promise<GroundingResult>;
  health(): Promise<boolean>;
}

// Policy — an access decision (deny-overrides). The first-party port evaluates the in-console
// ABAC rules; the OPA port asks a Rego decision API. Same contract either way, so the call site
// never knows which engine answered.
export interface PolicyInput {
  role: string;
  resource: string;
  attributes: Record<string, string>;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  engine: string;
}

export interface PolicyPort {
  meta: AdapterMeta;
  evaluate(input: PolicyInput): Promise<PolicyDecision>;
}

// PII / guardrails — detect (and optionally redact) sensitive spans in text. LLM Guard is THE
// authoritative content-guardrail engine (PII/DLP, secrets, prompt-injection, toxicity, language);
// the checks spine reads only this normalized shape, so it is agnostic to the engine internals.
//
// Fail-closed semantics (a guardrail must not be bypassable by killing the engine):
//   • `blocked === true` — the engine was CONFIGURED but could not screen (unreachable / errored).
//     The run MUST be denied (the checks spine maps this to a 'blocked' verdict). A guardrail that
//     silently fell open to a weaker floor is a security hole, so this is an explicit hard stop.
//   • `configured === false` — no engine URL is set. The guardrail step did NOT screen; the UI
//     surfaces this honestly as "guardrails not configured" (it must never pretend it screened).
//     A run is NOT blocked in this state — nothing was ever turned on to enforce.
// Both flags are optional so the shape stays back-compatible; absent ⇒ a normal, screened result.
export interface PiiResult {
  hits: boolean;
  entities: string[];
  redacted?: string;
  engine: string;
  /** true ⇒ the engine was configured but unreachable → FAIL CLOSED, the run must be blocked. */
  blocked?: boolean;
  /** false ⇒ no engine is configured → the step did not screen (surfaced, never faked as clean). */
  configured?: boolean;
}

export interface PiiPort {
  meta: AdapterMeta;
  // `orgId` scopes the deep config (org custom recognizers + thresholds). Pass it EXPLICITLY on the
  // durable/worker path (no request scope, so `headers()`-based org resolution would throw); omit it
  // on the request path to resolve the org from the session. Optional keeps existing callers valid.
  scan(text: string, orgId?: string): Promise<PiiResult>;
  health(): Promise<boolean>;
}

// Lineage — record that a job consumed inputs and produced outputs. First-party is a no-op
// (lineage is implicit in the audit trace); Marquez receives real OpenLineage run events so the
// source→answer graph is queryable. Emission is best-effort and never blocks the request.
export interface LineageEvent {
  job: string;
  run: string;
  status: 'START' | 'COMPLETE' | 'FAIL';
  inputs?: string[];
  outputs?: string[];
  // Optional per-dataset OpenLineage facets (schema / columnLineage / dataQuality), keyed by the
  // dataset name so the adapter can attach them to the matching input/output. A producer that knows
  // its shape (brain.ingest knows source fields; a DB dataset knows its columns) supplies these;
  // producers with no facet info simply omit them and a bare dataset is emitted. See
  // `src/lib/lineage-facets.ts` (DatasetFacetSpec) for the shape.
  facets?: import('@/lib/lineage-facets').DatasetFacetSpec[];
}

export interface LineagePort {
  meta: AdapterMeta;
  emit(event: LineageEvent): Promise<void>;
}

// Provenance signing — make an answer/export tamper-evident. HMAC (default) is a shared-secret
// MAC; ed25519 is an asymmetric signature so a verifier needs only the PUBLIC key (the real
// provenance property — third parties can verify without holding the signing secret). C2PA /
// Sigstore are the heavier external upgrades behind the same port.
export interface SigningPort {
  meta: AdapterMeta;
  algorithm: string;
  sign(payload: unknown): string;
  verify(payload: unknown, signature: string): boolean;
  publicKey(): string | null; // PEM for asymmetric adapters; null for HMAC (no public half)
}

// Evals — run an offline evaluation and return a scored run. golden (default) scores retrieval
// recall over the Brain; promptfoo runs an assertion matrix via its CLI against the gateway;
// Ragas/DeepEval call a RAG-metrics sidecar. All answer the same EvalRunResult shape, so the
// /admin/qa surface is agnostic to which evaluator ran. OSS adapters fall back to golden if their
// tool/service is unavailable, so selecting one is never a hard dependency.
export interface EvalRunResult {
  id: string;
  engine: string;
  score: number; // 0..100 (pass rate / aggregate metric)
  total: number;
  passed: number;
  startedAt: string;
  detail?: Record<string, unknown>;
}

export interface EvalsPort {
  meta: AdapterMeta;
  // orgId scopes where a persisted run lands (golden persists in-process; other adapters return
  // their result for the caller to persist under the same org). Defaults to the platform org.
  run(orgId?: string): Promise<EvalRunResult>;
  health(): Promise<boolean>;
}

// Drift / degradation — compare a recent window of quality signals against a baseline window and
// report whether the agent has drifted (distribution shift) or degraded (mean quality drop).
// First-party computes Population Stability Index over the eval-score history; Evidently runs full
// data/embedding-drift test suites behind the same verdict shape.
export type DriftStatus = 'stable' | 'warning' | 'drift';

export interface DriftMetric {
  name: string;
  value: number;
  status: DriftStatus;
}

export interface DriftReport {
  engine: string;
  status: DriftStatus;
  metrics: DriftMetric[];
  baseline: number; // samples in the baseline window
  current: number; // samples in the current window
  note?: string;
}

// Optional run config produced by the standard drift catalog (src/lib/drift-catalog.ts). A selected
// Evidently preset / per-column method + drift-share threshold flows through analyze() to the
// collector body; the first-party fallback honors `driftShareThreshold` when banding its PSI verdict.
export interface DriftRunOptions {
  preset?: string | null;
  method?: string | null;
  columnMethods?: Record<string, string>;
  driftShareThreshold?: number;
  // Scope the eval-score history the verdict is computed over to one org, so a tenant's drift
  // signal never mixes in another org's runs. Defaults to the platform org.
  orgId?: string;
}

export interface DriftPort {
  meta: AdapterMeta;
  analyze(options?: DriftRunOptions): Promise<DriftReport>;
  health(): Promise<boolean>;
}

// Caching — exact + semantic response cache. First-party is an in-process Map (bounded, TTL'd);
// Redis is the shared/at-scale backend. Same get/set contract; Redis falls back to memory if the
// server is unreachable, so the cache is never a hard dependency.
export interface CachePort {
  meta: AdapterMeta;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  health(): Promise<boolean>;
}

// Feature flags — runtime capability/feature enablement. First-party reads the in-console flag
// store (Postgres) + env; Unleash queries a central flag service. Same isEnabled() contract;
// Unleash falls back to the first-party store if unreachable.
export interface FlagsPort {
  meta: AdapterMeta;
  isEnabled(key: string, fallback?: boolean): Promise<boolean>;
  health(): Promise<boolean>;
}

// Sandbox — execute agent-authored code under isolation. The default refuses (tools run only via
// the scoped registry); the `docker` engine runs code in an ephemeral, network-disabled,
// resource-capped container (free, no API key, no Linux/KVM host needed); E2B / Firecracker are
// heavier isolation for prod. Always gated by the `agent-code-exec` flag.
export type SandboxLanguage = 'python' | 'node';

export interface SandboxResult {
  engine: string;
  ok: boolean; // ran to completion with exit 0
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  refused?: string; // set by the no-exec default — execution was declined, not attempted
}

export interface SandboxPort {
  meta: AdapterMeta;
  run(language: SandboxLanguage, code: string, timeoutMs?: number): Promise<SandboxResult>;
  health(): Promise<boolean>;
}

// MDM / device management — the "Fleet Control" backend. First-party is the in-console device
// registry (enrolled nodes); FleetDM (osquery-based) is the production swap-in, reached over its
// REST API. Same normalized device shape, so Fleet Control is agnostic to which one answered.
export interface MdmDevice {
  id: string;
  name: string;
  os: string;
  status: string;
  lastSeen: string;
  source: string;
}

// The optional "deep" surface — implemented only by a real MDM (FleetDM) that can run osquery,
// enumerate software/CVEs, and hold policies. The first-party registry does NOT implement these
// (it has no osquery agent), so callers must feature-detect `supportsFleet === true` before use.
// Types come from the pure-logic module so the port stays the single contract.
export interface MdmPort {
  meta: AdapterMeta;
  // `orgId` (optional) scopes the first-party registry to a tenant (SECURITY WAVE 1). The FleetDM
  // backend is a separate external inventory and ignores it, falling back to the org-scoped
  // first-party registry when unreachable.
  listDevices(orgId?: string): Promise<MdmDevice[]>;
  health(): Promise<boolean>;
  // True when this backend can service the live-query / software / policy methods below.
  supportsFleet?: boolean;
  // osquery live query: run `sql` across the given host ids and poll for aggregated results.
  liveQuery?(sql: string, hostIds: number[]): Promise<import('@/lib/fleetdm').LiveQueryResult>;
  // Per-host installed software + known CVEs.
  hostSoftware?(hostId: number): Promise<import('@/lib/fleetdm').SoftwareInventory>;
  // Policy CRUD against the MDM's own policy store.
  listPolicies?(): Promise<import('@/lib/fleetdm').FleetPolicy[]>;
  createPolicy?(
    input: import('@/lib/fleetdm').FleetPolicyInput,
  ): Promise<import('@/lib/fleetdm').FleetPolicy>;
  updatePolicy?(
    id: number,
    input: Partial<import('@/lib/fleetdm').FleetPolicyInput>,
  ): Promise<import('@/lib/fleetdm').FleetPolicy>;
  deletePolicy?(id: number): Promise<void>;
  // Destructive device commands (FleetDM MDM command endpoints). Async on Fleet's side — the
  // returned result reports 'pending'/'requested' plus any unlock PIN / device status echo. Only a
  // real MDM implements these; callers feature-detect the method before use. Fleet has no
  // reboot/restart REST command, so `restartHost` is deliberately absent (feature-detected as
  // unsupported). lock/unlock/wipe are Fleet Premium; refetch is free-tier.
  lockHost?(hostId: number): Promise<import('@/lib/fleetdm').DeviceCommandResult>;
  unlockHost?(hostId: number): Promise<import('@/lib/fleetdm').DeviceCommandResult>;
  wipeHost?(hostId: number): Promise<import('@/lib/fleetdm').DeviceCommandResult>;
  refetchHost?(hostId: number): Promise<import('@/lib/fleetdm').DeviceCommandResult>;
}

export type AnyAdapter = InferencePort | ObservabilityPort | SecretsPort | GroundingPort;

// Embedding width — one dimension throughout the Brain and the inference port.
export const EMBED_DIM = 384;
