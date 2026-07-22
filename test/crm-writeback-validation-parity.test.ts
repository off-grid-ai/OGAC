import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CRM_TASK_STATUSES as publicTaskStatuses,
  crmTaskCommandHash,
  validateCrmTaskCommand as publicTaskValidator,
} from '@/lib/crm-task-writeback';
import {
  CRM_WRITEBACK_USE_CASES as publicUseCases,
  crmCommandHash,
  validateCrmOpportunityWriteback as publicOpportunityValidator,
} from '@/lib/crm-writeback';
import {
  CRM_TASK_STATUSES,
  CRM_WRITEBACK_USE_CASES,
  validateCrmOpportunityWriteback,
  validateCrmTaskCommand,
} from '@/lib/crm-writeback-validation';

test('server write-back modules preserve the client-safe validation contract', () => {
  assert.equal(publicTaskValidator, validateCrmTaskCommand);
  assert.equal(publicOpportunityValidator, validateCrmOpportunityWriteback);
  assert.equal(publicTaskStatuses, CRM_TASK_STATUSES);
  assert.equal(publicUseCases, CRM_WRITEBACK_USE_CASES);

  const task = validateCrmTaskCommand({
    operation: 'create-task',
    idempotencyKey: 'delinquency:loan-001:v1',
    subject: 'Call borrower',
    useCase: 'lender-delinquency',
    kind: 'call',
    opportunityId: 'opp_loan_001',
  });
  assert.equal(task.ok, true);
  if (!task.ok) return;
  assert.equal(
    crmTaskCommandHash(task.value),
    '73a6f8bc55512dd6ac3b59c133036402da3a7a0cfbe40adaf6d16d17b728ca98',
  );

  const opportunity = validateCrmOpportunityWriteback({
    opportunityId: 'opp_001',
    idempotencyKey: 'cross-sell:account-1:v1',
    useCase: 'bank-cross-sell',
    followUp: { kind: 'call', summary: 'Discuss approved offer' },
    stage: 'proposal',
  });
  assert.equal(opportunity.ok, true);
  assert.equal(
    crmCommandHash(opportunity.value!),
    'b3e95c03301867be8c77b6141f02bb54dcef48cb8f62257e6c9906f3b695e0fb',
  );
});

test('client-safe validators retain the existing fail-closed error ordering', () => {
  assert.deepEqual(validateCrmTaskCommand({ operation: 'delete-task' }), {
    ok: false,
    errors: ['operation must be create-task or update-task'],
  });
  assert.deepEqual(validateCrmOpportunityWriteback(null), {
    ok: false,
    errors: ['body must be an object'],
  });
});
