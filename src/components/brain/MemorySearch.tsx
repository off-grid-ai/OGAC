'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { explainResponse } from '@/lib/api-failure';

interface Citation {
  citationId?: number;
  documentId?: string;
  title: string;
  excerpt: string;
  sourceType: string;
  providerLink?: string;
  version?: string;
  updatedAt?: string;
}

// ─── Search the organisation's memory, directly ────────────────────────────────────────────────────
//
// The capability map: "Retrieval is API/tool-first; there is no operator-facing memory-search console page
// yet — add a governed search surface so operators can query memory directly, not only via an agent."
//
// The retrieval itself is proven and governed; this is the missing surface. It calls the SAME
// /api/v1/organizational-brain/search route an agent's tool call goes through, so what an operator sees
// here is exactly what an agent would be given — if the two could differ, this page would be a
// second opinion about the org's memory rather than a window onto it.
//
// URL-DRIVEN, per the repo's navigation rule: the query lives in ?q= so a result set is shareable and
// Back steps out of a search instead of leaving the page.
export function MemorySearch() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [hits, setHits] = useState<Citation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(q), [q]);

  const run = useCallback(async (query: string) => {
    if (!query.trim()) {
      setHits(null);
      setError(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/organizational-brain/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 20 }),
      });
      if (!res.ok) {
        // A refusal is not breakage: memory search is capability-gated, and a reader who may not use it
        // must be told that rather than that the service is down.
        setError((await explainResponse(res, 'search the organisation’s memory')).message);
        setHits(null);
        return;
      }
      const body = (await res.json()) as { citations?: Citation[] };
      setError(null);
      setHits(body.citations ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(q);
  }, [q, run]);

  return (
    <div className="w-full space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // Push to the URL and let the effect fetch — one code path for typing and for a shared link.
          router.push(draft.trim() ? `?q=${encodeURIComponent(draft.trim())}` : '?');
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search what the organisation knows — a policy, a decision, a customer, a process…"
          className="max-w-2xl"
        />
        <Button type="submit" disabled={busy}>
          <MagnifyingGlass className="size-4" />
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}

      {/* Three distinct states, never conflated: nothing asked, asked-and-nothing-found, and results.
          An empty result that looks like an empty search box is how people conclude the memory is empty. */}
      {!error && hits === null ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Ask a question to search the organisation&apos;s memory. Every result carries where it came
            from, so an answer can be checked rather than trusted.
          </CardContent>
        </Card>
      ) : null}

      {!error && hits !== null && hits.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing in the organisation&apos;s memory matched “{q}”. That means nothing indexed matched —
            not that the answer does not exist somewhere unindexed.
          </CardContent>
        </Card>
      ) : null}

      {hits && hits.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            {hits.length} {hits.length === 1 ? 'passage' : 'passages'} — the same results an agent would be
            given for this question.
          </p>
          <div className="grid gap-3 xl:grid-cols-2">
            {hits.map((c, i) => (
              <Card key={`${c.documentId ?? c.title}-${i}`} className="shadow-sm">
                <CardContent className="space-y-1.5 py-4">
                  <p className="text-sm font-medium text-foreground">{c.title || 'Untitled'}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{c.excerpt}</p>
                  {/* PROVENANCE, always. A passage without its origin is a claim. */}
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {c.sourceType || 'unknown source'}
                    {c.version ? ` · v${c.version}` : ''}
                    {c.updatedAt ? ` · ${c.updatedAt.slice(0, 10)}` : ''}
                  </p>
                  {c.providerLink ? (
                    <a
                      href={c.providerLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-primary underline"
                    >
                      Open the source
                    </a>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
