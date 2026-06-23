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
  | 'evals';

export type RenderMode = 'native' | 'embed' | 'headless';

export interface AdapterMeta {
  id: string;
  capability: Capability;
  vendor: string;
  license: string;
  render: RenderMode;
  embedUrl?: string;
  description: string;
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

// PII / guardrails — detect (and optionally redact) sensitive spans in text. First-party is a
// regex scan; Presidio is the production detector. Both answer the same shape so the checks spine
// is agnostic to which one ran.
export interface PiiResult {
  hits: boolean;
  entities: string[];
  redacted?: string;
  engine: string;
}

export interface PiiPort {
  meta: AdapterMeta;
  scan(text: string): Promise<PiiResult>;
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

export type AnyAdapter = InferencePort | ObservabilityPort | SecretsPort | GroundingPort;

// Embedding width — one dimension throughout the Brain and the inference port.
export const EMBED_DIM = 384;
