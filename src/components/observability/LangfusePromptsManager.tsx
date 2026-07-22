'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { PromptListRow, PromptType } from '@/lib/langfuse-prompts';

// Langfuse prompt registry — list + create on the left/top, rows link to a deep detail page. Governed
// writes hit the admin observability routes. URL-driven detail: rows are real links, not modals.
export function LangfusePromptsManager() {
  const [configured, setConfigured] = useState(true);
  const [prompts, setPrompts] = useState<PromptListRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Create form
  const [name, setName] = useState('');
  const [type, setType] = useState<PromptType>('text');
  const [text, setText] = useState('');
  const [chatJson, setChatJson] = useState('[\n  { "role": "system", "content": "" }\n]');
  const [labels, setLabels] = useState('');
  const [tags, setTags] = useState('');
  const [commit, setCommit] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/admin/observability/prompts', { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; prompts?: PromptListRow[]; error?: string };
    setConfigured(j.configured !== false);
    setPrompts(j.prompts ?? []);
    setError(j.error ?? '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        labels: labels.split(',').map((s) => s.trim()).filter(Boolean),
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        commitMessage: commit.trim() || undefined,
      };
      if (type === 'text') {
        body.text = text;
      } else {
        try {
          body.messages = JSON.parse(chatJson);
        } catch {
          throw new Error('Chat messages must be valid JSON (an array of {role, content})');
        }
      }
      const res = await fetch('/api/v1/admin/observability/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || `create failed (${res.status})`);
      toast.success(`Prompt "${name.trim()}" saved`);
      setName('');
      setText('');
      setLabels('');
      setTags('');
      setCommit('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Langfuse isn&apos;t configured on this deployment yet (no Langfuse endpoint / project keys).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="h-fit shadow-sm lg:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">New prompt / version</CardTitle>
          <CardDescription className="text-xs">
            Re-using an existing name cuts a new version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input placeholder="team/summarizer" value={name} onChange={(e) => setName(e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <div className="flex gap-2">
              {(['text', 'chat'] as const).map((t) => (
                <Button key={t} type="button" size="sm" variant={type === t ? 'default' : 'outline'} onClick={() => setType(t)}>
                  {t}
                </Button>
              ))}
            </div>
          </div>
          {type === 'text' ? (
            <div className="space-y-1">
              <Label className="text-xs">Prompt body</Label>
              <Textarea rows={6} placeholder="You are a helpful assistant. {{input}}" value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Messages (JSON)</Label>
              <Textarea rows={6} value={chatJson} onChange={(e) => setChatJson(e.target.value)} className="font-mono text-xs" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Labels (csv)</Label>
              <Input placeholder="production" value={labels} onChange={(e) => setLabels(e.target.value)} className="h-9 font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags (csv)</Label>
              <Input placeholder="bfsi" value={tags} onChange={(e) => setTags(e.target.value)} className="h-9 font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Commit message</Label>
            <Input placeholder="initial version" value={commit} onChange={(e) => setCommit(e.target.value)} className="h-9" />
          </div>
          <Button size="sm" onClick={create} disabled={busy || !name.trim()} className="w-full">
            Save prompt
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Prompts</CardTitle>
          <CardDescription className="text-xs">
            {error ? <span className="text-destructive">{error}</span> : 'Click a prompt to manage its versions + labels.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Versions</TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prompts.map((p) => (
                  <TableRow key={p.name} className="cursor-pointer hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link href={`/insights/ai/langfuse-prompts/${encodeURIComponent(p.name)}`} className="text-primary hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{p.type}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{p.versionCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.labels.map((l) => (
                          <Badge key={l} variant={l === 'production' ? 'default' : 'outline'} className="text-[10px]">{l}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.updatedAt?.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
                {prompts.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No prompts yet.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
