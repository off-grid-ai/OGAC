import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { evidenceCards } from '@/lib/evidence-posture';
import { readEvidenceCounts } from '@/lib/evidence-posture-reader';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Evidence overview. This was a static four-card link grid under the heading "Evidence posture and
// coverage" — a menu wearing an overview's title, with no number anywhere on a compliance surface. Each
// card now carries its live count, and a count that could not be READ says so rather than showing 0.
const EVIDENCE = [
  { key: 'audit', href: '/governance/evidence/audit', title: 'Audit log',
    body: 'Accountability events and exports.' },
  { key: 'security', href: '/governance/evidence/security', title: 'Security events',
    body: 'Blocked, denied, and suspicious activity.' },
  { key: 'provenance', href: '/governance/evidence/provenance', title: 'Provenance',
    body: 'Verify signed answers and artifacts.' },
  { key: 'export', href: '/governance/evidence/export', title: 'Evidence export',
    body: 'Ship evidence to enterprise systems.' },
] as const;

export default async function EvidencePage() {
  const counts = await readEvidenceCounts(await currentOrgId());
  const cards = evidenceCards(counts);
  const byKey = new Map(cards.map((c) => [c.key, c]));

  return (
    <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {EVIDENCE.map((item) => {
        const c = byKey.get(item.key);
        return (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {c?.value === null ? (
                  // Unreadable is stated, not rendered as zero — on a compliance page those are
                  // opposite facts.
                  <p className="font-mono text-sm text-amber-600">Could not read this ledger.</p>
                ) : (
                  <p className="font-mono text-2xl text-foreground">
                    {c?.value?.toLocaleString('en-IN')}{' '}
                    <span className="text-xs text-muted-foreground">{c?.unit}</span>
                  </p>
                )}
                <p>{c?.value === 0 ? c.emptyNote : item.body}</p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
