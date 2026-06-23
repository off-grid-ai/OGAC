import { NextResponse } from 'next/server';
import { computeAnalytics } from '@/lib/analytics';

// Observability over the audit/telemetry stream — usage, latency, drift, perf degradation.
export async function GET() {
  return NextResponse.json(await computeAnalytics());
}
