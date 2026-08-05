import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  desiredLakeRule,
  describeRetentionState,
  lakeWriteTargets,
  mergeLakeRule,
  retentionStateFor,
  truncatedWindow,
  windowExceedsStore,
  type ExistingRule,
  type LakeWritingApp,
} from '../src/lib/lake-retention-policy.ts';

const DOMAINS = [
  { id: 'dom_assess', label: 'Claim assessments', resource: 'claim-lake/assessments' },
  { id: 'dom_exports', label: 'Exports', resource: 'claim-lake/exports' },
  { id: 'dom_whole', label: 'Whole bucket', resource: 'archive-lake' },
];

const app = (id: string, title: string, domain?: string): LakeWritingApp => ({
  id,
  title,
  steps: domain
    ? [{ kind: 'output', sink: 'lake', config: { domain } }]
    : [{ kind: 'output', sink: 'email', config: { to: 'x@y' } }],
});

test('THE TARGET LIST IS DERIVED FROM THE APPS, never configured', () => {
  // A hand-maintained list of "buckets we write to" is wrong the first time somebody adds an output
  // step, and the failure is silent: the policy keeps reporting itself applied while no longer
  // covering the new destination.
  const targets = lakeWriteTargets([app('a1', 'Claim assessor', 'dom_assess')], DOMAINS);
  assert.equal(targets.length, 1);
  assert.deepEqual(
    { bucket: targets[0].bucket, prefix: targets[0].prefix, by: targets[0].writtenBy },
    { bucket: 'claim-lake', prefix: 'assessments/', by: ['Claim assessor'] },
  );
});

test('apps that do not write to the lake contribute nothing', () => {
  assert.deepEqual(lakeWriteTargets([app('a2', 'Emailer')], DOMAINS), []);
  // A lake step naming a domain that does not exist is not a target we can bound — and inventing a
  // bucket for it would apply a rule somewhere nobody asked for.
  assert.deepEqual(lakeWriteTargets([app('a3', 'Broken', 'dom_missing')], DOMAINS), []);
});

test('two apps writing to one place are one target, and both are named', () => {
  // An operator changing a retention window needs to know everything it affects.
  const targets = lakeWriteTargets(
    [app('a1', 'Assessor', 'dom_assess'), app('a2', 'Reassessor', 'dom_assess')],
    DOMAINS,
  );
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].writtenBy, ['Assessor', 'Reassessor']);
});

test('a whole-bucket domain has an empty prefix, not a fabricated one', () => {
  const [t] = lakeWriteTargets([app('a', 'Archiver', 'dom_whole')], DOMAINS);
  assert.equal(t.bucket, 'archive-lake');
  assert.equal(t.prefix, '');
});

test('targets come back in a stable order so two runs produce comparable evidence', () => {
  const forward = lakeWriteTargets(
    [app('a', 'A', 'dom_exports'), app('b', 'B', 'dom_assess')],
    DOMAINS,
  );
  const reverse = lakeWriteTargets(
    [app('b', 'B', 'dom_assess'), app('a', 'A', 'dom_exports')],
    DOMAINS,
  );
  assert.deepEqual(forward.map((t) => t.prefix), reverse.map((t) => t.prefix));
});

// ─── does the bucket match the policy? ───────────────────────────────────────────────────────────

const rule = (over: Partial<ExistingRule> = {}): ExistingRule => ({
  id: 'r', prefix: 'assessments/', expireDays: 30, enabled: true, ...over,
});
const target = { prefix: 'assessments/' };

test('A RULE ON A DIFFERENT PREFIX IS NOT COVERAGE', () => {
  // Treating any rule on the bucket as coverage is how a policy reports itself applied while the
  // objects it was meant to bound are never touched.
  assert.deepEqual(retentionStateFor(target, [rule({ prefix: 'exports/' })], 30), { state: 'absent' });
  // A rule on the whole bucket DOES cover a prefix inside it.
  assert.deepEqual(retentionStateFor(target, [rule({ prefix: '' })], 30), { state: 'matches', days: 30 });
  // And a rule on a parent folder covers a child.
  assert.deepEqual(
    retentionStateFor({ prefix: 'assessments/2026/' }, [rule({ prefix: 'assessments/' })], 30),
    { state: 'matches', days: 30 },
  );
});

test('DRIFT IN THE DANGEROUS DIRECTION IS CALLED OUT AS SUCH', () => {
  // Kept LONGER than the policy claims means the compliance statement is false while the surface
  // looks configured. That is worse than nothing being set, because nothing looks wrong.
  const longer = retentionStateFor(target, [rule({ expireDays: 3650 })], 30);
  assert.deepEqual(longer, { state: 'drifted', found: 3650, expected: 30, longerThanPolicy: true });
  assert.match(describeRetentionState({ ...target, bucket: 'b', domainId: 'd', domainLabel: 'L', writtenBy: [] }, longer), /LONGER than the 30 days policy claims/);

  const shorter = retentionStateFor(target, [rule({ expireDays: 7 })], 30);
  assert.equal(shorter.state === 'drifted' && shorter.longerThanPolicy, false);
});

