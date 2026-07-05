'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const TRIGGERS = ['on-demand', 'on-call', 'on-message', 'observed', 'scheduled'] as const;

export interface ToolOption {
  id: string;
  name: string;
  policy: string; // 'allow' | 'approval' | 'block'
}

// Author an agent in plain language, and grant it capabilities. The instruction becomes the
// agent's system prompt; the selected tools are what it can actually DO (call a connector, run a
// query). Every run flows through the SAME governed pipeline as the built-ins (policy gate,
// guardrails, retrieval routing, grounding, provenance signing) — a granted tool still obeys its
// action policy (allow / needs-approval / blocked), so capability never bypasses governance.
// The create panel's open/closed state lives in the URL (?panel=new-agent) so Back closes it and
// it's deep-linkable — never in local useState.
export function CreateAgentButton({ tools = [] }: { tools?: ToolOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-agent';
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('');
  const [grounded, setGrounded] = useState(true);
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]>('on-demand');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  function reset() {
    setName('');
    setRole('');
    setSystemPrompt('');
    setModel('');
    setGrounded(true);
    setTrigger('on-demand');
    setSelectedTools([]);
  }

  // Reset the form each time the panel opens so a stale draft never lingers.
  useEffect(() => {
    if (open) reset();
  }, [open]);

  function toggleTool(id: string) {
    setSelectedTools((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));
  }

  async function create() {
    if (!name.trim() || !systemPrompt.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          role,
          systemPrompt,
          model,
          grounded,
          trigger,
          tools: selectedTools,
        }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Created "${name}" — runs through the governed pipeline`);
      setPanel(null);
      router.refresh();
    } catch {
      toast.error('Failed to create agent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-agent')}>
        <Plus className="size-4" />
        New agent
      </Button>
      <Sheet open={open} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Create an agent</SheetTitle>
            <SheetDescription>
              Give it a job, ground it in your knowledge, and grant it tools to act with. Every run
              is governed by the policy, guardrails, model routing, and grounding on this console —
              automatically.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Renewals Assistant"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-role">Role / team</Label>
              <Input
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Customer Success"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">Instructions</Label>
            <Textarea
              id="agent-prompt"
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You help the renewals team. Given an account, summarize its usage trend and draft a renewal talking-points list. Be concise and cite the source docs."
            />
            <p className="text-[11px] text-muted-foreground">
              This becomes the agent&apos;s system prompt. Grounding is enforced on top — it can&apos;t
              invent facts beyond the retrieved sources.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model (optional)</Label>
              <Input
                id="agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gateway default"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-trigger">Trigger</Label>
              <select
                id="agent-trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as (typeof TRIGGERS)[number])}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="agent-grounded">Grounded in the Brain</Label>
              <p className="text-[11px] text-muted-foreground">
                Retrieve + cite sources, and verify the answer against them.
              </p>
            </div>
            <Switch id="agent-grounded" checked={grounded} onCheckedChange={setGrounded} />
          </div>

          {/* Capabilities: which registered tools this agent may call. This is what makes it an
              agent rather than a canned prompt — but each tool still obeys its action policy. */}
          <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
            <div>
              <Label>Tools this agent can use</Label>
              <p className="text-[11px] text-muted-foreground">
                What the agent can actually do — call a connector, run a query. Granted tools still
                obey their action policy (allow / needs-approval / blocked).
              </p>
            </div>
            {tools.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No tools registered yet. Add connectors on the Integrations page to grant agents
                capabilities beyond text.
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
                          ? 'flex items-center gap-1 rounded-md border border-primary bg-primary/10 px-2 py-1 text-xs text-primary'
                          : 'flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/40'
                      }
                    >
                      {t.name}
                      {t.policy === 'approval' ? (
                        <span className="text-[9px] uppercase text-amber-600">·gated</span>
                      ) : t.policy === 'block' ? (
                        <span className="text-[9px] uppercase text-destructive">·blocked</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button
            onClick={create}
            disabled={busy || !name.trim() || !systemPrompt.trim()}
            className="w-full"
          >
            {busy ? 'Creating…' : 'Create agent'}
          </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
