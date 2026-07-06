import { NextResponse } from 'next/server';

// Graceful-degradation wrapper for route handlers (P2 #129).
//
// A route body that touches Postgres / an external service throws on outage, and Next turns the
// throw into an opaque 500 with no body — unlike the rest of this API, which returns a
// `{ error }`-shaped JSON envelope. `degradeOn503` runs the body and, if it throws, converts the
// throw into a `503 { error }` so a dependency being down reads as "service unavailable, retry"
// rather than a generic crash. It is a THIN wrapper: on the happy path it returns the body's own
// Response untouched — zero behavior change.
//
// SOLID: the pure error→message mapping is `degradeMessage` (below), unit-testable with no I/O; the
// wrapper is the only piece that touches NextResponse.

// Pure: turn an unknown thrown value into a stable, non-leaky user-facing message.
export function degradeMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'service unavailable';
}

export async function degradeOn503(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (err) {
    return NextResponse.json({ error: degradeMessage(err) }, { status: 503 });
  }
}
