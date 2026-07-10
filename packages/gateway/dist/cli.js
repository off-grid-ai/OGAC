#!/usr/bin/env node
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/cli.ts
import http from "http";
import fs from "fs";

// src/runtime-env.ts
import path from "path";
var cfg = {};
function electron() {
  try {
    const { app } = __require("electron");
    if (!app?.getPath) return null;
    const packaged = app.isPackaged;
    const resourcesPath = process.resourcesPath ?? "";
    return {
      dataDir: app.getPath("userData"),
      binRoots: packaged ? [path.join(resourcesPath, "bin")] : [path.join(app.getAppPath(), "resources", "bin"), path.join(process.cwd(), "resources", "bin")],
      resourceDirs: packaged ? [resourcesPath] : [path.join(app.getAppPath(), "resources"), path.join(process.cwd(), "resources")]
    };
  } catch {
    return null;
  }
}
function dataDir() {
  if (cfg.dataDir) return cfg.dataDir;
  if (process.env.OFFGRID_DATA_DIR) return process.env.OFFGRID_DATA_DIR;
  const e = electron();
  if (e) return e.dataDir;
  return path.join(process.cwd(), ".offgrid");
}
function modelsDir() {
  return path.join(dataDir(), "models");
}
function binRoots() {
  if (cfg.binRoots?.length) return cfg.binRoots;
  if (process.env.OFFGRID_BIN_DIR) return [process.env.OFFGRID_BIN_DIR];
  const e = electron();
  if (e) return e.binRoots;
  return [path.join(process.cwd(), "resources", "bin")];
}

// src/cluster/keycloak.ts
var CACHE_TTL_MS = 10 * 60 * 1e3;

// src/index.ts
var version = "0.1.0";

// src/cli.ts
var PORT = Number(process.env.OFFGRID_GATEWAY_PORT || process.env.PORT || 7878);
var HOST = process.env.OFFGRID_GATEWAY_HOST || "127.0.0.1";
function listModels() {
  try {
    return fs.readdirSync(modelsDir()).filter((f) => /\.(gguf|bin|onnx)$/i.test(f)).map((f) => ({ id: f }));
  } catch {
    return [];
  }
}
var server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  res.setHeader("content-type", "application/json");
  if (url === "/healthz") {
    res.end(JSON.stringify({ ok: true, version }));
    return;
  }
  if (url === "/v1/models") {
    res.end(JSON.stringify({ object: "list", data: listModels().map((m) => ({ ...m, object: "model" })) }));
    return;
  }
  res.statusCode = 501;
  res.end(JSON.stringify({ error: { message: "handler migrating from desktop runtime \u2014 see README", type: "not_implemented" } }));
});
server.listen(PORT, HOST, () => {
  console.log(`[offgrid-gateway] v${version}`);
  console.log(`  data dir:  ${dataDir()}`);
  console.log(`  models:    ${modelsDir()}`);
  console.log(`  bin roots: ${binRoots().join(", ")}`);
  console.log(`  listening: http://${HOST}:${PORT}  (try /healthz, /v1/models)`);
});
var shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
