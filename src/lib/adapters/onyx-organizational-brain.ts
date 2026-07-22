import {
  assertBrainAuthorization,
  requireBrainCapability,
  requireBrainIngestionConnection,
  resolveBrainSourceBinding,
  selectAuthorizedBrainDocumentSet,
  validateBrainDocument,
  validateBrainDocumentId,
  type BrainAuthorizationContext,
  type BrainCitation,
  type BrainDocument,
  type BrainSearchResult,
  type BrainSource,
  type BrainSourceState,
  type CreateBrainSourceInput,
  type OrganizationalBrainPort,
  OrganizationalBrainProviderError,
} from '@/lib/organizational-brain/contracts';
import {
  buildBrainProvenanceUri,
  parseTrustedBrainProvenanceUri,
} from '@/lib/organizational-brain/provenance';

export const ONYX_ADAPTER_VERSION = Object.freeze({
  tag: 'v4.4.1',
  commit: 'ff05648862d9c8dc2c834dc3d1a6bfcf495d5540',
});

type Fetch = typeof fetch;

export type OnyxOrganizationalBrainConfig = Readonly<{
  /** Full private API base. Include /api only when the Onyx deployment sets API_PREFIX=/api. */
  apiBaseUrl: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: Fetch;
}>;

export class OnyxOrganizationalBrainError extends OrganizationalBrainProviderError {
  readonly status?: number;
  readonly detail?: unknown;

  constructor(message: string, status?: number, detail?: unknown) {
    super(message, status === 404 ? 'notFound' : 'unavailable');
    this.name = 'OnyxOrganizationalBrainError';
    this.status = status;
    this.detail = detail;
  }
}

type JsonObject = Record<string, unknown>;

type OnyxConnectorDescriptor = Readonly<{
  connectionId: number;
  connectionName: string;
  connectorId: number;
  credentialId: number;
  connectorName: string;
  sourceType: string;
}>;

type OnyxConnectionSummary = Readonly<{
  connectionId: number;
  connectionName: string;
  sourceType: string;
}>;

type OnyxDocumentSet = Readonly<{
  id: number;
  name: string;
  description: string;
  connectionIds: readonly number[];
  connections: readonly OnyxConnectionSummary[];
  isPublic: boolean;
  users: readonly string[];
  groups: readonly number[];
  federatedConnectors: readonly JsonObject[];
}>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  }
  return Number(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function nullableString(value: unknown, label: string): string {
  if (value === null) return '';
  if (typeof value !== 'string') throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new OnyxOrganizationalBrainError(`Onyx returned an invalid ${label}`);
  return value;
}

export function mapOnyxSourceState(value: unknown): BrainSourceState {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === 'indexed' || normalized === 'active') return 'active';
  if (normalized === 'scheduled') return 'scheduled';
  if (normalized === 'indexing' || normalized === 'initial_indexing') return 'indexing';
  if (normalized === 'paused') return 'paused';
  if (normalized === 'deleting') return 'deleting';
  if (normalized === 'error' || normalized === 'invalid' || normalized === 'repeated_error') return 'invalid';
  return 'invalid';
}

function validateSourceInput(input: CreateBrainSourceInput): void {
  if (!input.name.trim() || input.name.length > 128 || /[\u0000-\u001f]/.test(input.name)) {
    throw new OnyxOrganizationalBrainError('source name is missing, too long, or contains control characters');
  }
  for (const [value, label] of [
    [input.refreshSeconds, 'refreshSeconds'],
    [input.pruneSeconds, 'pruneSeconds'],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new OnyxOrganizationalBrainError(`${label} must be a positive integer`);
    }
  }
}

export class OnyxOrganizationalBrain implements OrganizationalBrainPort {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: Fetch;
  private readonly timeoutMs: number;
  private readonly config: OnyxOrganizationalBrainConfig;

