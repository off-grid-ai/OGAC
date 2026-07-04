'use client';

import { ArrowRight, CheckCircle, Plus, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AgentRunner } from '@/components/agents/AgentRunner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { deriveTitle, validateBuilderInput } from '@/lib/studio-builder';

interface Tool {
  id: string;
  name: string;
}

const VISIBILITY: { id: 'private' | 'org' | 'public'; label: string; hint: string }[] = [
  { id: 'private', label: 'Just me', hint: 'Only you can use it' },
  { id: 'org', label: 'My org', hint: 'Everyone in the org can find and chat with it' },
  { id: 'public', label: 'Shareable link', hint: 'Publishes a direct link anyone with it can use' },
];

// The non-technical Studio builder (Phase 4.5). Describe an assistant in plain language, pick what
// it can do and whether it uses your uploaded knowledge, choose who can use it — Studio wires the
// governed agent + template behind the scenes (create the agent, save the template) and hands off
// to the agent's run page to try it. No model/param/embedding jargon anywhere.
export function StudioBuilder({ tools }: { tools: Tool[] }) {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [title, setTitle] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [grounded, setGrounded] = useState(true);
  const [visibility, setVisibility] = useState<'private' | 'org' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // Once created, we keep the operator on this page and let them try it inline (Step 4).
  const [created, setCreated] = useState<{ agentId: string; title: string; url?: string } | null>(
    null,
  );

  const check = validateBuilderInput({ goal, title, grounded, visibility, toolIds: selectedTools });

  function toggleTool(id: string) {
    setSelectedTools((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }

  // Ask the gateway to infer a name, relevant skills, and whether to ground — from the goal.
  // Best-effort: on any failure the form is untouched and the user configures it manually.
  async function suggest() {
    if (goal.trim().length < 10 || suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch('/api/v1/studio/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, tools }),
      });
      const s = (await res.json().catch(() => ({}))) as {
        title?: string;
        toolIds?: string[];
        grounded?: boolean | null;
      };
      if (s.title && !title.trim()) setTitle(s.title);
      if (Array.isArray(s.toolIds) && s.toolIds.length) setSelectedTools(s.toolIds);
      if (typeof s.grounded === 'boolean') setGrounded(s.grounded);
      toast.success('Suggested a setup from your description — tweak anything below.');
    } catch {
      toast.error('Could not suggest right now — configure it below.');
    } finally {
      setSuggesting(false);
    }
  }

  function reset() {
    setGoal('');
    setTitle('');
    setSelectedTools([]);
    setGrounded(true);
    setVisibility('private');
    setCreated(null);
  }

  async function create() {
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      // 1. Create the governed agent (goal → instructions, skills → tools, grounding on).
      const agentRes = await fetch('/api/v1/admin/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: check.value!.title,
          role: 'Studio',
          systemPrompt: check.value!.goal,
          tools: check.value!.toolIds,
          grounded: check.value!.grounded,
          trigger: 'on-demand',
        }),
      });
      if (!agentRes.ok) throw new Error('Could not create the assistant');
      const agent = (await agentRes.json()) as { id: string };

      // 2. Save the Studio template pointing at it (publishes /app/<slug> when shareable).
      const tplRes = await fetch('/api/v1/studio/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: check.value!.title,
          summary: check.value!.goal.slice(0, 200),
          prompt: check.value!.goal,
          visibility: check.value!.visibility,
          deploy: check.value!.visibility === 'public',
          workflow: {
            title: check.value!.title,
            summary: check.value!.goal.slice(0, 200),
            nodeIds: [`agent:${agent.id}`],
            edges: [],
          },
        }),
      });
      const tpl = (await tplRes.json().catch(() => ({}))) as { url?: string };

      toast.success(
        tpl.url
          ? `"${check.value!.title}" published — shareable at ${tpl.url}`
          : `"${check.value!.title}" created`,
      );
      // Stay on the page and let them try it inline (Step 4). router.refresh so the gallery on
      // /studio reflects the new assistant when they navigate back.
      setCreated({ agentId: agent.id, title: check.value!.title, url: tpl.url });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create the assistant');
    } finally {
      setBusy(false);
    }
  }

  // Post-create: success banner + inline try-it (the governed runner), no page change.
  if (created) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="border-primary/30 bg-primary/5 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <CheckCircle className="size-5 text-primary" weight="fill" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                &ldquo;{created.title}&rdquo; is live.
              </p>
              <p className="text-xs text-muted-foreground">
                Try it below. It runs through the full governed pipeline.
                {created.url ? (
                  <>
                    {' '}Shared at{' '}
                    <a href={created.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {created.url}
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
              <Plus className="size-4" />
              New assistant
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/studio">Done</Link>
            </Button>
          </CardContent>
        </Card>

        <AgentRunner agentId={created.agentId} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 1. Describe */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">1</span>
            What should this assistant do?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            placeholder="e.g. Answer employee questions about our HR policies, and always cite the policy document you used."
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggest}
              disabled={goal.trim().length < 10 || suggesting}
              className="gap-1.5"
            >
              <Sparkle className="size-4" />
              {suggesting ? 'Thinking…' : 'Suggest a setup'}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assistant-name" className="text-xs text-muted-foreground">
              Name (optional)
            </Label>
            <Input
              id="assistant-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={goal.trim() ? deriveTitle(goal) : 'HR Policy Assistant'}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Skills */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">2</span>
            What can it do? (optional)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Give it skills — the tools your org has set up. Each stays governed by its action policy.
          </p>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tools set up yet. Your admin can add them on the Integrations page. The assistant
              will still answer from its instructions and your knowledge.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t) => {
                const on = selectedTools.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTool(t.id)}
                    className={
                      on
                        ? 'rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs text-primary'
                        : 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40'
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Knowledge */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">3</span>
            Should it use your uploaded knowledge?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="grounded" className="text-sm">Answer from uploaded knowledge</Label>
              <p className="text-[11px] text-muted-foreground">
                It only answers from your documents and cites them — it won&apos;t make things up.
                Add documents on the Knowledge page.
              </p>
            </div>
            <Switch id="grounded" checked={grounded} onCheckedChange={setGrounded} />
          </div>
        </CardContent>
      </Card>

      {/* 4. Share */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">4</span>
            Who can use it?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {VISIBILITY.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVisibility(v.id)}
              className={
                visibility === v.id
                  ? 'flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 text-left'
                  : 'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary/40'
              }
            >
              <div>
                <div className="text-sm text-foreground">{v.label}</div>
                <div className="text-[11px] text-muted-foreground">{v.hint}</div>
              </div>
              {visibility === v.id ? <Badge variant="secondary" className="bg-primary/10 text-primary">selected</Badge> : null}
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {check.ok ? 'Ready — you can try it right after creating.' : check.error}
        </p>
        <Button onClick={create} disabled={!check.ok || busy} className="gap-1.5">
          <Sparkle className="size-4" />
          {busy ? 'Creating…' : 'Create & try'}
          {!busy ? <ArrowRight className="size-4" /> : null}
        </Button>
      </div>
    </div>
  );
}
