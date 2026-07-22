import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const ORG = 'test-s3-connector-query-runtime';
const FOREIGN_ORG = 'test-s3-connector-query-runtime-foreign';
const dbUp = await dbReachable();

test(
  'canonical App connector-query resolves tenant policy and retains S3 source provenance',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const vault = new Map<string, string>();
    const content = Buffer.from('{"claim":"CLM-1042","risk":"high"}');
    const sourceEtag = 'claim-evidence-etag';
    const s3Requests: string[] = [];
    let requestedMaxKeys: string | null = null;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://boundary');
      const vaultMatch = url.pathname.match(/^\/v1\/secret\/data\/(.+)$/);
      if (vaultMatch) {
        const key = decodeURIComponent(vaultMatch[1]);
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
            data?: { value?: string };
          };
          vault.set(key, body.data?.value ?? '');
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ data: { version: 1 } }));
        }
        if (req.method === 'GET') {
          const value = vault.get(key);
          if (!value) {
            res.statusCode = 404;
            return res.end();
          }
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ data: { data: { value } } }));
        }
        if (req.method === 'DELETE') {
          vault.delete(key);
          res.statusCode = 204;
          return res.end();
        }
      }

      if (!url.pathname.startsWith('/s3/')) {
        res.statusCode = 404;
        return res.end();
      }
      assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
      s3Requests.push(`${req.method} ${url.pathname}${url.search}`);

      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        requestedMaxKeys = url.searchParams.get('max-keys');
        assert.equal(url.searchParams.get('prefix'), 'approved/');
        res.setHeader('content-type', 'application/xml');
        return res.end(
          `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>approved/case-1.json</Key><Size>${content.length}</Size><LastModified>2026-07-23T00:00:00Z</LastModified><ETag>"${sourceEtag}"</ETag></Contents></ListBucketResult>`,
        );
      }

      const key = decodeURIComponent(url.pathname.replace(/^\/s3\/claims-archive\//, ''));
      if (key !== 'approved/case-1.json') {
        res.statusCode = 404;
        return res.end();
      }
      if (req.method === 'HEAD') {
        res.setHeader('content-length', String(content.length));
        res.setHeader('content-type', 'application/json');
        res.setHeader('last-modified', 'Wed, 23 Jul 2026 00:00:00 GMT');
        res.setHeader('etag', `"${sourceEtag}"`);
        return res.end();
      }
      if (req.method === 'GET') {
        res.setHeader('content-type', 'application/json');
        return res.end(content);
      }
      res.statusCode = 405;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const previousBaoUrl = process.env.OFFGRID_OPENBAO_URL;
    const previousBaoToken = process.env.OFFGRID_OPENBAO_TOKEN;
    process.env.OFFGRID_OPENBAO_URL = baseUrl;
    process.env.OFFGRID_OPENBAO_TOKEN = 'test-token';
    t.after(() => {
      if (previousBaoUrl === undefined) delete process.env.OFFGRID_OPENBAO_URL;
      else process.env.OFFGRID_OPENBAO_URL = previousBaoUrl;
      if (previousBaoToken === undefined) delete process.env.OFFGRID_OPENBAO_TOKEN;
      else process.env.OFFGRID_OPENBAO_TOKEN = previousBaoToken;
    });

    const { createConnector, deleteConnector } = await import('@/lib/store');
    const { createDomain, deleteDomain } = await import('@/lib/data-domains-store');
    const { persistConnectorSecret, serializeObjectStoreCredential } =
      await import('@/lib/connector-secrets');
    const { queryDomain } = await import('@/lib/adapters/connector-query');
    const { executeStep } = await import('@/lib/app-run');
    const connector = await createConnector({
      name: 'Claims evidence archive',
      type: 's3',
      endpoint: `${baseUrl}/s3`,
      auth: 'api-key',
      description: 'Runtime integration boundary',
      custom: true,
      orgId: ORG,
    });
    const domain = await createDomain(
      {
        label: 'Claim evidence',
        connectorId: connector.id,
        resource: 'claims-archive/approved',
        opHints: { limit: 999 },
      },
      ORG,
    );
    await persistConnectorSecret(
      connector.id,
      serializeObjectStoreCredential({ accessKey: 'access', secretKey: 'secret' }),
    );
    t.after(async () => {
      await deleteDomain(domain.id, ORG);
      await deleteConnector(connector.id, ORG);
    });

    const target = {
      id: connector.id,
      type: connector.type,
      endpoint: connector.endpoint,
    };
    const queried = await queryDomain(domain, target);
    assert.equal(queried.result?.dialect, 's3');
    assert.equal(queried.result?.count, 1);
    assert.equal(
      requestedMaxKeys,
      '20',
      'generic caller limit is clamped by the S3 source contract',
    );
    const row = queried.result?.rows[0] as
      | {
          content?: string;
          provenance?: { etag?: string; sha256?: string; connectorId?: string; domainId?: string };
        }
      | undefined;
    assert.equal(row?.content, content.toString());
    assert.deepEqual(row?.provenance, {
      connectorId: connector.id,
      domainId: domain.id,
      bucket: 'claims-archive',
      key: 'approved/case-1.json',
      etag: sourceEtag,
      lastModified: '2026-07-23T00:00:00.000Z',
      sha256: createHash('sha256').update(content).digest('hex'),
    });

    const beforeTenantDenial = s3Requests.length;
    const denied = await queryDomain({ ...domain, orgId: FOREIGN_ORG }, target);
    assert.equal(denied.result, null);
    assert.equal(
      s3Requests.length,
      beforeTenantDenial,
      'cross-tenant domain input never reaches S3',
    );

    const step = {
      id: 'read-claim-evidence',
      label: 'Read claim evidence',
      kind: 'connector-query' as const,
      domain: domain.id,
      op: 'read' as const,
      params: { key: 'case-1.json' },
    };
    const appResult = await executeStep(
      {
        id: 'app_claim_triage',
        orgId: ORG,
        ownerId: 'owner_test',
        title: 'Claim triage',
        summary: 'Uses governed claim evidence.',
        visibility: 'org',
        published: true,
        trigger: { kind: 'on-demand' },
        steps: [step],
        edges: [],
      },
      step,
      [],
      { orgId: ORG, runId: 'run_s3_runtime' },
    );
    assert.equal(appResult.status, 'done');
    const appEvidence = appResult.output ?? '';
    assert.match(appEvidence, /CLM-1042/);
    assert.match(appEvidence, new RegExp(sourceEtag));
    assert.match(appEvidence, /"sha256":"[a-f0-9]{64}"/);
    assert.match(appEvidence, /"bucket":"claims-archive"/);
    assert.match(appEvidence, /"key":"approved\/case-1\.json"/);
    assert.ok(appEvidence.includes(`"connectorId":"${connector.id}"`));
    assert.ok(appEvidence.includes(`"domainId":"${domain.id}"`));
    assert.doesNotMatch(appEvidence, /access|secret/);
    assert.match(appResult.detail ?? '', /via s3/);
  },
);
