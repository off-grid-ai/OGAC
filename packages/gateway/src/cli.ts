#!/usr/bin/env node
// offgrid-gateway — run the Off Grid AI gateway headless (standalone / Docker).
//
//   OFFGRID_DATA_DIR=~/.offgrid OFFGRID_BIN_DIR=/opt/offgrid/bin offgrid-gateway
//
// Configuration comes from env (see runtime-env): OFFGRID_DATA_DIR,
// OFFGRID_BIN_DIR, OFFGRID_RESOURCE_DIR. The full OpenAI-compatible handlers
// migrate from the desktop runtime in the next step; this v0.1 exposes health +
// model discovery so the deployment surface (CLI, Docker, port) is real now.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { dataDir, modelsDir, binRoots, version } from './index';

const PORT = Number(process.env.OFFGRID_GATEWAY_PORT || process.env.PORT || 7878);
const HOST = process.env.OFFGRID_GATEWAY_HOST || '127.0.0.1';

function listModels(): { id: string }[] {
  try {
    return fs
      .readdirSync(modelsDir())
      .filter((f) => /\.(gguf|bin|onnx)$/i.test(f))
      .map((f) => ({ id: f }));
  } catch {
    return [];
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  res.setHeader('content-type', 'application/json');
  if (url === '/healthz') {
    res.end(JSON.stringify({ ok: true, version }));
    return;
  }
  if (url === '/v1/models') {
    res.end(JSON.stringify({ object: 'list', data: listModels().map((m) => ({ ...m, object: 'model' })) }));
    return;
  }
  res.statusCode = 501;
  res.end(JSON.stringify({ error: { message: 'handler migrating from desktop runtime — see README', type: 'not_implemented' } }));
});

server.listen(PORT, HOST, () => {
  console.log(`[offgrid-gateway] v${version}`);
  console.log(`  data dir:  ${dataDir()}`);
  console.log(`  models:    ${modelsDir()}`);
  console.log(`  bin roots: ${binRoots().join(', ')}`);
  console.log(`  listening: http://${HOST}:${PORT}  (try /healthz, /v1/models)`);
});

const shutdown = (): void => { server.close(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void path; // reserved for resource resolution in upcoming handlers
