import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDemoBanner,
  buildSigninDemoBanner,
  DEMO_READONLY_NOTE,
  readDemoBanner,
  readSigninDemoBanner,
} from '@/lib/demo-hellobar';

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

// ─── signin-context banner (logged-out visitor needs the creds to sign in) ─────────────────────────

test('buildSigninDemoBanner: shows on a demo tenant host regardless of session, hidden off-host', () => {
  assert.equal(buildSigninDemoBanner({ isTenantHost: true, email: 'x', password: 'y' }).show, true);
  // no creds set but on a demo host → still shows (the read-only note)
  assert.equal(buildSigninDemoBanner({ isTenantHost: true, email: null, password: null }).show, true);
  // not a demo host → never shows, even with creds
  assert.equal(buildSigninDemoBanner({ isTenantHost: false, email: 'x', password: 'y' }).show, false);
});

test('buildSigninDemoBanner: passes creds through trimmed, nulls blanks, shares the note copy', () => {
  const m = buildSigninDemoBanner({ isTenantHost: true, email: ' demo@offgrid.local ', password: ' pw ' });
  assert.equal(m.email, 'demo@offgrid.local');
  assert.equal(m.password, 'pw');
  assert.equal(m.note, DEMO_READONLY_NOTE);

  const blank = buildSigninDemoBanner({ isTenantHost: true, email: '  ', password: '' });
  assert.equal(blank.email, null);
  assert.equal(blank.password, null);

  const absent = buildSigninDemoBanner({ isTenantHost: true, email: undefined, password: undefined });
  assert.equal(absent.email, null);
  assert.equal(absent.password, null);
});

test('readSigninDemoBanner: pulls creds from env when on a demo host, hides off-host', () => {
  const savedEmail = process.env.OFFGRID_DEMO_VIEWER_EMAIL;
  const savedPw = process.env.OFFGRID_DEMO_VIEWER_PASSWORD;
  try {
    process.env.OFFGRID_DEMO_VIEWER_EMAIL = 'demo@offgrid.local';
    process.env.OFFGRID_DEMO_VIEWER_PASSWORD = 'view-only-2026';

    const onHost = readSigninDemoBanner(true);
    assert.equal(onHost.show, true);
    assert.equal(onHost.email, 'demo@offgrid.local');
    assert.equal(onHost.password, 'view-only-2026');

    const offHost = readSigninDemoBanner(false);
    assert.equal(offHost.show, false);
  } finally {
    if (savedEmail === undefined) delete process.env.OFFGRID_DEMO_VIEWER_EMAIL;
    else process.env.OFFGRID_DEMO_VIEWER_EMAIL = savedEmail;
    if (savedPw === undefined) delete process.env.OFFGRID_DEMO_VIEWER_PASSWORD;
    else process.env.OFFGRID_DEMO_VIEWER_PASSWORD = savedPw;
  }
});

test('readDemoBanner: pulls the creds from env for a viewer, hides for a non-viewer', () => {
  const savedEmail = process.env.OFFGRID_DEMO_VIEWER_EMAIL;
  const savedPw = process.env.OFFGRID_DEMO_VIEWER_PASSWORD;
  try {
    process.env.OFFGRID_DEMO_VIEWER_EMAIL = 'demo@offgrid.local';
    process.env.OFFGRID_DEMO_VIEWER_PASSWORD = 'view-only-2026';

    const viewer = readDemoBanner('viewer');
    assert.equal(viewer.show, true);
    assert.equal(viewer.email, 'demo@offgrid.local');
    assert.equal(viewer.password, 'view-only-2026');

    const admin = readDemoBanner('admin');
    assert.equal(admin.show, false);
  } finally {
    if (savedEmail === undefined) delete process.env.OFFGRID_DEMO_VIEWER_EMAIL;
    else process.env.OFFGRID_DEMO_VIEWER_EMAIL = savedEmail;
    if (savedPw === undefined) delete process.env.OFFGRID_DEMO_VIEWER_PASSWORD;
    else process.env.OFFGRID_DEMO_VIEWER_PASSWORD = savedPw;
  }
});
