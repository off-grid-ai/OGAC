import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toConnectHost, toDisplayHost, toDisplayHostname } from '@/lib/display-host';

test('loopback host maps to S1', () => {
  assert.equal(toDisplayHost('http://127.0.0.1:6333'), 'http://offgrid-s1.local:6333/');
  assert.equal(toDisplayHost('http://localhost:8080'), 'http://offgrid-s1.local:8080/');
  assert.equal(toDisplayHost('https://127.0.0.1'), 'https://offgrid-s1.local/');
});

test('loopback preserves scheme, port and path', () => {
  assert.equal(
    toDisplayHost('http://127.0.0.1:9200/_cluster/health'),
    'http://offgrid-s1.local:9200/_cluster/health',
  );
  assert.equal(
    toDisplayHost('http://localhost:6333/collections?limit=10'),
    'http://offgrid-s1.local:6333/collections?limit=10',
  );
  assert.equal(toDisplayHost('https://127.0.0.1:8200/v1/sys/health'), 'https://offgrid-s1.local:8200/v1/sys/health');
});

test('g6 loopback-proxy port range (8931-8939) maps to g6', () => {
  assert.equal(toDisplayHost('http://127.0.0.1:8931'), 'http://offgrid-g6.local:8931/'); // Langfuse
  assert.equal(toDisplayHost('http://127.0.0.1:8932'), 'http://offgrid-g6.local:8932/'); // Unleash
  assert.equal(toDisplayHost('http://localhost:8938'), 'http://offgrid-g6.local:8938/'); // Presidio
  assert.equal(toDisplayHost('http://127.0.0.1:8939'), 'http://offgrid-g6.local:8939/'); // range end
});

test('port boundaries around the g6 range still map to S1', () => {
  assert.equal(toDisplayHost('http://127.0.0.1:8930'), 'http://offgrid-s1.local:8930/');
  assert.equal(toDisplayHost('http://127.0.0.1:8940'), 'http://offgrid-s1.local:8940/');
  assert.equal(toDisplayHost('http://127.0.0.1:8081'), 'http://offgrid-s1.local:8081/'); // Temporal
});

test('known S1 IP maps to S1', () => {
  assert.equal(toDisplayHost('http://127.0.0.1:8800'), 'http://offgrid-s1.local:8800/');
  assert.equal(toDisplayHost('http://127.0.0.1:7878/v1'), 'http://offgrid-s1.local:7878/v1');
});

test('known g6 IP maps to g6 regardless of port', () => {
  assert.equal(toDisplayHost('http://192.168.1.66:3030'), 'http://offgrid-g6.local:3030/');
  assert.equal(toDisplayHost('http://192.168.1.66:4242/health'), 'http://offgrid-g6.local:4242/health');
});

test('gateway inference node IPs map to their g-hosts', () => {
  assert.equal(toDisplayHost('http://192.168.1.57:8801'), 'http://offgrid-g1.local:8801/');
  assert.equal(toDisplayHost('192.168.1.58:8801'), 'offgrid-g2.local:8801');
  assert.equal(toDisplayHost('192.168.1.32'), 'offgrid-g3.local');
  assert.equal(toDisplayHost('192.168.1.63'), 'offgrid-g4.local');
  assert.equal(toDisplayHost('192.168.1.65'), 'offgrid-g5.local');
  assert.equal(toDisplayHost('192.168.1.62'), 'offgrid-g7.local');
  assert.equal(toDisplayHost('192.168.1.64'), 'offgrid-g8.local');
});

test('unknown private IP never leaks — falls back to S1', () => {
  assert.equal(toDisplayHost('http://10.0.0.5:9000'), 'http://offgrid-s1.local:9000/');
  assert.equal(toDisplayHost('http://172.16.4.4'), 'http://offgrid-s1.local/');
  assert.equal(toDisplayHost('192.168.99.99:1234'), 'offgrid-s1.local:1234');
  assert.equal(toDisplayHost('169.254.1.1'), 'offgrid-s1.local'); // link-local
});

test('public URLs pass through unchanged', () => {
  assert.equal(toDisplayHost('https://ai.getoffgridai.co'), 'https://ai.getoffgridai.co');
  assert.equal(
    toDisplayHost('https://onprem-console.getoffgridai.co/signin'),
    'https://onprem-console.getoffgridai.co/signin',
  );
  assert.equal(toDisplayHost('https://gateway.getoffgridai.co/healthz'), 'https://gateway.getoffgridai.co/healthz');
});

