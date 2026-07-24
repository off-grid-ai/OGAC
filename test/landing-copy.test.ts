import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDING } from '../src/lib/landing-copy.ts';

// Walk every string value in the copy tree so the brand rules are enforced across ALL copy, not a
// hand-picked sample. These mirror the brand-approved writing rules (ogac-landing-page-copy · copy.json).
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) allStrings(x, out);
  return out;
}
const STRINGS = allStrings(LANDING);

test('landing copy uses NO em dashes (brand rule: plain punctuation)', () => {
  const offenders = STRINGS.filter((s) => s.includes('—'));
  assert.deepEqual(offenders, [], `em dash found in: ${offenders.join(' | ')}`);
});

test('landing copy names the product "Off Grid AI", never the stale console branding', () => {
  assert.equal(LANDING.brand, 'Off Grid AI');
  const stale = /off\s*grid\s*(ai\s*)?console|enterprise console/i;
  const offenders = STRINGS.filter((s) => stale.test(s));
  assert.deepEqual(offenders, [], `stale "Console" branding in: ${offenders.join(' | ')}`);
});

test('landing copy never names the underlying open-source technologies (brand rule)', () => {
  // Sales copy must sell outcomes, not implementation. These are the wrapped OSS engines.
  const oss = /\b(onyx|qdrant|litellm|kestra|openbao|clickhouse|lancedb|airbyte|marquez|superset|fleetdm|unleash|opensearch|victoriametrics|victorialogs|jaeger|langfuse|ragas|evidently|presidio|keycloak|redpanda|temporal|\bopa\b|seaweedfs)\b/i;
  const offenders = STRINGS.filter((s) => oss.test(s));
  assert.deepEqual(offenders, [], `underlying OSS named in sales copy: ${offenders.join(' | ')}`);
});

test('landing copy avoids the banned marketing buzzwords', () => {
  const banned = /\b(revolutionary|seamless(ly)?|empower|leverage|robust|cutting-edge|best-in-class|synergy|game-?chang)/i;
  const offenders = STRINGS.filter((s) => banned.test(s));
  assert.deepEqual(offenders, [], `banned buzzword in: ${offenders.join(' | ')}`);
});

test('the core promise + offer are present verbatim', () => {
  assert.match(LANDING.hero.headline, /intelligence and capabilities of the entire enterprise/);
  assert.match(LANDING.hero.offer, /Five working AI use cases\. Live in 14 days\. Zero cost\. Outcomes guaranteed\./);
});
