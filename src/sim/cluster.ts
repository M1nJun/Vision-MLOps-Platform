/**
 * Clustering within each DL class.
 *
 * The inspection engine has already sorted every NG crop into a class (SCRATCH, DENT,
 * ...). Inside one class the crops still differ - a long scratch, a dashed one, a smear
 * - and those sub-types are usually not equally likely to be real defects. Grouping
 * them lets a reviewer see each kind of call together instead of in fetch order.
 *
 *   1. Embed    every SourceMap with a pretrained CNN (MobileNet v2, ImageNet weights,
 *               penultimate layer, 1280-d), run in the browser with TensorFlow.js.
 *   2. Reduce   L2-normalise, then PCA to at most 12 dimensions.
 *   3. Cluster  k-means++ for k = 2..4 within each (vision, class) group, keeping the k
 *               with the best mean silhouette score.
 *
 * If the model cannot be downloaded, step 1 falls back to handcrafted features
 * (a downsampled grey image plus a gradient-orientation histogram) so the demo still
 * runs; the result records which embedder produced it.
 */
import type { Occurrence } from "./collect";
import { sourceCanvas } from "./images";
import { rng } from "./rng";

export type ClusterPhase = "loading" | "embedding" | "clustering";

export interface ClusterGroup {
  /** "<vision>|<class>" */
  key: string;
  k: number;
  silhouette: number;
  /** Crop count per cluster, largest first. */
  sizes: number[];
  /** The crop closest to each cluster's centre - its representative. */
  medoids: string[];
}

export interface ClusterResult {
  method: string;
  /** occurrence id -> cluster index within its group (0 = largest). */
  assign: Record<string, number>;
  groups: Record<string, ClusterGroup>;
  ms: number;
}

type Progress = (phase: ClusterPhase, done: number, total: number, method: string) => void;

const MAX_K = 4;
const PCA_DIMS = 12;
/** Groups smaller than this are left as one cluster - too few to split meaningfully. */
const MIN_GROUP = 6;

/* ===================== embedders ===================== */

interface Embedder {
  name: string;
  embed: (c: HTMLCanvasElement) => Promise<Float32Array>;
}

let embedderPromise: Promise<Embedder> | null = null;

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function loadMobileNet(): Promise<Embedder> {
  // Loaded on demand: TensorFlow.js is the heaviest thing on the page and nothing else
  // needs it, so it stays out of the initial bundle.
  const tf = await import("@tensorflow/tfjs");
  const mobilenet = await import("@tensorflow-models/mobilenet");
  await tf.ready();
  const model = await mobilenet.load({ version: 2, alpha: 1.0 });
  return {
    name: "MobileNet v2",
    embed: async (c) => {
      // infer(..., true) returns the penultimate activation - the embedding - rather
      // than ImageNet class scores, which mean nothing for an electrode.
      const t = tf.tidy(() => model.infer(c, true));
      const data = (await t.data()) as Float32Array;
      t.dispose();
      return Float32Array.from(data);
    },
  };
}

const handcrafted: Embedder = {
  name: "Handcrafted (fallback)",
  embed: async (c) => {
    const w = 40;
    const h = 30;
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const ctx = small.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 765;
    const hist = new Float32Array(16);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx = g[y * w + x + 1] - g[y * w + x - 1];
        const gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
        const bin = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 16) % 16;
        hist[bin] += Math.hypot(gx, gy) * 4;
      }
    }
    const out = new Float32Array(g.length + hist.length);
    out.set(g);
    out.set(hist, g.length);
    return out;
  },
};

function getEmbedder(): Promise<Embedder> {
  embedderPromise ??= timeout(loadMobileNet(), 30_000).catch((e) => {
    console.warn("MobileNet unavailable, using handcrafted features:", e);
    return handcrafted;
  });
  return embedderPromise;
}

/* ===================== linear algebra ===================== */

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/**
 * PCA through the n x n Gram matrix - n (crops in a group) is far smaller than the
 * embedding width, so this is the cheap side. Top components by power iteration with
 * deflation; each crop's coordinates are eigenvector * sqrt(eigenvalue).
 */
function pca(X: Float32Array[], dims: number): number[][] {
  const n = X.length;
  const d = X[0].length;
  const mean = new Float64Array(d);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  const C = X.map((x) => Float64Array.from(x, (v, j) => v - mean[j]));
  const G: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += C[a][j] * C[b][j];
      G[a][b] = G[b][a] = s;
    }
  }
  const r = rng("pca");
  const coords: number[][] = Array.from({ length: n }, () => []);
  const m = Math.min(dims, n - 1);
  for (let c = 0; c < m; c++) {
    let v = Array.from({ length: n }, () => r() - 0.5);
    let lambda = 0;
    for (let it = 0; it < 60; it++) {
      const w = G.map((row) => row.reduce((s, g, i) => s + g * v[i], 0));
      lambda = Math.hypot(...w);
      if (lambda < 1e-9) break;
      v = w.map((x) => x / lambda);
    }
    if (lambda < 1e-9) break;
    const sl = Math.sqrt(lambda);
    for (let i = 0; i < n; i++) coords[i].push(v[i] * sl);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) G[a][b] -= lambda * v[a] * v[b];
  }
  return coords;
}

const dist2 = (a: number[], b: number[]) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);

