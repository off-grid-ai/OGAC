'use client';

import {
  ArrowLeft,
  Copy,
  ClockCounterClockwise,
  PencilSimple,
  TextAlignLeft,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PromptPlayground } from '@/components/prompts/PromptPlayground';
import { renderPromptTemplate } from '@/lib/prompt-template';
import { relativeTime } from '@/lib/workspace-grid';

interface PromptView {
  id: string;
  title: string;
  content: string;
  tags: string[];
  variables: string[];
  owner: string;
  visibility: string;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

// Prompt detail — the full template + a live fill-and-copy preview over its {{variables}}, metadata,
// and the prompt's actions. Editing deep-links back to the library's edit panel (?panel=<id>) so the
// single edit form stays DRY (no duplicated editor). Delete confirms, then returns to the library.
export function PromptDetail({ prompt, isOwner }: { prompt: PromptView; isOwner: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});

  const rendered = useMemo(
    () => renderPromptTemplate(prompt.content, values),
    [prompt.content, values],
  );

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} — paste it into any chat`);
    // Record the use so the library's counter stays honest (same call the list "Use" makes).
    await fetch(`/api/v1/prompts/${prompt.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ use: true }),
    }).catch(() => {});
  }

  async function remove() {
    if (!confirm(`Delete prompt “${prompt.title}”?`)) return;
    const r = await fetch(`/api/v1/prompts/${prompt.id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Prompt deleted');
      router.push('/workspace/prompts');
    } else {
      toast.error('Could not delete');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <TextAlignLeft className="size-5" />
          </div>
          <div>
            <Link
              href="/workspace/prompts"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Prompts
            </Link>
            <h1 className="mt-1 font-mono text-lg font-semibold text-foreground">{prompt.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={prompt.visibility === 'org' ? 'default' : 'outline'} className="text-[10px]">
                {prompt.visibility === 'org' ? 'Shared with org' : 'Just me'}
              </Badge>
              {prompt.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => copy(prompt.content, 'template')}>
            <Copy className="size-4" /> Copy
          </Button>
          {isOwner ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => router.push(`/workspace/prompts?panel=${encodeURIComponent(prompt.id)}`)}
              >
                <PencilSimple className="size-4" /> Edit
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={remove}>
                <Trash className="size-4" /> Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Template + rendered preview fill the wide columns; metadata sidebar on the right. */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Template</CardTitle>
              <button
                onClick={() => copy(prompt.content, 'template')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Copy className="size-3.5" /> copy
              </button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
                {prompt.content || '—'}
              </pre>
            </CardContent>
          </Card>

          <PromptPlayground content={prompt.content} />

          {prompt.variables.length > 0 ? (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Fill variables &amp; copy</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Provide values for each <code className="text-primary">{'{{variable}}'}</code>; the
                  preview updates live. Unfilled slots stay as their placeholder.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {prompt.variables.map((v) => (
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
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Preview
                    </span>
                    <button
                      onClick={() => copy(rendered, 'filled prompt')}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Copy className="size-3.5" /> copy filled
                    </button>
                  </div>
                  <pre className="max-h-[20rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
                    {rendered || '—'}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6 lg:col-span-1">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Detail label="Variables">
                {prompt.variables.length === 0 ? (
                  <span className="text-muted-foreground">None — plain text prompt</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {prompt.variables.map((v) => (
                      <Badge key={v} variant="outline" className="text-[10px] text-primary">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                )}
              </Detail>
              <Detail label="Uses">
                <span className="text-foreground">{prompt.uses}</span>
              </Detail>
              <Detail label="Owner">
                <span className="text-muted-foreground">{prompt.owner || '—'}</span>
              </Detail>
              <Detail label="Updated">
                <span className="text-muted-foreground">{relativeTime(prompt.updatedAt)}</span>
              </Detail>
              <Detail label="Created">
                <span className="text-muted-foreground">{relativeTime(prompt.createdAt)}</span>
              </Detail>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center gap-2">
              <ClockCounterClockwise className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="font-mono text-foreground">Current</span>
                <span>edited {relativeTime(prompt.updatedAt)}</span>
              </div>
              <p>
                Library prompts keep a single living version — each edit replaces the current text.
                Copy the template above to snapshot it before a big change.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
