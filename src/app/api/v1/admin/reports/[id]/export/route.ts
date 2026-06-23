import { NextResponse } from 'next/server';
import { generateReport } from '@/lib/reports';

// Generate one report live and stream it as a Markdown download.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await generateReport(id);
  if (!report) return NextResponse.json({ error: 'unknown report' }, { status: 404 });
  return new Response(report.body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${report.filename}"`,
    },
  });
}
