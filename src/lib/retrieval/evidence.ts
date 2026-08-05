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
  /**
   * The STORE IDENTITY a retrieval actually read — a Qdrant collection, or the LanceDB table.
   *
   * This used to be Qdrant-only and hard-coded to null for every other provider, so a LanceDB
   * retrieval recorded which provider ran but not what it read. "The provider-neutral port selected
   * LanceDB" was therefore an unfalsifiable claim: nothing in the evidence distinguished it from a
   * retrieval that never touched a store at all.
   */
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

function storeIdentity(
  providerId: RetrievalProviderId,
  input: { qdrantCollection?: string; lanceTable?: string },
): string | null {
  if (providerId === 'qdrant') return input.qdrantCollection?.trim() || 'offgrid-brain';
  if (providerId === 'lancedb') return input.lanceTable?.trim() || null;
  // pgvector stores documents in a table too, but nothing threads its name yet — null here means
  // "not recorded", and the surface says so rather than inventing a name.
  return null;
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
  /** The LanceDB table name, threaded from the Brain so there is one source of truth. */
  lanceTable?: string;
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
    // Named per provider rather than defaulted to null: every provider HAS a store identity, and
    // recording it is what makes "this retrieval read LanceDB" checkable instead of asserted.
    collection: storeIdentity(providerId, input),
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
