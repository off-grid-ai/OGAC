'use client';

import { Play, Terminal } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const LANGS = ['python', 'node'] as const;

interface Result {
  engine: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  refused?: string;
  // The flag-gate path (agent-code-exec off) returns { error } instead of a sandbox result.
  error?: string;
}

function SandboxOutput({ result }: { result: Result }) {
  const refusal = result.refused ?? result.error;
  if (refusal) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
        Refused (safe default): {refusal}
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline">{result.engine}</Badge>
        <Badge
          variant="secondary"
          className={result.ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}
        >
          exit {result.exitCode ?? '—'}
        </Badge>
        {result.timedOut ? (
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
            timed out
          </Badge>
        ) : null}
      </div>
      {result.stdout ? (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2.5 font-mono text-[11px] text-foreground">
          {result.stdout}
        </pre>
      ) : null}
      {result.stderr ? (
        <pre className="overflow-x-auto rounded-md bg-destructive/5 p-2.5 font-mono text-[11px] text-destructive">
          {result.stderr}
        </pre>
      ) : null}
    </>
  );
}

// Run agent-authored code in the active sandbox (POST /admin/sandbox/run). Double-gated: the
// `agent-code-exec` flag must be ON and the no-exec default refuses — so a refusal is the expected
// safe state, shown plainly rather than as an error.
export function SandboxRunner() {
  const [language, setLanguage] = useState<(typeof LANGS)[number]>('python');
  const [code, setCode] = useState('print("hello from the sandbox")');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!code.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/sandbox/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language, code }),
      });
      setResult((await res.json()) as Result);
    } catch {
      setResult({
        engine: 'unknown',
        ok: false,
        stdout: '',
        stderr: 'request failed',
        exitCode: null,
        timedOut: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal className="size-4 text-primary" />
          Sandbox runner
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Execute code in the isolated sandbox. Gated by the <code>agent-code-exec</code> flag; the
          no-exec default safely refuses.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <Button
              key={l}
              type="button"
              size="sm"
              variant={language === l ? 'default' : 'outline'}
              onClick={() => setLanguage(l)}
            >
              {l}
            </Button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sb-code">Code</Label>
          <Textarea
            id="sb-code"
            rows={5}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <Button size="sm" onClick={run} disabled={busy || !code.trim()} className="w-full">
          <Play className="size-4" />
          {busy ? 'Running…' : 'Run in sandbox'}
        </Button>

        {result ? (
          <div className="space-y-2 border-t border-border pt-3">
            <SandboxOutput result={result} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
