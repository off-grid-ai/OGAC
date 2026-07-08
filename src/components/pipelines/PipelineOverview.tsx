'use client';

import {
  ArrowRight,
  Cloud,
  Database,
  FlowArrow,
  HardDrives,
  Plugs,
  Scales,
  ShieldCheck,
  Target,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pipelineTabHref } from '@/lib/pipeline-detail';
import { PipelineActions } from './PipelineActions';
import { PipelineEditSheet } from './PipelineEditSheet';
import { PipelineLifecycle, type PipelineLifecycleData } from './PipelineLifecycle';

// The rich, honest data the Overview renders. Everything read-only here is read from the real libs on
// the server; where a per-pipeline number can't be honestly attributed yet, the field is a count or a
// "not configured" flag — NEVER a fabricated metric.
export interface PipelineOverviewData {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  visibility: string;
  isTemplate: boolean;
  defaultModel: string | null;
  dataAllowlist: string[];
  gateway?: { id: string; name: string; kind: string; egressClass: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Egress leash summary derived from routing (pure). */
  routing: {
    egressAllowed: boolean;
    rules: { label: string; action: string }[];
  };
  /** Governance overlay state (this pipeline's own overrides) + inherited org rule counts. */
  governance: {
    policyOverlayKeys: number;
    guardrailOverlayKeys: number;
    orgPolicyRules: number;
    orgGuardrailRules: number;
  };
  /** Quality attach counts (pipeline-scoped, honest). Run pass-rate is NOT attributed per pipeline. */
  quality: {
    evalsAttached: number;
    goldenCases: number;
  };
  /** Consumers bound to this pipeline (apps/agents + chat projects) + chat-default/allowlist flags. */
  consumers: {
    apps: { id: string; title: string; published: boolean }[];
    projects: { id: string; name: string }[];
    isOrgDefaultChat: boolean;
    inChatAllowlist: boolean;
  };
  /** Recent version history (newest first, capped). */
  recentVersions: { id: string; version: number; note: string; createdAt: string | null; createdBy: string }[];
  /** M2 lifecycle & ownership (server-resolved for THIS user's role). */
  lifecycle: PipelineLifecycleData;
}

function egressBadge(egressClass: string | undefined) {
  if (egressClass === 'on-prem') {
    return (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        <HardDrives className="size-3" /> on-prem
      </Badge>
    );
  }
  if (egressClass === 'cloud') {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Cloud className="size-3" /> cloud
      </Badge>
    );
  }
  return null;
}

function statusBadge(status: string) {
  if (status === 'published') {
    return <Badge variant="secondary" className="bg-primary/10 text-primary">published</Badge>;
  }
  if (status === 'in_review') {
    return (
      <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
        in review
      </Badge>
    );
  }
  if (status === 'archived' || status === 'deprecated') {
    return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  }
  return <Badge variant="outline" className="text-amber-600 dark:text-amber-400">draft</Badge>;
}

