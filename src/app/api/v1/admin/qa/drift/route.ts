import { NextResponse } from 'next/server';
import { getDrift } from '@/lib/adapters/registry';

// Drift / degradation report over the eval-score history (first-party PSI by default, Evidently
// when OFFGRID_ADAPTER_DRIFT=evidently). GET so dashboards/monitors can poll it cheaply.
export async function GET() {
  return NextResponse.json(await getDrift().analyze());
}
