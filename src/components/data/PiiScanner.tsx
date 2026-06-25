'use client';

import { Eye } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Result {
  hits: boolean;
  entities: string[];
  redacted?: string;
  engine: string;
}

// Standalone PII detection/redaction over arbitrary text (POST /admin/pii/scan). The same port the
// guardrails run in-path, exposed as a tool so a team can check text before it's stored or sent.
export function PiiScanner() {
  const [text, setText] = useState('Email jane.doe@acme.com or call +1 415 555 0132, Aadhaar 1234 5678 9012.');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/admin/pii/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('failed');
      setResult((await res.json()) as Result);
    } catch {
      toast.error('Scan failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Eye className="size-4 text-primary" />
          PII scanner
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Detect and redact sensitive entities in any text — the same detector the guardrails run
          in-path on every request.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pii-text">Text</Label>
          <Textarea id="pii-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Button size="sm" onClick={scan} disabled={busy || !text.trim()} className="w-full">
          {busy ? 'Scanning…' : 'Scan for PII'}
        </Button>

        {result ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="secondary"
                className={
                  result.hits ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'
                }
              >
                {result.hits ? `${result.entities.length} entities found` : 'no PII detected'}
              </Badge>
              <Badge variant="outline">{result.engine}</Badge>
              {result.entities.map((e) => (
                <Badge key={e} variant="secondary" className="text-muted-foreground">
                  {e}
                </Badge>
              ))}
            </div>
            {result.redacted ? (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2.5 text-xs text-foreground">
                {result.redacted}
              </pre>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
