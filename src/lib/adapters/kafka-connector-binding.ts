import { getConnector } from '@/lib/connector-detail';
import {
  connectorSecretKey,
  getConnectorSecretRef,
  resolveConnectorSecret,
} from '@/lib/connector-secrets';
import { getDomain } from '@/lib/data-domains-store';
import {
  KafkaSourceContractError,
  validateResolvedKafkaSourceBinding,
  type ResolvedKafkaSourceBinding,
} from '@/lib/kafka-enterprise-source';

export type KafkaConnectorBindingFailure =
  | 'unknown-source'
  | 'not-kafka'
  | 'source-unavailable'
  | 'unknown-domain'
  | 'unapproved-scope'
  | 'invalid-endpoint'
  | 'invalid-scope'
  | 'missing-credential'
  | 'invalid-credential';

export class KafkaConnectorBindingError extends Error {
  readonly code: KafkaConnectorBindingFailure;

  constructor(code: KafkaConnectorBindingFailure, message: string) {
    super(message);
    this.name = 'KafkaConnectorBindingError';
    this.code = code;
  }
}

interface KafkaDomainBinding {
  schemaRegistryUrl: string;
  schemaSubject: string;
  schemaVersion: number;
  schemaId: number;
  schemaSha256: string;
  tenantField: string;
}

interface KafkaVaultBinding {
  version: 1;
  tls: boolean;
  sasl: ResolvedKafkaSourceBinding['security']['sasl'];
  username?: string;
  password?: string;
  schemaRegistryAuthorization?: string;
}

const DOMAIN_KEYS = [
  'schemaRegistryUrl',
  'schemaSubject',
  'schemaVersion',
  'schemaId',
  'schemaSha256',
  'tenantField',
] as const;
const VAULT_KEYS = [
  'version',
  'tls',
  'sasl',
  'username',
  'password',
  'schemaRegistryAuthorization',
] as const;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => key in value);
}

function parseDomainBinding(opHints: Record<string, unknown> | undefined): KafkaDomainBinding {
  const candidate = opHints?.kafka;
  if (
    !plainObject(candidate) ||
    !hasExactKeys(candidate, DOMAIN_KEYS, DOMAIN_KEYS) ||
    typeof candidate.schemaRegistryUrl !== 'string' ||
    typeof candidate.schemaSubject !== 'string' ||
    !Number.isInteger(candidate.schemaVersion) ||
    !Number.isInteger(candidate.schemaId) ||
    typeof candidate.schemaSha256 !== 'string' ||
    typeof candidate.tenantField !== 'string'
  ) {
    throw new KafkaConnectorBindingError(
      'invalid-scope',
      'The approved Kafka data domain does not have one complete, exact schema binding.',
    );
  }
  return {
    schemaRegistryUrl: candidate.schemaRegistryUrl,
    schemaSubject: candidate.schemaSubject,
    schemaVersion: Number(candidate.schemaVersion),
    schemaId: Number(candidate.schemaId),
    schemaSha256: candidate.schemaSha256,
    tenantField: candidate.tenantField,
  };
}

function parseVaultBinding(secret: string): KafkaVaultBinding {
  let candidate: unknown;
  try {
    candidate = JSON.parse(secret);
  } catch {
    throw new KafkaConnectorBindingError(
      'invalid-credential',
      'The Kafka source credential is not a valid vaulted binding.',
    );
  }
  const allowedSasl = ['none', 'plain', 'scram-sha-256', 'scram-sha-512'] as const;
  if (
    !plainObject(candidate) ||
    !hasExactKeys(candidate, VAULT_KEYS, ['version', 'tls', 'sasl']) ||
    candidate.version !== 1 ||
    typeof candidate.tls !== 'boolean' ||
    !allowedSasl.includes(candidate.sasl as (typeof allowedSasl)[number]) ||
    (candidate.username !== undefined && typeof candidate.username !== 'string') ||
    (candidate.password !== undefined && typeof candidate.password !== 'string') ||
    (candidate.schemaRegistryAuthorization !== undefined &&
      typeof candidate.schemaRegistryAuthorization !== 'string')
  ) {
    throw new KafkaConnectorBindingError(
      'invalid-credential',
      'The Kafka source credential has an unsupported vaulted binding shape.',
    );
  }
  const sasl = candidate.sasl as KafkaVaultBinding['sasl'];
  const username = typeof candidate.username === 'string' ? candidate.username.trim() : undefined;
  const password = typeof candidate.password === 'string' ? candidate.password : undefined;
  const registryAuthorization =
    typeof candidate.schemaRegistryAuthorization === 'string'
      ? candidate.schemaRegistryAuthorization
      : undefined;
  if (
    (sasl === 'none' && (username || password)) ||
    (sasl !== 'none' && (!username || !password)) ||
    (registryAuthorization !== undefined &&
      !/^(Basic|Bearer) [^\r\n]{1,2048}$/.test(registryAuthorization))
  ) {
    throw new KafkaConnectorBindingError(
      'invalid-credential',
      'The vaulted Kafka authentication material does not match its declared security policy.',
    );
  }
  return {
    version: 1,
    tls: candidate.tls,
    sasl,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password }),
    ...(registryAuthorization === undefined
      ? {}
      : { schemaRegistryAuthorization: registryAuthorization }),
  };
}

