import type { LineageDeliveryReceipt } from '../lineage-delivery';
import type { MetaCondition, RetrievalOptions, SearchMode } from './query';

export type RetrievalProviderId = 'lancedb' | 'pgvector' | 'qdrant';

export interface RetrievalFilterEvidence {
  kind: 'tenant' | 'metadata' | 'acl';
  field: string;
  operator: 'match' | 'any' | 'text' | 'grants';
  value: string | number | Array<string | number> | null;
}

export interface RetrievalExecutionEvidence {
  correlationId: string | null;
  providerId: RetrievalProviderId;
  collection: string | null;
  selectedSourceIds: string[];
  mode: SearchMode;
  filters: RetrievalFilterEvidence[];
  lineage: LineageDeliveryReceipt | null;
}

export function retrievalProviderId(selected: string | undefined): RetrievalProviderId {
  if (selected === 'qdrant' || selected === 'pgvector') return selected;
  return 'lancedb';
}

function metadataFilter(condition: MetaCondition): RetrievalFilterEvidence {
  if ('match' in condition) {
    return {
      kind: 'metadata',
      field: condition.field,
      operator: 'match',
      value: condition.match,
    };
  }
  if ('any' in condition) {
    return {
      kind: 'metadata',
      field: condition.field,
      operator: 'any',
      value: [...condition.any],
    };
  }
  return {
    kind: 'metadata',
    field: condition.field,
    operator: 'text',
    value: condition.text,
  };
}

/**
 * Describe the filters the retrieval adapters actually receive. Values stay in the structured
 * envelope for audit correlation; the human summary below lists only field/operator names.
 */
export function buildRetrievalExecutionEvidence(input: {
  correlationId?: string;
  selectedProvider?: string;
  qdrantCollection?: string;
  selectedSourceIds: readonly string[];
  orgId?: string;
  options?: RetrievalOptions;
}): RetrievalExecutionEvidence {
  const providerId = retrievalProviderId(input.selectedProvider);
  const filters: RetrievalFilterEvidence[] = [];
  if (input.orgId) {
    filters.push({
      kind: 'tenant',
      field: 'org_id',
      operator: 'match',
      value: input.orgId,
    });
  }
  for (const condition of input.options?.filter?.must ?? []) {
    filters.push(metadataFilter(condition));
  }
  if (input.options?.asker) {
    filters.push({
      kind: 'acl',
      field: 'document_acl',
      operator: 'grants',
      value: null,
    });
  }
  return {
    correlationId: input.correlationId?.trim() || null,
    providerId,
    collection:
      providerId === 'qdrant' ? input.qdrantCollection?.trim() || 'offgrid-brain' : null,
    selectedSourceIds: [...input.selectedSourceIds],
    mode: input.options?.mode === 'hybrid' ? 'hybrid' : 'vector',
    filters,
    lineage: null,
  };
}

export function withLineageDelivery(
  evidence: RetrievalExecutionEvidence,
  lineage: LineageDeliveryReceipt,
): RetrievalExecutionEvidence {
  return { ...evidence, lineage };
}

/** Safe concise string for the persisted run step; filter values are deliberately not rendered. */
export function retrievalExecutionSummary(evidence: RetrievalExecutionEvidence): string {
  const collection = evidence.collection ? ` collection=${evidence.collection}` : '';
  const filter =
    evidence.filters.length === 0
      ? 'none'
      : evidence.filters.map((item) => `${item.kind}:${item.field}/${item.operator}`).join(',');
  const lineage = evidence.lineage
    ? `${evidence.lineage.adapterId}:${evidence.lineage.status}${
        evidence.lineage.httpStatus === null ? '' : `/${evidence.lineage.httpStatus}`
      }`
    : 'pending';
  return `provider=${evidence.providerId}${collection} mode=${evidence.mode} filters=${filter} lineage=${lineage}`;
}
