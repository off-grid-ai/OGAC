// Worker env bootstrap — MUST be the FIRST import in the worker entrypoint.
//
// WHY THIS IS A SEPARATE MODULE (and not inline in temporal-worker.mts):
// ES modules hoist and fully EVALUATE every static `import` before any top-level statement in the
// importing module runs. The worker imports `../src/worker/agent-run.activities`, which transitively
// imports `@/db`, whose module body runs `new Pool({ connectionString: process.env.DATABASE_URL })`
// at load time. So an inline `dotenv.config()` placed *after* the activities import (or even before
// it, as a statement) is TOO LATE — the Pool is already built against an unset DATABASE_URL, which
// falls back to the passwordless default and every Drizzle query dies with
// `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
//
// The only way to load env BEFORE the DB module evaluates is to do it as a SIDE EFFECT of a module
// that is itself imported before the activities import. Import order among a module's own imports is
// source order, so as long as this module is listed first, its top-level `loadEnvConfig(...)` runs
// before `@/db` is ever touched.
//
// We also resolve the console root ABSOLUTELY from import.meta.url rather than trusting CWD: under
// launchd the WorkingDirectory is not guaranteed to be the console dir, so a relative `.env.local`
// path would silently load nothing. Using `@next/env` gives us the exact same precedence Next uses
// for the app (.env.local > .env.$NODE_ENV > .env), so the worker and the console see identical env.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { workerIdentity } from '../src/lib/worker-artifact-identity.ts';

// `@next/env` is a CJS module whose ESM-interop shape differs between tsx (esbuild) and node's
// native strip-types resolver. `createRequire` loads it as plain CJS, which resolves identically
// under both runtimes and gives us the real `loadEnvConfig` function.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');

// scripts/ → console root is one level up. Absolute, CWD-independent.
const consoleRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// `dev = false` makes Next prefer .env.production (mirrors `next start`); .env.local always wins.
// Loading here, at module-eval time, guarantees process.env is populated before @/db is imported.
loadEnvConfig(consoleRoot, false);

/**
 * Env keys the worker MUST have before it can run the agent pipeline. Pure + side-effect-free so it
 * is unit-testable against an arbitrary env map. DATABASE_URL is the one that caused the live SASL
 * crash; the gateway creds are what the pipeline's LLM step needs.
 */
export const REQUIRED_WORKER_ENV = [
  'DATABASE_URL',
  'OFFGRID_GATEWAY_URL',
  'OFFGRID_GATEWAY_API_KEY',
] as const;

/**
 * Return the subset of REQUIRED_WORKER_ENV that is missing or blank in the given env map. Empty
 * array = all present. Kept pure (takes the env, returns a list) so the caller decides whether a
 * missing key is fatal vs a warning, and so it can be tested without touching process.env.
 */
export function missingRequiredEnv(
  env: Record<string, string | undefined>,
  required: readonly string[] = REQUIRED_WORKER_ENV,
): string[] {
  return required.filter((key) => {
    const v = env[key];
    return v === undefined || v.trim() === '';
  });
}

// The deployed release SHA (artifact-identity): prefer OFFGRID_RELEASE_SHA, else the immutable
// deploy stamp push.sh writes (deploy/.deployed-sha), else 'dev' for a local checkout. Absolute
// path from the console root so it resolves under launchd's arbitrary WorkingDirectory.
export function releaseSha(): string {
  const env = process.env.OFFGRID_RELEASE_SHA?.trim();
  if (env) return env;
  try {
    return readFileSync(join(consoleRoot, 'deploy', '.deployed-sha'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

// The Temporal worker identity that BINDS this poller to its deployed artifact: <pid>@<host>#<sha8>.
// Set as Worker.create({ identity }) so DescribeTaskQueue reports the artifact SHA on every poller.
export function workerIdentityString(): string {
  return workerIdentity(process.pid, hostname(), releaseSha());
}
