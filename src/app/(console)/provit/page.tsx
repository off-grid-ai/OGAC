import { Eye, ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { requireModuleForUser } from '@/lib/module-access';
import { getShowcase, provitBaseUrl, provitConfigured, provitHealth } from '@/lib/provit';

export const dynamic = 'force-dynamic';

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
  const [health, showcase] = await Promise.all([provitHealth(), getShowcase()]);

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
            Visual QA — catch visual regressions and review UI changes on-prem.
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Showcase</h2>
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
