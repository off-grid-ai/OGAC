'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface Citation {
  n: number;
  source: string;
  text: string;
  ref?: string;
}
interface CopilotAnswer {
  answer: string;
  citations: Citation[];
  source: 'gateway' | 'no-data' | 'fallback';
  hasData: boolean;
}

const EXAMPLES = [
  'Why is cost up this week?',
  'What is drifting right now?',
  'Which recent runs failed and why?',
  'Are any pipelines unhealthy?',
];

const SOURCE_LABEL: Record<CopilotAnswer['source'], string> = {
  gateway: 'Synthesised by your on-prem AI over live records',
  fallback: 'AI unavailable — showing the raw records',
  'no-data': 'No records available',
};

export function AskPanel() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const query = q.trim();
    if (query.length < 3) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as CopilotAnswer);
    } catch {
      setError('Could not reach the copilot.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Ask the Ops Copilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Why did the last support pipeline run fail?"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(question);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => ask(question)} disabled={loading || question.trim().length < 3}>
              {loading ? 'Thinking…' : 'Ask'}
            </Button>
            <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuestion(ex);
                  ask(ex);
                }}
                disabled={loading}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/40 shadow-sm">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Answer</CardTitle>
            <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
              {SOURCE_LABEL[result.source]}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {result.answer}
            </p>

            {result.citations.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Cited records
                </p>
                <ol className="space-y-1.5">
                  {result.citations.map((c) => (
                    <li key={c.n} className="flex gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0 font-mono text-foreground">[{c.n}]</span>
                      <span>
                        <span className="mr-1 uppercase tracking-wide text-[10px] text-muted-foreground/60">
                          {c.source}
                        </span>
                        {c.text}
                        {c.ref ? (
                          <a
                            href={c.ref}
                            className="ml-1 text-primary underline-offset-2 hover:underline"
                          >
                            view
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                No underlying records were available for this question.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
