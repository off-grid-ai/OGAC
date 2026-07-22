import { validateBrainDocument, type BrainDocument, type CreateBrainSourceInput } from './contracts';

export class BrainRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainRequestError';
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrainRequestError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new BrainRequestError(`${label} contains an unsupported field`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BrainRequestError(`${label} must be a string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) throw new BrainRequestError(`${label} must be an integer`);
  return Number(value);
}

function stringMap(value: unknown): Record<string, string | readonly string[]> | undefined {
  if (value === undefined) return undefined;
  const input = record(value, 'document metadata');
  return Object.fromEntries(
    Object.entries(input).map(([key, raw]) => {
      if (typeof raw === 'string') return [key, raw];
      if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) return [key, raw as string[]];
      throw new BrainRequestError('document metadata values must be strings or string arrays');
    }),
  );
}

export function parseBrainSearchRequest(value: unknown): { query: string; limit?: number } {
  const input = record(value, 'search request');
  exactKeys(input, ['query', 'limit'], 'search request');
  const query = string(input.query, 'query').trim();
  const limit = optionalInteger(input.limit, 'limit');
  if (!query || query.length > 2048) throw new BrainRequestError('query is missing or too long');
  if (limit !== undefined && (limit < 1 || limit > 100)) {
    throw new BrainRequestError('limit must be between 1 and 100');
  }
  return { query, limit };
}

export function parseBrainDocument(value: unknown): BrainDocument {
  const input = record(value, 'document');
  exactKeys(
    input,
    ['id', 'title', 'semanticIdentifier', 'sections', 'sourceType', 'sourceUri', 'version', 'checksum', 'updatedAt', 'metadata'],
    'document',
  );
  if (!Array.isArray(input.sections)) throw new BrainRequestError('document sections must be an array');
  const sections = input.sections.map((raw) => {
    const section = record(raw, 'document section');
    exactKeys(section, ['text', 'heading'], 'document section');
    return {
      text: string(section.text, 'document section text'),
      heading: optionalString(section.heading, 'document section heading'),
    };
  });
  const document: BrainDocument = {
    id: string(input.id, 'document id'),
    title: string(input.title, 'document title'),
    semanticIdentifier: string(input.semanticIdentifier, 'document semantic identifier'),
    sections,
    sourceType: string(input.sourceType, 'document source type'),
    sourceUri: optionalString(input.sourceUri, 'document source URI'),
    version: string(input.version, 'document version'),
    checksum: string(input.checksum, 'document checksum'),
    updatedAt: string(input.updatedAt, 'document updatedAt'),
    metadata: stringMap(input.metadata),
  };
  validateBrainDocument(document);
  return document;
}

export function parseCreateBrainSourceRequest(value: unknown): CreateBrainSourceInput {
  const input = record(value, 'source request');
  exactKeys(
    input,
    ['name', 'inputType', 'providerConfig', 'connectionBindingId', 'documentSetSlug', 'refreshSeconds', 'pruneSeconds'],
    'source request',
  );
  const inputType = string(input.inputType, 'inputType');
  if (!['load_state', 'poll', 'event'].includes(inputType)) {
    throw new BrainRequestError('inputType must be load_state, poll, or event');
  }
  const name = string(input.name, 'source name').trim();
  const refreshSeconds = optionalInteger(input.refreshSeconds, 'refreshSeconds');
  const pruneSeconds = optionalInteger(input.pruneSeconds, 'pruneSeconds');
  if (!name || name.length > 128 || /[\u0000-\u001f]/.test(name)) {
    throw new BrainRequestError('source name is missing, too long, or contains control characters');
  }
  if ([refreshSeconds, pruneSeconds].some((item) => item !== undefined && item <= 0)) {
    throw new BrainRequestError('source frequencies must be positive integers');
  }
  return {
    name,
    inputType: inputType as CreateBrainSourceInput['inputType'],
    providerConfig: record(input.providerConfig, 'providerConfig'),
    connectionBindingId: string(input.connectionBindingId, 'connectionBindingId'),
    documentSetSlug: string(input.documentSetSlug, 'documentSetSlug'),
    refreshSeconds,
    pruneSeconds,
  };
}

export function parseSourceStateRequest(value: unknown): { state: 'active' | 'paused' } {
  const input = record(value, 'source state request');
  exactKeys(input, ['state'], 'source state request');
  if (input.state !== 'active' && input.state !== 'paused') {
    throw new BrainRequestError('state must be active or paused');
  }
  return { state: input.state };
}

export function parseSourceSyncRequest(value: unknown): { fromBeginning?: boolean } {
  const input = record(value, 'source sync request');
  exactKeys(input, ['fromBeginning'], 'source sync request');
  if (input.fromBeginning !== undefined && typeof input.fromBeginning !== 'boolean') {
    throw new BrainRequestError('fromBeginning must be a boolean');
  }
  return { fromBeginning: input.fromBeginning as boolean | undefined };
}
