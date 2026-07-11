import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDemoBanner,
  buildSigninDemoBanner,
  DEMO_READONLY_NOTE,
  readDemoBanner,
  readSigninDemoBanner,
  resolveDemoCreds,
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
  const m = buildDemoBanner({
    role: 'viewer',
    email: '  demo@offgrid.local ',
    password: ' pw123 ',
  });
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
  assert.doesNotMatch(
    m.note,
    /—|!|[""'']/,
    'brand voice: no em-dash, exclamation, or curly quotes',
  );
  assert.match(m.note, /view everything/i);
  assert.match(m.note, /cannot make changes/i);
});

// ─── per-tenant creds resolver (there are TWO demo tenants) ──────────────────────────────────────────

test('resolveDemoCreds: a per-slug override wins over the generic fallback', () => {
  const env = {
    OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL: 'bharat.viewer@demo.local',
    OFFGRID_DEMO_VIEWER_BHARATUNION_PASSWORD: 'bharat-pw',
    OFFGRID_DEMO_VIEWER_EMAIL: 'generic@demo.local',
    OFFGRID_DEMO_VIEWER_PASSWORD: 'generic-pw',
  };
  assert.deepEqual(resolveDemoCreds('bharatunion', env), {
    email: 'bharat.viewer@demo.local',
    password: 'bharat-pw',
  });
  // a different tenant on the SAME env gets ITS own override, not bharat's
  const env2 = {
    ...env,
    OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL: 'suraksha.viewer@demo.local',
    OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD: 'suraksha-pw',
  };
  assert.deepEqual(resolveDemoCreds('suraksha', env2), {
    email: 'suraksha.viewer@demo.local',
    password: 'suraksha-pw',
  });
});

test('resolveDemoCreds: falls back to the generic pair when the slug has no override', () => {
  const env = {
    OFFGRID_DEMO_VIEWER_EMAIL: 'generic@demo.local',
    OFFGRID_DEMO_VIEWER_PASSWORD: 'generic-pw',
  };
  assert.deepEqual(resolveDemoCreds('suraksha', env), {
    email: 'generic@demo.local',
    password: 'generic-pw',
  });
});

test('resolveDemoCreds: per-field mix — slug email + generic password fallback', () => {
  const env = {
    OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL: 'bharat.viewer@demo.local',
    OFFGRID_DEMO_VIEWER_PASSWORD: 'generic-pw',
  };
  assert.deepEqual(resolveDemoCreds('bharatunion', env), {
    email: 'bharat.viewer@demo.local',
    password: 'generic-pw',
  });
});

test('resolveDemoCreds: trims values and treats blanks as unset (falls through)', () => {
  const env = {
    OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL: '   ',
    OFFGRID_DEMO_VIEWER_EMAIL: '  fallback@demo.local ',
    OFFGRID_DEMO_VIEWER_PASSWORD: ' fallback-pw ',
  };
  assert.deepEqual(resolveDemoCreds('bharatunion', env), {
    email: 'fallback@demo.local',
    password: 'fallback-pw',
  });
});

test('resolveDemoCreds: null when the slug is absent', () => {
  assert.equal(resolveDemoCreds(null, { OFFGRID_DEMO_VIEWER_EMAIL: 'x', OFFGRID_DEMO_VIEWER_PASSWORD: 'y' }), null);
  assert.equal(resolveDemoCreds(undefined, {}), null);
  assert.equal(resolveDemoCreds('', {}), null);
});

test('resolveDemoCreds: null when a full email+password pair cannot be resolved', () => {
  assert.equal(resolveDemoCreds('bharatunion', {}), null);
  // email only, no password anywhere → null (no half-set creds)
  assert.equal(resolveDemoCreds('bharatunion', { OFFGRID_DEMO_VIEWER_EMAIL: 'x@demo.local' }), null);
});

test('resolveDemoCreds: a slug with unsafe chars cannot smuggle a foreign env key', () => {
  const env = {
    // a real key that a naive concat of "bharat.union" might reach
    OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL: 'right@demo.local',
    OFFGRID_DEMO_VIEWER_BHARATUNION_PASSWORD: 'right-pw',
  };
  // dots/dashes are stripped → resolves to the sanitised BHARATUNION key
  assert.deepEqual(resolveDemoCreds('bharat.union', env), {
    email: 'right@demo.local',
    password: 'right-pw',
  });
});

