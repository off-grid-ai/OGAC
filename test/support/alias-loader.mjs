// ESM resolver hook mapping the tsconfig "@/*" -> "src/*" alias so integration tests can import the
// real @/db-backed libs under `node --test --experimental-strip-types`. TypeScript source uses
// extensionless imports (e.g. `@/db`, `@/lib/evals-golden`), so we probe for a matching `.ts` file
// or an `index.ts` under a directory. Registered via test/support/register-alias.mjs (--import).
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const SRC = pathToFileURL(pathResolve(process.cwd(), 'src') + '/').href;
// `next/navigation` has no ESM `exports` entry Node resolves under `node --test` (Next resolves it
// via its own bundler). DB-backed libs (e.g. module-access) import its server helpers only for
// navigation code paths the integration tests never take, so map it to a throwing stub so those
// libs stay importable. Purely additive — only intercepts a specifier that would otherwise throw.
const NEXT_NAV_STUB = pathToFileURL(
  pathResolve(process.cwd(), 'test/support/next-navigation-stub.mjs'),
).href;
// `next/server` is likewise resolvable only through Next's own tooling under `node --test`. next-auth
// imports it at load time, so any @/lib whose graph reaches next-auth (agentrun → chat-governance →
// module-access → @/auth) can't load without this. Same additive rationale as the navigation stub.
const NEXT_SERVER_STUB = pathToFileURL(
  pathResolve(process.cwd(), 'test/support/next-server-stub.mjs'),
).href;
// `next/headers` (cookies/headers) — same harness-resolution gap; imported at load time by next-auth
// + @/lib/tenancy. Async no-op accessors; never exercised by the DB-only integration tests.
const NEXT_HEADERS_STUB = pathToFileURL(
  pathResolve(process.cwd(), 'test/support/next-headers-stub.mjs'),
).href;

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function withExtension(url) {
  const p = fileURLToPath(url);
  if (isFile(p)) return url; // already a real file (has an extension)
  if (existsSync(p + '.ts')) return url + '.ts';
  if (existsSync(p + '.tsx')) return url + '.tsx';
  if (existsSync(pathResolve(p, 'index.ts'))) return new URL('index.ts', url + '/').href;
  return url;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/navigation') return nextResolve(NEXT_NAV_STUB, context);
  if (specifier === 'next/server') return nextResolve(NEXT_SERVER_STUB, context);
  if (specifier === 'next/headers') return nextResolve(NEXT_HEADERS_STUB, context);
  // "@/..." alias -> src/..., with .ts / index.ts probing.
  if (specifier === '@' || specifier.startsWith('@/')) {
    const rest = specifier === '@' ? '' : specifier.slice(2);
    const target = withExtension(new URL(rest, SRC).href);
    return nextResolve(target, context);
  }
  // Extensionless relative imports between TS source files (e.g. `./schema`) — the default
  // resolver won't append `.ts`, so probe for it before giving up.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (context.parentURL) {
        const target = withExtension(new URL(specifier, context.parentURL).href);
        if (target.endsWith('.ts') || target.endsWith('.tsx')) {
          return nextResolve(target, context);
        }
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
