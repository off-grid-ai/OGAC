'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const TRIGGERS = ['on-demand', 'on-call', 'on-message', 'observed', 'scheduled'] as const;

// Author an agent in plain language. Whatever you type becomes the agent's instruction — it then
// runs through the SAME governed pipeline as the built-ins (policy gate, guardrails, retrieval
// routing, grounding, provenance signing). No code, no special powers.
export function CreateAgentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('');
  const [grounded, setGrounded] = useState(true);
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]>('on-demand');
  const [busy, setBusy] = useState(false);

  function reset() {
    setName('');
    setRole('');
    setSystemPrompt('');
    setModel('');
    setGrounded(true);
    setTrigger('on-demand');
  }

  async function create() {
    if (!name.trim() || !systemPrompt.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, role, systemPrompt, model, grounded, trigger }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Created "${name}" — runs through the governed pipeline`);
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to create agent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New agent
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create an agent from text</DialogTitle>
          <DialogDescription>
            Describe the job in plain language. Every run is governed by the policy, guardrails,
            model routing, and grounding configured on this console — automatically.
          </DialogDescription>
        </DialogHeader>
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
          <Button
            onClick={create}
            disabled={busy || !name.trim() || !systemPrompt.trim()}
            className="w-full"
          >
            {busy ? 'Creating…' : 'Create agent'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
