import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { connectors, dataDomains, ingestJobs } from '@/db/schema';
import {
  isGovernedKafkaBinding,
  isGovernedKafkaConnector as isGovernedKafkaConnectorOwner,
  resolveKafkaConnectorBinding,
} from '@/lib/adapters/kafka-connector-binding';
import {
  getConnectorSecretRef,
  persistConnectorSecret,
  resolveConnectorSecret,
} from '@/lib/connector-secrets';
import { getConnector } from '@/lib/connector-detail';
import {
  createDomain,
  deleteDomain,
  getDomain,
  listDomains,
  updateDomain,
} from '@/lib/data-domains-store';
import {
  redactedKafkaSecurity,
  validateKafkaSource,
  type KafkaSourceInput,
  type NormalizedKafkaSource,
} from '@/lib/kafka-source-onboarding';
import { createConnector, deleteConnector, updateConnector } from '@/lib/store';

export type KafkaSourceOnboardingFailure =
  'invalid-input' | 'unknown-source' | 'not-kafka' | 'ambiguous-binding' | 'source-unavailable';

export class KafkaSourceOnboardingError extends Error {
  readonly code: KafkaSourceOnboardingFailure;
  readonly fields: Record<string, string>;

  constructor(
    code: KafkaSourceOnboardingFailure,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'KafkaSourceOnboardingError';
    this.code = code;
    this.fields = fields;
  }
}

export interface KafkaSourceView {
  connectorId: string;
  domainId: string;
  name: string;
  description: string;
  status: string;
  bootstrapEndpoint: string;
  schemaRegistryEndpoint: string;
  topic: string;
  schemaSubject: string;
  schemaVersion: number;
  schemaId: number;
  schemaSha256: string;
  tenantField: string;
  security: ReturnType<typeof redactedKafkaSecurity>;
}

function validationOrThrow(
  input: KafkaSourceInput,
  current?: Parameters<typeof validateKafkaSource>[1],
): NormalizedKafkaSource {
  const result = validateKafkaSource(input, current);
  if (!result.ok || !result.value) {
    throw new KafkaSourceOnboardingError(
      'invalid-input',
      'Some source details need attention.',
      result.errors,
    );
  }
  return result.value;
}

async function ownedKafkaDomain(connectorId: string, orgId: string) {
  const domains = (await listDomains(orgId)).filter((domain) => domain.connectorId === connectorId);
  if (domains.length !== 1) {
    throw new KafkaSourceOnboardingError(
      'ambiguous-binding',
      domains.length === 0
        ? 'This Kafka source has no governed data binding.'
        : 'This Kafka source has more than one data binding. Resolve that conflict before editing it.',
    );
  }
  return domains[0];
}

async function loadKafkaSource(connectorId: string, orgId: string) {
  const connector = await getConnector(connectorId, orgId);
  if (!connector) {
    throw new KafkaSourceOnboardingError('unknown-source', 'Kafka source was not found.');
  }
  if (connector.type.toLowerCase() !== 'kafka') {
    throw new KafkaSourceOnboardingError('not-kafka', 'This connector is not a Kafka source.');
  }
  const domain = await ownedKafkaDomain(connectorId, orgId);
  return { connector, domain };
}

async function assembleView(connectorId: string, orgId: string): Promise<KafkaSourceView> {
  const { connector, domain } = await loadKafkaSource(connectorId, orgId);
  const binding = await resolveKafkaConnectorBinding({
    orgId,
    connectorId,
    domainId: domain.id,
  }).catch((error) => {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      error instanceof Error ? error.message : 'The Kafka source binding is unavailable.',
    );
  });
  return {
    connectorId,
    domainId: domain.id,
    name: connector.name,
    description: connector.description,
    status: connector.status,
    bootstrapEndpoint: connector.endpoint,
    schemaRegistryEndpoint: binding.schemaRegistryUrl,
    topic: binding.topic,
    schemaSubject: binding.schema.subject,
    schemaVersion: binding.schema.version,
    schemaId: binding.schema.id,
    schemaSha256: binding.schema.sha256,
    tenantField: binding.tenantField,
    security: redactedKafkaSecurity(binding.security),
  };
}

export async function getKafkaSource(connectorId: string, orgId: string): Promise<KafkaSourceView> {
  return assembleView(connectorId, orgId);
}

export async function isGovernedKafkaDomain(domainId: string, orgId: string): Promise<boolean> {
  const domain = await getDomain(domainId, orgId);
  if (!domain) return false;
  return isGovernedKafkaBinding({
    orgId,
    connectorId: domain.connectorId,
    domainId: domain.id,
  });
}

export async function isGovernedKafkaConnector(
  connectorId: string,
  orgId: string,
): Promise<boolean> {
  return isGovernedKafkaConnectorOwner({ orgId, connectorId });
}

/**
 * Create one Connector + one DataDomain + one opaque OpenBao binding. Every later-step failure
 * compensates all earlier writes so the directory never retains a half-configured source.
 */
