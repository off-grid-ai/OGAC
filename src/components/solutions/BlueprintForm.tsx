'use client';

import { FloppyDisk, Plus, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { SolutionBlueprint, SolutionBlueprintInput } from '@/lib/solution-blueprints';
import { splitList } from '@/lib/solution-blueprints';

type EditableBlueprint = SolutionBlueprintInput;

const EMPTY: EditableBlueprint = {
  title: '',
  summary: '',
  industry: '',
  process: '',
  businessOwner: '',
  requiredDataDomains: [],
  requiredCapabilities: ['grounded-inference'],
  requiredPipelineName: '',
  sourceTemplateKey: '',
  adoptable: false,
  outcome: {
    metricName: '',
    metricUnit: '',
    direction: 'increase',
    measurementWindow: '',
    baseline: { value: 0, label: '' },
    target: { value: 0, label: '' },
    measured: null,
    roi: {
      currency: 'USD',
      annualBenefit: 0,
      implementationCost: 0,
      annualOperatingCost: 0,
      rationale: '',
    },
  },
  proof: { status: 'unverified', summary: '', evidenceLinks: [] },
};

function editable(blueprint: SolutionBlueprint): EditableBlueprint {
  return {
    title: blueprint.title,
    summary: blueprint.summary,
    industry: blueprint.industry,
    process: blueprint.process,
    businessOwner: blueprint.businessOwner,
    requiredDataDomains: blueprint.requiredDataDomains,
    requiredCapabilities: blueprint.requiredCapabilities,
    requiredPipelineName: blueprint.requiredPipelineName,
    sourceTemplateKey: blueprint.sourceTemplateKey,
    adoptable: blueprint.adoptable,
    outcome: blueprint.outcome,
    proof: blueprint.proof,
  };
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function BlueprintForm({ blueprint }: Readonly<{ blueprint?: SolutionBlueprint }>) {
  const router = useRouter();
  const [model, setModel] = useState<EditableBlueprint>(blueprint ? editable(blueprint) : EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const endpoint = blueprint
    ? `/api/v1/admin/solution-blueprints/${blueprint.id}`
    : '/api/v1/admin/solution-blueprints';
  const set = <K extends keyof EditableBlueprint>(key: K, value: EditableBlueprint[K]) =>
    setModel((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const response = await fetch(endpoint, {
      method: blueprint ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(model),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError((result.errors ?? [result.error ?? 'Unable to save']).join(' · '));
      return;
    }
    if (blueprint) router.refresh();
    else router.push(`/solutions/library/${result.id}`);
  }

  async function remove() {
    if (
      !blueprint ||
      !window.confirm(
        `Retire ${blueprint.title}? Existing versions, deployments, and evidence remain.`,
      )
    )
      return;
    const response = await fetch(endpoint, { method: 'DELETE' });
    if (!response.ok) {
      setError('Unable to delete blueprint');
      return;
    }
    router.push('/solutions/library');
    router.refresh();
  }

  const updateOutcome = (patch: Partial<EditableBlueprint['outcome']>) =>
    set('outcome', { ...model.outcome, ...patch });
  const updateRoi = (patch: Partial<EditableBlueprint['outcome']['roi']>) =>
    updateOutcome({ roi: { ...model.outcome.roi, ...patch } });
  const updateProof = (patch: Partial<EditableBlueprint['proof']>) =>
    set('proof', { ...model.proof, ...patch });

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border bg-card p-5">
      <div className="grid gap-4 lg:grid-cols-4">
        <Field label="Blueprint name">
          <Input required value={model.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Industry">
          <Input
            required
            value={model.industry}
            onChange={(e) => set('industry', e.target.value)}
          />
        </Field>
        <Field label="Process">
          <Input required value={model.process} onChange={(e) => set('process', e.target.value)} />
        </Field>
        <Field label="Business owner">
          <Input
            required
            value={model.businessOwner}
            onChange={(e) => set('businessOwner', e.target.value)}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Adoptable runtime</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Turn this on only when a published App and governed pipeline implement this exact
            contract. Hypotheses stay visible but cannot be deployed.
          </p>
        </div>
        <Switch
          aria-label="Allow this Blueprint to be adopted"
          checked={model.adoptable}
          onCheckedChange={(checked) => set('adoptable', checked)}
        />
      </div>
      <Field label="What business outcome does this solve?">
        <Textarea required value={model.summary} onChange={(e) => set('summary', e.target.value)} />
      </Field>

      <div className="grid gap-4 lg:grid-cols-4">
        <Field label="Required data domains (comma-separated)">
          <Input
            required
            value={model.requiredDataDomains.join(', ')}
            onChange={(e) => set('requiredDataDomains', splitList(e.target.value))}
          />
        </Field>
        <Field label="Required capabilities">
          <Input
            required
            value={model.requiredCapabilities.join(', ')}
            onChange={(e) =>
              set(
                'requiredCapabilities',
                splitList(e.target.value) as EditableBlueprint['requiredCapabilities'],
              )
            }
          />
        </Field>
        <Field label="Required governed pipeline">
          <Input
            required
            value={model.requiredPipelineName}
            onChange={(e) => set('requiredPipelineName', e.target.value)}
          />
        </Field>
        <Field label="Source app template">
          <Input
            required
            value={model.sourceTemplateKey}
            onChange={(e) => set('sourceTemplateKey', e.target.value)}
          />
        </Field>
      </div>

      <section className="space-y-3 border-t pt-4">
        <div>
          <h3 className="text-sm font-medium">Outcome contract</h3>
          <p className="text-xs text-muted-foreground">
            Reusable baseline, target, and measurement protocol. Tenant results are recorded on the
            deployed solution.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="KPI">
            <Input
              required
              value={model.outcome.metricName}
              onChange={(e) => updateOutcome({ metricName: e.target.value })}
            />
          </Field>
          <Field label="Unit">
            <Input
              required
              value={model.outcome.metricUnit}
              onChange={(e) => updateOutcome({ metricUnit: e.target.value })}
            />
          </Field>
          <Field label="Direction">
            <select
              className="h-9 w-full rounded-md border bg-background px-3"
              value={model.outcome.direction}
              onChange={(e) =>
                updateOutcome({ direction: e.target.value as 'increase' | 'decrease' })
              }
            >
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
            </select>
          </Field>
          <Field label="Measurement window">
            <Input
              required
              value={model.outcome.measurementWindow}
              onChange={(e) => updateOutcome({ measurementWindow: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Baseline">
            <div className="flex gap-2">
              <Input
                required
                placeholder="Label"
                value={model.outcome.baseline.label}
                onChange={(e) =>
                  updateOutcome({ baseline: { ...model.outcome.baseline, label: e.target.value } })
                }
              />
              <Input
                required
                type="number"
                value={model.outcome.baseline.value}
                onChange={(e) =>
                  updateOutcome({
                    baseline: { ...model.outcome.baseline, value: Number(e.target.value) },
                  })
                }
              />
            </div>
          </Field>
          <Field label="Target">
            <div className="flex gap-2">
              <Input
                required
                placeholder="Label"
                value={model.outcome.target.label}
                onChange={(e) =>
                  updateOutcome({ target: { ...model.outcome.target, label: e.target.value } })
                }
              />
              <Input
                required
                type="number"
                value={model.outcome.target.value}
                onChange={(e) =>
                  updateOutcome({
                    target: { ...model.outcome.target, value: Number(e.target.value) },
                  })
                }
              />
            </div>
          </Field>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <div>
          <h3 className="text-sm font-medium">Justifiable ROI</h3>
          <p className="text-xs text-muted-foreground">
            State the economic hypothesis and its evidence—never just a vanity percentage.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="Currency">
            <Input
              required
              value={model.outcome.roi.currency}
              onChange={(e) => updateRoi({ currency: e.target.value })}
            />
          </Field>
          <Field label="Annual benefit">
            <Input
              required
              type="number"
              min="0"
              value={model.outcome.roi.annualBenefit}
              onChange={(e) => updateRoi({ annualBenefit: Number(e.target.value) })}
            />
          </Field>
          <Field label="Implementation cost">
            <Input
              required
              type="number"
              min="0"
              value={model.outcome.roi.implementationCost}
              onChange={(e) => updateRoi({ implementationCost: Number(e.target.value) })}
            />
          </Field>
          <Field label="Annual operating cost">
            <Input
              required
              type="number"
              min="0"
              value={model.outcome.roi.annualOperatingCost}
              onChange={(e) => updateRoi({ annualOperatingCost: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="ROI rationale">
          <Textarea
            required
            value={model.outcome.roi.rationale}
            onChange={(e) => updateRoi({ rationale: e.target.value })}
          />
        </Field>
      </section>

      <section className="grid gap-4 border-t pt-4 lg:grid-cols-3">
        <Field label="Evidence status">
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
            value={model.proof.status}
            onChange={(e) =>
              updateProof({ status: e.target.value as EditableBlueprint['proof']['status'] })
            }
          >
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
          </select>
        </Field>
        <Field label="Proof summary">
          <Input
            required
            value={model.proof.summary}
            onChange={(e) => updateProof({ summary: e.target.value })}
          />
        </Field>
        <Field label="Evidence links">
          <Input
            value={model.proof.evidenceLinks.join(', ')}
            onChange={(e) => updateProof({ evidenceLinks: splitList(e.target.value) })}
          />
        </Field>
      </section>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-3">
        {blueprint ? (
          <Button type="button" variant="destructive" onClick={remove}>
            <Trash /> Retire Blueprint
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={saving}>
          {blueprint ? <FloppyDisk /> : <Plus />}
          {saving ? 'Saving…' : blueprint ? 'Create new version' : 'Create blueprint'}
        </Button>
      </div>
    </form>
  );
}