function parseBootstrapBroker(endpoint: string): { broker: string; tls: boolean } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new KafkaConnectorBindingError(
      'invalid-endpoint',
      'The Kafka source endpoint is invalid.',
    );
  }
  if (
    !['kafka:', 'kafkas:'].includes(url.protocol) ||
    !url.hostname ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new KafkaConnectorBindingError(
      'invalid-endpoint',
      'Kafka bootstrap endpoint must be one credential-free kafka://host:port address.',
    );
  }
  return { broker: `${url.hostname}:${url.port}`, tls: url.protocol === 'kafkas:' };
}

/**
 * Identify lifecycle-owned Kafka bindings without reading credential values or contacting OpenBao.
 * Ownership is the stable structure written by the governed lifecycle, not current runtime
 * validity: malformed endpoints/schema hints must remain owned so generic routes cannot become a
 * repair bypass. Generic Kafka metadata fixtures remain outside this owner because they lack the
 * exact canonical connector secret reference.
 */
export async function isGovernedKafkaBinding(input: {
  orgId: string;
  connectorId: string;
  domainId: string;
}): Promise<boolean> {
  const connector = await getConnector(input.connectorId, input.orgId);
  if (!connector || connector.type.toLowerCase() !== 'kafka') return false;
  const domain = await getDomain(input.domainId, input.orgId);
  if (!domain || domain.connectorId !== connector.id) return false;
  return (await getConnectorSecretRef(connector.id)) === connectorSecretKey(connector.id);
}

/**
 * Assemble the canonical org-scoped Connector, DataDomain and OpenBao owners into one trusted
 * Kafka binding. Callers can name only the three owned identities; brokers, topic, schema and all
 * authentication material are resolved here and cannot be overridden by a runtime request.
 */
export async function resolveKafkaConnectorBinding(input: {
  orgId: string;
  connectorId: string;
  domainId: string;
}): Promise<ResolvedKafkaSourceBinding> {
  const connector = await getConnector(input.connectorId, input.orgId);
  if (!connector) {
    throw new KafkaConnectorBindingError('unknown-source', 'Kafka source was not found.');
  }
  if (connector.type.toLowerCase() !== 'kafka') {
    throw new KafkaConnectorBindingError('not-kafka', 'This source is not a Kafka event source.');
  }
  if (connector.status.toLowerCase() !== 'connected') {
    throw new KafkaConnectorBindingError(
      'source-unavailable',
      'This Kafka source is not connected.',
    );
  }

  const domain = await getDomain(input.domainId, input.orgId);
  if (!domain) {
    throw new KafkaConnectorBindingError('unknown-domain', 'Kafka data domain was not found.');
  }
  if (
    domain.orgId !== input.orgId ||
    domain.id !== input.domainId ||
    domain.connectorId !== connector.id
  ) {
    throw new KafkaConnectorBindingError(
      'unapproved-scope',
      'This Kafka source is not approved for the requested data domain.',
    );
  }

  const endpoint = parseBootstrapBroker(connector.endpoint);
  const scope = parseDomainBinding(domain.opHints);
  const secret = await resolveConnectorSecret(connector.id);
  if (!secret) {
    throw new KafkaConnectorBindingError(
      'missing-credential',
      'This Kafka source does not have a usable vaulted security binding.',
    );
  }
  const security = parseVaultBinding(secret);
  if (security.tls !== endpoint.tls) {
    throw new KafkaConnectorBindingError(
      'invalid-credential',
      'The vaulted Kafka TLS policy does not match the approved endpoint.',
    );
  }

  const binding: ResolvedKafkaSourceBinding = {
    version: 1,
    orgId: input.orgId,
    connectorId: connector.id,
    domainId: domain.id,
    brokers: [endpoint.broker],
    topic: domain.resource,
    schemaRegistryUrl: scope.schemaRegistryUrl,
    schema: {
      subject: scope.schemaSubject,
      version: scope.schemaVersion,
      id: scope.schemaId,
      sha256: scope.schemaSha256,
    },
    tenantField: scope.tenantField,
    security: {
      tls: security.tls,
      sasl: security.sasl,
      ...(security.username === undefined ? {} : { username: security.username }),
      ...(security.password === undefined ? {} : { password: security.password }),
      ...(security.schemaRegistryAuthorization === undefined
        ? {}
        : { schemaRegistryAuthorization: security.schemaRegistryAuthorization }),
    },
  };
  try {
    return validateResolvedKafkaSourceBinding(binding);
  } catch (error) {
    if (error instanceof KafkaSourceContractError) {
      throw new KafkaConnectorBindingError(
        'invalid-scope',
        `The approved Kafka binding is invalid: ${error.message}`,
      );
    }
    throw error;
  }
}
