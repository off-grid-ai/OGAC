import { notFound } from 'next/navigation';
import { DeployedApp } from '@/components/studio/DeployedApp';
import { getAppBySlug } from '@/lib/apps-store';
import { resolveDeployedApp } from '@/lib/deployed-app';

export const dynamic = 'force-dynamic';

// A DEPLOYED app (S2) — served at /app/<slug>, no console chrome. This is the Lovable-style
// shareable surface: a published builder app anyone with the link can use. The app lives in the
// `apps` table (the ONE build artifact — see lib/app-model.ts); the SAME table the run endpoint
// (POST /api/v1/app/<slug>/run → getAppBySlug) resolves, so page + run stay on one source of truth.
// A slug that isn't a PUBLISHED app 404s (unpublished apps are never served publicly).
export default async function DeployedAppPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  const resolved = resolveDeployedApp(app);
  if (!resolved) notFound();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{resolved.title}</h1>
        {resolved.summary ? (
          <p className="mt-1 text-sm text-muted-foreground">{resolved.summary}</p>
        ) : null}
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Off Grid AI · deployed app · runs governed on-prem
        </p>
      </header>
      <DeployedApp slug={resolved.slug} />
    </div>
  );
}
