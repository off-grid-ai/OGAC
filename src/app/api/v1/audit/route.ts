import { NextResponse } from 'next/server';
import { listAudit } from '@/lib/store';

// Aggregated audit across the fleet (the DPO evidence stream). Optional ?deviceId & ?limit.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return NextResponse.json({ object: 'list', data: await listAudit({ deviceId, limit }) });
}
