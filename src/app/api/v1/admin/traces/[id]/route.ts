import { NextResponse } from 'next/server';
import { buildWaterfall, langfuseReadConfigured, listObservations } from '@/lib/langfuse';

// One trace's span waterfall — GET /api/public/observations?traceId=... via the read client.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!langfuseReadConfigured()) {
    return NextResponse.json({ configured: false, spans: [] });
  }
  try {
    const obs = await listObservations(id);
    return NextResponse.json({ configured: true, spans: buildWaterfall(obs), raw: obs.length });
  } catch (e) {
    return NextResponse.json({ configured: true, spans: [], error: (e as Error).message });
  }
}
