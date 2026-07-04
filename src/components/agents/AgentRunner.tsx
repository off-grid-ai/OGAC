'use client';

import { Play } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface Step {
  kind?: string;
  label?: string;
  detail?: string;
}
interface Check {
  name: string;
  verdict: string;
}
interface Citation {
  title?: string;
  ref?: string;
  snippet?: string;
}
interface RunResult {
  output: string;
  governed?: boolean;
  runId?: string;
  status?: string;
  steps?: Step[];
  checks?: Check[];
  citations?: Citation[];
  error?: string;
}

const STATUS_CLASS: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  pending_review: 'bg-amber-500/10 text-amber-600',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

const CHECK_CLASS: Record<string, string> = {
  pass: 'text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-600',
  redacted: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  fail: 'bg-destructive/10 text-destructive',
};

// Invoke an agent through the REAL governed pipeline (POST /admin/run with agentId) and show the
// result inline: the answer, the pipeline steps it ran (policy → guard → retrieve → answer → ground
// → sign), guardrail verdicts, and source citations. This is the console's "run it and watch it be
// governed" surface — the whole platform thesis in one box.
export function AgentRunner({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, input }),
      });
      const data = (await res.json().catch(() => ({}))) as RunResult;
      setResult(res.ok ? data : { output: '', error: data.error ?? `HTTP ${res.status}` });
      if (res.ok) router.refresh(); // refresh the recent-runs table below
    } catch (e) {
      setResult({ output: '', error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Run</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Invoke this agent through the governed pipeline — policy gate, guardrails, retrieval
          grounding, and provenance all apply. The steps, checks, and citations show below.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask this agent something…"
          rows={3}
          className="text-sm"
        />
        <Button onClick={run} disabled={busy || !input.trim()} size="sm" className="gap-1.5">
          <Play className="size-4" />
          {busy ? 'Running…' : 'Run'}
        </Button>

        {result ? (
          <div className="space-y-3 border-t border-border pt-3">
            {result.error ? (
              <p className="text-sm text-destructive">{result.error}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {result.status ? (
                    <Badge variant="secondary" className={STATUS_CLASS[result.status] ?? ''}>
                      {result.status}
                    </Badge>
                  ) : null}
                  {result.governed ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      governed
                    </Badge>
                  ) : null}
                  {result.checks?.map((c) => (
                    <Badge key={c.name} variant="secondary" className={CHECK_CLASS[c.verdict] ?? ''}>
                      {c.name}: {c.verdict}
                    </Badge>
                  ))}
                </div>

                {result.output ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Answer
                    </div>
                    <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-foreground">
                      {result.output}
                    </p>
                  </div>
                ) : null}

                {result.steps?.length ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Pipeline
                    </div>
                    <ol className="mt-1 space-y-1">
                      {result.steps.map((s, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-xs">
                          <span className="font-mono text-primary">{s.kind ?? '·'}</span>
                          <span className="text-muted-foreground">{s.label ?? s.detail ?? ''}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {result.citations?.length ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Sources
                    </div>
                    <ul className="mt-1 space-y-1">
                      {result.citations.map((c, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{c.title ?? c.ref}</span>
                          {c.snippet ? ` — ${c.snippet.slice(0, 120)}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
