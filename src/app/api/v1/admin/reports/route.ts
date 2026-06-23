import { NextResponse } from 'next/server';
import { REPORTS } from '@/lib/reports';

// The report catalog — each entry is generated live and exported via /reports/{id}/export.
export function GET() {
  return NextResponse.json({ object: 'list', data: REPORTS });
}
