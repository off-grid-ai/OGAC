// Test-only stub for `next/server`. next-auth's env module imports `next/server` at load time, and
// that specifier is resolvable only through Next's own bundler/exports map — node --test's ESM
// resolver throws ERR_MODULE_NOT_FOUND on it. Any @/lib module whose import graph transitively
// reaches next-auth (e.g. agentrun → chat-governance → module-access → @/auth → next-auth) therefore
// can't load in the harness. The integration tests only exercise the DB-backed store functions, never
// a request/response code path, so inert placeholders are sufficient — purely additive, only
// intercepts a specifier that would otherwise throw.
export class NextResponse extends Response {
  static json(body, init) {
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  }
  static redirect(url, init) {
    return new NextResponse(null, { status: 307, ...init, headers: { location: String(url) } });
  }
  static next(init) {
    return new NextResponse(null, init);
  }
}
export class NextRequest extends Request {}
export const userAgent = () => ({});
export const userAgentFromString = () => ({});
export const NextFetchEvent = class {};
export const ImageResponse = class {};
