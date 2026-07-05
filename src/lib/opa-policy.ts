import {
  type RegoCompileError,
  type RegoModule,
  type RegoModuleInput,
  normalizeModule,
  normalizeModuleList,
  opaPolicyUrl,
  parseOpaCompileErrors,
} from '@/lib/opa-policy-policy';

// Thin I/O adapter for the OPA policy API — the "author / validate / deploy real Rego" seam. The
// pure logic (id validation, url building, compile-error parsing, response shaping) lives in
// opa-policy-policy.ts; this file is only the network. Endpoints used:
//   GET    /v1/policies         — list stored modules
//   GET    /v1/policies/{id}    — read one module's Rego source
//   PUT    /v1/policies/{id}    — upload a module; OPA COMPILES on upload → 400 + errors if invalid
//   DELETE /v1/policies/{id}    — remove a module
//
// This is the ADVANCED path. It never touches the first-party ABAC engine or the
// offgrid/authz decision call — those remain the default. When OFFGRID_OPA_URL is unset every
// method returns `{ ok: false, reachable: false }` so the UI degrades honestly.

const TIMEOUT_MS = 5000;

function baseUrl(): string | undefined {
  return process.env.OFFGRID_OPA_URL;
}

export interface OpaUnreachable {
  reachable: false;
  reason: string;
}

// Deploy outcome: a discriminated result so a route can 201 on success, 400 with compile
// diagnostics on invalid Rego, or 502 when OPA is unreachable — without any of that logic leaking
// into the route.
export type DeployResult =
  | { status: 'deployed'; module: RegoModule }
  | { status: 'invalid'; errors: RegoCompileError[] }
  | { status: 'unreachable'; reason: string };

function unreachable(reason: string): OpaUnreachable {
  return { reachable: false, reason };
}

// List stored Rego modules. Returns null-ish via the reachable flag rather than throwing.
export async function listModules(): Promise<
  { reachable: true; modules: RegoModule[] } | OpaUnreachable
> {
  const base = baseUrl();
  if (!base) return unreachable('OFFGRID_OPA_URL not set');
  try {
    const res = await fetch(opaPolicyUrl(base), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return unreachable(`OPA ${res.status}`);
    const body = await res.json();
    return { reachable: true, modules: normalizeModuleList(body) };
  } catch (e) {
    return unreachable((e as Error).message);
  }
}

// Read one module's source.
export async function getModule(
  id: string,
): Promise<{ reachable: true; module: RegoModule | null } | OpaUnreachable> {
  const base = baseUrl();
  if (!base) return unreachable('OFFGRID_OPA_URL not set');
  try {
    const res = await fetch(opaPolicyUrl(base, id), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return { reachable: true, module: null };
    if (!res.ok) return unreachable(`OPA ${res.status}`);
    const body = await res.json();
    // GET /v1/policies/{id} → { result: { id, raw, ast } }
    const result = (body as { result?: unknown })?.result ?? null;
    return { reachable: true, module: normalizeModule(result) };
  } catch (e) {
    return unreachable((e as Error).message);
  }
}

// Upload (create OR replace) a module. OPA compiles on upload: a 200 means the Rego is valid and
// now active; a 400 carries the compile errors, which we parse into diagnostics. This doubles as
// "validate" — the same PUT is how you check whether Rego compiles.
export async function deployModule(input: RegoModuleInput): Promise<DeployResult> {
  const base = baseUrl();
  if (!base) return { status: 'unreachable', reason: 'OFFGRID_OPA_URL not set' };
  try {
    const res = await fetch(opaPolicyUrl(base, input.id), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: input.rego,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      return {
        status: 'deployed',
        module: { id: input.id, rego: input.rego, package: '' },
      };
    }
    // Any non-2xx: try to read a compile-error body. If it parses to diagnostics, it's invalid Rego
    // (400); otherwise treat as a transport failure.
    const body = await res.json().catch(() => null);
    const errors = parseOpaCompileErrors(body);
    if (errors.length && res.status >= 400 && res.status < 500) {
      return { status: 'invalid', errors };
    }
    return { status: 'unreachable', reason: `OPA ${res.status}` };
  } catch (e) {
    return { status: 'unreachable', reason: (e as Error).message };
  }
}

// Validate WITHOUT persisting a fresh module: PUT to a scratch id, read the compile result, then
// clean the scratch module up. OPA has no dry-run compile endpoint, so this is the idiomatic way to
// get compile feedback for brand-new Rego without clobbering a real id. Editing an existing id can
// just call deployModule (a valid PUT is the deploy).
export async function validateModule(input: RegoModuleInput): Promise<DeployResult> {
  const base = baseUrl();
  if (!base) return { status: 'unreachable', reason: 'OFFGRID_OPA_URL not set' };
  const scratchId = `__offgrid_validate__/${input.id}`;
  const result = await deployModule({ id: scratchId, rego: input.rego });
  // Best-effort cleanup of the scratch module on success (invalid Rego never got stored).
  if (result.status === 'deployed') {
    await deleteModule(scratchId).catch(() => undefined);
    return { status: 'deployed', module: { id: input.id, rego: input.rego, package: '' } };
  }
  return result;
}

// Delete a module. Idempotent-ish: a 404 counts as "already gone" (deleted: true) so the UI is not
// tripped by a double-delete.
export async function deleteModule(
  id: string,
): Promise<{ reachable: true; deleted: boolean } | OpaUnreachable> {
  const base = baseUrl();
  if (!base) return unreachable('OFFGRID_OPA_URL not set');
  try {
    const res = await fetch(opaPolicyUrl(base, id), {
      method: 'DELETE',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok || res.status === 404) return { reachable: true, deleted: true };
    return unreachable(`OPA ${res.status}`);
  } catch (e) {
    return unreachable((e as Error).message);
  }
}
