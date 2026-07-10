'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_TRIGGERS, type AgentTriggerValue, validateAgentForm } from '@/lib/agent-form';
import { panelHref, withPanelParams } from '@/lib/url-panel';

export interface ToolOption {
  id: string;
  name: string;
  policy: string; // 'allow' | 'approval' | 'block'
}

// The subset of an agent needed to prefill the edit form. Built-ins aren't editable so only
// custom agents are ever passed here.
export interface EditableAgent {
  id: string;
  name: string;
  role: string;
  systemPrompt?: string;
  model?: string;
  grounded: boolean;
  trigger: string;
  tools: string[];
}

interface Draft {
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  grounded: boolean;
  trigger: AgentTriggerValue;
  tools: string[];
}

const EMPTY: Draft = {
  name: '',
  role: '',
  systemPrompt: '',
  model: '',
  grounded: true,
  trigger: 'on-demand',
  tools: [],
};

function draftFromAgent(a: EditableAgent): Draft {
  return {
    name: a.name,
    role: a.role === 'Custom' ? '' : a.role,
    systemPrompt: a.systemPrompt ?? '',
    model: a.model ?? '',
    grounded: a.grounded,
    trigger: (AGENT_TRIGGERS as readonly string[]).includes(a.trigger)
      ? (a.trigger as AgentTriggerValue)
      : 'on-demand',
    tools: a.tools ?? [],
  };
}

// Author OR edit an agent in plain language, and grant it capabilities. The instruction becomes
// the agent's system prompt; the selected tools are what it can actually DO. Every run flows
// through the SAME governed pipeline as the built-ins (policy gate, guardrails, retrieval
// routing, grounding, provenance signing) — a granted tool still obeys its action policy. The
// panel's open/target state lives in the URL (?panel=new-agent | edit:<id>) so Back closes it and
// it's deep-linkable — never in local useState.
export function AgentFormPanel({
  tools = [],
  editable = [],
}: {
  tools?: ToolOption[];
  editable?: EditableAgent[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel') ?? '';
  const editId = panel.startsWith('edit:') ? panel.slice('edit:'.length) : null;
  const open = panel === 'new-agent' || editId !== null;
  const editing = editId ? editable.find((a) => a.id === editId) : undefined;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  // Seed the form each time the panel opens (blank for create, the agent for edit) so a stale
  // draft never lingers.
  useEffect(() => {
    if (!open) return;
    setDraft(editing ? draftFromAgent(editing) : EMPTY);
    setTouched(false);
    // editId keys the effect so switching between edit targets re-seeds.
  }, [open, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleTool(id: string) {
    setDraft((d) => ({
      ...d,
      tools: d.tools.includes(id) ? d.tools.filter((t) => t !== id) : [...d.tools, id],
    }));
  }

  const errors = validateAgentForm(draft);

  async function submit() {
    setTouched(true);
    if (Object.keys(errors).length > 0) {
      toast.error('Name and instructions are required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(editId ? `/api/v1/admin/agents/${editId}` : '/api/v1/admin/agents', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(
        editId
          ? `Saved "${draft.name}"`
          : `Created "${draft.name}" — runs through the governed pipeline`,
      );
      setPanel(null);
      router.refresh();
    } catch {
      toast.error(editId ? 'Failed to save agent' : 'Failed to create agent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && setPanel(null)}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editId ? 'Edit agent' : 'Create an agent'}</SheetTitle>
          <SheetDescription>
            Give it a job, ground it in your knowledge, and grant it tools to act with. Every run is
            governed by the policy, guardrails, model routing, and grounding on this console —
            automatically.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="agent-name"
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Renewals Assistant"
                aria-invalid={touched && errors.name ? true : undefined}
              />
              {touched && errors.name ? (
                <p className="text-[11px] text-destructive">{errors.name}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-role">Role / team</Label>
              <Input
                id="agent-role"
                value={draft.role}
                onChange={(e) => set('role', e.target.value)}
                placeholder="Customer Success"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">
              Instructions <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="agent-prompt"
              rows={6}
              value={draft.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              placeholder="You help the renewals team. Given an account, summarize its usage trend and draft a renewal talking-points list. Be concise and cite the source docs."
              aria-invalid={touched && errors.systemPrompt ? true : undefined}
            />
            {touched && errors.systemPrompt ? (
              <p className="text-[11px] text-destructive">{errors.systemPrompt}</p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              This becomes the agent&apos;s system prompt. Grounding is enforced on top — it
              can&apos;t invent facts beyond the retrieved sources.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model (optional)</Label>
              <Input
                id="agent-model"
                value={draft.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="gateway default"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-trigger">Trigger</Label>
              <select
                id="agent-trigger"
                value={draft.trigger}
                onChange={(e) => set('trigger', e.target.value as AgentTriggerValue)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {AGENT_TRIGGERS.map((t) => (
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
            <Switch
              id="agent-grounded"
              checked={draft.grounded}
              onCheckedChange={(v) => set('grounded', v)}
            />
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
                  const on = draft.tools.includes(t.id);
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
        </SheetBody>
        <SheetFooter>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? (editId ? 'Saving…' : 'Creating…') : editId ? 'Save changes' : 'Create agent'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
