import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyRecordPurpose,
  deleteDomain,
  getDomain,
  isValidDomain,
  normalizeDnsRecord,
  normalizeDomain,
  normalizeStatus,
  registerDomain,
  verifyDomain,
} from '@/lib/resend-domains';

const ENV = { RESEND_API_KEY: 're_key' } as NodeJS.ProcessEnv;

// ─── PURE normalization ────────────────────────────────────────────────────────────────────────

test('normalizeStatus maps known statuses; unknown → pending', () => {
  assert.equal(normalizeStatus('verified'), 'verified');
  assert.equal(normalizeStatus('not_started'), 'not_started');
  assert.equal(normalizeStatus('weird'), 'pending');
  assert.equal(normalizeStatus(undefined), 'pending');
});

test('classifyRecordPurpose derives SPF/DKIM/DMARC/MX from label + type + name', () => {
  assert.equal(classifyRecordPurpose({ record: 'SPF' }), 'SPF');
  assert.equal(classifyRecordPurpose({ record: 'DKIM' }), 'DKIM');
  assert.equal(classifyRecordPurpose({ type: 'MX', name: 'send.acme.co' }), 'MX');
  assert.equal(classifyRecordPurpose({ type: 'TXT', name: '_dmarc.acme.co' }), 'DMARC');
  assert.equal(classifyRecordPurpose({ type: 'TXT', name: 'resend._domainkey.acme.co' }), 'DKIM');
  assert.equal(classifyRecordPurpose({ type: 'TXT', name: 'acme.co' }), 'SPF');
  assert.equal(classifyRecordPurpose({ type: 'CNAME', name: 'x' }), 'OTHER');
});

test('normalizeDnsRecord carries type/name/value + optional ttl/priority/status', () => {
  const r = normalizeDnsRecord({
    record: 'MX',
    type: 'mx',
    name: 'send.acme.co',
    value: 'feedback-smtp.resend.com',
    ttl: 'Auto',
    priority: 10,
    status: 'pending',
  });
  assert.equal(r.purpose, 'MX');
  assert.equal(r.type, 'MX');
  assert.equal(r.priority, 10);
  assert.equal(r.ttl, 'Auto');
  assert.equal(r.status, 'pending');
});

test('normalizeDomain maps a full Resend domain response to {id,domain,status,records}', () => {
  const d = normalizeDomain({
    id: 'dom_1',
    name: 'mail.acme.co',
    status: 'pending',
    region: 'us-east-1',
    created_at: '2026-01-01T00:00:00Z',
    records: [
      { record: 'SPF', type: 'TXT', name: 'send.mail.acme.co', value: 'v=spf1 include:amazonses.com ~all' },
      { record: 'DKIM', type: 'TXT', name: 'resend._domainkey.mail.acme.co', value: 'p=MIGf…' },
      { type: 'MX', name: 'send.mail.acme.co', value: 'feedback-smtp.resend.com', priority: 10 },
      { type: 'TXT', name: '_dmarc.mail.acme.co', value: 'v=DMARC1; p=none;' },
      { name: '', value: '' }, // dropped (no name/value)
    ],
  });
  assert.equal(d.id, 'dom_1');
  assert.equal(d.domain, 'mail.acme.co');
  assert.equal(d.status, 'pending');
  assert.equal(d.records.length, 4);
  assert.deepEqual(d.records.map((r) => r.purpose).sort(), ['DKIM', 'DMARC', 'MX', 'SPF']);
});

test('isValidDomain accepts real domains, rejects urls/emails/whitespace', () => {
  assert.equal(isValidDomain('mail.acme.co'), true);
  assert.equal(isValidDomain('acme.io'), true);
  assert.equal(isValidDomain('https://acme.co'), false);
  assert.equal(isValidDomain('a@acme.co'), false);
  assert.equal(isValidDomain('acme co'), false);
  assert.equal(isValidDomain('nope'), false);
});

// ─── thin I/O against an in-process Resend domains-API STUB ───────────────────────────────────────

