import type { SolutionTemplateDeploymentRequest } from '@/lib/solution-template-deployment';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  const row = object(value);
  if (!row) return null;
  const entries = Object.entries(row);
  if (entries.some(([, item]) => typeof item !== 'string')) return null;
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
}

export interface SolutionTemplateDeploymentRequestParseResult {
  value: SolutionTemplateDeploymentRequest | null;
  errors: string[];
}

/** Pure boundary parser. Invalid input is preserved as explicit guidance, never silently defaulted. */
export function parseSolutionTemplateDeploymentRequest(
  input: unknown,
): SolutionTemplateDeploymentRequestParseResult {
  const body = object(input);
  if (!body) return { value: null, errors: ['a JSON deployment request is required'] };

  const values = stringMap(body.values);
  const blueprintVersion =
    typeof body.blueprintVersion === 'number' ? body.blueprintVersion : Number.NaN;
  const templateId = text(body.templateId);
  const pipelineId = text(body.pipelineId);
  const title = body.title === undefined ? undefined : text(body.title);
  const actionConnectorId =
    body.actionConnectorId === undefined ? undefined : text(body.actionConnectorId);
  const errors: string[] = [];

  if (!Number.isInteger(blueprintVersion) || blueprintVersion < 1) {
    errors.push('blueprint version must be a positive integer');
  }
  if (!templateId) errors.push('template is required');
  if (!pipelineId) errors.push('governed pipeline is required');
  if (body.title !== undefined && !title) errors.push('App title cannot be blank');
  if (body.actionConnectorId !== undefined && !actionConnectorId) {
    errors.push('action connection cannot be blank');
  }
  if (!values) errors.push('template values must be a string map');

  if (errors.length || !values) return { value: null, errors };
  return {
    value: {
      blueprintVersion,
      templateId,
      pipelineId,
      values,
      ...(title === undefined ? {} : { title }),
      ...(actionConnectorId === undefined ? {} : { actionConnectorId }),
    },
    errors: [],
  };
}
