// Product-owned ETL blueprints — PURE, zero I/O. These are reviewed business workflows exposed as
// ordinary ETL jobs, not a second hidden flow catalog owned by deployment scripts.

import type { EtlJobDraft, ManagedEtlBlueprint } from './etl-job';

export interface ManagedEtlBlueprintDefinition {
  key: ManagedEtlBlueprint;
  name: string;
  outcome: string;
  draft: EtlJobDraft;
}

const DELINQUENCY: ManagedEtlBlueprintDefinition = {
  key: 'bfsi-delinquency-snapshot',
  name: 'Delinquency exposure snapshot',
  outcome: 'Prioritize collections using current overdue-loan count and principal exposure.',
  draft: {
    name: 'Delinquency exposure snapshot',
    sourceConnectorId: 'warehouse-bfsi',
    sourceResource: 'bfsi.fact_loan',
    destDatabase: 'bfsi',
    destTable: 'delinquency_orchestration_audit',
    mappings: [],
    trigger: 'schedule',
    cron: '15 1 * * *',
  },
};

const DEFINITIONS: Record<ManagedEtlBlueprint, ManagedEtlBlueprintDefinition> = {
  'bfsi-delinquency-snapshot': DELINQUENCY,
};

export function managedEtlBlueprint(
  key: string,
): ManagedEtlBlueprintDefinition | undefined {
  return DEFINITIONS[key as ManagedEtlBlueprint];
}