/** k-means with k-means++ seeding; several seeded restarts, lowest inertia wins. */
function kmeans(P: number[][], k: number, seed: string): { labels: number[]; centers: number[][] } {
  let best: { labels: number[]; centers: number[][]; inertia: number } | null = null;
  for (let restart = 0; restart < 6; restart++) {
    const r = rng(`${seed}|${k}|${restart}`);
    const centers: number[][] = [P[Math.floor(r() * P.length)]];
    while (centers.length < k) {
      const d = P.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
      const total = d.reduce((s, x) => s + x, 0);
      let t = r() * total;
      let i = 0;
      while (i < d.length - 1 && (t -= d[i]) > 0) i++;
      centers.push(P[i]);
    }
    let labels = new Array(P.length).fill(0);
    for (let it = 0; it < 50; it++) {
      const next = P.map((p) => {
        let bi = 0;
        let bd = Infinity;
        centers.forEach((c, ci) => {
          const dd = dist2(p, c);
          if (dd < bd) [bd, bi] = [dd, ci];
        });
        return bi;
      });
      const changed = next.some((l, i) => l !== labels[i]);
      labels = next;
      for (let c = 0; c < k; c++) {
        const mem = P.filter((_, i) => labels[i] === c);
        if (mem.length) centers[c] = mem[0].map((_, j) => mem.reduce((s, p) => s + p[j], 0) / mem.length);
      }
      if (!changed) break;
    }
    const inertia = P.reduce((s, p, i) => s + dist2(p, centers[labels[i]]), 0);
    if (!best || inertia < best.inertia) best = { labels, centers: centers.map((c) => [...c]), inertia };
  }
  return best!;
}

/** Mean silhouette: how much closer each crop is to its own cluster than the next. */
function silhouette(P: number[][], labels: number[], k: number): number {
  const D = P.map((p) => P.map((q) => Math.sqrt(dist2(p, q))));
  let total = 0;
  for (let i = 0; i < P.length; i++) {
    const mean = (c: number) => {
      const idx = labels.map((l, j) => (l === c && j !== i ? j : -1)).filter((j) => j >= 0);
      return idx.length ? idx.reduce((s, j) => s + D[i][j], 0) / idx.length : 0;
    };
    const a = mean(labels[i]);
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== labels[i]) b = Math.min(b, mean(c));
    total += b === Infinity || Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
  }
  return total / P.length;
}

/* ===================== the job ===================== */

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function clusterOccurrences(occs: Occurrence[], onProgress: Progress): Promise<ClusterResult> {
  const t0 = performance.now();
  onProgress("loading", 0, occs.length, "MobileNet v2");
  const embedder = await getEmbedder();

  // 1. Embed every crop. Yielding every few images keeps the page responsive.
  const emb = new Map<string, Float32Array>();
  for (let i = 0; i < occs.length; i++) {
    emb.set(occs[i].id, normalize(await embedder.embed(sourceCanvas(occs[i]))));
    if (i % 6 === 5 || i === occs.length - 1) {
      onProgress("embedding", i + 1, occs.length, embedder.name);
      await tick();
    }
  }

  // 2-3. Within each (vision, class) group: PCA, then k-means with k by silhouette.
  const byGroup = new Map<string, Occurrence[]>();
  for (const o of occs) {
    const key = `${o.vision}|${o.classFolder}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), o]);
  }

  const assign: Record<string, number> = {};
  const groups: Record<string, ClusterGroup> = {};
  let g = 0;
  for (const [key, members] of byGroup) {
    onProgress("clustering", g++, byGroup.size, embedder.name);
    await tick();

    if (members.length < MIN_GROUP) {
      members.forEach((o) => (assign[o.id] = 0));
      groups[key] = { key, k: 1, silhouette: 0, sizes: [members.length], medoids: [members[0].id] };
      continue;
    }

    const P = pca(members.map((o) => emb.get(o.id)!), PCA_DIMS);
    let best = { k: 2, score: -Infinity, labels: [] as number[], centers: [] as number[][] };
    for (let k = 2; k <= Math.min(MAX_K, Math.floor(members.length / 3)); k++) {
      const { labels, centers } = kmeans(P, k, key);
      const score = silhouette(P, labels, k);
      if (score > best.score) best = { k, score, labels, centers };
    }

    // Renumber so cluster 0 is the largest - the order a reviewer would want them in.
    const sizes = Array.from({ length: best.k }, (_, c) => best.labels.filter((l) => l === c).length);
    const order = sizes.map((s, c) => [s, c]).sort((a, b) => b[0] - a[0]).map(([, c]) => c);
    const rank = new Map(order.map((c, i) => [c, i]));
    const medoids = order.map((c) => {
      let bi = -1;
      let bd = Infinity;
      P.forEach((p, i) => {
        if (best.labels[i] !== c) return;
        const d = dist2(p, best.centers[c]);
        if (d < bd) [bd, bi] = [d, i];
      });
      return members[bi].id;
    });
    members.forEach((o, i) => (assign[o.id] = rank.get(best.labels[i])!));
    groups[key] = { key, k: best.k, silhouette: best.score, sizes: order.map((c) => sizes[c]), medoids };
  }
  onProgress("clustering", byGroup.size, byGroup.size, embedder.name);

  return { method: embedder.name, assign, groups, ms: performance.now() - t0 };
}