// ─── signin-context banner (logged-out visitor needs the creds to sign in) ─────────────────────────

test('buildSigninDemoBanner: shows on a demo tenant host regardless of session, hidden off-host', () => {
  assert.equal(
    buildSigninDemoBanner({ slug: 'bharatunion', creds: { email: 'x', password: 'y' } }).show,
    true,
  );
  // no creds resolved but on a demo host → still shows (the read-only note)
  assert.equal(buildSigninDemoBanner({ slug: 'bharatunion', creds: null }).show, true);
  // not a demo host → never shows, even with creds
  assert.equal(buildSigninDemoBanner({ slug: null, creds: { email: 'x', password: 'y' } }).show, false);
});

test('buildSigninDemoBanner: passes creds through trimmed, nulls when unset, shares the note copy', () => {
  const m = buildSigninDemoBanner({
    slug: 'bharatunion',
    creds: { email: ' demo@offgrid.local ', password: ' pw ' },
  });
  assert.equal(m.email, 'demo@offgrid.local');
  assert.equal(m.password, 'pw');
  assert.equal(m.note, DEMO_READONLY_NOTE);

  const noCreds = buildSigninDemoBanner({ slug: 'bharatunion', creds: null });
  assert.equal(noCreds.email, null);
  assert.equal(noCreds.password, null);
  assert.equal(noCreds.note, DEMO_READONLY_NOTE);
});

test('readSigninDemoBanner: pulls the RIGHT tenant creds from env by slug, hides off-host', () => {
  const keys = [
    'OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL',
    'OFFGRID_DEMO_VIEWER_BHARATUNION_PASSWORD',
    'OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL',
    'OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD',
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL = 'bharat@demo.local';
    process.env.OFFGRID_DEMO_VIEWER_BHARATUNION_PASSWORD = 'bharat-pw';
    process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL = 'suraksha@demo.local';
    process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD = 'suraksha-pw';

    const bharat = readSigninDemoBanner('bharatunion');
    assert.equal(bharat.show, true);
    assert.equal(bharat.email, 'bharat@demo.local');
    assert.equal(bharat.password, 'bharat-pw');

    const suraksha = readSigninDemoBanner('suraksha');
    assert.equal(suraksha.email, 'suraksha@demo.local');
    assert.equal(suraksha.password, 'suraksha-pw');

    const offHost = readSigninDemoBanner(null);
    assert.equal(offHost.show, false);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
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

    // Per-tenant: a slug's own override wins over the generic pair, so each tenant's in-app
    // hellobar shows ITS OWN viewer email (the bug: insurer was showing the generic demo-bank@).
    const savedSlugEmail = process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL;
    const savedSlugPw = process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD;
    try {
      process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL = 'demo-insurer@getoffgridai.co';
      process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD = 'view-only-2026';
      const insurer = readDemoBanner('viewer', 'suraksha');
      assert.equal(insurer.email, 'demo-insurer@getoffgridai.co', 'per-slug override must win over generic');
      // no slug → generic fallback still works (single-tenant deploys)
      assert.equal(readDemoBanner('viewer').email, 'demo@offgrid.local');
    } finally {
      if (savedSlugEmail === undefined) delete process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL;
      else process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_EMAIL = savedSlugEmail;
      if (savedSlugPw === undefined) delete process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD;
      else process.env.OFFGRID_DEMO_VIEWER_SURAKSHA_PASSWORD = savedSlugPw;
    }
  } finally {
    if (savedEmail === undefined) delete process.env.OFFGRID_DEMO_VIEWER_EMAIL;
    else process.env.OFFGRID_DEMO_VIEWER_EMAIL = savedEmail;
    if (savedPw === undefined) delete process.env.OFFGRID_DEMO_VIEWER_PASSWORD;
    else process.env.OFFGRID_DEMO_VIEWER_PASSWORD = savedPw;
  }
});
