import { Eye, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { provitRepos } from '@/db/schema';
import { requireModuleForUser } from '@/lib/module-access';
import { currentPrincipal, provitAbacAllows, visibilityFilter } from '@/lib/provit-access';
import { getShowcase, provitBaseUrl, provitConfigured, provitHealth } from '@/lib/provit';
import { TokenPanel } from './TokenPanel';

export const dynamic = 'force-dynamic';

// Mapped repos the viewer may see — inherits the console's ABAC (resource='provit') + tenancy
// (public library ∪ own org ∪ own private). Never throws: a fresh DB just yields an empty list.
async function mappedRepos() {
  try {
    const p = await currentPrincipal();
    if (!(await provitAbacAllows(p, 'read'))) return [];
    return await db.select().from(provitRepos).where(visibilityFilter(provitRepos, p)).orderBy(desc(provitRepos.mappedAt)).limit(60);
  } catch {
    return [];
  }
}

// Provit — visual-QA product surfaced as a first-class console module. Shows reachability
// status, a link to open Provit, and its public showcase. Navigation lives in the URL:
// the `?q=` search param filters the showcase server-side (no client-only state).
export default async function ProvitPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireModuleForUser('provit');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const configured = provitConfigured();
  const baseUrl = provitBaseUrl();
  const [health, showcase, repos] = await Promise.all([provitHealth(), getShowcase(), mappedRepos()]);
  const needleR = (q ?? '').trim().toLowerCase();
  const shownRepos = needleR ? repos.filter((r) => r.url.toLowerCase().includes(needleR)) : repos;

  const needle = query.toLowerCase();
  const items = needle
    ? showcase.items.filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          (i.description ?? '').toLowerCase().includes(needle),
      )
    : showcase.items;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Eye className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Provit</h1>
          <p className="text-sm text-muted-foreground">
            Maps a repo into modules, runs every behavior end to end, and judges the recording with
            vision. Free runs are public; your account keeps repos and runs private to your org.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4">
        <StatusBadge configured={configured} reachable={health.reachable} />
        <span className="text-sm text-muted-foreground">{baseUrl}</span>
        <a
          href={baseUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Open Provit
          <ArrowSquareOut className="size-4" />
        </a>
      </div>

      {/* URL-driven filter — GET form so the query lives in the address bar / history. */}
      <form method="GET" className="flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Filter showcase…"
          className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Filter
        </button>
      </form>

      <TokenPanel />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Your repos</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{shownRepos.length}</span>
        </div>
        {shownRepos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repos yet. Repos your org maps stay private here; public demo runs live in the showcase below.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shownRepos.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-card p-4">
                <a
                  href={`${baseUrl}/repos/${encodeURIComponent(r.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-primary hover:underline"
                >
                  {r.url.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')}
                  <ArrowSquareOut className="size-3.5 shrink-0" />
                </a>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span><b className="text-foreground">{r.features}</b> features</span>
                  <span><b className="text-foreground">{r.cases}</b> tests</span>
                  <span><b className="text-foreground">{r.screens}</b> screens</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Public showcase</h2>
        {showcase.error ? (
          <p className="text-sm text-muted-foreground">
            Could not load the showcase: {showcase.error}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? `No showcase items match “${query}”.` : 'No showcase items available.'}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-md border border-border bg-card p-4">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {item.title}
                    <ArrowSquareOut className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                )}
                {item.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ configured, reachable }: { configured: boolean; reachable: boolean }) {
  const label = !configured ? 'Not configured' : reachable ? 'Reachable' : 'Unreachable';
  const tone = !configured
    ? 'bg-muted text-muted-foreground'
    : reachable
      ? 'bg-primary/10 text-primary'
      : 'bg-destructive/10 text-destructive';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
