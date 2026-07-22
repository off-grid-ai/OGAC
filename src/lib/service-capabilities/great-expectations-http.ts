import type { GxResult, ParseResult } from './great-expectations-lifecycle';

// Pure route-response shaping shared by every GX handler. Framework routes only perform auth,
// tenant resolution, adapter invocation, audit, and this deterministic result mapping.

export interface GxHttpPayload {
  status: number;
  body: Record<string, unknown>;
}

export function gxParseFailure(parsed: ParseResult<unknown>): GxHttpPayload {
  return {
    status: 400,
    body: { error: parsed.errors.join('; '), errors: parsed.errors },
  };
}

export function gxResultPayload<T>(result: GxResult<T>, successStatus = 200): GxHttpPayload {
  if (result.ok) {
    return {
      status: successStatus,
      body: { data: result.value, capabilities: result.manifest },
    };
  }
  return {
    status: result.status,
    body: {
      error: result.message,
      kind: result.kind,
      capabilities: result.manifest,
    },
  };
}
