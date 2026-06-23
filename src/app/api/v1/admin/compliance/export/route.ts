import { buildExport } from '@/lib/compliance';

// One-click DPIA / evidence pack (Markdown) the DPO can hand to a regulator.
export async function GET(req: Request) {
  const framework = new URL(req.url).searchParams.get('framework') ?? undefined;
  const { filename, body } = await buildExport(framework);
  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
