'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PromptDetail } from '@/lib/adapters/langfuse-prompts';

// Per-prompt lifecycle surface. The selected version is URL-driven (?version=) so Back steps between
// versions. Actions: promote/move a deployment label, add a label, and delete (this version or all).
export function LangfusePromptDetail({ name }: { name: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const version = params.get('version') ?? '';
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [labelInput, setLabelInput] = useState('');

  const load = useCallback(async () => {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    const res = await fetch(`/api/v1/admin/observability/prompts/${encodeURIComponent(name)}${qs}`, { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; detail?: PromptDetail | null; error?: string };
    setConfigured(j.configured !== false);
    setDetail(j.detail ?? null);
    setError(j.error ?? '');
  }, [name, version]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectVersion = (v: number | '') => {
    const qs = new URLSearchParams(params.toString());
    if (v === '') qs.delete('version');
    else qs.set('version', String(v));
    router.replace(`?${qs}`, { scroll: false });
  };

  const selected = detail?.selected ?? null;

  async function setLabels(newLabels: string[]) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/observability/prompts/${encodeURIComponent(name)}/versions/${selected.version}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newLabels }) },
      );
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `update failed (${res.status})`);
      toast.success('Labels updated');
      setLabelInput('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(scope: 'version' | 'all') {
    const msg = scope === 'all' ? `Delete ALL versions of "${name}"?` : `Delete version ${selected?.version} of "${name}"?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const qs = scope === 'version' && selected ? `?version=${selected.version}` : '';
      const res = await fetch(`/api/v1/admin/observability/prompts/${encodeURIComponent(name)}${qs}`, { method: 'DELETE' });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `delete failed (${res.status})`);
      toast.success('Deleted');
      if (scope === 'all') router.push('/insights/ai/langfuse-prompts');
      else await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return <Card className="shadow-sm"><CardContent className="py-6 text-center text-sm text-muted-foreground">Langfuse isn&apos;t configured on this deployment.</CardContent></Card>;
  }
  if (!detail) {
    return <Card className="shadow-sm"><CardContent className="py-6 text-center text-sm text-muted-foreground">{error || 'Prompt not found.'}</CardContent></Card>;
  }

  const meta = detail.meta;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="h-fit shadow-sm lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Versions</CardTitle>
          <CardDescription className="text-xs">{meta.type} · {meta.versions.length} version(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {meta.versions.map((v) => {
            const isSel = selected?.version === v || (version === '' && meta.latestVersion === v && !selected);
            return (
              <button
                key={v}
                onClick={() => selectVersion(v)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted/40 ${selected?.version === v ? 'bg-muted/60 font-medium' : ''}`}
              >
                <span className="font-mono">v{v}</span>
                {isSel ? <Badge variant="secondary">viewing</Badge> : null}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm">
              {selected ? `Version ${selected.version}` : 'Select a version'}
            </CardTitle>
            <CardDescription className="text-xs">
              {selected?.commitMessage || (selected ? 'No commit message' : 'Pick a version on the left')}
            </CardDescription>
          </div>
          {selected ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => remove('version')} disabled={busy}>Delete version</Button>
              <Button size="sm" variant="destructive" onClick={() => remove('all')} disabled={busy}>Delete all</Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Labels:</span>
                {selected.labels.length === 0 ? <span className="text-xs text-muted-foreground">none</span> : null}
                {selected.labels.map((l) => (
                  <Badge key={l} variant={l === 'production' ? 'default' : 'outline'} className="gap-1">
                    {l}
                    <button
                      onClick={() => setLabels(selected.labels.filter((x) => x !== l))}
                      className="ml-1 text-[10px] opacity-70 hover:opacity-100"
                      aria-label={`Remove ${l}`}
                    >
                      ✕
                    </button>
                  </Badge>
                ))}
                {!selected.isProduction ? (
                  <Button size="sm" variant="outline" onClick={() => setLabels([...selected.labels, 'production'])} disabled={busy}>
                    Promote to production
                  </Button>
                ) : null}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Add label</Label>
                  <Input placeholder="staging" value={labelInput} onChange={(e) => setLabelInput(e.target.value)} className="h-9 font-mono" />
                </div>
                <Button size="sm" onClick={() => labelInput.trim() && setLabels([...selected.labels, labelInput.trim()])} disabled={busy || !labelInput.trim()}>
                  Add
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body</Label>
                {selected.type === 'text' ? (
                  <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap">{selected.text}</pre>
                ) : (
                  <div className="space-y-2">
                    {selected.messages.map((m, i) => (
                      <div key={i} className="rounded-md border border-border bg-muted/30 p-3">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">{m.role}</div>
                        <pre className="font-mono text-xs whitespace-pre-wrap">{m.content}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selected.tags.length ? (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                </div>
              ) : null}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{error || 'No version selected.'}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
