import { NextResponse } from 'next/server';
import { syncConnector } from '@/lib/store';

// Trigger an ingest run for a connector (creates an ingest job).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await syncConnector(id);
  if (!job) {
    return NextResponse.json({ error: 'unknown connector' }, { status: 404 });
  }
  return NextResponse.json(job, { status: 202 });
}
