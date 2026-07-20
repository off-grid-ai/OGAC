import assert from 'node:assert/strict';
import test from 'node:test';

import { lineageRunUuid } from '../src/lib/correlation.ts';
import { route } from '../src/lib/retrieval/router.ts';
import type { LineageEvent } from '../src/lib/adapters/types.ts';
import type { RetrievalSource } from '../src/lib/retrieval/types.ts';

test('route correlates the selected Qdrant provider, real filters, and lineage receipt', async () => {
  const source: RetrievalSource = {
    id: 'kb',
    kind: 'kb',
    label: 'Knowledge base (Brain)',
    describe: 'test boundary',
    async search() {
      return [
        {
          sourceId: 'kb',
          sourceKind: 'kb',
          title: 'Claims authority',
          snippet: 'Authority limits',
          ref: 'doc:claims-authority',
          score: 0.9,
        },
      ];
    },
  };
  let emitted: LineageEvent | null = null;
  const result = await route(
    'what is the claims authority policy?',
    8,
    {
      mode: 'hybrid',
      filter: { must: [{ field: 'product', match: 'motor' }] },
      asker: { subject: 'claims@example.test', roles: ['claims'] },
    },
    { orgId: 'org_insurance', correlationId: 'run_claim_42' },
    {
      sources: [source],
      selectedProvider: 'qdrant',
      qdrantCollection: 'claims-rules',
      emitLineage: async (event) => {
        emitted = event;
        return {
          adapterId: 'marquez',
          job: event.job,
          runId: event.run,
          status: 'accepted',
          httpStatus: 201,
          attemptedAt: '2026-07-20T00:00:00.000Z',
          detail: 'accepted',
        };
      },
    },
  );

  assert.deepEqual(emitted, {
    job: 'brain.retrieve.qdrant',
    run: lineageRunUuid('run_claim_42'),
    status: 'COMPLETE',
    inputs: ['Knowledge base (Brain)'],
    outputs: ['retrieval-result'],
  });
  assert.equal(result.evidence?.correlationId, 'run_claim_42');
  assert.equal(result.evidence?.providerId, 'qdrant');
  assert.equal(result.evidence?.collection, 'claims-rules');
  assert.equal(result.evidence?.lineage?.status, 'accepted');
  assert.deepEqual(
    result.evidence?.filters.map(({ kind, field }) => ({ kind, field })),
    [
      { kind: 'tenant', field: 'org_id' },
      { kind: 'metadata', field: 'product' },
      { kind: 'acl', field: 'document_acl' },
    ],
  );
});
