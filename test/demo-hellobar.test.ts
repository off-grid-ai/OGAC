import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemoBanner, DEMO_READONLY_NOTE } from '@/lib/demo-hellobar';

// Pure hellobar decision. ZERO IO — proves it shows ONLY for a viewer, passes creds through when set,
// and nulls blank/absent creds. The reader (readDemoBanner) is thin env glue over this.

test('buildDemoBanner: shows for a viewer, hidden for admin/other/absent', () => {
  assert.equal(buildDemoBanner({ role: 'viewer', email: null, password: null }).show, true);
  assert.equal(buildDemoBanner({ role: 'VIEWER', email: null, password: null }).show, true);
  assert.equal(buildDemoBanner({ role: 'admin', email: 'x', password: 'y' }).show, false);
  assert.equal(buildDemoBanner({ role: 'operator', email: null, password: null }).show, false);
  assert.equal(buildDemoBanner({ role: undefined, email: null, password: null }).show, false);
  assert.equal(buildDemoBanner({ role: null, email: null, password: null }).show, false);
});

test('buildDemoBanner: passes creds through, trims, nulls blanks', () => {
  const m = buildDemoBanner({ role: 'viewer', email: '  demo@offgrid.local ', password: ' pw123 ' });
  assert.equal(m.email, 'demo@offgrid.local');
  assert.equal(m.password, 'pw123');

  const blank = buildDemoBanner({ role: 'viewer', email: '   ', password: '' });
  assert.equal(blank.email, null);
  assert.equal(blank.password, null);

  const absent = buildDemoBanner({ role: 'viewer', email: undefined, password: undefined });
  assert.equal(absent.email, null);
  assert.equal(absent.password, null);
});

test('buildDemoBanner: the note is the shared read-only copy, brand-clean (no em-dash/!/curly)', () => {
  const m = buildDemoBanner({ role: 'viewer', email: null, password: null });
  assert.equal(m.note, DEMO_READONLY_NOTE);
  assert.doesNotMatch(m.note, /—|!|[""'']/, 'brand voice: no em-dash, exclamation, or curly quotes');
  assert.match(m.note, /view everything/i);
  assert.match(m.note, /cannot make changes/i);
});
