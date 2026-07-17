export const GUARDRAILS_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Detector reachability, fallback posture, and supported entity types.',
    route: '/governance/guardrails/overview',
  },
  {
    id: 'protections',
    label: 'Protections',
    description: 'Enable standard protections for the organization or selected pipelines.',
    route: '/governance/guardrails/protections',
  },
  {
    id: 'masking',
    label: 'Masking rules',
    description: 'Create and maintain entity or regex-based masking and enforcement rules.',
    route: '/governance/guardrails/masking',
  },
  {
    id: 'recognizers',
    label: 'Recognizers',
    description: 'Manage custom PII patterns, context terms, and deny lists.',
    route: '/governance/guardrails/recognizers',
  },
  {
    id: 'thresholds',
    label: 'Thresholds',
    description: 'Set global and per-entity confidence floors for detections.',
    route: '/governance/guardrails/thresholds',
  },
  {
    id: 'test',
    label: 'Test',
    description: 'Run a string through the live detector without storing it.',
    route: '/governance/guardrails/test',
  },
] as const;

export type GuardrailsDestination = (typeof GUARDRAILS_DESTINATIONS)[number];
export type GuardrailsDestinationId = GuardrailsDestination['id'];

export function guardrailsDestination(
  rawId: string | null | undefined,
): GuardrailsDestination | undefined {
  return GUARDRAILS_DESTINATIONS.find((candidate) => candidate.id === rawId);
}

/**
 * Preserve links to the old all-in-one surface by routing query-owned places to their new owner.
 */
export function legacyGuardrailsDestination(params: URLSearchParams): GuardrailsDestination {
  if (params.has('q')) return GUARDRAILS_DESTINATIONS[5];
  if (params.has('panel') || params.has('id')) return GUARDRAILS_DESTINATIONS[2];
  if (params.has('cat_q') || params.has('cat_kind') || params.has('cat_cat')) {
    return GUARDRAILS_DESTINATIONS[1];
  }
  return GUARDRAILS_DESTINATIONS[0];
}
