// Pure contract for creating and rotating one governed Kafka enterprise source.
//
// The UI and route may provide friendly fields, but only this module decides the credential-free
// Connector endpoint, exact DataDomain schema binding, and opaque OpenBao value. Runtime callers
// cannot supply brokers, topics, schemas, tenant fields, consumer groups, or credentials.

export type KafkaSaslMode = 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512';
export type KafkaRegistryAuthMode = 'none' | 'bearer' | 'basic';

export interface KafkaSourceInput {
  name?: unknown;
  description?: unknown;
  bootstrapEndpoint?: unknown;
  schemaRegistryEndpoint?: unknown;
  topic?: unknown;
  schemaSubject?: unknown;
  schemaVersion?: unknown;
  schemaId?: unknown;
  schemaSha256?: unknown;
  tenantField?: unknown;
  tls?: unknown;
  sasl?: unknown;
  username?: unknown;
  password?: unknown;
  registryAuth?: unknown;
  registryToken?: unknown;
  registryUsername?: unknown;
  registryPassword?: unknown;
}

export interface KafkaSourceSecrets {
  sasl: KafkaSaslMode;
  username?: string;
  password?: string;
  schemaRegistryAuthorization?: string;
}

export interface NormalizedKafkaSource {
  name: string;
  description: string;
  connectorEndpoint: string;
  connectorAuth: 'none' | 'api-key';
  domainLabel: string;
  topic: string;
  domainHints: {
    kafka: {
      schemaRegistryUrl: string;
      schemaSubject: string;
      schemaVersion: number;
      schemaId: number;
      schemaSha256: string;
      tenantField: string;
    };
  };
  vaultValue: string;
  security: {
    tls: boolean;
    sasl: KafkaSaslMode;
    registryAuth: KafkaRegistryAuthMode;
  };
}

export interface KafkaSourceValidation {
  ok: boolean;
  value: NormalizedKafkaSource | null;
  errors: Record<string, string>;
}

export interface KafkaSourceCurrentSecurity extends KafkaSourceSecrets {
  tls: boolean;
}

const SASL_MODES: readonly KafkaSaslMode[] = [
  'none',
  'plain',
  'scram-sha-256',
  'scram-sha-512',
];
const REGISTRY_AUTH_MODES: readonly KafkaRegistryAuthMode[] = ['none', 'bearer', 'basic'];
const TOPIC_RE = /^[A-Za-z0-9._-]{1,249}$/;
const SCHEMA_SUBJECT_RE = /^[A-Za-z0-9._-]{1,249}$/;
const TENANT_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const INPUT_KEYS = new Set<keyof KafkaSourceInput>([
  'name',
  'description',
  'bootstrapEndpoint',
  'schemaRegistryEndpoint',
  'topic',
  'schemaSubject',
  'schemaVersion',
  'schemaId',
  'schemaSha256',
  'tenantField',
  'tls',
  'sasl',
  'username',
  'password',
  'registryAuth',
  'registryToken',
  'registryUsername',
  'registryPassword',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const parsed = text(value) as T;
  return allowed.includes(parsed) ? parsed : null;
}

function normalizeBootstrapEndpoint(raw: string, tls: boolean): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `${tls ? 'kafkas' : 'kafka'}://${raw}`;
  try {
    const url = new URL(candidate);
    if (
      !['kafka:', 'kafkas:'].includes(url.protocol) ||
      !url.hostname ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/') ||
      (tls && url.protocol !== 'kafkas:') ||
      (!tls && url.protocol !== 'kafka:')
    ) {
      return null;
    }
    return `${url.protocol}//${url.hostname}:${url.port}`;
  } catch {
    return null;
  }
}

