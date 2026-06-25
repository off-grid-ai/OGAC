import { NextResponse } from 'next/server';
import { runQaSweep } from '@/lib/qa/sweep';

// Scheduled Agent-QA sweep — run it on a cadence (cron / CI / scheduler) against this endpoint.
// Runs an offline eval + drift analysis, emits a `qa.sweep` span (alert on degraded=true), and
// returns the verdict. 200 when healthy, 503 when degraded — so a CI gate / monitor can react to
// the status code directly.
export async function POST() {
  const sweep = await runQaSweep();
  return NextResponse.json(sweep, { status: sweep.degraded ? 503 : 200 });
}
