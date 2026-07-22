'use client';

import { CodeBlock } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sampleCallbackRecord } from '@/lib/litellm-callbacks';

// Shows operators EXACTLY what a structured callback record looks like — the per-call artifact the
// gateway streams to every sink. Built from the SAME pure mapper the live stream uses
// (litellm-log-shape via sampleCallbackRecord), so the preview can never drift from reality.

const FIELD_NOTE: Record<string, string> = {
  ts: 'call end time (epoch ms)',
  gateway: 'fleet node / deployment served',
  model: 'model the caller requested',
  modelServed: 'upstream model resolved',
  kind: 'text / embedding / image',
  status: '200 ok, ≥400 on failure',
  ms: 'end-to-end latency',
  tokens: 'total tokens',
  promptTokens: 'prompt tokens',
  completionTokens: 'completion tokens',
  caller: 'attributed key alias / user',
  corrId: 'request correlation id',
};

export function CallbacksPayloadPreview() {
  // Deterministic sample (fixed times) → stable preview.
  const record = sampleCallbackRecord();
  const entries = Object.entries(record).filter(([, v]) => v !== undefined);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <CodeBlock weight="duotone" className="size-4 text-primary" />
          Per-call record shape
        </CardTitle>
        <Badge variant="outline" className="font-mono text-[10px]">
          example
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every completed call is fanned to the callback sinks as one structured record — this is the
          exact shape that lands in the console traffic stream.
        </p>
        <div className="overflow-x-auto rounded-md border border-border bg-muted/30">
          <pre className="p-3 font-mono text-[12px] leading-relaxed">
            {JSON.stringify(record, null, 2)}
          </pre>
        </div>
        <dl className="grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
          {entries.map(([k]) => (
            <div key={k} className="flex items-baseline gap-2">
              <dt className="font-mono text-foreground">{k}</dt>
              <dd className="text-muted-foreground">{FIELD_NOTE[k] ?? ''}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