// A section card with a title, an optional icon, and a "manage on the X tab" link in the header.
function SectionCard({
  title,
  icon,
  href,
  linkLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
        {href ? (
          <Link
            href={href}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {linkLabel ?? 'Open'} <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1 text-sm text-foreground">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

// The comprehensive Overview — the heart-of-the-product surface. Full-width, real dashboard: identity
// + lifecycle actions, binding, routing/egress leash, governance, quality, data ceiling, consumers,
// and recent versions — each linking into the tab that owns it. Honest empty states throughout.
export function PipelineOverview({ pipeline: p }: { pipeline: PipelineOverviewData }) {
  const href = (tab: Parameters<typeof pipelineTabHref>[1]) => pipelineTabHref(p.id, tab);

  return (
    <div className="w-full space-y-6">
      {/* ── header: identity + status + lifecycle actions ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-foreground">{p.name}</h2>
            {statusBadge(p.status)}
            <Badge variant="outline" className="text-xs">v{p.version}</Badge>
            {p.isTemplate ? (
              <Badge variant="secondary" className="bg-primary/10 text-primary">template</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.description || 'No description.'}</p>
        </div>
        <PipelineActions pipelineId={p.id} status={p.status} name={p.name} showTransitions={false} />
      </div>

      {/* ── M2 lifecycle & ownership band ── */}
      <PipelineLifecycle data={p.lifecycle} />

      {/* ── the dashboard grid ── */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* Binding */}
        <SectionCard
          title="Binding"
          icon={<FlowArrow className="size-4 text-primary" />}
          href={href('routing')}
          linkLabel="Gateway & Routing"
        >
          <div className="divide-y">
            <Field label="Gateway">
              {p.gateway ? (
                <span className="inline-flex items-center gap-2">
                  {p.gateway.name} {egressBadge(p.gateway.egressClass)}
                </span>
              ) : (
                <span className="text-muted-foreground">Org default gateway</span>
              )}
            </Field>
            <Field label="Egress">
              {p.gateway
                ? p.gateway.egressClass === 'on-prem'
                  ? 'Data stays on-prem'
                  : 'Data may leave to cloud'
                : '—'}
            </Field>
            <Field label="Default model">
              <span className="font-mono text-xs">{p.defaultModel || 'gateway default'}</span>
            </Field>
          </div>
        </SectionCard>

        {/* Routing / egress leash */}
        <SectionCard
          title="Routing (egress leash)"
          icon={<Target className="size-4 text-primary" />}
          href={href('routing')}
          linkLabel="Edit routing"
        >
          <div className="space-y-2">
            <Field label="Cloud egress">
              {p.routing.egressAllowed ? (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  allowed
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-primary/10 text-primary">leashed to on-prem</Badge>
              )}
            </Field>
            {p.routing.rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No data_class rules — everything defaults to local. Add rules on Gateway &amp; Routing to
                steer PII/sensitive classes to block or on-prem.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {p.routing.rules.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-foreground">{r.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>

        {/* Data ceiling — editable via the Edit sheet / Routing tab */}
        <SectionCard
          title="Data ceiling (hard allowlist)"
          icon={<Database className="size-4 text-primary" />}
          href={href('routing')}
          linkLabel="Edit ceiling"
        >
          {p.dataAllowlist.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No data domains allowed — this pipeline touches no data (deny-by-default). Add domains via
              Edit to let consumers reach them.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {p.dataAllowlist.map((d) => (
                <Badge key={d} variant="outline" className="font-mono text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Governance — policy + guardrails */}
        <SectionCard
          title="Policy"
          icon={<Scales className="size-4 text-primary" />}
          href={href('policy')}
          linkLabel="Policy tab"
        >
          <div className="divide-y">
            <Field label="This pipeline">
              {p.governance.policyOverlayKeys > 0
                ? `${p.governance.policyOverlayKeys} override${p.governance.policyOverlayKeys === 1 ? '' : 's'}`
                : 'inherits org defaults'}
            </Field>
            <Field label="Org policy rules">{p.governance.orgPolicyRules}</Field>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Effective policy = org defaults, tightened by this pipeline&apos;s overrides. Configure on the
            Policy tab.
          </p>
        </SectionCard>

        <SectionCard
          title="Guardrails"
          icon={<ShieldCheck className="size-4 text-primary" />}
          href={href('guardrails')}
          linkLabel="Guardrails tab"
        >
          <div className="divide-y">
            <Field label="This pipeline">
              {p.governance.guardrailOverlayKeys > 0
                ? `${p.governance.guardrailOverlayKeys} override${p.governance.guardrailOverlayKeys === 1 ? '' : 's'}`
                : 'inherits org defaults'}
            </Field>
            <Field label="Org guardrail rules">{p.governance.orgGuardrailRules}</Field>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            PII masking, injection, and grounding checks. Scoped to this pipeline; inherits org. Configure
            on the Guardrails tab.
          </p>
        </SectionCard>

        {/* Quality snapshot — honest attach counts, no fabricated pass-rate */}
        <SectionCard
          title="Quality"
          icon={<Target className="size-4 text-primary" />}
          href={href('quality')}
          linkLabel="Quality tab"
        >
          <div className="divide-y">
            <Field label="Evals attached">{p.quality.evalsAttached}</Field>
            <Field label="Golden set size">{p.quality.goldenCases}</Field>
          </div>
          {p.quality.evalsAttached === 0 && p.quality.goldenCases === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No quality bar configured yet — attach evals and a golden set on the Quality tab, then run
              them in this pipeline&apos;s context to gate releases.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Run these in context and review the pass-rate + drift on the Quality tab.
            </p>
          )}
        </SectionCard>

        {/* Consumers — LIVE (apps/agents bound + chat projects that pin it + chat-default flags) */}
        <SectionCard
          title="Consumers"
          icon={<Plugs className="size-4 text-primary" />}
          href={href('api')}
          linkLabel="API tab"
        >
          {(() => {
            const { apps, projects, isOrgDefaultChat, inChatAllowlist } = p.consumers;
            const total =
              apps.length + projects.length + (isOrgDefaultChat || inChatAllowlist ? 1 : 0);
            if (total === 0) {
              return (
                <p className="text-xs text-muted-foreground">
                  Nothing consumes this pipeline yet. Bind it from an app/agent&apos;s &quot;Runs on&quot;
                  selector, pin it on a chat project, or make it the org-default chat pipeline in Admin.
                  External callers use a provisioned key from the API tab.
                </p>
              );
            }
            return (
              <div className="space-y-3 text-xs">
                {(isOrgDefaultChat || inChatAllowlist) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isOrgDefaultChat ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        org-default chat
                      </Badge>
                    ) : null}
                    {inChatAllowlist ? (
                      <Badge variant="outline">available for chat</Badge>
                    ) : null}
                  </div>
                )}
                {apps.length > 0 && (
                  <div>
                    <div className="mb-1 uppercase tracking-wide text-muted-foreground">
                      Apps &amp; agents ({apps.length})
                    </div>
                    <ul className="space-y-1">
                      {apps.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2">
                          <Link href={`/build/apps/${a.id}`} className="truncate text-primary hover:underline">
                            {a.title || a.id}
                          </Link>
                          {a.published ? (
                            <Badge variant="outline" className="shrink-0">live</Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 text-muted-foreground">draft</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {projects.length > 0 && (
                  <div>
                    <div className="mb-1 uppercase tracking-wide text-muted-foreground">
                      Chat projects ({projects.length})
                    </div>
                    <ul className="space-y-1">
                      {projects.map((pr) => (
                        <li key={pr.id} className="truncate text-foreground">
                          {pr.name || pr.id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </SectionCard>

        {/* Identity / meta */}
        <SectionCard title="Details" icon={<FlowArrow className="size-4 text-primary" />}>
          <div className="divide-y">
            <Field label="Status">
              <span className="capitalize">{p.status}</span>
            </Field>
            <Field label="Visibility">
              <span className="capitalize">{p.visibility}</span>
            </Field>
            <Field label="Version">v{p.version}</Field>
            <Field label="Updated">
              {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—'}
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* ── recent versions (full-width band) ── */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">Recent versions</CardTitle>
          <Link href={href('versions')} className="flex items-center gap-1 text-xs text-primary hover:underline">
            All versions <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {p.recentVersions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {p.recentVersions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">v{v.version}</Badge>
                    <span className="capitalize text-muted-foreground">{v.note}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.createdAt ? new Date(v.createdAt).toLocaleString() : ''}
                    {v.createdBy ? ` · ${v.createdBy}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The URL-driven edit sheet (?panel=edit); the header Edit button opens it. */}
      <PipelineEditSheet
        data={{
          id: p.id,
          name: p.name,
          description: p.description,
          visibility: p.visibility,
          gatewayId: p.gateway?.id ?? null,
          defaultModel: p.defaultModel,
          egressAllowed: p.routing.egressAllowed,
          dataAllowlist: p.dataAllowlist,
        }}
      />
    </div>
  );
}
