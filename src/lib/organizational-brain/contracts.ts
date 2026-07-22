export type BrainActor = Readonly<{
  tenantId: string;
  subjectId: string;
  role?: string;
}>;

export type BrainAccessPolicyEntry = Readonly<{
  tenantId: string;
  subjectIds?: readonly string[];
  roles?: readonly string[];
  documentSetSlugs: readonly string[];
  ingestionConnectionId?: number;
}>;

const issuedAuthorizations = new WeakSet<object>();
declare const brainAuthorizationBrand: unique symbol;

export type BrainAuthorizationContext = Readonly<{
  tenantId: string;
  subjectId: string;
  role?: string;
  documentSetNames: readonly string[];
  ingestionConnectionId?: number;
  [brainAuthorizationBrand]: true;
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
  for (const slug of entry.documentSetSlugs) brainDocumentSetName(entry.tenantId, slug);
  if (
    entry.ingestionConnectionId !== undefined &&
    (!Number.isSafeInteger(entry.ingestionConnectionId) || entry.ingestionConnectionId <= 0)
  ) {
    throw new BrainPolicyError('ingestion connection id must be a positive integer');
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

  const grant = Object.freeze({
    tenantId,
    subjectId,
    role,
    documentSetNames: Object.freeze(documentSetNames),
    ingestionConnectionId: ingestionConnectionIds[0],
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
    context.documentSetNames.some((name) => !name.startsWith(prefix))
  ) {
    throw new BrainAuthorizationError('organizational-brain scope is empty or has escaped its tenant namespace');
  }
}

export function requireBrainIngestionConnection(context: BrainAuthorizationContext): number {
  assertBrainAuthorization(context);
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

export type BrainCitation = Readonly<{
  citationId?: number;
  documentId?: string;
  title: string;
  excerpt: string;
  sourceType: string;
  sourceUri?: string;
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
  credentialReference: string;
  name: string;
  sourceType: string;
  state: BrainSourceState;
  documentCount: number;
  syncInProgress: boolean;
  lastSyncStatus?: string;
  lastSuccessfulSyncAt?: string;
  lastPrunedAt?: string;
  repeatedError: boolean;
}>;

export type CreateBrainSourceInput = Readonly<{
  name: string;
  sourceType: string;
  inputType: 'load_state' | 'poll' | 'event';
  providerConfig: Readonly<Record<string, unknown>>;
  credentialReference: string;
  documentSetSlug: string;
  refreshSeconds?: number;
  pruneSeconds?: number;
}>;

export interface OrganizationalBrainPort {
  search(
    context: BrainAuthorizationContext,
    input: Readonly<{ query: string; limit?: number }>,
  ): Promise<BrainSearchResult>;
  upsertDocument(context: BrainAuthorizationContext, document: BrainDocument): Promise<Readonly<{ id: string; created: boolean }>>;
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
