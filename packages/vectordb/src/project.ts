// @offgrid/vectordb — 2D projection (visualization)
//
// Pure-JS PCA to project high-dimensional embeddings down to 2D for
// scatter-plotting "what's inside" a vector store. No dependencies: we compute
// the covariance matrix and extract the top-2 principal components via power
// iteration with deflation. Deterministic and safe on degenerate inputs.

import type { VectorPoint } from './types.js';

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectedPoint extends Point2D {
  id: VectorPoint['id'];
  payload?: Record<string, unknown>;
}

/** Column-wise mean of a matrix. */
function columnMeans(rows: number[][], dim: number): number[] {
  const means = new Array<number>(dim).fill(0);
  for (const row of rows) {
    for (let j = 0; j < dim; j++) means[j] += row[j] ?? 0;
  }
  for (let j = 0; j < dim; j++) means[j] /= rows.length;
  return means;
}

/** Mean-centre the data in place-safe fashion (returns a new matrix). */
function center(rows: number[][], means: number[], dim: number): number[][] {
  return rows.map((row) => {
    const out = new Array<number>(dim);
    for (let j = 0; j < dim; j++) out[j] = (row[j] ?? 0) - means[j];
    return out;
  });
}

/** Covariance matrix (dim x dim) of already-centred data. */
function covariance(centered: number[][], dim: number): number[][] {
  const n = centered.length;
  const cov: number[][] = Array.from({ length: dim }, () =>
    new Array<number>(dim).fill(0),
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

function matVec(m: number[][], v: number[], dim: number): number[] {
  const out = new Array<number>(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    let s = 0;
    const mi = m[i];
    for (let j = 0; j < dim; j++) s += mi[j] * v[j];
    out[i] = s;
  }
  return out;
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Dominant eigenvector of a symmetric matrix via power iteration. */
function powerIteration(m: number[][], dim: number, iters = 100): number[] {
  // Seed deterministically (avoids a zero-projection start).
  let v = new Array<number>(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i + 1);
  let n = norm(v);
  if (n === 0) {
    v = new Array<number>(dim).fill(1);
    n = Math.sqrt(dim);
  }
  for (let i = 0; i < dim; i++) v[i] /= n;

  for (let it = 0; it < iters; it++) {
    const next = matVec(m, v, dim);
    const nn = norm(next);
    if (nn === 0) return v; // zero variance in this direction
    for (let i = 0; i < dim; i++) next[i] /= nn;
    v = next;
  }
  return v;
}

/** Rayleigh quotient — the eigenvalue for eigenvector v of matrix m. */
function eigenvalue(m: number[][], v: number[], dim: number): number {
  const mv = matVec(m, v, dim);
  let s = 0;
  for (let i = 0; i < dim; i++) s += v[i] * mv[i];
  return s;
}

/** Deflate matrix by removing the component along eigenvector v (eigenvalue λ). */
function deflate(m: number[][], v: number[], lambda: number, dim: number): void {
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      m[i][j] -= lambda * v[i] * v[j];
    }
  }
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Project N vectors to 2D via PCA (top-2 principal components).
 *
 * Edge cases:
 *  - 0 vectors → []
 *  - 1 vector  → [{x:0,y:0}]
 *  - dim < 2 or degenerate second component → falls back to using the
 *    raw first dimension / zero for the missing axis.
 */
export function project2D(vectors: number[][]): Point2D[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  const dim = vectors.reduce((mx, v) => Math.max(mx, v.length), 0);
  if (dim === 0) return vectors.map(() => ({ x: 0, y: 0 }));

  const means = columnMeans(vectors, dim);
  const centered = center(vectors, means, dim);

  if (dim === 1) {
    // Only one axis of information available.
    return centered.map((row) => ({ x: row[0] ?? 0, y: 0 }));
  }

  const cov = covariance(centered, dim);

  const pc1 = powerIteration(cov, dim);
  const lambda1 = eigenvalue(cov, pc1, dim);
  deflate(cov, pc1, lambda1, dim);
  const pc2 = powerIteration(cov, dim);

  return centered.map((row) => ({
    x: dot(row, pc1),
    y: dot(row, pc2),
  }));
}

/**
 * Project VectorPoints (pulling `.vector`) and re-attach id + payload.
 * Points without a vector are skipped.
 */
export function project2DFromPoints(points: VectorPoint[]): ProjectedPoint[] {
  const withVec = points.filter(
    (p): p is VectorPoint & { vector: number[] } => Array.isArray(p.vector),
  );
  const coords = project2D(withVec.map((p) => p.vector));
  return withVec.map((p, i) => ({
    id: p.id,
    x: coords[i]?.x ?? 0,
    y: coords[i]?.y ?? 0,
    payload: p.payload,
  }));
}