test('already-mDNS hosts pass through unchanged', () => {
  assert.equal(toDisplayHost('http://offgrid-s1.local:6333'), 'http://offgrid-s1.local:6333');
  assert.equal(toDisplayHost('offgrid-g6.local:8931'), 'offgrid-g6.local:8931');
});

test('bare host and host:port forms', () => {
  assert.equal(toDisplayHost('127.0.0.1:6333'), 'offgrid-s1.local:6333');
  assert.equal(toDisplayHost('localhost'), 'offgrid-s1.local');
  assert.equal(toDisplayHost('127.0.0.1:8932'), 'offgrid-g6.local:8932');
  assert.equal(toDisplayHost('127.0.0.1:8081/'), 'offgrid-s1.local:8081/');
});

test('IPv6 loopback forms', () => {
  assert.equal(toDisplayHost('http://[::1]:6333'), 'http://offgrid-s1.local:6333/');
  assert.equal(toDisplayHost('[::1]:8931'), 'offgrid-g6.local:8931');
});

test('empty / nullish input', () => {
  assert.equal(toDisplayHost(''), '');
  assert.equal(toDisplayHost(null), '');
  assert.equal(toDisplayHost(undefined), '');
  assert.equal(toDisplayHost('   '), '');
});

test('malformed URL falls through to raw handling', () => {
  // Not a valid URL and no scheme → treated as bare host, unknown public → unchanged.
  assert.equal(toDisplayHost('not a url'), 'not a url');
});

test('toDisplayHostname strips scheme and path to a compact chip', () => {
  assert.equal(toDisplayHostname('http://127.0.0.1:6333/collections'), 'offgrid-s1.local:6333');
  assert.equal(toDisplayHostname('https://ai.getoffgridai.co/x'), 'ai.getoffgridai.co');
  assert.equal(toDisplayHostname('http://127.0.0.1:8931'), 'offgrid-g6.local:8931');
  assert.equal(toDisplayHostname('127.0.0.1:8800'), 'offgrid-s1.local:8800');
});

test('toConnectHost inverts the S1/g6 display mapping back to loopback', () => {
  assert.equal(toConnectHost('http://offgrid-s1.local:6333'), 'http://127.0.0.1:6333/');
  assert.equal(toConnectHost('http://offgrid-s1.local:6333/collections'), 'http://127.0.0.1:6333/collections');
  assert.equal(toConnectHost('http://offgrid-g6.local:8931'), 'http://127.0.0.1:8931/');
  assert.equal(toConnectHost('offgrid-s1.local:6333'), '127.0.0.1:6333');
  assert.equal(toConnectHost('offgrid-g6.local:8932/health'), '127.0.0.1:8932/health');
});

test('toConnectHost is a true inverse for the values we display', () => {
  for (const raw of ['http://127.0.0.1:6333', 'http://127.0.0.1:8931', 'http://127.0.0.1:8938']) {
    assert.equal(toConnectHost(toDisplayHost(raw)).replace(/\/$/, ''), raw);
  }
});

test('toConnectHost leaves public URLs, raw IPs, and loopback untouched', () => {
  assert.equal(toConnectHost('https://ai.getoffgridai.co'), 'https://ai.getoffgridai.co');
  assert.equal(toConnectHost('http://127.0.0.1:6333'), 'http://127.0.0.1:6333');
  assert.equal(toConnectHost('http://127.0.0.1:8800'), 'http://127.0.0.1:8800');
  assert.equal(toConnectHost(''), '');
  assert.equal(toConnectHost(null), '');
});

test('no raw loopback / IP survives for any known internal URL', () => {
  const internal = [
    'http://127.0.0.1:7878',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:6333',
    'http://127.0.0.1:9200',
    'http://127.0.0.1:8931',
    'http://127.0.0.1:8932',
    'http://127.0.0.1:8938',
    'http://127.0.0.1:8800',
    'http://192.168.1.66:3030',
  ];
  for (const u of internal) {
    const out = toDisplayHost(u);
    assert.doesNotMatch(out, /127\.0\.0\.1|localhost|192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\./, `leaked in ${u} -> ${out}`);
    assert.match(out, /offgrid-(s1|g6)\.local/);
  }
});
