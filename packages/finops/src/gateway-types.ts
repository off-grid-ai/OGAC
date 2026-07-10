// @offgrid/finops — structural types mirrored from @offgrid/gateway.
// Defined locally on purpose: this package MUST NOT depend on @offgrid/gateway.

export interface TrafficRecord {
  ts: number;
  gateway: string;
  model: string;
  modelServed?: string;
  kind: 'text' | 'image' | 'embedding';
  status: number;
  ms: number;
  bytes: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  caller?: string;
  corrId?: string;
}

export interface ObservabilitySink {
  readonly name: string;
  record(e: TrafficRecord): void;
}

export interface GatewayNode {
  name: string;
  host: string;
  port: number;
  model: string;
}

export interface PolicyContext {
  caller: string;
  corrId: string;
  model: string;
  image: boolean;
  body: Record<string, unknown>;
  target: GatewayNode;
  candidates: GatewayNode[];
  deny?: { status: number; message: string; policy: string };
  shortCircuit?: { status: number; json: unknown; from: string };
  meta: Record<string, unknown>;
}

export interface PolicyOutcome {
  status: number;
  output: string;
  promptTokens: number;
  completionTokens: number;
  streamed: boolean;
  raw?: unknown;
}

export interface Policy {
  readonly name: string;
  pre?(ctx: PolicyContext): void | Promise<void>;
  post?(ctx: PolicyContext, o: PolicyOutcome): void | Promise<void>;
}
