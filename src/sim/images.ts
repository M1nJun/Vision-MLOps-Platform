/**
 * Synthetic inspection images.
 *
 * No real production image leaves the plant, so every picture in this demo is drawn
 * here: a grey material texture in the model's own geometry, with the defect its DL
 * class names painted on top. Each class has two to four visual sub-types (a long
 * scratch, a dashed one, a smear...), so the clustering step has real structure to
 * find. An overkill is drawn faint - often just texture the engine over-read - so the
 * review is a genuine visual call rather than reading a label.
 *
 * The pair image is an ActiveMap (a heat map of where the network looked) or a binary
 * defect mask, depending on the model.
 */
import type { Occurrence } from "./collect";
import { STATION_BY_ID } from "./fleet";
import { rng } from "./rng";

const W = 400;
const H = 300;

interface Spot {
  x: number;
  y: number;
  size: number;
  angle: number;
}

const urlCache = new Map<string, string>();

export function imageFor(o: Occurrence, kind: "source" | "pair"): string {
  const key = `${o.id}|${kind}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = kind === "source" ? sourceCanvas(o).toDataURL("image/jpeg", 0.86) : drawPair(o);
  urlCache.set(key, url);
  return url;
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/* ===================== base textures ===================== */

function grain(ctx: CanvasRenderingContext2D, r: () => number, amount: number) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function streaks(ctx: CanvasRenderingContext2D, r: () => number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * W;
    ctx.strokeStyle = `rgba(${r() > 0.5 ? "255,255,255" : "0,0,0"},${alpha * r()})`;
    ctx.lineWidth = 0.5 + r() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (r() - 0.5) * 6, H);
    ctx.stroke();
  }
}

function base(o: Occurrence, ctx: CanvasRenderingContext2D, r: () => number) {
  const style = STATION_BY_ID[o.station].imageStyle;
  const tone = [62, 88, 72, 96][Number(o.vision.slice(-1)) - 1] ?? 80;

  if (style === "electrode") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `rgb(${tone + 8},${tone + 8},${tone + 10})`);
    g.addColorStop(1, `rgb(${tone - 6},${tone - 6},${tone - 4})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    streaks(ctx, r, 60, 0.12);
    grain(ctx, r, 26);
    return;
  }

  // Dark field for the cell-geometry models.
  ctx.fillStyle = "#16181c";
  ctx.fillRect(0, 0, W, H);

  if (style === "lead" || style === "tab") {
    // A metal tab rising out of the cell body.
    ctx.fillStyle = `rgb(${tone + 20},${tone + 20},${tone + 24})`;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    const tw = style === "tab" ? 120 : 150;
    const tg = ctx.createLinearGradient(W / 2 - tw / 2, 0, W / 2 + tw / 2, 0);
    tg.addColorStop(0, "#8d9096");
    tg.addColorStop(0.5, "#c9ccd2");
    tg.addColorStop(1, "#8a8d92");
    ctx.fillStyle = tg;
    ctx.fillRect(W / 2 - tw / 2, 24, tw, H * 0.62 - 24);
    if (style === "lead") {
      ctx.fillStyle = "#c9b98a";
      ctx.fillRect(W / 2 - tw / 2 - 6, H * 0.46, tw + 12, 22);
    }
  } else if (style === "gap") {
    // Two electrode layers with a separator gap between them.
    ctx.fillStyle = `rgb(${tone + 30},${tone + 30},${tone + 32})`;
    ctx.fillRect(0, 40, W, 90);
    ctx.fillRect(0, 170, W, 90);
    ctx.fillStyle = "#e7e3d6";
    ctx.fillRect(0, 130, W, 40);
  } else {
    // Film, lit from the side.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#c8c4b8");
    g.addColorStop(1, "#9a978d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  streaks(ctx, r, 30, 0.08);
  grain(ctx, r, 20);
}

/* ===================== defects ===================== */

/**
 * The defect sits near the middle of the crop - the engine crops around what it
 * flagged - except where the geometry fixes it: on the gap line, or a tab edge.
 */
function spotFor(o: Occurrence, r: () => number): Spot {
  const style = STATION_BY_ID[o.station].imageStyle;
  let x = W / 2 + (r() - 0.5) * 60;
  let y = H / 2 + (r() - 0.5) * 50;
  if (style === "gap") y = o.classFolder.startsWith("LOWER") ? 168 : 132;
  if (style === "lead" || style === "tab") {
    x = o.classFolder.endsWith("_L") || o.region === "LEFT" ? W / 2 - 66 : W / 2 + 66;
    y = 70 + r() * 90;
  }
  return { x, y, size: 0.85 + r() * 0.3, angle: (r() - 0.5) * 0.5 };
}

type Prim = "line" | "dashes" | "smear" | "zigzag" | "blob" | "ring" | "particles" | "waves" | "notch" | "spikes";

/** The sub-types each family of class can show, in variant order. */
function primsFor(o: Occurrence): Prim[] {
  const style = STATION_BY_ID[o.station].imageStyle;
  const c = o.classFolder;
  if (style === "gap") return ["blob", "waves", "particles", "notch"];
  if (style === "lead") return ["notch", "spikes", "blob", "smear"];
  if (c.includes("SCRATCH")) return ["line", "dashes", "smear", "zigzag"];
  if (c.includes("CRACK") || c.includes("TEAR")) return ["zigzag", "line", "dashes", "smear"];
  if (c.includes("DENT") || c.includes("PINHOLE")) return ["blob", "ring", "particles", "smear"];
  if (c.includes("FOREIGN") || c.includes("BURR")) return ["blob", "particles", "line", "spikes"];
  return ["waves", "line", "smear", "zigzag"];
}

function drawDefect(o: Occurrence, ctx: CanvasRenderingContext2D, r: () => number, s: Spot) {
  const real = o.truth === "RealNG";
  // An overkill is a much fainter version of the same look - often just texture.
  const a = real ? 1 : 0.38;
  const z = s.size * (real ? 1 : 0.75);
  const bright = o.classFolder.includes("SCRATCH") || o.classFolder.includes("BURR");
  const ink = (alpha: number) => (bright ? `rgba(240,240,244,${alpha * a})` : `rgba(8,8,10,${alpha * a})`);
  const prim = primsFor(o)[o.variant % 4];

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  ctx.lineCap = "round";

  switch (prim) {
    case "line": {
      ctx.strokeStyle = ink(0.9);
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.moveTo(-95 * z, -6);
      ctx.lineTo(95 * z, 6);
      ctx.stroke();
      break;
    }
    case "dashes": {
      ctx.strokeStyle = ink(0.9);
      ctx.lineWidth = 3.5 * z;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 26 * z - 8, i * 3);
        ctx.lineTo(i * 26 * z + 8, i * 3 + 2);
        ctx.stroke();
      }
      break;
    }
    case "smear": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70 * z);
      g.addColorStop(0, ink(0.55));
      g.addColorStop(1, ink(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, 90 * z, 34 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "zigzag": {
      ctx.strokeStyle = ink(0.95);
      ctx.lineWidth = 2.6 * z;
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) ctx.lineTo(-80 * z + i * 16 * z, i % 2 ? -14 * z : 14 * z);
      ctx.stroke();
      break;
    }
    case "blob": {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34 * z);
      g.addColorStop(0, ink(0.95));
      g.addColorStop(0.75, ink(0.6));
      g.addColorStop(1, ink(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, 34 * z, 26 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ring": {
      ctx.strokeStyle = ink(0.9);
      ctx.lineWidth = 6 * z;
      ctx.beginPath();
      ctx.arc(0, 0, 36 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 28 * z, Math.PI * 1.05, Math.PI * 1.7);
      ctx.stroke();
      break;
    }
    case "particles": {
      ctx.fillStyle = ink(0.95);
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc((r() - 0.5) * 120 * z, (r() - 0.5) * 80 * z, (3 + r() * 4) * z, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "waves": {
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = k % 2 ? ink(0.7) : `rgba(255,255,255,${0.45 * a})`;
        ctx.lineWidth = 4 * z;
        ctx.beginPath();
        for (let t = -130; t <= 130; t += 6) ctx.lineTo(t, (k - 1.5) * 14 * z + Math.sin(t / 16) * 9 * z);
        ctx.stroke();
      }
      break;
    }
    case "notch": {
      ctx.fillStyle = ink(1);
      ctx.beginPath();
      ctx.moveTo(-16 * z, -26 * z);
      ctx.lineTo(18 * z, 0);
      ctx.lineTo(-16 * z, 26 * z);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "spikes": {
      ctx.strokeStyle = bright ? `rgba(240,240,244,${a})` : ink(1);
      ctx.lineWidth = 2.4 * z;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 10 * z, 20 * z);
        ctx.lineTo(i * 10 * z + 4, -26 * z);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/* ===================== the two images ===================== */

/** The SourceMap as a canvas - the clustering reads its pixels directly. */
export function sourceCanvas(o: Occurrence): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const r = rng(o.seed);
  base(o, ctx, r);
  drawDefect(o, ctx, rng(o.seed ^ 0x2f), spotFor(o, rng(o.seed ^ 0x51ed)));
  return c;
}

/** Jet-like ramp for the activation map. */
function heat(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return [r * 255, g * 255, b * 255];
}

function drawPair(o: Occurrence): string {
  const [c, ctx] = canvas();
  const s = spotFor(o, rng(o.seed ^ 0x51ed));
  const pair = STATION_BY_ID[o.station].pairLabel;
  const real = o.truth === "RealNG";

  if (pair === "Mask") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.beginPath();
    const k = (real ? 1 : 0.5) * s.size;
    ctx.ellipse(0, 0, 40 * k, 22 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return c.toDataURL("image/png");
  }

  // ActiveMap: where the network's attention fell, on the crop's own frame.
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const r = rng(o.seed ^ 0xa11);
  // A second, weaker hot spot: overkills tend to show attention that is diffuse or
  // split, which is part of what a reviewer learns to read.
  const s2 = { x: r() * W, y: r() * H };
  const spread = real ? 26 : 44;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d1 = ((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * spread * spread);
      const d2 = ((x - s2.x) ** 2 + (y - s2.y) ** 2) / (2 * 50 * 50);
      const v = Math.exp(-d1) * (real ? 1 : 0.62) + Math.exp(-d2) * (real ? 0.18 : 0.42);
      const [R, G, B] = heat(v * 0.95);
      const i = (y * W + x) * 4;
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = B;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.86);
}
