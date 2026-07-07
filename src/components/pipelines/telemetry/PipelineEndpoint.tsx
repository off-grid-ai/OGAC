'use client';

import { Copy } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// ─── PipelineEndpoint — the pipeline's callable endpoint + curl/SDK snippets ──────────────────────
//
// Renders the pipeline's own provisioned endpoint (origin resolved client-side from window.location so
// it's correct on every tenant subdomain) plus copy-paste curl + JS snippets. The key is a placeholder
// (og_pl_…) the operator swaps for one they mint above — we NEVER echo a real secret here.
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-2">
        <code className="flex-1 break-all whitespace-pre-wrap text-xs text-foreground">{value}</code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success('Copied');
          }}
          aria-label={`Copy ${label}`}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function PipelineEndpoint({ pipelineId }: { pipelineId: string }) {
  const [origin, setOrigin] = useState('https://your-console.example.com');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const path = `/api/v1/pipeline/${pipelineId}/run`;
  const url = `${origin}${path}`;
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer og_pl_…" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your request", "data_class": "general"}'`;
  const js = `const res = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer og_pl_…",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: "your request", data_class: "general" }),
});
const run = await res.json();`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <CopyRow label="Endpoint" value={`POST ${path}`} />
        <CopyRow label="curl" value={curl} />
      </div>
      <div className="space-y-3">
        <CopyRow label="JavaScript (fetch)" value={js} />
        <p className="text-xs text-muted-foreground">
          Present a key you mint above as the <code>Authorization: Bearer</code> token. Every call is
          governed by this pipeline — its policy, guardrails, and routing/egress leash apply. A key
          minted for this pipeline can only ever invoke this pipeline.
        </p>
      </div>
    </div>
  );
}
