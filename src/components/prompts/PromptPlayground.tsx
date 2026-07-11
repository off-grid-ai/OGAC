'use client';

import { Play, ShieldCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { extractPartialRefs, extractVariables } from '@/lib/prompt-template';

interface ModelInfo {
  id: string;
}
interface Check {
  name: string;
  verdict: string;
  detail?: string;
}
interface PlaygroundResult {
  rendered: string;
  output?: string;
  error?: string;
  blocked?: boolean;
  missing?: string[];
  cyclic?: string[];
  checks?: Check[];
}

// Prompt Playground — run THIS prompt against a model and see the result, in the console. Fills the
// prompt's {{variables}}, then POSTs to /api/v1/prompts/playground, which inlines any {{>partials}},
// sends the rendered text through the GOVERNED gateway (same inbound/outbound guardrail floor as chat)
// and returns the model output + the guardrail verdicts. Nothing runs client-side against a model.
export function PromptPlayground({
  content,
  promptId,
  version,
  onRun,
}: Readonly<{
  content: string;
  /** When set, runs are tagged (promptId + version) so they appear in the prompt's observability. */
  promptId?: string;
  version?: string;
  /** Fired after a run completes (any outcome) so the detail page can refresh its metrics. */
  onRun?: () => void;
}>) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  const variables = useMemo(() => extractVariables(content), [content]);
  const partialRefs = useMemo(() => extractPartialRefs(content), [content]);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/v1/chat/models');
      if (r.ok) {
        const body = (await r.json()) as { models?: ModelInfo[] };
        const list = body.models ?? [];
        setModels(list);
        if (list.length) setModel((m) => m || list[0].id);
      }
    })();
  }, []);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch('/api/v1/prompts/playground', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, model, values, promptId, version }),
      });
      const data = (await r.json().catch(() => ({}))) as PlaygroundResult;
      setResult(data);
      if (!r.ok && !data.blocked) toast.error(data.error || 'Run failed');
      else if (data.blocked) toast.error('Blocked by input guardrail');
      else toast.success('Ran through the governed gateway');
    } catch {
      toast.error('Could not reach the gateway');
    } finally {
      setRunning(false);
      // Metrics only capture a governed run once it reaches the gateway; give the async index a beat.
      if (promptId && version) setTimeout(() => onRun?.(), 1500);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Play className="size-4 text-primary" /> Playground
          </CardTitle>
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> runs through the governed gateway
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Fill any variables and run this prompt against a model. It passes through the same input and
          output guardrails as your chat — nothing bypasses governance.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: model + variable inputs */}
          <div className="space-y-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Model</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
              >
                {models.length === 0 ? <option value="">default model</option> : null}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>

            {partialRefs.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                Composes partials:{' '}
                {partialRefs.map((p) => (
                  <code key={p} className="mr-1 text-primary">{`{{>${p}}}`}</code>
                ))}
                <span className="block">Inlined on the server before the model sees the prompt.</span>
              </div>
            ) : null}

            {variables.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {variables.map((v) => (
                  <label key={v} className="space-y-1 text-xs text-muted-foreground">
                    <span className="font-mono text-primary">{`{{${v}}}`}</span>
                    <Input
                      value={values[v] ?? ''}
                      onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                      placeholder={v}
                      className="font-mono"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                This prompt has no variables — run it as-is.
              </p>
            )}

            <Button onClick={run} disabled={running} size="sm" className="w-full gap-1.5">
              {running ? <Spinner className="size-4" /> : <Play className="size-4" />}
              {running ? 'Running…' : 'Run prompt'}
            </Button>
          </div>

          {/* Right: output + guardrail verdicts */}
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Output</span>
            {result?.blocked ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <Warning className="mt-0.5 size-4 shrink-0" />
                <span>{result.error || 'Blocked by input guardrail.'}</span>
              </div>
            ) : (
              <pre className="min-h-[10rem] max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
                {running ? 'Running through the gateway…' : result?.output || result?.error || '—'}
              </pre>
            )}

            {result?.missing?.length ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-500">
                Unknown partials (left as-is): {result.missing.map((m) => `{{>${m}}}`).join(', ')}
              </p>
            ) : null}
            {result?.cyclic?.length ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-500">
                Circular partial reference: {result.cyclic.join(', ')}
              </p>
            ) : null}

            {result?.checks?.length ? (
              <div className="flex flex-wrap gap-1">
                {result.checks.map((c, i) => (
                  <Badge
                    key={`${c.name}-${i}`}
                    variant={
                      c.verdict === 'blocked' || c.verdict === 'fail'
                        ? 'destructive'
                        : c.verdict === 'warn' || c.verdict === 'redacted'
                          ? 'secondary'
                          : 'outline'
                    }
                    className="text-[10px]"
                    title={c.detail}
                  >
                    {c.name}: {c.verdict}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
