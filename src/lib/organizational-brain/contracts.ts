export type BrainActor = Readonly<{
  tenantId: string;
  subjectId: string;
  role?: string;
}>;

export type BrainOperationCapability = 'retrieve' | 'ingest' | 'manageSources';

export type BrainSourceBindingPolicy = Readonly<{
  id: string;
  sourceType: string;
  providerCredentialId: number;
  allowedProviderConfigKeys: readonly string[];
}>;

export type BrainAccessPolicyEntry = Readonly<{
  tenantId: string;
  subjectIds?: readonly string[];
  roles?: readonly string[];
  documentSetSlugs: readonly string[];
  capabilities: readonly BrainOperationCapability[];
  ingestionConnectionId?: number;
  sourceBindings?: readonly BrainSourceBindingPolicy[];
}>;

const issuedAuthorizations = new WeakSet<object>();
declare const brainAuthorizationBrand: unique symbol;

export type BrainAuthorizationContext = Readonly<{
  tenantId: string;
  subjectId: string;
  role?: string;
  documentSetNames: readonly string[];
  capabilities: readonly BrainOperationCapability[];
  ingestionConnectionId?: number;
  sourceBindings: readonly BrainSourceBindingPolicy[];
  [brainAuthorizationBrand]: true;
}>;

declare const brainSourceBindingBrand: unique symbol;
export type ResolvedBrainSourceBinding = Readonly<{
  id: string;
  sourceType: string;
  providerCredentialId: number;
  providerConfig: Readonly<Record<string, unknown>>;
  [brainSourceBindingBrand]: true;
}>;

export class BrainAuthorizationError extends Error {
  readonly code = 'BRAIN_AUTHORIZATION_DENIED';

  constructor(message: string) {
    super(message);
    this.name = 'BrainAuthorizationError';
  }
}

export class BrainPolicyError extends Error {
  readonly code = 'BRAIN_POLICY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'BrainPolicyError';
  }
}

const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DOCUMENT_SET_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BINDING_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_KEY_PATTERN = /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|bearer)/i;
const VALID_CAPABILITIES = new Set<BrainOperationCapability>(['retrieve', 'ingest', 'manageSources']);

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

function tenantPrefix(tenantId: string): string {
  return `ogac:${tenantId}:`;
}

export function brainDocumentSetName(tenantId: string, slug: string): string {
  const tenant = normalized(tenantId);
  const normalizedSlug = normalized(slug).toLowerCase();
  if (!TENANT_PATTERN.test(tenant)) {
    throw new BrainPolicyError('tenant id is not safe for an Onyx document-set namespace');
  }
  if (!DOCUMENT_SET_SLUG_PATTERN.test(normalizedSlug)) {
    throw new BrainPolicyError('document-set slug must contain only lowercase letters, digits, and hyphens');
  }
  return `${tenantPrefix(tenant)}${normalizedSlug}`;
}

function matchesActor(entry: BrainAccessPolicyEntry, actor: BrainActor): boolean {
  if (entry.tenantId !== actor.tenantId) return false;
  const subjectMatch = entry.subjectIds?.includes(actor.subjectId) ?? false;
  const roleMatch = actor.role ? (entry.roles?.includes(actor.role) ?? false) : false;
  return subjectMatch || roleMatch;
}

function validatePolicyEntry(entry: BrainAccessPolicyEntry): void {
  if (!TENANT_PATTERN.test(normalized(entry.tenantId))) {
    throw new BrainPolicyError('policy contains an invalid tenant id');
  }
  if (!(entry.subjectIds?.length || entry.roles?.length)) {
    throw new BrainPolicyError('policy entry must target at least one subject or role');
  }
  if (!entry.documentSetSlugs.length) {
    throw new BrainPolicyError('policy entry must authorize at least one document set');
  }
  if (!entry.capabilities.length || entry.capabilities.some((capability) => !VALID_CAPABILITIES.has(capability))) {
    throw new BrainPolicyError('policy entry must contain recognized organizational-brain capabilities');
  }
  for (const slug of entry.documentSetSlugs) brainDocumentSetName(entry.tenantId, slug);
  if (
    entry.ingestionConnectionId !== undefined &&
    (!Number.isSafeInteger(entry.ingestionConnectionId) || entry.ingestionConnectionId <= 0)
  ) {
    throw new BrainPolicyError('ingestion connection id must be a positive integer');
  }
  for (const binding of entry.sourceBindings ?? []) {
    if (
      !BINDING_ID_PATTERN.test(binding.id) ||
      !binding.sourceType.trim() ||
      !Number.isSafeInteger(binding.providerCredentialId) ||
      binding.providerCredentialId <= 0 ||
      !binding.allowedProviderConfigKeys.length ||
      binding.allowedProviderConfigKeys.some((key) => !key.trim() || SECRET_KEY_PATTERN.test(key))
    ) {
      throw new BrainPolicyError('source binding is invalid or permits a secret-bearing configuration key');
    }
  }
}

