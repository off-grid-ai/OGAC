#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_http = __toESM(require("http"), 1);
var import_fs = __toESM(require("fs"), 1);

// src/runtime-env.ts
var import_path = __toESM(require("path"), 1);
var cfg = {};
function electron() {
  try {
    const { app } = require("electron");
    if (!app?.getPath) return null;
    const packaged = app.isPackaged;
    const resourcesPath = process.resourcesPath ?? "";
    return {
      dataDir: app.getPath("userData"),
      binRoots: packaged ? [import_path.default.join(resourcesPath, "bin")] : [import_path.default.join(app.getAppPath(), "resources", "bin"), import_path.default.join(process.cwd(), "resources", "bin")],
      resourceDirs: packaged ? [resourcesPath] : [import_path.default.join(app.getAppPath(), "resources"), import_path.default.join(process.cwd(), "resources")]
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
  return import_path.default.join(process.cwd(), ".offgrid");
}
function modelsDir() {
  return import_path.default.join(dataDir(), "models");
}
function binRoots() {
  if (cfg.binRoots?.length) return cfg.binRoots;
  if (process.env.OFFGRID_BIN_DIR) return [process.env.OFFGRID_BIN_DIR];
  const e = electron();
  if (e) return e.binRoots;
  return [import_path.default.join(process.cwd(), "resources", "bin")];
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
    return import_fs.default.readdirSync(modelsDir()).filter((f) => /\.(gguf|bin|onnx)$/i.test(f)).map((f) => ({ id: f }));
  } catch {
    return [];
  }
}
var server = import_http.default.createServer((req, res) => {
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
