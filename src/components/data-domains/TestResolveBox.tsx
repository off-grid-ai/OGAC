'use client';

import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { resolveDomain, resolveDomainRanked, type DataDomain } from '@/lib/data-domains';

// "Test resolve" — the operator types a phrase and sees exactly which rule the connector engine
// would bind it to, using the SAME pure resolver the builder/router use at runtime. Runs entirely
// client-side over the already-fetched domains (deterministic, no round-trip). Shows the confident
// winner (or an honest "no confident match") plus the ranked candidates so ambiguity is visible.
export function TestResolveBox({
  domains,
  connectorName,
}: {
  domains: DataDomain[];
  connectorName: Record<string, string>;
}) {
  const [phrase, setPhrase] = useState('');

  const { winner, ranked } = useMemo(() => {
    const q = phrase.trim();
    if (!q) return { winner: null, ranked: [] as ReturnType<typeof resolveDomainRanked> };
    return { winner: resolveDomain(q, domains), ranked: resolveDomainRanked(q, domains) };
  }, [phrase, domains]);

  const name = (id: string) => connectorName[id] ?? id;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Test resolve</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Type a phrase a workflow step or query might use — see which rule it binds to, by the same
          deterministic resolver the builder uses.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder='e.g. "check the employee reimbursement quota"'
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />
        </div>

        {phrase.trim() ? (
          <div className="space-y-2">
            {winner ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <Badge className="bg-primary/15 text-primary">binds to</Badge>
                <span className="font-medium text-foreground">{winner.label}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">{name(winner.connectorId)}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <code className="font-mono text-muted-foreground">{winner.resource}</code>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No confident match — the engine returns <b>null</b> rather than guess. (A miss is
                safe; a wrong bind is a data-integrity incident.)
              </div>
            )}

            {ranked.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
                  Candidates
                </p>
                {ranked.map((r) => (
                  <div
                    key={r.domain.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span>
                      <span className="text-foreground">{r.domain.label}</span> ·{' '}
                      {name(r.domain.connectorId)} · <code>{r.domain.resource}</code>
                    </span>
                    <span className="tabular-nums">{r.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