/**
 * Resolve a server-owned policy into an opaque, immutable grant. The request body never participates
 * in this decision. A cloned or hand-built object is rejected by assertBrainAuthorization because it
 * was not issued by this module.
 */
export function resolveBrainAuthorization(
  actor: BrainActor,
  policy: readonly BrainAccessPolicyEntry[],
): BrainAuthorizationContext {
  const tenantId = normalized(actor.tenantId);
  const subjectId = normalized(actor.subjectId);
  const role = normalized(actor.role) || undefined;
  if (!TENANT_PATTERN.test(tenantId) || !subjectId) {
    throw new BrainAuthorizationError('trusted tenant and subject identity are required');
  }

  for (const entry of policy) validatePolicyEntry(entry);
  const matches = policy.filter((entry) => matchesActor(entry, { tenantId, subjectId, role }));
  const documentSetNames = [
    ...new Set(matches.flatMap((entry) => entry.documentSetSlugs.map((slug) => brainDocumentSetName(tenantId, slug)))),
  ].sort();
  if (!documentSetNames.length) {
    throw new BrainAuthorizationError('no organizational-brain document sets are authorized');
  }

  const ingestionConnectionIds = [
    ...new Set(
      matches
        .map((entry) => entry.ingestionConnectionId)
        .filter((value): value is number => value !== undefined),
    ),
  ];
  if (ingestionConnectionIds.length > 1) {
    throw new BrainPolicyError('matching policy entries disagree on the ingestion connection');
  }

  const capabilities = [...new Set(matches.flatMap((entry) => entry.capabilities))].sort() as BrainOperationCapability[];
  const sourceBindings = matches.flatMap((entry) => entry.sourceBindings ?? []);
  const bindingIds = new Set<string>();
  for (const binding of sourceBindings) {
    if (bindingIds.has(binding.id)) throw new BrainPolicyError('matching policy entries contain duplicate source binding ids');
    bindingIds.add(binding.id);
  }

  const grant = Object.freeze({
    tenantId,
    subjectId,
    role,
    documentSetNames: Object.freeze(documentSetNames),
    capabilities: Object.freeze(capabilities),
    ingestionConnectionId: ingestionConnectionIds[0],
    sourceBindings: Object.freeze(
      sourceBindings.map((binding) =>
        Object.freeze({
          ...binding,
          allowedProviderConfigKeys: Object.freeze([...binding.allowedProviderConfigKeys]),
        }),
      ),
    ),
  }) as BrainAuthorizationContext;
  issuedAuthorizations.add(grant);
  return grant;
}

export function assertBrainAuthorization(context: BrainAuthorizationContext): void {
  if (!issuedAuthorizations.has(context) || !Object.isFrozen(context)) {
    throw new BrainAuthorizationError('organizational-brain authorization context is not server-issued');
  }
  const prefix = tenantPrefix(context.tenantId);
  if (
    !context.documentSetNames.length ||
    new Set(context.documentSetNames).size !== context.documentSetNames.length ||
    context.documentSetNames.some((name) => !name.startsWith(prefix)) ||
    !context.capabilities.length ||
    context.capabilities.some((capability) => !VALID_CAPABILITIES.has(capability))
  ) {
    throw new BrainAuthorizationError('organizational-brain scope is empty or has escaped its tenant namespace');
  }
}

export function requireBrainCapability(
  context: BrainAuthorizationContext,
  capability: BrainOperationCapability,
): void {
  assertBrainAuthorization(context);
  if (!context.capabilities.includes(capability)) {
    throw new BrainAuthorizationError(`organizational-brain ${capability} operation is not authorized`);
  }
}

