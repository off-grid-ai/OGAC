'use client';

import { ArrowRight, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, NativeSelect } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TemplateVar } from '@/lib/app-template-vars';
import type {
  SolutionDeploymentReceipt,
  SolutionTemplateDeploymentRequest,
} from '@/lib/solution-template-deployment';

export interface SolutionRequirementView {
  id: string;
  label: string;
  detail: string;
  status: 'ready' | 'approval-required' | 'unavailable';
  remedyHref?: string;
}

export interface SolutionTemplateOption {
  id: string;
  title: string;
  vars: TemplateVar[];
}

export interface SolutionPipelineOption {
  id: string;
  label: string;
}

export interface SolutionConnectorOption {
  id: string;
  label: string;
}

interface ErrorEnvelope {
  error?: string;
  errors?: string[];
}

export class SolutionDeploymentRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SolutionDeploymentRequestError';
  }
}

type FetchBoundary = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function messageForFailure(status: number, body: ErrorEnvelope): string {
  const supplied = body.errors?.filter(Boolean).join('. ') || body.error?.trim();
  if (supplied) return supplied;
  if (status === 400)
    return 'The deployment details are incomplete. Check each field and try again.';
  if (status === 401) return 'Your session ended. Sign in again before deploying this solution.';
  if (status === 403)
    return 'Your role cannot deploy Apps. Ask an administrator for App builder access.';
  if (status === 404) return 'This solution or one of its required assets is no longer available.';
  if (status === 409)
    return 'The solution changed while this page was open. Reload it before deploying.';
  if (status === 422) return 'One or more governed requirements are not available yet.';
  return 'The solution could not be deployed. Try again.';
}

