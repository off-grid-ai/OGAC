'use client';

import { Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  buildRunRequest,
  normalizeRunResult,
  type RunLanguage,
  type RunOutcome,
  type RunResultView,
} from '@/lib/sandbox-view';

const OUTCOME_VARIANT: Record<RunOutcome, string> = {
  ok: 'bg-primary/10 text-primary',
  failed: 'bg-destructive/10 text-destructive',
  timeout: 'bg-amber-500/10 text-amber-600',
  refused: 'text-muted-foreground',
};

const PLACEHOLDER: Record<RunLanguage, string> = {
  python: 'print("hello from the sandbox")',
  node: 'console.log("hello from the sandbox")',
};

function isLanguage(v: string | null): v is RunLanguage {
  return v === 'python' || v === 'node';
}

export function RunCodePanel({
  execEnabled,
  execCapable,
  backend,
}: {
  execEnabled: boolean;
  execCapable: boolean;
  backend: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Language selection is a navigational position → drive it from the URL, not local state.
  const langParam = searchParams.get('lang');
  const language: RunLanguage = isLanguage(langParam) ? langParam : 'python';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResultView | null>(null);

  // The panel is enabled only when BOTH gates are open: the flag AND an exec-capable backend.
  const gated = !execEnabled || !execCapable;

  function selectLanguage(lang: RunLanguage) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('lang', lang);
    router.push(`/sandbox?${params.toString()}`, { scroll: false });
  }

  async function run() {
    const built = buildRunRequest(language, code);
    if (!built.ok) {
      setError(built.error);
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/sandbox/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.request),
      });
      const raw = await res.json().catch(() => ({}));
      setResult(normalizeRunResult(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Run code</CardTitle>
        <div className="flex gap-1">
          {(['python', 'node'] as RunLanguage[]).map((lang) => (
            <Button
              key={lang}
              size="xs"
              variant={language === lang ? 'default' : 'secondary'}
              onClick={() => selectLanguage(lang)}
            >
              {lang}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {gated ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <Warning className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Code execution is disabled.</p>
              <p>
                This panel runs agent-authored code and is double-gated. To enable it:
              </p>
              <ul className="ml-4 list-disc space-y-0.5">
                {!execEnabled ? (
                  <li>enable the <code>agent-code-exec</code> feature flag (currently off)</li>
                ) : null}
                {!execCapable ? (
                  <li>
                    set <code>OFFGRID_ADAPTER_SANDBOX=docker</code> — the active backend{' '}
                    <code>{backend}</code> refuses execution
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        <Textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={PLACEHOLDER[language]}
          spellCheck={false}
          disabled={gated || busy}
          className="min-h-40 font-mono text-xs"
        />

        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={gated || busy || !code.trim()} size="sm">
            <Play className="size-4" />
            {busy ? 'Running…' : 'Run'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {language} · network disabled · 30s cap
          </span>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {result ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className={OUTCOME_VARIANT[result.outcome]}>
                {result.outcome}
              </Badge>
              <span className="text-muted-foreground">engine: {result.engine}</span>
              <span className="text-muted-foreground">
                exit: {result.exitCode ?? '—'}
              </span>
              {result.timedOut ? <span className="text-amber-600">timed out</span> : null}
            </div>
            {result.refused ? (
              <p className="text-xs text-muted-foreground">{result.refused}</p>
            ) : null}
            {result.stdout ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">stdout</p>
                <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                  {result.stdout}
                </pre>
              </div>
            ) : null}
            {result.stderr ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">stderr</p>
                <pre className="overflow-x-auto rounded bg-destructive/5 p-2 text-xs whitespace-pre-wrap text-destructive">
                  {result.stderr}
                </pre>
              </div>
            ) : null}
            {!result.stdout && !result.stderr && !result.refused ? (
              <p className="text-xs text-muted-foreground">No output.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