export function requireBrainIngestionConnection(context: BrainAuthorizationContext): number {
  requireBrainCapability(context, 'ingest');
  if (!context.ingestionConnectionId) {
    throw new BrainAuthorizationError('organizational-brain ingestion is not authorized for this principal');
  }
  return context.ingestionConnectionId;
}

export function selectAuthorizedBrainDocumentSet(
  context: BrainAuthorizationContext,
  slug: string,
): string {
  assertBrainAuthorization(context);
  const selected = brainDocumentSetName(context.tenantId, slug);
  if (!context.documentSetNames.includes(selected)) {
    throw new BrainAuthorizationError('selected document set is not authorized');
  }
  return selected;
}

function assertProviderConfigHasNoSecrets(value: unknown, path = 'providerConfig'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertProviderConfigHasNoSecrets(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new BrainAuthorizationError(`${path}.${key} is secret-bearing and cannot cross the source-management API`);
    }
    assertProviderConfigHasNoSecrets(nested, `${path}.${key}`);
  }
}

function cloneAndFreezeJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BrainAuthorizationError('source configuration numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') {
    throw new BrainAuthorizationError('source configuration must contain only JSON-safe values');
  }
  if (seen.has(value)) throw new BrainAuthorizationError('source configuration cannot contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    const cloned = value.map((item) => cloneAndFreezeJson(item, seen));
    seen.delete(value);
    return Object.freeze(cloned);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new BrainAuthorizationError('source configuration objects must be plain JSON objects');
  }
  const cloned = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneAndFreezeJson(nested, seen)]),
  );
  seen.delete(value);
  return Object.freeze(cloned);
}

export function resolveBrainSourceBinding(
  context: BrainAuthorizationContext,
  bindingId: string,
  providerConfig: Readonly<Record<string, unknown>>,
): ResolvedBrainSourceBinding {
  requireBrainCapability(context, 'manageSources');
  const binding = context.sourceBindings.find((candidate) => candidate.id === bindingId);
  if (!binding) throw new BrainAuthorizationError('source connection binding is not authorized');
  assertProviderConfigHasNoSecrets(providerConfig);
  const allowedKeys = new Set(binding.allowedProviderConfigKeys);
  if (Object.keys(providerConfig).some((key) => !allowedKeys.has(key))) {
    throw new BrainAuthorizationError('source configuration contains a field not approved for this source binding');
  }
  return Object.freeze({
    id: binding.id,
    sourceType: binding.sourceType,
    providerCredentialId: binding.providerCredentialId,
    providerConfig: cloneAndFreezeJson(providerConfig) as Readonly<Record<string, unknown>>,
  }) as ResolvedBrainSourceBinding;
}

export type BrainDocument = Readonly<{
  id: string;
  title: string;
  semanticIdentifier: string;
  sections: readonly Readonly<{ text: string; link?: string; heading?: string }>[];
  sourceType: string;
  sourceUri?: string;
  version: string;
  checksum: string;
  updatedAt: string;
  metadata?: Readonly<Record<string, string | readonly string[]>>;
}>;

const DOCUMENT_FIELD_LIMIT = 512;
const DOCUMENT_SOURCE_URI_LIMIT = 4096;
const DOCUMENT_SECTION_LIMIT = 64;
const DOCUMENT_SECTION_TEXT_LIMIT = 256 * 1024;
const DOCUMENT_TOTAL_TEXT_LIMIT = 1024 * 1024;
const DOCUMENT_METADATA_ENTRY_LIMIT = 64;
const DOCUMENT_METADATA_KEY_LIMIT = 128;
const DOCUMENT_METADATA_VALUE_LIMIT = 4096;
const DOCUMENT_METADATA_ARRAY_LIMIT = 64;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function boundedDocumentField(value: string, label: string, limit = DOCUMENT_FIELD_LIMIT): void {
  if (!value.trim() || value.length > limit || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new BrainPolicyError(`${label} is missing, too long, or contains control characters`);
  }
}

