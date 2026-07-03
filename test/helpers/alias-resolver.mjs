// ESM resolve hook so `node --test` can import the REAL lib modules.
// 1. Maps the `@/*` tsconfig alias to ./src/*.
// 2. Adds a `.ts` extension to extensionless relative imports (e.g. `./schema`), which
//    TypeScript source uses freely but Node's ESM resolver requires explicitly.
// Registered via test/helpers/register-alias.mjs (loaded with --import in the test script).
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const SRC_DIR = pathResolve(process.cwd(), 'src');
const SRC = pathToFileURL(SRC_DIR + '/').href;

async function tryExts(baseUrl, context, nextResolve) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '.js']) {
    try {
      return await nextResolve(baseUrl + ext, context);
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/*` alias -> src/*
  if (specifier === '@/db' || specifier.startsWith('@/')) {
    const url = new URL(specifier.slice(2), SRC).href;
    const r = await tryExts(url, context, nextResolve);
    if (r) return r;
  }

  // Extensionless relative import from a .ts source file -> add .ts (etc.)
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[cm]?[jt]sx?$/.test(specifier) &&
    context.parentURL
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    if (parentPath.startsWith(SRC_DIR)) {
      const targetBase = new URL(specifier, context.parentURL).href;
      for (const ext of ['.ts', '.tsx', '/index.ts', '.js']) {
        if (existsSync(fileURLToPath(targetBase + ext))) {
          return nextResolve(targetBase + ext, context);
        }
      }
    }
  }

  return nextResolve(specifier, context);
}