export async function createKafkaSource(
  input: KafkaSourceInput,
  orgId: string,
): Promise<KafkaSourceView> {
  const normalized = validationOrThrow(input);
  let connectorId: string | null = null;
  let domainId: string | null = null;
  try {
    const connector = await createConnector({
      name: normalized.name,
      type: 'kafka',
      endpoint: normalized.connectorEndpoint,
      auth: normalized.connectorAuth,
      description: normalized.description,
      custom: true,
      orgId,
    });
    connectorId = connector.id;
    await persistConnectorSecret(connector.id, orgId, normalized.vaultValue);
    const domain = await createDomain(
      {
        label: normalized.domainLabel,
        connectorId: connector.id,
        resource: normalized.topic,
        aliases: [],
        opHints: normalized.domainHints,
      },
      orgId,
    );
    domainId = domain.id;
    return await assembleView(connector.id, orgId);
  } catch (error) {
    const cleanup = await Promise.allSettled([
      ...(domainId ? [deleteDomain(domainId, orgId)] : []),
      ...(connectorId ? [deleteConnector(connectorId, orgId)] : []),
    ]);
    if (
      cleanup.some(
        (result) =>
          result.status === 'rejected' || (result.status === 'fulfilled' && result.value === false),
      )
    ) {
      throw new KafkaSourceOnboardingError(
        'source-unavailable',
        'The source could not be saved and its partial binding could not be fully removed. Stop using it until an operator repairs it.',
      );
    }
    if (error instanceof KafkaSourceOnboardingError) throw error;
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The source could not be saved. No partial binding was retained.',
    );
  }
}

/** Validate the whole replacement first, then compensate DB and vault if any write fails. */
export async function updateKafkaSource(
  connectorId: string,
  input: KafkaSourceInput,
  orgId: string,
): Promise<KafkaSourceView> {
  const { connector, domain } = await loadKafkaSource(connectorId, orgId);
  const currentBinding = await resolveKafkaConnectorBinding({
    orgId,
    connectorId,
    domainId: domain.id,
  }).catch(() => {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The current binding cannot be read safely, so it was not changed.',
    );
  });
  const oldSecret = await resolveConnectorSecret(connectorId, orgId);
  if (!oldSecret) {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The current vaulted credential is missing, so it was not changed.',
    );
  }
  const normalized = validationOrThrow(input, currentBinding.security);

  try {
    const updatedConnector = await updateConnector(
      connectorId,
      {
        name: normalized.name,
        endpoint: normalized.connectorEndpoint,
        auth: normalized.connectorAuth,
        description: normalized.description,
      },
      orgId,
    );
    if (!updatedConnector) throw new Error('connector disappeared during update');
    const updatedDomain = await updateDomain(
      domain.id,
      {
        label: normalized.domainLabel,
        resource: normalized.topic,
        opHints: normalized.domainHints,
      },
      orgId,
    );
    if (!updatedDomain) throw new Error('domain disappeared during update');
    await persistConnectorSecret(connectorId, orgId, normalized.vaultValue);
    return await assembleView(connectorId, orgId);
  } catch {
    const rollback = await Promise.allSettled([
      updateConnector(
        connectorId,
        {
          name: connector.name,
          endpoint: connector.endpoint,
          auth: connector.auth,
          description: connector.description,
        },
        orgId,
      ),
      updateDomain(
        domain.id,
        {
          label: domain.label,
          connectorId: domain.connectorId,
          resource: domain.resource,
          aliases: domain.aliases,
          opHints: domain.opHints ?? null,
        },
        orgId,
      ),
      persistConnectorSecret(connectorId, orgId, oldSecret),
    ]);
    if (
      rollback.some(
        (result) =>
          result.status === 'rejected' || (result.status === 'fulfilled' && result.value === null),
      )
    ) {
      throw new KafkaSourceOnboardingError(
        'source-unavailable',
        'The update failed and the previous binding could not be fully restored. Stop using this source until an operator repairs it.',
      );
    }
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The update failed. The previous usable binding was restored.',
    );
  }
}

/** Delete the three owners as one lifecycle operation; restore the vault value on DB failure. */
export async function deleteKafkaSource(connectorId: string, orgId: string): Promise<void> {
  const { domain } = await loadKafkaSource(connectorId, orgId);
  const secretRef = await getConnectorSecretRef(connectorId, orgId);
  const oldSecret = await resolveConnectorSecret(connectorId, orgId);
  if (!secretRef || !oldSecret) {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The vaulted binding cannot be removed safely. Nothing was deleted.',
    );
  }
  const { openBaoSecrets } = await import('@/lib/adapters/secrets');
  if (!openBaoSecrets.remove || !openBaoSecrets.set) {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The secret store is not writable. Nothing was deleted.',
    );
  }
  try {
    await openBaoSecrets.remove(secretRef);
  } catch {
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The stored credential could not be removed. Nothing was deleted.',
    );
  }
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(ingestJobs)
        .where(and(eq(ingestJobs.connectorId, connectorId), eq(ingestJobs.orgId, orgId)));
      await tx
        .delete(dataDomains)
        .where(and(eq(dataDomains.id, domain.id), eq(dataDomains.orgId, orgId)));
      const deleted = await tx
        .delete(connectors)
        .where(and(eq(connectors.id, connectorId), eq(connectors.orgId, orgId)))
        .returning({ id: connectors.id });
      if (deleted.length !== 1) throw new Error('connector disappeared during delete');
    });
  } catch {
    try {
      await openBaoSecrets.set(secretRef, oldSecret);
    } catch {
      throw new KafkaSourceOnboardingError(
        'source-unavailable',
        'The delete failed and the previous credential could not be restored. Stop using this source until an operator repairs it.',
      );
    }
    throw new KafkaSourceOnboardingError(
      'source-unavailable',
      'The source could not be deleted. Its previous binding was retained.',
    );
  }
}
