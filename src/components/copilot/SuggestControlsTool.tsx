'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface GuardrailSuggestion {
  id: string;
  name: string;
  category: string;
  entity: string;
  confidence: 'recommended' | 'suggested' | 'optional';
  reason: string;
}
interface EvalSuggestion {
  id: string;
  name: string;
  category: string;
  engine: string;
  defaultThreshold: number;
  confidence: 'recommended' | 'suggested' | 'optional';
  reason: string;
}
interface Suggestions {
  guardrails: GuardrailSuggestion[];
  evals: EvalSuggestion[];
  signals: string[];
}

const CONF_CLASS: Record<string, string> = {
  recommended: 'bg-primary/10 text-primary',
  suggested: 'bg-amber-500/10 text-amber-600',
  optional: 'bg-muted text-muted-foreground',
};

// Auto-suggest guardrails + evals for a draft pipeline. The operator describes the pipeline and its
// data allowlist; the tool returns a starter set from the catalogs, each explained + ranked. This is
// the one-click apply the pipeline builder consumes (same catalog ids the builder enables).
export function SuggestControlsTool() {
  const [purpose, setPurpose] = useState('');
  const [allowlist, setAllowlist] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    if (purpose.trim().length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/copilot/suggest-controls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purpose,
          allowlist: allowlist
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as Suggestions);
    } catch {
      setError('Could not reach the suggestion service.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Describe the pipeline</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Say what it does and which data it touches. We suggest the guardrails and evals that fit.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Summarise customer support tickets and draft replies for the credit-cards team"
            rows={4}
          />
          <div className="space-y-1">
            <label htmlFor="suggest-controls-allowlist" className="text-xs text-muted-foreground">Data allowlist (comma-separated)</label>
            <Input
              id="suggest-controls-allowlist"
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              placeholder="support_tickets, customer_profiles"
            />
          </div>
          <Button onClick={suggest} disabled={loading || purpose.trim().length < 3}>
            {loading ? 'Analysing…' : 'Suggest controls'}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {result?.signals?.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Detected:</span>
            {result.signals.map((s) => (
              <Badge key={s} variant="secondary" className="bg-muted text-xs font-normal">
                {s}
              </Badge>
            ))}
          </div>
        ) : null}

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">
              Suggested guardrails {result ? `(${result.guardrails.length})` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">Describe a pipeline to see suggestions.</p>
            ) : result.guardrails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guardrails suggested.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {result.guardrails.map((g) => (
                  <li key={g.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{g.name}</span>
                      <Badge variant="secondary" className={CONF_CLASS[g.confidence]}>
                        {g.confidence}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.category} · {g.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">
              Suggested evals {result ? `(${result.evals.length})` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">Describe a pipeline to see suggestions.</p>
            ) : result.evals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evals suggested.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {result.evals.map((ev) => (
                  <li key={ev.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{ev.name}</span>
                      <Badge variant="secondary" className={CONF_CLASS[ev.confidence]}>
                        {ev.confidence}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ev.category} · pass ≥ {Math.round(ev.defaultThreshold * 100)}% · {ev.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
