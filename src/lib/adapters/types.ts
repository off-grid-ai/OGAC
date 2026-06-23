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
  | 'bi';

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

export type AnyAdapter = InferencePort | ObservabilityPort | SecretsPort | GroundingPort;

// Embedding width — one dimension throughout the Brain and the inference port.
export const EMBED_DIM = 384;