function normalizeRegistryEndpoint(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function credential(value: unknown, field: string, errors: Record<string, string>): string {
  const parsed = text(value);
  if (!parsed) errors[field] = 'Required for the selected security mode.';
  else if (parsed.length > 2048 || /[\r\n]/.test(parsed)) {
    errors[field] = 'Must be 2,048 characters or fewer and stay on one line.';
  }
  return parsed;
}

function encodeBasic(username: string, password: string): string {
  return btoa(unescape(encodeURIComponent(`${username}:${password}`)));
}

function registryModeFromCurrent(
  authorization: string | undefined,
): KafkaRegistryAuthMode {
  if (authorization?.startsWith('Bearer ')) return 'bearer';
  if (authorization?.startsWith('Basic ')) return 'basic';
  return 'none';
}

/** Validate a complete create or replacement binding before any I/O occurs. */
export function validateKafkaSource(
  input: KafkaSourceInput,
  current?: KafkaSourceCurrentSecurity,
): KafkaSourceValidation {
  const errors: Record<string, string> = {};
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key as keyof KafkaSourceInput))) {
    errors.request = 'Remove fields that are not part of governed source onboarding.';
  }
  const name = text(input.name);
  const description = text(input.description);
  const bootstrapRaw = text(input.bootstrapEndpoint);
  const registryRaw = text(input.schemaRegistryEndpoint);
  const topic = text(input.topic);
  const schemaSubject = text(input.schemaSubject);
  const schemaVersion = positiveInteger(input.schemaVersion);
  const schemaId = positiveInteger(input.schemaId);
  const schemaSha256 = text(input.schemaSha256).toLowerCase();
  const tenantField = text(input.tenantField);
  const tls = typeof input.tls === 'boolean' ? input.tls : null;
  const sasl = enumValue(input.sasl, SASL_MODES);
  const registryAuth = enumValue(input.registryAuth, REGISTRY_AUTH_MODES);

  if (!name) errors.name = 'Enter a name people will recognize.';
  else if (name.length > 120) errors.name = 'Use 120 characters or fewer.';
  if (description.length > 500) errors.description = 'Use 500 characters or fewer.';
  if (tls === null) errors.tls = 'Choose whether this source uses TLS.';
  const connectorEndpoint = tls === null ? null : normalizeBootstrapEndpoint(bootstrapRaw, tls);
  if (!connectorEndpoint) {
    errors.bootstrapEndpoint = 'Enter one host and port that matches the selected TLS mode.';
  }
  const schemaRegistryUrl = normalizeRegistryEndpoint(registryRaw);
  if (!schemaRegistryUrl) {
    errors.schemaRegistryEndpoint = 'Enter one http:// or https:// Schema Registry endpoint.';
  }
  if (!TOPIC_RE.test(topic) || topic === '.' || topic === '..') {
    errors.topic = 'Use a Kafka topic name with letters, numbers, dots, hyphens, or underscores.';
  }
  if (!SCHEMA_SUBJECT_RE.test(schemaSubject)) {
    errors.schemaSubject = 'Enter the exact registered schema subject.';
  }
  if (!schemaVersion) errors.schemaVersion = 'Enter a positive schema version.';
  if (!schemaId) errors.schemaId = 'Enter a positive schema ID.';
  if (!SHA256_RE.test(schemaSha256)) {
    errors.schemaSha256 = 'Enter the 64-character SHA-256 of the approved schema.';
  }
  if (!TENANT_FIELD_RE.test(tenantField)) {
    errors.tenantField = 'Enter the record field that contains the organization ID.';
  }
  if (!sasl) errors.sasl = 'Choose a login method.';
  if (!registryAuth) errors.registryAuth = 'Choose a Schema Registry login method.';

  let username: string | undefined;
  let password: string | undefined;
  if (sasl && sasl !== 'none') {
    username = text(input.username) || (current?.sasl === sasl ? current.username : undefined);
    password = text(input.password) || (current?.sasl === sasl ? current.password : undefined);
    username = credential(username, 'username', errors);
    password = credential(password, 'password', errors);
  }

  let schemaRegistryAuthorization: string | undefined;
  if (registryAuth === 'bearer') {
    const token = text(input.registryToken);
    if (token) schemaRegistryAuthorization = `Bearer ${credential(token, 'registryToken', errors)}`;
    else if (registryModeFromCurrent(current?.schemaRegistryAuthorization) === 'bearer') {
      schemaRegistryAuthorization = current?.schemaRegistryAuthorization;
    } else {
      errors.registryToken = 'Required for the selected Schema Registry login.';
    }
  } else if (registryAuth === 'basic') {
    const registryUsername = text(input.registryUsername);
    const registryPassword = text(input.registryPassword);
    if (registryUsername || registryPassword) {
      const user = credential(registryUsername, 'registryUsername', errors);
      const pass = credential(registryPassword, 'registryPassword', errors);
      if (user && pass) schemaRegistryAuthorization = `Basic ${encodeBasic(user, pass)}`;
    } else if (registryModeFromCurrent(current?.schemaRegistryAuthorization) === 'basic') {
      schemaRegistryAuthorization = current?.schemaRegistryAuthorization;
    } else {
      errors.registryUsername = 'Required for the selected Schema Registry login.';
      errors.registryPassword = 'Required for the selected Schema Registry login.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors };

  const security = {
    version: 1 as const,
    tls: tls as boolean,
    sasl: sasl as KafkaSaslMode,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(schemaRegistryAuthorization ? { schemaRegistryAuthorization } : {}),
  };
  return {
    ok: true,
    value: {
      name,
      description,
      connectorEndpoint: connectorEndpoint as string,
      connectorAuth: sasl === 'none' ? 'none' : 'api-key',
      domainLabel: name,
      topic,
      domainHints: {
        kafka: {
          schemaRegistryUrl: schemaRegistryUrl as string,
          schemaSubject,
          schemaVersion: schemaVersion as number,
          schemaId: schemaId as number,
          schemaSha256,
          tenantField,
        },
      },
      vaultValue: JSON.stringify(security),
      security: {
        tls: tls as boolean,
        sasl: sasl as KafkaSaslMode,
        registryAuth: registryAuth as KafkaRegistryAuthMode,
      },
    },
    errors: {},
  };
}

export function redactedKafkaSecurity(security: KafkaSourceCurrentSecurity): {
  tls: boolean;
  sasl: KafkaSaslMode;
  hasSaslCredentials: boolean;
  registryAuth: KafkaRegistryAuthMode;
  hasRegistryCredential: boolean;
} {
  const registryAuth = registryModeFromCurrent(security.schemaRegistryAuthorization);
  return {
    tls: security.tls,
    sasl: security.sasl,
    hasSaslCredentials: Boolean(security.username && security.password),
    registryAuth,
    hasRegistryCredential: registryAuth !== 'none',
  };
}