/** Pure request-boundary validation shared by every future organizational-brain provider. */
export function validateBrainDocument(document: BrainDocument): void {
  boundedDocumentField(document.id, 'document id');
  boundedDocumentField(document.title, 'document title');
  boundedDocumentField(document.semanticIdentifier, 'document semantic identifier');
  boundedDocumentField(document.sourceType, 'document source type', 128);
  boundedDocumentField(document.version, 'document version', 128);
  if (document.sourceUri !== undefined) {
    boundedDocumentField(document.sourceUri, 'document source URI', DOCUMENT_SOURCE_URI_LIMIT);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(document.sourceUri)) {
      throw new BrainPolicyError('document source URI must be absolute');
    }
  }
  if (!document.sections.length || document.sections.length > DOCUMENT_SECTION_LIMIT) {
    throw new BrainPolicyError(`document must contain between 1 and ${DOCUMENT_SECTION_LIMIT} sections`);
  }
  let totalText = 0;
  for (const section of document.sections) {
    if (!section.text.trim() || section.text.length > DOCUMENT_SECTION_TEXT_LIMIT) {
      throw new BrainPolicyError('document section text is missing or too long');
    }
    totalText += section.text.length;
    if (section.heading !== undefined) boundedDocumentField(section.heading, 'document section heading');
    if (totalText > DOCUMENT_TOTAL_TEXT_LIMIT) throw new BrainPolicyError('document text exceeds the total size limit');
  }
  const metadata = Object.entries(document.metadata ?? {});
  if (metadata.length > DOCUMENT_METADATA_ENTRY_LIMIT) throw new BrainPolicyError('document has too many metadata fields');
  for (const [key, raw] of metadata) {
    boundedDocumentField(key, 'document metadata key', DOCUMENT_METADATA_KEY_LIMIT);
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length > DOCUMENT_METADATA_ARRAY_LIMIT) {
      throw new BrainPolicyError('document metadata array has too many values');
    }
    for (const value of values) {
      if (value.length > DOCUMENT_METADATA_VALUE_LIMIT || CONTROL_CHARACTER_PATTERN.test(value)) {
        throw new BrainPolicyError('document metadata value is too long or contains control characters');
      }
    }
  }
  const updatedAt = new Date(document.updatedAt);
  if (Number.isNaN(updatedAt.valueOf())) throw new BrainPolicyError('document updatedAt is invalid');
}

export type BrainCitation = Readonly<{
  citationId?: number;
  documentId?: string;
  title: string;
  excerpt: string;
  sourceType: string;
  providerLink?: string;
  provenanceUri?: string;
  version?: string;
  checksum?: string;
  updatedAt?: string;
}>;

export type BrainSearchResult = Readonly<{
  query: string;
  citations: readonly BrainCitation[];
}>;

export type BrainSourceState = 'scheduled' | 'indexing' | 'active' | 'paused' | 'deleting' | 'invalid';

export type BrainSource = Readonly<{
  id: string;
  connectionId: string;
  name: string;
  sourceType: string;
  state: BrainSourceState;
  documentCount: number;
  syncInProgress: boolean;
  lastSyncStatus?: string;
  lastSuccessfulSyncAt?: string;
  lastPrunedAt?: string;
  repeatedError: boolean;
  connectionConfigured: boolean;
}>;

export type CreateBrainSourceInput = Readonly<{
  name: string;
  inputType: 'load_state' | 'poll' | 'event';
  providerConfig: Readonly<Record<string, unknown>>;
  connectionBindingId: string;
  documentSetSlug: string;
  refreshSeconds?: number;
  pruneSeconds?: number;
}>;

export interface OrganizationalBrainPort {
  search(
    context: BrainAuthorizationContext,
    input: Readonly<{ query: string; limit?: number }>,
  ): Promise<BrainSearchResult>;
  upsertDocument(
    context: BrainAuthorizationContext,
    document: BrainDocument,
  ): Promise<
    Readonly<{
      id: string;
      created: boolean;
      provenanceUri: string;
      originalSourceUri?: string;
    }>
  >;
  deleteDocument(context: BrainAuthorizationContext, documentId: string): Promise<void>;
  listSources(context: BrainAuthorizationContext): Promise<readonly BrainSource[]>;
  createSource(context: BrainAuthorizationContext, input: CreateBrainSourceInput): Promise<BrainSource>;
  setSourceState(
    context: BrainAuthorizationContext,
    connectionId: string,
    state: 'active' | 'paused',
  ): Promise<void>;
  triggerSourceSync(context: BrainAuthorizationContext, sourceId: string, fromBeginning?: boolean): Promise<void>;
  deleteSource(context: BrainAuthorizationContext, sourceId: string): Promise<void>;
}
