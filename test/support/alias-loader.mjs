// ESM resolver hook mapping the tsconfig "@/*" -> "src/*" alias so integration tests can import the
// real @/db-backed libs under `node --test --experimental-strip-types`. TypeScript source uses
// extensionless imports (e.g. `@/db`, `@/lib/evals-golden`), so we probe for a matching `.ts` file
// or an `index.ts` under a directory. Registered via test/support/register-alias.mjs (--import).
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const SRC = pathToFileURL(pathResolve(process.cwd(), 'src') + '/').href;

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
