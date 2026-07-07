import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { DeployedApp } from '@/components/studio/DeployedApp';

export const dynamic = 'force-dynamic';

// A DEPLOYED Studio app (S2) — served at /app/<slug>, no console chrome. This is the
// Lovable-style shareable surface: a published agent app anyone with the link can use.
export default async function DeployedAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [tpl] = await db
    .select({ title: studioTemplates.title, summary: studioTemplates.summary, slug: studioTemplates.slug })
    .from(studioTemplates)
    .where(and(eq(studioTemplates.slug, slug), eq(studioTemplates.published, true)))
    .limit(1);
  if (!tpl?.slug) notFound();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{tpl.title}</h1>
        {tpl.summary ? <p className="mt-1 text-sm text-muted-foreground">{tpl.summary}</p> : null}
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Off Grid AI · deployed app · runs governed on-prem
        </p>
      </header>
      <DeployedApp slug={tpl.slug} />
    </div>
  );
}