/** Browser boundary used by the real form and exercised against an HTTP server in integration tests. */
export async function submitSolutionDeployment(
  fetchBoundary: FetchBoundary,
  endpoint: string,
  request: SolutionTemplateDeploymentRequest,
  timeoutMs = 15_000,
): Promise<SolutionDeploymentReceipt> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchBoundary(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as
      { receipt?: SolutionDeploymentReceipt } | ErrorEnvelope;
    if (!response.ok || !('receipt' in body) || !body.receipt) {
      throw new SolutionDeploymentRequestError(
        response.status,
        messageForFailure(response.status, body as ErrorEnvelope),
      );
    }
    return body.receipt;
  } catch (error) {
    if (error instanceof SolutionDeploymentRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SolutionDeploymentRequestError(
        408,
        'Deployment did not respond within 15 seconds. No completion is being claimed.',
      );
    }
    throw new SolutionDeploymentRequestError(
      0,
      'The Console could not reach the deployment service. Try again.',
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function defaultValues(vars: readonly TemplateVar[]): Record<string, string> {
  return Object.fromEntries(vars.map((variable) => [variable.name, variable.default ?? '']));
}

function statusLabel(status: SolutionRequirementView['status']): string {
  if (status === 'ready') return 'Ready';
  if (status === 'approval-required') return 'Approval required';
  return 'Needs setup';
}

export function solutionDeploymentReceiptHref(
  receipt: Pick<SolutionDeploymentReceipt, 'deploymentId'>,
): string {
  return `/solutions/deployed/${encodeURIComponent(receipt.deploymentId)}`;
}

export function SolutionRequirementList({
  requirements,
}: Readonly<{ requirements: SolutionRequirementView[] }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {requirements.map((requirement) => (
        <Card key={requirement.id} className="min-w-0 shadow-none">
          <CardHeader className="space-y-2 pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-sm font-medium">{requirement.label}</CardTitle>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {statusLabel(requirement.status)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <p>{requirement.detail}</p>
            {requirement.remedyHref && requirement.status === 'unavailable' ? (
              <Link
                href={requirement.remedyHref}
                className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline"
              >
                Fix this requirement <ArrowRight aria-hidden />
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SolutionDeploymentPanel({
  blueprintId,
  blueprintVersion,
  solutionTitle,
  detailHref,
  deploying,
  requirements,
  templates,
  pipelines,
  connectors,
  hasActions,
}: Readonly<{
  blueprintId: string;
  blueprintVersion: number;
  solutionTitle: string;
  detailHref: string;
  deploying: boolean;
  requirements: SolutionRequirementView[];
  templates: SolutionTemplateOption[];
  pipelines: SolutionPipelineOption[];
  connectors: SolutionConnectorOption[];
  hasActions: boolean;
}>) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? '');
  const [appTitle, setAppTitle] = useState(solutionTitle);
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templateId, templates],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    defaultValues(activeTemplate?.vars ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(defaultValues(activeTemplate?.vars ?? []));
  }, [activeTemplate]);

  const missingVariables = (activeTemplate?.vars ?? []).filter(
    (variable) => variable.required && !(values[variable.name] ?? '').trim(),
  );
  const unavailable = requirements.filter((item) => item.status === 'unavailable');
  const canDeploy =
    unavailable.length === 0 &&
    Boolean(templateId && pipelineId) &&
    (!hasActions || Boolean(connectorId)) &&
    missingVariables.length === 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDeploy || saving) return;
    setSaving(true);
    setError('');
    try {
      const request: SolutionTemplateDeploymentRequest = {
        blueprintVersion,
        templateId,
        pipelineId,
        title: appTitle.trim() || undefined,
        values,
        ...(hasActions ? { actionConnectorId: connectorId } : {}),
      };
      const receipt = await submitSolutionDeployment(
        window.fetch.bind(window),
        `/api/v1/solution-blueprints/${encodeURIComponent(blueprintId)}/deploy`,
        request,
      );
      router.push(solutionDeploymentReceiptHref(receipt));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The solution could not be deployed. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!deploying) {
    return (
      <Card className="shadow-none">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium">Create your governed App</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Off Grid copies the registered workflow, binds only your approved data and actions,
              and keeps a deployment receipt.
            </p>
          </div>
          {unavailable.length ? (
            <Button disabled className="min-h-11 shrink-0">
              {unavailable.length} requirement{unavailable.length === 1 ? '' : 's'} need setup
            </Button>
          ) : (
            <Button asChild className="min-h-11 shrink-0">
              <Link href={`${detailHref}?deploy=1`}>Configure and deploy</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]"
    >
      <Card className="min-w-0 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Configure your App</CardTitle>
          <p className="text-xs text-muted-foreground">
            These are the only values this registered solution allows you to change.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field>
            <Label htmlFor="solution-app-title">App name</Label>
            <Input
              id="solution-app-title"
              value={appTitle}
              maxLength={120}
              onChange={(event) => setAppTitle(event.target.value)}
            />
            <FieldDescription>
              This is how people in your organization find the App.
            </FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="solution-template">Registered workflow</Label>
              <NativeSelect
                id="solution-template"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                disabled={templates.length <= 1}
                required
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                The governed workflow this solution is registered to use.
              </FieldDescription>
            </Field>
            <Field>
              <Label htmlFor="solution-pipeline">Governed AI pipeline</Label>
              <NativeSelect
                id="solution-pipeline"
                value={pipelineId}
                onChange={(event) => setPipelineId(event.target.value)}
                disabled={pipelines.length <= 1}
                required
              >
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.label}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>Only compatible, published pipelines appear here.</FieldDescription>
            </Field>
          </div>

          {(activeTemplate?.vars ?? []).length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {activeTemplate!.vars.map((variable) => (
                <Field key={variable.name}>
                  <Label htmlFor={`solution-var-${variable.name}`}>
                    {variable.description || variable.name}
                  </Label>
                  {variable.type === 'select' && variable.options?.length ? (
                    <NativeSelect
                      id={`solution-var-${variable.name}`}
                      value={values[variable.name] ?? ''}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [variable.name]: event.target.value,
                        }))
                      }
                      required={variable.required}
                    >
                      <option value="">Select an option</option>
                      {variable.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      id={`solution-var-${variable.name}`}
                      type={variable.type === 'number' ? 'number' : 'text'}
                      value={values[variable.name] ?? ''}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [variable.name]: event.target.value,
                        }))
                      }
                      required={variable.required}
                    />
                  )}
                  <FieldDescription>
                    {variable.required ? 'Required by this workflow.' : 'Optional.'}
                  </FieldDescription>
                </Field>
              ))}
            </div>
          ) : null}

          {hasActions ? (
            <Field>
              <Label htmlFor="solution-connector">Enterprise connection for actions</Label>
              <NativeSelect
                id="solution-connector"
                value={connectorId}
                onChange={(event) => setConnectorId(event.target.value)}
                disabled={connectors.length <= 1}
                required
              >
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.label}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                Source-organization credentials are never copied. This App uses your
                organization&apos;s verified connection.
              </FieldDescription>
            </Field>
          ) : null}

          {missingVariables.length ? (
            <FieldError role="alert">
              Fill in:{' '}
              {missingVariables.map((variable) => variable.description || variable.name).join(', ')}
              .
            </FieldError>
          ) : null}
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="outline" className="min-h-11">
              <Link href={detailHref}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={!canDeploy || saving} className="min-h-11">
              {saving ? 'Deploying...' : 'Deploy governed App'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <aside className="min-w-0 space-y-4">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">What happens next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <p>A private App is created from this registered workflow.</p>
            <p>Your data, pipeline, permissions, and action approvals remain enforced.</p>
            <p>You receive a receipt linking the exact Blueprint version to the deployed App.</p>
          </CardContent>
        </Card>
        {unavailable.length ? (
          <div role="alert" className="rounded-lg border border-destructive/40 p-4">
            <div className="flex items-start gap-2">
              <Warning className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <p className="text-xs">Resolve the unavailable requirements before deploying.</p>
            </div>
          </div>
        ) : null}
      </aside>
    </form>
  );
}
