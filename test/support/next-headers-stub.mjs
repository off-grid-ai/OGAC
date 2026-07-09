// Test-only stub for `next/headers` (cookies()/headers()/draftMode()). Resolvable only through
// Next's own tooling under `node --test`; next-auth + @/lib/tenancy import it at load time. The
// integration tests never take a request-scoped code path, so async no-op accessors suffice. Purely
// additive — only intercepts a specifier that would otherwise throw ERR_MODULE_NOT_FOUND.
const empty = {
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  set: () => {},
  delete: () => {},
  entries: () => [][Symbol.iterator](),
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  forEach: () => {},
  [Symbol.iterator]: () => [][Symbol.iterator](),
};
export async function cookies() {
  return empty;
}
export async function headers() {
  return empty;
}
export async function draftMode() {
  return { isEnabled: false, enable: () => {}, disable: () => {} };
}
