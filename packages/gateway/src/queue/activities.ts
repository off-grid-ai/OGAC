// @offgrid/gateway — queue ACTIVITIES.
//
// An activity is the ONLY place that touches the network / the node pool. It
// runs OUTSIDE the Temporal workflow sandbox, so plain `fetch` + env are fine.
// It POSTs the queued request to the cluster gateway's OpenAI-compatible
// endpoint and THROWS on any failure so Temporal retries per the workflow's
// retry policy. Because the worker caps how many of these run concurrently
// (maxConcurrentActivityTaskExecutions), the pool is never over-driven.

import type { QueuedInferenceRequest, QueueResult } from './types';

/** Cluster gateway base URL. The worker sets this from QueueConfig via env. */
function gatewayUrl(): string {
  return (
    process.env.OFFGRID_QUEUE_GATEWAY_URL ||
    process.env.OFFGRID_GATEWAY_URL ||
    'http://localhost:8800'
  );
}

/**
 * Authentication for the queue worker's gateway hop. The worker is a machine client and cannot use
 * request-scoped Console credentials. Prefer a queue-specific key when operators isolate it; fall
 * back to the gateway's canonical static key so existing on-prem deployments remain compatible.
 */
export function queueGatewayHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const bearer = env.OFFGRID_QUEUE_GATEWAY_BEARER_TOKEN?.trim();
  if (bearer) return { authorization: `Bearer ${bearer}` };
  const apiKey = (env.OFFGRID_QUEUE_GATEWAY_API_KEY || env.OFFGRID_GATEWAY_API_KEY)?.trim();
  return apiKey ? { 'x-api-key': apiKey } : {};
}

/**
 * Run one inference against the cluster gateway. Throws on non-2xx or transport
 * error → Temporal retries. On success returns the parsed completion.
 */
export async function runInference(req: QueuedInferenceRequest): Promise<QueueResult> {
  const started = Date.now();
  const url = `${gatewayUrl().replace(/\/$/, '')}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...queueGatewayHeaders(),
  };
  if (req.caller) headers['x-offgrid-caller'] = req.caller;
  if (req.corrId) headers['x-offgrid-corr-id'] = req.corrId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req.body),
  });

  const text = await res.text();

  // Non-2xx → throw so Temporal retries (503 saturation, node flaps, etc.).
  if (!res.ok) {
    throw new Error(`inference ${res.status}: ${text.slice(0, 500)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`inference returned non-JSON body (${res.status})`);
  }

  return { status: res.status, body, ms: Date.now() - started };
}
