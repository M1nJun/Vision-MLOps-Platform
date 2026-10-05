/**
 * Seeded randomness, so a demo is the same demo every time it is opened.
 *
 * Everything the simulator invents - how many defects a PC found on a given day, which
 * cell they were on, what the picture looks like - is derived from a string seed. The
 * same PC, day and station always produce the same crops, which is what lets a second
 * fetch over the same day "overwrite" files instead of inventing new ones.
 */

/** FNV-1a: a small, well-spread 32-bit string hash. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 - fast, and plenty for pictures and counts. */
export function rng(seed: number | string): () => number {
  let a = typeof seed === "string" ? hash(seed) : seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length) % items.length];
}

export function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}