  constructor(config: OnyxOrganizationalBrainConfig) {
    const url = new URL(config.apiBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new OnyxOrganizationalBrainError('Onyx API base URL must use HTTP or HTTPS');
    }
    if (!config.apiToken.trim()) throw new OnyxOrganizationalBrainError('Onyx API token is required');
    this.apiBaseUrl = url.toString().replace(/\/$/, '');
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new OnyxOrganizationalBrainError('Onyx timeout must be an integer between 1 and 60000 milliseconds');
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.config.apiToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as unknown) : undefined;
      if (!response.ok) {
        throw new OnyxOrganizationalBrainError(`Onyx request failed with ${response.status}`, response.status, body);
      }
      return body;
    } catch (error) {
      if (error instanceof OnyxOrganizationalBrainError) throw error;
      if (error instanceof SyntaxError) throw new OnyxOrganizationalBrainError('Onyx returned malformed JSON');
      if (controller.signal.aborted) throw new OnyxOrganizationalBrainError('Onyx request timed out');
      throw new OnyxOrganizationalBrainError('Onyx request failed', undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(
    context: BrainAuthorizationContext,
    input: Readonly<{ query: string; limit?: number }>,
  ): Promise<BrainSearchResult> {
    requireBrainCapability(context, 'retrieve');
    const query = input.query.trim();
    if (!query || query.length > 2048) throw new OnyxOrganizationalBrainError('search query is missing or too long');
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new OnyxOrganizationalBrainError('search limit must be between 1 and 100');
    }

    const payload = object(
      await this.request('/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          document_sets: context.documentSetNames,
          skip_query_expansion: false,
        }),
      }),
      'search response',
    );
    const citations: BrainCitation[] = array(payload.results, 'search results')
      .slice(0, limit)
      .map((raw) => {
        const result = object(raw, 'search result');
        const link = optionalString(result.link);
        const provenance = parseTrustedBrainProvenanceUri(context, link);
        return {
          citationId: Number.isSafeInteger(result.citation_id) ? Number(result.citation_id) : undefined,
          documentId: provenance?.documentId,
          title: requiredString(result.title, 'search result title'),
          excerpt: requiredString(result.content, 'search result content'),
          sourceType: requiredString(result.source_type, 'search result source type'),
          providerLink: link,
          provenanceUri: provenance ? link : undefined,
          version: provenance?.version,
          checksum: provenance?.checksum,
          updatedAt: optionalString(result.updated_at),
        };
      });
    return { query, citations };
  }

  async upsertDocument(
    context: BrainAuthorizationContext,
    document: BrainDocument,
  ): Promise<{ id: string; created: boolean; provenanceUri: string; originalSourceUri?: string }> {
    const connectionId = requireBrainIngestionConnection(context);
    validateBrainDocument(document);
    const updatedAt = new Date(document.updatedAt);
    const provenanceUri = buildBrainProvenanceUri(context, document);
    const providerDocumentId = `ogac:${context.tenantId}:${document.id}`;
    const metadata: Record<string, string | readonly string[]> = {
      ...(document.metadata ?? {}),
      ogac_tenant_id: context.tenantId,
      ogac_source_type: document.sourceType,
      ogac_version: document.version,
      ogac_checksum: document.checksum,
      ...(document.sourceUri ? { ogac_original_source_uri: document.sourceUri } : {}),
    };
    const response = object(
      await this.request('/onyx-api/ingestion', {
        method: 'POST',
        body: JSON.stringify({
          document: {
            id: providerDocumentId,
            sections: document.sections.map((section) => ({
              type: 'text',
              text: section.text,
              link: provenanceUri,
              ...(section.heading ? { heading: section.heading } : {}),
            })),
            source: 'ingestion_api',
            semantic_identifier: document.semanticIdentifier,
            title: document.title,
            metadata,
            doc_updated_at: updatedAt.toISOString(),
          },
          cc_pair_id: connectionId,
        }),
      }),
      'ingestion response',
    );
    requiredString(response.document_id, 'ingested document id');
    if (typeof response.already_existed !== 'boolean') {
      throw new OnyxOrganizationalBrainError('Onyx returned an invalid ingestion existence flag');
    }
    return {
      id: document.id,
      created: !response.already_existed,
      provenanceUri,
      originalSourceUri: document.sourceUri,
    };
  }

  async deleteDocument(context: BrainAuthorizationContext, documentId: string): Promise<void> {
    requireBrainIngestionConnection(context);
    validateBrainDocumentId(documentId);
    await this.request(`/onyx-api/ingestion/${encodeURIComponent(`ogac:${context.tenantId}:${documentId}`)}`, {
      method: 'DELETE',
    });
  }

  private parseDocumentSets(payload: unknown): OnyxDocumentSet[] {
    return array(payload, 'document-set response').map((raw) => {
      const value = object(raw, 'document set');
      const connections = array(value.cc_pair_summaries, 'document-set connection summaries').map((summaryRaw) => {
        const summary = object(summaryRaw, 'document-set connection summary');
        requiredString(summary.access_type, 'connection access type');
        return {
          connectionId: requiredInteger(summary.id, 'connection id'),
          connectionName: requiredString(summary.name, 'connection name'),
          sourceType: requiredString(summary.source, 'connection source'),
        };
      });
      requiredBoolean(value.is_up_to_date, 'document-set freshness flag');
      return {
        id: requiredInteger(value.id, 'document-set id'),
        name: requiredString(value.name, 'document-set name'),
        description: nullableString(value.description, 'document-set description'),
        connectionIds: connections.map((connection) => connection.connectionId),
        connections,
        isPublic: requiredBoolean(value.is_public, 'document-set public flag'),
        users: array(value.users, 'document-set users').map((user) => requiredString(user, 'document-set user')),
        groups: array(value.groups, 'document-set groups').map((group) => requiredInteger(group, 'group id')),
        federatedConnectors: array(
          value.federated_connector_summaries,
          'federated connector summaries',
        ).map((item) => {
          const summary = object(item, 'federated connector summary');
          const id = requiredInteger(summary.id, 'federated connector id');
          requiredString(summary.name, 'federated connector name');
          requiredString(summary.source, 'federated connector source');
          return {
            federated_connector_id: id,
            entities: object(summary.entities, 'federated connector entities'),
          };
        }),
      };
    });
  }

  private async authorizedDocumentSets(context: BrainAuthorizationContext): Promise<OnyxDocumentSet[]> {
    assertBrainAuthorization(context);
    const all = this.parseDocumentSets(await this.request('/manage/document-set'));
    return all.filter((documentSet) => context.documentSetNames.includes(documentSet.name));
  }

  private async authorizedDescriptors(context: BrainAuthorizationContext): Promise<OnyxConnectorDescriptor[]> {
    const summaries = (await this.authorizedDocumentSets(context)).flatMap((documentSet) => documentSet.connections);
    const unique = [...new Map(summaries.map((summary) => [summary.connectionId, summary])).values()];
    return Promise.all(
      unique.map(async (summary) => {
        const value = object(
          await this.request(`/manage/admin/cc-pair/${summary.connectionId}`),
          'connection detail',
        );
        const connector = object(value.connector, 'connector');
        const credential = object(value.credential, 'credential');
        const descriptor = {
          connectionId: requiredInteger(value.id, 'connection id'),
          connectionName: requiredString(value.name, 'connection name'),
          connectorId: requiredInteger(connector.id, 'connector id'),
          credentialId: requiredInteger(credential.id, 'credential id'),
          connectorName: requiredString(connector.name, 'connector name'),
          sourceType: requiredString(connector.source, 'connector source'),
        };
        if (
          descriptor.connectionId !== summary.connectionId ||
          descriptor.connectionName !== summary.connectionName ||
          descriptor.sourceType !== summary.sourceType
        ) {
          throw new OnyxOrganizationalBrainError('Onyx connection detail does not match its document-set summary');
        }
        return descriptor;
      }),
    );
  }

  async listSources(context: BrainAuthorizationContext): Promise<readonly BrainSource[]> {
    requireBrainCapability(context, 'manageSources');
    const allowed = new Map(
      (await this.authorizedDescriptors(context)).map((descriptor) => [descriptor.connectionId, descriptor]),
    );
    if (!allowed.size) return [];
    const groups = array(
      await this.request('/manage/admin/connector/indexing-status', {
        method: 'POST',
        body: JSON.stringify({ get_all_connectors: true }),
      }),
      'connector indexing status',
    );
    const statuses = groups.flatMap((group) => array(object(group, 'connector status group').indexing_statuses, 'statuses'));
    return statuses.flatMap((statusRaw): BrainSource[] => {
      const status = object(statusRaw, 'connector status');
      const connectionId = requiredInteger(status.cc_pair_id, 'connection id');
      const descriptor = allowed.get(connectionId);
      if (!descriptor) return [];
      return [
        {
          id: String(descriptor.connectorId),
          connectionId: String(connectionId),
          name: descriptor.connectionName,
          sourceType: descriptor.sourceType,
          state: mapOnyxSourceState(status.cc_pair_status),
          documentCount: Number.isSafeInteger(status.docs_indexed) ? Number(status.docs_indexed) : 0,
          syncInProgress: status.in_progress === true,
          lastSyncStatus: optionalString(status.last_status),
          lastSuccessfulSyncAt: optionalString(status.last_success),
          repeatedError: status.in_repeated_error_state === true,
          connectionConfigured: true,
        },
      ];
    });
  }

  async createSource(context: BrainAuthorizationContext, input: CreateBrainSourceInput): Promise<BrainSource> {
    requireBrainCapability(context, 'manageSources');
    validateSourceInput(input);
    const documentSetName = selectAuthorizedBrainDocumentSet(context, input.documentSetSlug);
    const binding = resolveBrainSourceBinding(context, input.connectionBindingId, input.providerConfig);
    const sourceName = `ogac:${context.tenantId}:${input.name.trim()}`;
    let connectorId: number | undefined;
    let connectionId: number | undefined;
    try {
      const created = object(
        await this.request('/manage/admin/connector', {
          method: 'POST',
          body: JSON.stringify({
            name: sourceName,
            source: binding.sourceType,
            input_type: input.inputType,
            connector_specific_config: binding.providerConfig,
            refresh_freq: input.refreshSeconds,
            prune_freq: input.pruneSeconds,
            access_type: 'public',
            groups: [],
          }),
        }),
        'connector creation response',
      );
      connectorId = requiredInteger(created.id, 'connector id');
      const associated = object(
        await this.request(`/manage/connector/${connectorId}/credential/${binding.providerCredentialId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: sourceName,
            access_type: 'public',
            groups: [],
            processing_mode: 'REGULAR',
          }),
        }),
        'connector association response',
      );
      if (associated.success !== true) {
        throw new OnyxOrganizationalBrainError('Onyx did not create the connector-credential association');
      }
      connectionId = requiredInteger(associated.data, 'connection id');

      const allSets = this.parseDocumentSets(await this.request('/manage/document-set'));
      const existing = allSets.find((documentSet) => documentSet.name === documentSetName);
      if (existing) {
        await this.request('/manage/admin/document-set', {
          method: 'PATCH',
          body: JSON.stringify({
            id: existing.id,
            name: existing.name,
            description: existing.description,
            cc_pair_ids: [...new Set([...existing.connectionIds, connectionId])],
            is_public: true,
            users: existing.users,
            groups: existing.groups,
            federated_connectors: existing.federatedConnectors,
          }),
        });
      } else {
        await this.request('/manage/admin/document-set', {
          method: 'POST',
          body: JSON.stringify({
            name: documentSetName,
            description: `OGAC governed source set for ${context.tenantId}`,
            cc_pair_ids: [connectionId],
            is_public: true,
            users: [],
            groups: [],
            federated_connectors: [],
          }),
        });
      }
      return {
        id: String(connectorId),
        connectionId: String(connectionId),
        name: input.name.trim(),
        sourceType: binding.sourceType,
        state: 'scheduled',
        documentCount: 0,
        syncInProgress: false,
        repeatedError: false,
        connectionConfigured: true,
      };
    } catch (error) {
      try {
        await this.rollbackSourceCreation(connectorId, binding.providerCredentialId, connectionId);
      } catch (cleanupError) {
        throw new OnyxOrganizationalBrainError(
          `Onyx source creation failed and connector ${connectorId ?? 'unknown'} cleanup also failed`,
          undefined,
          {
            creation: error instanceof Error ? error.message : 'unknown creation failure',
            cleanup: cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup failure',
            orphanConnectorId: connectorId,
            orphanConnectionId: connectionId,
          },
        );
      }
      throw error;
    }
  }

  private async rollbackSourceCreation(
    connectorId: number | undefined,
    credentialId: number,
    connectionId: number | undefined,
  ): Promise<void> {
    if (!connectorId) return;
    const failures: string[] = [];
    if (connectionId) {
      try {
        await this.request(`/manage/connector/${connectorId}/credential/${credentialId}`, { method: 'DELETE' });
      } catch (error) {
        failures.push(`association cleanup: ${error instanceof Error ? error.message : 'unknown failure'}`);
      }
    }
    try {
      await this.request(`/manage/admin/connector/${connectorId}`, { method: 'DELETE' });
    } catch (error) {
      failures.push(`connector cleanup: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
    if (failures.length) throw new OnyxOrganizationalBrainError(failures.join('; '));
  }

  private async authorizedDescriptor(
    context: BrainAuthorizationContext,
    value: string,
    key: 'connectionId' | 'connectorId',
  ): Promise<OnyxConnectorDescriptor> {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new OnyxOrganizationalBrainError('source id is invalid');
    const descriptors = await this.authorizedDescriptors(context);
    const descriptor = descriptors.find((candidate) => candidate[key] === id);
    if (!descriptor) throw new OnyxOrganizationalBrainError('source is outside the authorized tenant scope', 404);
    return descriptor;
  }

  async setSourceState(
    context: BrainAuthorizationContext,
    connectionId: string,
    state: 'active' | 'paused',
  ): Promise<void> {
    requireBrainCapability(context, 'manageSources');
    const source = await this.authorizedDescriptor(context, connectionId, 'connectionId');
    await this.request(`/manage/admin/cc-pair/${source.connectionId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: state.toUpperCase() }),
    });
  }

  async triggerSourceSync(
    context: BrainAuthorizationContext,
    sourceId: string,
    fromBeginning = false,
  ): Promise<void> {
    requireBrainCapability(context, 'manageSources');
    const source = await this.authorizedDescriptor(context, sourceId, 'connectorId');
    await this.request('/manage/admin/connector/run-once', {
      method: 'POST',
      body: JSON.stringify({
        connector_id: source.connectorId,
        credential_ids: [source.credentialId],
        from_beginning: fromBeginning,
      }),
    });
  }

  async deleteSource(context: BrainAuthorizationContext, sourceId: string): Promise<void> {
    requireBrainCapability(context, 'manageSources');
    const source = await this.authorizedDescriptor(context, sourceId, 'connectorId');
    await this.request('/manage/admin/deletion-attempt', {
      method: 'POST',
      body: JSON.stringify({ connector_id: source.connectorId, credential_id: source.credentialId }),
    });
  }
}