test('a PAUSED rule is not compliance, even at the right number of days', () => {
  // The window is correct and nothing is being deleted. A state that reads as "matches" here would be
  // the most confident possible way to be wrong.
  assert.deepEqual(retentionStateFor(target, [rule({ enabled: false })], 30), { state: 'paused', days: 30 });
  assert.match(
    describeRetentionState({ ...target, bucket: 'b', domainId: 'd', domainLabel: 'L', writtenBy: [] }, { state: 'paused', days: 30 }),
    /PAUSED, so nothing is being removed/,
  );
});

test('when several rules cover a prefix, the SHORTEST window governs', () => {
  // Whichever fires first is what actually happens to the object; reporting the longer one would
  // overstate how long the data survives.
  const state = retentionStateFor(target, [rule({ prefix: '', expireDays: 90 }), rule({ expireDays: 7 })], 7);
  assert.deepEqual(state, { state: 'matches', days: 7 });
});

test('APPLYING THE POLICY DOES NOT DELETE RULES IT DOES NOT OWN', () => {
  // A bucket can carry rules an operator set. Replacing the whole list with ours would silently drop
  // them — and a deleted retention rule means data living longer than someone intended, which is the
  // exact failure this feature exists to prevent, caused by the feature.
  const existing = [rule({ id: 'operator-set', prefix: 'exports/', expireDays: 365 })];
  const merged = mergeLakeRule(existing, desiredLakeRule('assessments/', 30));
  assert.equal(merged.length, 2);
  assert.ok(merged.some((r) => r.id === 'operator-set' && r.expireDays === 365));
  // Re-applying replaces OUR rule on that prefix rather than accumulating duplicates.
  const again = mergeLakeRule(merged, desiredLakeRule('assessments/', 60));
  assert.equal(again.length, 2);
  assert.equal(again.find((r) => r.prefix === 'assessments/')?.expireDays, 60);
});

test('the rule we set is named so a person can tell where it came from', () => {
  assert.equal(desiredLakeRule('assessments/', 30).id, 'offgrid-retention-assessments-30d');
  assert.equal(desiredLakeRule('', 90).id, 'offgrid-retention-all-90d');
  // A prefix with characters a broker/store would reject is sanitised into the name.
  assert.match(desiredLakeRule('a b/c/', 30).id, /^[A-Za-z0-9._-]+$/);
});

test('the absent state says what it means in the reader\'s words', () => {
  const t = { bucket: 'claim-lake', prefix: 'assessments/', domainId: 'd', domainLabel: 'Claim assessments', writtenBy: [] };
  assert.match(describeRetentionState(t, { state: 'absent' }), /nothing bounded how long files are kept/);
  // No storage vocabulary in the sentence a compliance reader sees.
  assert.doesNotMatch(describeRetentionState(t, { state: 'absent' }), /lifecycle|S3|prefix rule/i);
});

test('A WINDOW THE STORE CANNOT HOLD IS ITS OWN STATE, because the consequence is data loss', () => {
  // MEASURED live 2026-08-05 against the deployed store: 30 days round-tripped as 30, but 365 read back
  // as 109 and 3650 as 66 — those values modulo 256. The store encodes the day count in a single byte
  // and wraps SILENTLY, downward. BFSI windows are 2555 and 3650 days, so exactly the values a bank or
  // insurer needs are the ones that break, and they break by deleting records years early while the
  // surface reports the policy as applied.
  const t = { bucket: 'b', prefix: 'assessments/', domainId: 'd', domainLabel: 'Assessments', writtenBy: [] };
  const state = retentionStateFor(t, [], 3650);
  assert.deepEqual(state, { state: 'unrepresentable', expected: 3650, wouldBecome: 66 });
  assert.equal(truncatedWindow(365), 109);
  assert.equal(windowExceedsStore(255), false);
  assert.equal(windowExceedsStore(256), true);

  // The sentence has to name the real number, not hedge. Someone reads this to decide whether they are
  // compliant, and "may be incorrect" is not an answer.
  const line = describeRetentionState(t, state);
  assert.match(line, /would silently reduce that to 66 days and delete them early/);
  assert.match(line, /NO retention rule was set here/);
});

test('the unrepresentable check runs BEFORE looking at what is on the bucket', () => {
  // If the store cannot hold the window, the current rules are beside the point — applying the policy
  // would make things actively worse, so that has to be decided first.
  const t = { prefix: 'assessments/' };
  const withMatchingRule = retentionStateFor(t, [{ id: 'r', prefix: 'assessments/', expireDays: 3650, enabled: true }], 3650);
  assert.equal(withMatchingRule.state, 'unrepresentable');
});

test('windows the store CAN hold still behave exactly as before', () => {
  const t = { prefix: 'assessments/' };
  assert.deepEqual(retentionStateFor(t, [{ id: 'r', prefix: 'assessments/', expireDays: 200, enabled: true }], 200), {
    state: 'matches', days: 200,
  });
  assert.deepEqual(retentionStateFor(t, [], 30), { state: 'absent' });
});
