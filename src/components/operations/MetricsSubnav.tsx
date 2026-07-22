import Link from 'next/link';

// Sub-navigation between the two metric surfaces under Operations → Health → Metrics: the PromQL
// Explorer and the Alerts view. Plain links so each is deep-linkable and Back-coherent.
const TABS = [
  { id: 'explorer', label: 'Explorer', href: '/operations/health/metrics/explorer' },
  { id: 'alerts', label: 'Alerts', href: '/operations/health/metrics/alerts' },
] as const;

export function MetricsSubnav({ active }: Readonly<{ active: 'explorer' | 'alerts' }>) {
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            t.id === active
              ? 'border-emerald-600 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
