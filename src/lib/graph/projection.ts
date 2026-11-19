/**
 * File: src/lib/graph/projection.ts
 * Description: deterministic 2-D projection used by the Thought Constellation — principal component analysis by power iteration
 *   (no randomness, no dependency: the same vectors always give the same map), overlap spreading and a deterministic k-means for
 *   the cluster level of the semantic zoom. Pure functions, unit-tested in tests/unit/next-k-logic.test.ts.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
export interface Projection { coords: [number, number][]; /** share of the variance carried by each axis (0…1) */ explained: [number, number] }

const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const normalise = (v: Float64Array) => { const n = Math.sqrt(dot(v, v)); if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n; return n; };

/**
 * PCA to two dimensions. Vectors are centred, the two leading axes are found by power iteration on XᵀX (start vector fixed, second
 * axis kept orthogonal to the first), the sign of each axis is fixed (its largest loading is positive) and the coordinates are scaled
 * together so the largest absolute value is 1 (the aspect ratio of the cloud is kept).
 */
export function pca2(vectors: ArrayLike<number>[], iterations = 60): Projection {
  const n = vectors.length; if (!n) return { coords: [], explained: [0, 0] };
  const d = vectors[0].length; if (n === 1 || !d) return { coords: vectors.map(() => [0, 0] as [number, number]), explained: [0, 0] };
  const mean = new Float64Array(d); for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const X = vectors.map((v) => { const r = new Float64Array(d); for (let j = 0; j < d; j++) r[j] = v[j] - mean[j]; return r; });
  let total = 0; for (const r of X) total += dot(r, r);
  if (total < 1e-18) return { coords: vectors.map(() => [0, 0] as [number, number]), explained: [0, 0] };
  const axis = (ortho: Float64Array | null, seed: number): { v: Float64Array; lambda: number } => {
    const v = new Float64Array(d); for (let j = 0; j < d; j++) v[j] = Math.sin((j + 1) * seed) + 0.5 * Math.cos((j + 1) * 0.37 * seed);
    const clean = () => { if (ortho) { const k = dot(v, ortho); for (let j = 0; j < d; j++) v[j] -= k * ortho[j]; } };
    clean(); normalise(v); let lambda = 0; const w = new Float64Array(d);
    for (let it = 0; it < iterations; it++) {
      w.fill(0); for (const r of X) { const s = dot(r, v); if (s !== 0) for (let j = 0; j < d; j++) w[j] += s * r[j]; }
      v.set(w); clean(); const norm = normalise(v); const prev = lambda; lambda = norm;
      if (norm < 1e-18) { lambda = 0; break; } if (it > 4 && Math.abs(lambda - prev) <= 1e-10 * lambda) break;
    }
    let big = 0; for (let j = 1; j < d; j++) if (Math.abs(v[j]) > Math.abs(v[big]) + 1e-15) big = j; if (v[big] < 0) for (let j = 0; j < d; j++) v[j] = -v[j];
    return { v, lambda };
  };
  const a = axis(null, 1.3); const b = axis(a.v, 2.1);
  const raw = X.map((r) => [dot(r, a.v), b.lambda > 0 ? dot(r, b.v) : 0] as [number, number]);
  let max = 0; for (const [x, y] of raw) max = Math.max(max, Math.abs(x), Math.abs(y)); const k = max > 0 ? 1 / max : 1;
  return { coords: raw.map(([x, y]) => [round(x * k), round(y * k)]), explained: [round(a.lambda / total), round(b.lambda / total)] };
}
const round = (x: number) => Math.round(x * 1e5) / 1e5 || 0;

/**
 * Points that fall on (almost) the same spot — identical or near-identical notes — are fanned out on a small golden-angle spiral
 * around that spot, in input order, so every star stays reachable. Points that are alone are not moved.
 */
export function spreadOverlaps(coords: [number, number][], minDist = 0.012): [number, number][] {
  const cell = (x: number, y: number) => `${Math.round(x / minDist)}:${Math.round(y / minDist)}`; const seen = new Map<string, number>();
  return coords.map(([x, y]) => { const key = cell(x, y); const i = seen.get(key) ?? 0; seen.set(key, i + 1); if (!i) return [x, y]; const r = minDist * 0.9 * Math.sqrt(i); const t = i * 2.399963229728653; return [round(x + r * Math.cos(t)), round(y + r * Math.sin(t))]; });
}

export interface Cluster2D { /** index of the cluster of each point */ assign: number[]; centers: [number, number][]; sizes: number[]; /** distance from the centre to its farthest member */ radii: number[] }
/** Number of clusters shown at the far zoom level: about √(n/2), between 1 and 18. */
export const clusterCount = (n: number) => (n <= 2 ? Math.min(n, 1) : Math.max(1, Math.min(18, Math.round(Math.sqrt(n / 2)))));
/**
 * Deterministic k-means in the plane: farthest-point initialisation starting from the point closest to the centroid, then Lloyd
 * iterations until nothing moves (at most `iterations`). Empty clusters are dropped; ties go to the lowest index.
 */
export function kmeans2d(coords: [number, number][], k: number, iterations = 30): Cluster2D {
  const n = coords.length; if (!n || k < 1) return { assign: [], centers: [], sizes: [], radii: [] }; k = Math.min(k, n);
  const d2 = (p: [number, number], q: [number, number]) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  const c0: [number, number] = [coords.reduce((s, p) => s + p[0], 0) / n, coords.reduce((s, p) => s + p[1], 0) / n];
  let first = 0; for (let i = 1; i < n; i++) if (d2(coords[i], c0) < d2(coords[first], c0) - 1e-15) first = i;
  const centers: [number, number][] = [[...coords[first]] as [number, number]]; const near = coords.map((p) => d2(p, centers[0]));
  while (centers.length < k) { let far = 0; for (let i = 1; i < n; i++) if (near[i] > near[far] + 1e-15) far = i; if (near[far] <= 1e-15) break; centers.push([...coords[far]] as [number, number]); for (let i = 0; i < n; i++) near[i] = Math.min(near[i], d2(coords[i], centers[centers.length - 1])); }
  let assign = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    const next = coords.map((p) => { let best = 0; for (let c = 1; c < centers.length; c++) if (d2(p, centers[c]) < d2(p, centers[best]) - 1e-15) best = c; return best; });
    const moved = it === 0 || next.some((a, i) => a !== assign[i]); assign = next; if (!moved) break;
    const sum = centers.map(() => [0, 0, 0]); assign.forEach((a, i) => { sum[a][0] += coords[i][0]; sum[a][1] += coords[i][1]; sum[a][2]++; });
    sum.forEach((s, c) => { if (s[2]) centers[c] = [s[0] / s[2], s[1] / s[2]]; });
  }
  // drop empty clusters and renumber by first appearance (stable ids for a given input)
  const order: number[] = []; for (const a of assign) if (!order.includes(a)) order.push(a);
  const map = new Map(order.map((c, i) => [c, i])); const out = assign.map((a) => map.get(a)!); const cs = order.map((c) => [round(centers[c][0]), round(centers[c][1])] as [number, number]);
  const sizes = cs.map(() => 0); const radii = cs.map(() => 0); out.forEach((a, i) => { sizes[a]++; radii[a] = Math.max(radii[a], Math.sqrt(d2(coords[i], cs[a]))); });
  return { assign: out, centers: cs, sizes, radii: radii.map(round) };
}
