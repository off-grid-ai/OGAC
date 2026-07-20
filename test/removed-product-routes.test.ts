import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

const REMOVED_ACTIVE_PATHS = [
  'src/app/(console)/provit/page.tsx',
  'src/app/(console)/operations/visual-qa/page.tsx',
  'src/app/api/v1/provit/intelligence/chat/route.ts',
  'src/app/api/v1/provit/intelligence/route.ts',
  'src/app/api/v1/provit/repos/route.ts',
  'src/app/api/v1/provit/runs/route.ts',
  'src/app/api/v1/provit/showcase/route.ts',
  'src/app/api/v1/provit/tokens/route.ts',
  'src/app/api/v1/provit/upload/route.ts',
] as const;

const REMOVED_IMPLEMENTATION_PATHS = [
  'src/lib/provit-access.ts',
  'src/lib/provit-intelligence.ts',
  'src/lib/provit-policy.ts',
  'src/lib/provit-token.ts',
  'src/lib/provit-upload.ts',
  'src/lib/provit.ts',
  'src/app/(console)/provit/IntelligencePanel.tsx',
  'src/app/(console)/provit/TokenPanel.tsx',
  'src/app/(console)/provit/UploadPanel.tsx',
  'scripts/seed-hitl-provit.mts',
] as const;

test('removed ProVit product and API routes cannot be built into the active Next.js route tree', () => {
  for (const path of REMOVED_ACTIVE_PATHS) {
    assert.equal(existsSync(new URL(path, ROOT)), false, `${path} must remain absent`);
  }
});

test('removed ProVit implementation libraries and seed entrypoint remain absent', () => {
  for (const path of REMOVED_IMPLEMENTATION_PATHS) {
    assert.equal(existsSync(new URL(path, ROOT)), false, `${path} must remain absent`);
  }
});
