'use client';

import { LockSimple, Warning } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  type ControlValue,
  type EffectiveControlView,
  type EffectiveGovernanceView,
  clearOverlayControl,
  tightenOverlay,
} from '@/lib/pipeline-governance';
import type { GovernanceControls, PermissionLevel } from '@/lib/pipelines-policy';
import { PERMISSION_SCALE } from '@/lib/pipelines-policy';
import { cn } from '@/lib/utils';

// ─── GovernancePanel — the shared Policy / Guardrails tab surface ─────────────────────────────────
// Renders EFFECTIVE governance (org defaults + this pipeline's overlay, merged by the PURE
// effectiveGovernance / describeEffective). Each control shows its value + an honest SOURCE badge
// (org-locked / org-default / pipeline-override) and a locked control is tighten-only. Editing a
// control runs the PURE tightenOverlay client-side FIRST (a loosen attempt is refused before any
// network call) then PATCHes the pipeline's policyOverlay/guardrailOverlay via updatePipeline (which
// versions the pipeline). Everything here is scoped to THIS pipeline — never the org store.

const SOURCE_LABEL: Record<EffectiveControlView['source'], string> = {
  'org-locked': 'Org · locked',
  'org-default': 'Org default',
  'pipeline-override': 'This pipeline',
};

export interface GovernancePanelProps {
  pipelineId: string;
  pipelineName: string;
  /** 'policy' → policyOverlay column; 'guardrails' → guardrailOverlay column. */
  overlayField: 'policyOverlay' | 'guardrailOverlay';
  title: string;
  intro: string;
  /** The org baseline for THIS slice (ORG_POLICY_DEFAULTS or ORG_GUARDRAIL_DEFAULTS). */
  orgDefaults: GovernanceControls;
  /** The pipeline's current overlay for this slice (already normalized). */
  overlay: GovernanceControls;
  /** The merged, decorated display model (from describeEffective) — the initial render. */
  view: EffectiveGovernanceView;
  /** Optional attach-from-library section (guardrail catalog toggles). */
  library?: { id: string; name: string; description: string; control: ControlValue & { key: string } }[];
}

export function GovernancePanel({
  pipelineId,
  pipelineName,
  overlayField,
  title,
  intro,
  orgDefaults,
  overlay,
  view,
  library,
}: GovernancePanelProps) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  // Persist a full overlay object for this slice via the pipeline PATCH (versions the pipeline).
  async function persist(nextOverlay: GovernanceControls, controlKey: string): Promise<boolean> {
    setSaving(controlKey);
    try {
      const r = await fetch(`/api/v1/admin/pipelines/${pipelineId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [overlayField]: nextOverlay }),
      });
      if (r.ok) {
        router.refresh();
        return true;
      }
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error || 'Could not save — the change was not applied.');
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function applyEdit(key: string, value: ControlValue) {
    const result = tightenOverlay(orgDefaults, overlay, key, value);
    if (!result.ok) {
      // Refused up-front by the pure rule — a loosen attempt on a locked control.
      toast.error(result.reason);
      return;
    }
    if (await persist(result.overlay, key)) {
      toast.success(`Applied to ${pipelineName}`);
    }
  }

  async function revert(key: string) {
    const next = clearOverlayControl(overlay, key);
    if (await persist(next, key)) toast.success('Reverted to the org default');
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{intro}</p>
      </div>

      {view.rejected.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
          <span>
            The saved overlay tried to loosen a locked org control ({view.rejected.join(', ')}). The
            org value stands — a pipeline can only tighten a locked control.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {view.controls.map((c) => (
          <ControlRow
            key={c.key}
            control={c}
            saving={saving === c.key}
            onToggle={(bool) => applyEdit(c.key, { bool })}
            onLevel={(level) => applyEdit(c.key, { level })}
            onRevert={() => revert(c.key)}
          />
        ))}
      </div>

      {library && library.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Attach from the library</CardTitle>
            <p className="text-xs text-muted-foreground">
              Standard protections you can turn on for this pipeline. Attaching tightens the control —
              it never loosens the org baseline.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {library.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="outline"
                title={item.description}
                disabled={saving === item.control.key}
                onClick={() => applyEdit(item.control.key, { bool: item.control.bool, level: item.control.level })}
              >
                {saving === item.control.key ? <Spinner /> : null} {item.name}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ─── One control row — a bool toggle or a permission-level segmented control ──────────────────────
function ControlRow({
  control,
  saving,
  onToggle,
  onLevel,
  onRevert,
}: {
  control: EffectiveControlView;
  saving: boolean;
  onToggle: (bool: boolean) => void;
  onLevel: (level: PermissionLevel) => void;
  onRevert: () => void;
}) {
  const c = control;
  return (
    <div className="rounded-md border border-border bg-background p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{c.label}</span>
            {c.locked ? (
              <LockSimple className="size-3.5 text-muted-foreground" weight="fill" aria-label="Locked by org" />
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{c.description}</p>
        </div>
        <Badge
          variant={c.source === 'pipeline-override' ? 'default' : 'secondary'}
          className="shrink-0 text-[10px]"
        >
          {SOURCE_LABEL[c.source]}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {c.kind === 'bool' ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={c.bool === true}
              disabled={saving}
              onCheckedChange={(v) => onToggle(Boolean(v))}
            />
            <span className={cn(saving && 'opacity-60')}>{c.valueLabel}</span>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {PERMISSION_SCALE.map((lvl) => {
              const active = c.level === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  disabled={saving}
                  onClick={() => onLevel(lvl)}
                  className={cn(
                    'rounded px-2 py-1 text-xs transition-colors',
                    active
                      ? 'bg-primary/15 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    saving && 'opacity-60',
                  )}
                >
                  {lvl}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          {saving ? <Spinner /> : null}
          {c.overridden ? (
            <button
              type="button"
              disabled={saving}
              onClick={onRevert}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              revert to org ({c.orgValueLabel})
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
