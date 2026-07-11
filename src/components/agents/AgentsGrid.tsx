'use client';

import { Robot } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AgentCardActions } from '@/components/agents/AgentCardActions';
import { AgentFormPanel, type EditableAgent, type ToolOption } from '@/components/agents/AgentFormPanel';
import { Badge } from '@/components/ui/badge';
import { accentHue, initials } from '@/lib/workspace-grid';

export interface AgentCardModel {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt?: string;
  model?: string;
  planes: string[];
  planeLabels: string[];
  tools: string[];
  grounded: boolean;
  trigger: string;
  custom?: boolean;
  enabled?: boolean;
}

const TRIGGER: Record<string, string> = {
  'on-call': 'bg-blue-500/10 text-blue-600',
  'on-message': 'bg-blue-500/10 text-blue-600',
  observed: 'bg-primary/10 text-primary',
  scheduled: 'bg-amber-500/10 text-amber-600',
  'on-demand': 'bg-muted text-muted-foreground',
};

function AgentCard({ a }: Readonly<{ a: AgentCardModel }>) {
  const hue = accentHue(a.id || a.name);
  const disabled = a.custom && a.enabled === false;
  return (
    <div
      className={
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md' +
        (disabled ? ' opacity-60' : '')
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded font-mono text-[11px] font-medium"
          style={{ background: `hsl(${hue} 60% 45% / 0.15)`, color: `hsl(${hue} 60% 45%)` }}
          aria-hidden
        >
          {a.custom ? initials(a.name) : <Robot className="size-4" />}
        </span>
        <Link href={`/build/agents/${a.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
          <span className="truncate font-mono text-sm font-medium">{a.name}</span>
        </Link>
        {disabled ? (
          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
            disabled
          </Badge>
        ) : a.custom ? (
          <Badge variant="secondary" className="shrink-0 bg-primary/10 text-[10px] text-primary">
            yours
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {a.role}
          </Badge>
          <Badge variant="secondary" className={`text-[10px] ${TRIGGER[a.trigger] ?? ''}`}>
            {a.trigger}
          </Badge>
          {a.grounded ? (
            <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
              grounded
            </Badge>
          ) : null}
        </div>
        <p className="line-clamp-3 min-h-[3rem] text-xs leading-relaxed text-muted-foreground">
          {a.description || a.systemPrompt || 'No description.'}
        </p>
        {a.tools.length ? (
          <div className="flex flex-wrap gap-1">
            {a.tools.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Needs
            </span>
            {a.planeLabels.length ? (
              a.planeLabels.map((p) => (
                <Badge key={p} variant="secondary" className="bg-primary/10 text-[10px] text-primary">
                  {p}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          <AgentCardActions agentId={a.id} custom={a.custom} enabled={a.enabled !== false} />
        </div>
      </div>
    </div>
  );
}

// The Agents management grid: a responsive card grid (fills wide screens) with per-card run /
// edit / enable-disable / delete, plus the shared URL-driven create/edit panel. A thin presenter
// over server-provided data.
export function AgentsGrid({
  agents,
  tools,
}: Readonly<{
  agents: AgentCardModel[];
  tools: ToolOption[];
}>) {
  const editable: EditableAgent[] = agents
    .filter((a) => a.custom)
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      systemPrompt: a.systemPrompt,
      model: a.model,
      grounded: a.grounded,
      trigger: a.trigger,
      tools: a.tools,
    }));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {agents.map((a) => (
          <AgentCard key={a.id} a={a} />
        ))}
      </div>
      <AgentFormPanel tools={tools} editable={editable} />
    </>
  );
}