function domainsStub(state: { verifyCalls: number }) {
  const domainObj = (status: string) => ({
    id: 'dom_x',
    name: 'mail.acme.co',
    status,
    records: [{ record: 'SPF', type: 'TXT', name: 'send.mail.acme.co', value: 'v=spf1 ~all' }],
  });
  const impl: typeof fetch = async (url, init) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.endsWith('/domains') && method === 'POST') {
      return new Response(JSON.stringify(domainObj('not_started')), { status: 201 });
    }
    if (u.endsWith('/verify') && method === 'POST') {
      state.verifyCalls += 1;
      return new Response(JSON.stringify({ id: 'dom_x' }), { status: 200 });
    }
    if (u.endsWith('/dom_x') && method === 'GET') {
      // After a verify was requested, report verified — so verifyDomain re-reads a fresh status.
      return new Response(JSON.stringify(domainObj(state.verifyCalls > 0 ? 'verified' : 'pending')), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return impl;
}

test('registerDomain returns the normalized DNS records to hand to the customer', async () => {
  const res = await registerDomain('mail.acme.co', undefined, ENV, domainsStub({ verifyCalls: 0 }));
  assert.equal(res.ok, true);
  assert.equal(res.data!.domain, 'mail.acme.co');
  assert.equal(res.data!.records[0].purpose, 'SPF');
});

test('registerDomain rejects an invalid domain WITHOUT calling the API', async () => {
  let called = false;
  const impl: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };
  const res = await registerDomain('not a domain', undefined, ENV, impl);
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test('registerDomain honest-degrades when no API key (configured:false, no call)', async () => {
  const res = await registerDomain('mail.acme.co', undefined, {} as NodeJS.ProcessEnv, domainsStub({ verifyCalls: 0 }));
  assert.equal(res.ok, false);
  assert.equal(res.configured, false);
});

test('verifyDomain re-checks then re-reads the fresh status (pending → verified)', async () => {
  const state = { verifyCalls: 0 };
  const impl = domainsStub(state);
  const before = await getDomain('dom_x', ENV, impl);
  assert.equal(before.data!.status, 'pending');
  const after = await verifyDomain('dom_x', ENV, impl);
  assert.equal(state.verifyCalls, 1);
  assert.equal(after.data!.status, 'verified');
});

// ─── error / no-key / network-throw branches (each op) ────────────────────────────────────────────

const NOKEY = {} as NodeJS.ProcessEnv;
const okImpl: typeof fetch = async () => new Response('{}', { status: 200 });
const errImpl: typeof fetch = async () => new Response(JSON.stringify({ message: 'nope' }), { status: 404 });
const throwImpl: typeof fetch = async () => {
  throw new Error('network down');
};

test('getDomain: no-key → configured:false; API 404 → ok:false; network throw → ok:false', async () => {
  assert.equal((await getDomain('id', NOKEY, okImpl)).configured, false);
  const e = await getDomain('id', ENV, errImpl);
  assert.equal(e.ok, false);
  assert.match(e.reason, /nope/);
  const t = await getDomain('id', ENV, throwImpl);
  assert.equal(t.ok, false);
  assert.match(t.reason, /network down/);
});

test('registerDomain: API error surfaced; network throw handled', async () => {
  const e = await registerDomain('mail.acme.co', 'eu-west-1', ENV, errImpl);
  assert.equal(e.ok, false);
  assert.match(e.reason, /nope/);
  const t = await registerDomain('mail.acme.co', undefined, ENV, throwImpl);
  assert.equal(t.ok, false);
  assert.match(t.reason, /network down/);
});

test('verifyDomain: no-key → configured:false; API error surfaced; network throw handled', async () => {
  assert.equal((await verifyDomain('id', NOKEY, okImpl)).configured, false);
  const e = await verifyDomain('id', ENV, errImpl);
  assert.equal(e.ok, false);
  const t = await verifyDomain('id', ENV, throwImpl);
  assert.equal(t.ok, false);
});

test('deleteDomain: success, tolerates 404, no-key, and network throw', async () => {
  const del: typeof fetch = async () => new Response(null, { status: 200 });
  assert.equal((await deleteDomain('id', ENV, del)).ok, true);
  const notFound: typeof fetch = async () => new Response(null, { status: 404 });
  assert.equal((await deleteDomain('id', ENV, notFound)).ok, true); // 404 tolerated
  const err: typeof fetch = async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
  assert.equal((await deleteDomain('id', ENV, err)).ok, false);
  assert.equal((await deleteDomain('id', NOKEY, del)).configured, false);
  assert.equal((await deleteDomain('id', ENV, throwImpl)).ok, false);
});
