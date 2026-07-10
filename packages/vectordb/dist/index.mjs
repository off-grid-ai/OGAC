// src/adapters/qdrant.ts
function baseUrl(url) {
  return url.replace(/\/+$/, "");
}
function headers(cfg) {
  const h = { "content-type": "application/json" };
  if (cfg.apiKey) h["api-key"] = cfg.apiKey;
  return h;
}
async function getJson(url, cfg) {
  try {
    const res = await fetch(url, { method: "GET", headers: headers(cfg) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function postJson(url, cfg, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
function parseCollectionInfo(name, raw) {
  const result = raw?.result;
  if (!result || typeof result !== "object") return null;
  const r = result;
  let vectors = 0;
  const vc = r["vectors_count"];
  const pc = r["points_count"];
  if (typeof vc === "number") vectors = vc;
  else if (typeof pc === "number") vectors = pc;
  let dim;
  let distance;
  const config = r["config"];
  const params = config?.["params"];
  const vectorsCfg = params?.["vectors"];
  if (vectorsCfg && typeof vectorsCfg === "object") {
    const asObj = vectorsCfg;
    if (typeof asObj["size"] === "number") {
      dim = asObj["size"];
      if (typeof asObj["distance"] === "string") distance = asObj["distance"];
    } else {
      const first = Object.values(asObj)[0];
      if (first && typeof first["size"] === "number") {
        dim = first["size"];
        if (typeof first["distance"] === "string") distance = first["distance"];
      }
    }
  }
  return { name, vectors, dim, distance };
}
function parsePoint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = raw;
  const id = p["id"];
  if (typeof id !== "string" && typeof id !== "number") return null;
  const point = { id };
  const vec = p["vector"];
  if (Array.isArray(vec) && vec.every((v) => typeof v === "number")) {
    point.vector = vec;
  } else if (vec && typeof vec === "object") {
    const first = Object.values(vec).find(
      (v) => Array.isArray(v) && v.every((n) => typeof n === "number")
    );
    if (Array.isArray(first)) point.vector = first;
  }
  const payload = p["payload"];
  if (payload && typeof payload === "object") {
    point.payload = payload;
  }
  return point;
}
function qdrantInspector(cfg) {
  const url = baseUrl(cfg.url);
  return {
    config: cfg,
    async ping() {
      const root = await getJson(`${url}/`, cfg);
      if (root !== null) return true;
      try {
        const res = await fetch(`${url}/healthz`, { headers: headers(cfg) });
        return res.ok;
      } catch {
        return false;
      }
    },
    async listCollections() {
      const raw = await getJson(`${url}/collections`, cfg);
      const cols = raw?.result?.collections;
      if (!Array.isArray(cols)) return [];
      const names = cols.map((c) => c?.name).filter((n) => typeof n === "string");
      const infos = await Promise.all(
        names.map(async (name) => {
          const detail = await getJson(`${url}/collections/${encodeURIComponent(name)}`, cfg);
          return parseCollectionInfo(name, detail) ?? { name, vectors: 0 };
        })
      );
      return infos;
    },
    async collectionInfo(name) {
      const raw = await getJson(`${url}/collections/${encodeURIComponent(name)}`, cfg);
      return parseCollectionInfo(name, raw);
    },
    async sample(name, n = 20) {
      const raw = await postJson(
        `${url}/collections/${encodeURIComponent(name)}/points/scroll`,
        cfg,
        { limit: n, with_vector: true, with_payload: true }
      );
      const points = raw?.result?.points;
      if (!Array.isArray(points)) return [];
      return points.map(parsePoint).filter((p) => p !== null);
    },
    async count(name) {
      const info = await this.collectionInfo(name);
      return info?.vectors ?? 0;
    },
    async search(name, vector, k = 10) {
      const raw = await postJson(
        `${url}/collections/${encodeURIComponent(name)}/points/search`,
        cfg,
        { vector, limit: k, with_payload: true, with_vector: true }
      );
      const result = raw?.result;
      if (!Array.isArray(result)) return [];
      return result.map(parsePoint).filter((p) => p !== null);
    }
  };
}

// src/adapters/lancedb.ts
async function loadLance() {
  try {
    const specifier = "@lancedb/lancedb";
    const mod = await import(
      /* @vite-ignore */
      specifier
    );
    return mod;
  } catch {
    return null;
  }
}
async function connect(cfg) {
  const lance = await loadLance();
  if (!lance) return null;
  try {
    return await lance.connect(cfg.url);
  } catch {
    return null;
  }
}
function rowToPoint(row, index) {
  const rawId = row["id"] ?? row["_rowid"] ?? index;
  const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : index;
  const point = { id };
  const vec = row["vector"];
  if (Array.isArray(vec) && vec.every((v) => typeof v === "number")) {
    point.vector = vec;
  } else if (vec != null && typeof vec.length === "number") {
    const arr = Array.from(vec);
    if (arr.every((v) => typeof v === "number")) point.vector = arr;
  }
  const payload = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "vector") continue;
    payload[k] = v;
  }
  if (Object.keys(payload).length > 0) point.payload = payload;
  return point;
}
function lancedbInspector(cfg) {
  return {
    config: cfg,
    async ping() {
      const conn = await connect(cfg);
      if (!conn) return false;
      try {
        await conn.tableNames();
        return true;
      } catch {
        return false;
      }
    },
    async listCollections() {
      const conn = await connect(cfg);
      if (!conn) return [];
      try {
        const names = await conn.tableNames();
        return Promise.all(
          names.map(async (name) => {
            const info = await this.collectionInfo(name);
            return info ?? { name, vectors: 0 };
          })
        );
      } catch {
        return [];
      }
    },
    async collectionInfo(name) {
      const conn = await connect(cfg);
      if (!conn) return null;
      try {
        const table = await conn.openTable(name);
        const vectors = await table.countRows();
        const rows = await table.query().limit(1).toArray();
        let dim;
        const first = rows[0]?.["vector"];
        if (Array.isArray(first)) dim = first.length;
        else if (first != null && typeof first.length === "number") {
          dim = first.length;
        }
        return { name, vectors, dim };
      } catch {
        return null;
      }
    },
    async sample(name, n = 20) {
      const conn = await connect(cfg);
      if (!conn) return [];
      try {
        const table = await conn.openTable(name);
        const rows = await table.query().limit(n).toArray();
        return rows.map(rowToPoint);
      } catch {
        return [];
      }
    },
    async count(name) {
      const conn = await connect(cfg);
      if (!conn) return 0;
      try {
        const table = await conn.openTable(name);
        return await table.countRows();
      } catch {
        return 0;
      }
    }
  };
}

// src/adapters/unsupported.ts
function unsupportedInspector(cfg) {
  const note = `[vectordb] backend "${cfg.kind}" is not yet supported`;
  return {
    config: cfg,
    async ping() {
      console.warn(note);
      return false;
    },
    async listCollections() {
      return [];
    },
    async collectionInfo() {
      return null;
    },
    async sample() {
      return [];
    },
    async count() {
      return 0;
    }
  };
}

// src/factory.ts
function createInspector(cfg) {
  switch (cfg.kind) {
    case "qdrant":
      return qdrantInspector(cfg);
    case "lancedb":
      return lancedbInspector(cfg);
    case "chroma":
    case "pgvector":
    case "weaviate":
    case "milvus":
      return unsupportedInspector(cfg);
    default: {
      const _exhaustive = cfg.kind;
      return unsupportedInspector({ ...cfg, kind: _exhaustive });
    }
  }
}

// src/project.ts
function columnMeans(rows, dim) {
  const means = new Array(dim).fill(0);
  for (const row of rows) {
    for (let j = 0; j < dim; j++) means[j] += row[j] ?? 0;
  }
  for (let j = 0; j < dim; j++) means[j] /= rows.length;
  return means;
}
function center(rows, means, dim) {
  return rows.map((row) => {
    const out = new Array(dim);
    for (let j = 0; j < dim; j++) out[j] = (row[j] ?? 0) - means[j];
    return out;
  });
}
function covariance(centered, dim) {
  const n = centered.length;
  const cov = Array.from(
    { length: dim },
    () => new Array(dim).fill(0)
  );
  for (const row of centered) {
    for (let i = 0; i < dim; i++) {
      const ri = row[i];
      if (ri === 0) continue;
      for (let j = i; j < dim; j++) {
        cov[i][j] += ri * row[j];
      }
    }
  }
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const v = cov[i][j] / denom;
      cov[i][j] = v;
      cov[j][i] = v;
    }
  }
  return cov;
}
function matVec(m, v, dim) {
  const out = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    let s = 0;
    const mi = m[i];
    for (let j = 0; j < dim; j++) s += mi[j] * v[j];
    out[i] = s;
  }
  return out;
}
function norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}
function powerIteration(m, dim, iters = 100) {
  let v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i + 1);
  let n = norm(v);
  if (n === 0) {
    v = new Array(dim).fill(1);
    n = Math.sqrt(dim);
  }
  for (let i = 0; i < dim; i++) v[i] /= n;
  for (let it = 0; it < iters; it++) {
    const next = matVec(m, v, dim);
    const nn = norm(next);
    if (nn === 0) return v;
    for (let i = 0; i < dim; i++) next[i] /= nn;
    v = next;
  }
  return v;
}
function eigenvalue(m, v, dim) {
  const mv = matVec(m, v, dim);
  let s = 0;
  for (let i = 0; i < dim; i++) s += v[i] * mv[i];
  return s;
}
function deflate(m, v, lambda, dim) {
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      m[i][j] -= lambda * v[i] * v[j];
    }
  }
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function project2D(vectors) {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const dim = vectors.reduce((mx, v) => Math.max(mx, v.length), 0);
  if (dim === 0) return vectors.map(() => ({ x: 0, y: 0 }));
  const means = columnMeans(vectors, dim);
  const centered = center(vectors, means, dim);
  if (dim === 1) {
    return centered.map((row) => ({ x: row[0] ?? 0, y: 0 }));
  }
  const cov = covariance(centered, dim);
  const pc1 = powerIteration(cov, dim);
  const lambda1 = eigenvalue(cov, pc1, dim);
  deflate(cov, pc1, lambda1, dim);
  const pc2 = powerIteration(cov, dim);
  return centered.map((row) => ({
    x: dot(row, pc1),
    y: dot(row, pc2)
  }));
}
function project2DFromPoints(points) {
  const withVec = points.filter(
    (p) => Array.isArray(p.vector)
  );
  const coords = project2D(withVec.map((p) => p.vector));
  return withVec.map((p, i) => ({
    id: p.id,
    x: coords[i]?.x ?? 0,
    y: coords[i]?.y ?? 0,
    payload: p.payload
  }));
}

// src/catalog.ts
var VECTORDB_INTEGRATIONS = [
  { id: "qdrant", name: "Qdrant", category: "vectordb", configFields: ["url", "apiKey"], status: "available" },
  { id: "lancedb", name: "LanceDB", category: "vectordb", configFields: ["url"], status: "available" },
  { id: "chroma", name: "Chroma", category: "vectordb", configFields: ["url", "apiKey"], status: "planned" },
  { id: "pgvector", name: "pgvector", category: "vectordb", configFields: ["url"], status: "planned" },
  { id: "weaviate", name: "Weaviate", category: "vectordb", configFields: ["url", "apiKey"], status: "planned" },
  { id: "milvus", name: "Milvus", category: "vectordb", configFields: ["url", "apiKey"], status: "planned" }
];
export {
  VECTORDB_INTEGRATIONS,
  createInspector,
  lancedbInspector,
  project2D,
  project2DFromPoints,
  qdrantInspector,
  unsupportedInspector
};
