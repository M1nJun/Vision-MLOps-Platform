/**
 * What a fetch finds: the NG crops each vision PC wrote for a DL model on a given day.
 *
 * This stands in for the SMB crawl the desktop fetcher did - resolve the day's product
 * from the result CSV's file name, find the crop folders under that product, scan the
 * DL class folders (skipping the OK ones), and copy each SourceMap with its paired
 * ActiveMap or mask into <out>\<VISION>\<class>\.
 */
import {
  CSV_ROOT,
  DATASET_ROOT,
  IMAGE_ROOT,
  PCS,
  PRODUCTS,
  STATION_BY_ID,
  reviewRoot,
  visionShort,
  type Pc,
  type Station,
  type Vision,
} from "./fleet";
import { hash, int, pick, rng } from "./rng";

export type Label = "RealNG" | "Overkill";

export interface Occurrence {
  id: string;
  station: string;
  pcKey: string;
  date: string;
  vision: Vision;
  classFolder: string;
  cellKey: string;
  region: string;
  fileName: string;
  hasPair: boolean;
  seed: number;
  /** Which of the class's visual sub-types this crop was drawn as. Ground truth only:
   *  the clustering never reads it - it has to find the groups from the pixels. */
  variant: number;
  /** What a reviewer would conclude - the simulator's ground truth. It decides how
   *  visible the defect in the picture is, and nothing on screen reads it directly. */
  truth: Label;
}

/** How often the DL engine's NG call turns out to be overkill, per class. A model
 *  with a high value here is the one most in need of the next retraining cycle. */
const OVERKILL_RATE: Record<string, number> = {
  "02_SCRATCH": 0.62,
  "03_DENT": 0.35,
  "04_FOREIGN_MATERIAL": 0.28,
  "05_PINHOLE": 0.18,
  "06_COATING_EDGE": 0.45,
  "07_FOLD": 0.3,
  "08_CRACK": 0.12,
  BOTH_DL: 0.55,
};

export function overkillRate(cls: string): number {
  return OVERKILL_RATE[cls] ?? 0.33;
}

/** How many visually distinct sub-types a class has: 2 or 3, fixed per class. The
 *  clustering is not told this - it searches k = 2..4 and picks by silhouette. */
export function variantCount(station: string, cls: string): number {
  return 2 + (hash(`${station}|${cls}|variants`) % 2);
}

/**
 * Overkill share per sub-type. Sub-types are not equally trustworthy - one look is
 * nearly always a real defect, another nearly always a harmless mark the engine
 * over-read - which is exactly what makes grouping by appearance useful in review.
 */
function variantOverkill(v: number, n: number, cls: string): number {
  if (v === 0) return 0.12;
  if (v === n - 1) return 0.82;
  return overkillRate(cls);
}

export function productFor(pc: Pc, day: string): string {
  return PRODUCTS[hash(pc.line + day) % PRODUCTS.length];
}

function cellId(r: () => number, day: string): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const yy = day.slice(3, 4);
  return `X${yy}${pick(r, [...letters])}${pick(r, [...letters])}${String(int(r, 0, 99999)).padStart(5, "0")}`;
}

/** The NG crops one PC produced for one model on one day. Deterministic. */
export function occurrencesFor(station: Station, pc: Pc, day: string): Occurrence[] {
  const r = rng(`${station.id}|${pc.key}|${day}`);
  const n = Math.round(station.volume * int(r, 6, 14));
  const product = productFor(pc, day);
  const out: Occurrence[] = [];
  const lineCode = pc.line.replace("Line ", "L");
  const vis = visionShort(pc.vision);

  for (let i = 0; i < n; i++) {
    // Classes are not equally likely: the first one or two take most of the volume,
    // which is what an engine with a loose threshold on one class looks like.
    const w = r();
    const ci = Math.min(station.classes.length - 1, Math.floor(w * w * station.classes.length * 1.15));
    const classFolder = station.classes[ci];
    const region = pick(r, station.regions);
    const cellKey = cellId(r, day);
    const hh = String(int(r, 6, 21)).padStart(2, "0");
    const mm = String(int(r, 0, 59)).padStart(2, "0");
    const ss = String(int(r, 0, 59)).padStart(2, "0");
    const seed = hash(`${station.id}|${pc.key}|${day}|${i}`);
    const nv = variantCount(station.id, classFolder);
    const variant = Math.floor(r() * nv);
    const truth: Label = rng(seed ^ 0x9e3779b9)() < variantOverkill(variant, nv, classFolder) ? "Overkill" : "RealNG";
    const fileName = `${cellKey}_${lineCode}_${vis}_${hh}${mm}${ss}_${region}_${product}_SourceMap.jpg`;
    out.push({
      id: `${station.id}|${pc.key}|${day}|${i}`,
      station: station.id,
      pcKey: pc.key,
      date: day,
      vision: pc.vision,
      classFolder,
      cellKey,
      region,
      fileName,
      // A handful of SourceMaps arrive without their pair, as on the real share.
      hasPair: station.pairLabel !== null && r() > 0.06,
      seed,
      variant,
      truth,
    });
  }
  return out;
}

/* ===================== dates ===================== */

export type DateMode = "single" | "range" | "specific";

export interface DateSelection {
  mode: DateMode;
  single: string;
  start: string;
  end: string;
  specific: string[];
}

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}

/** Range input is capped at a week - a month of one model is thousands of crops and
 *  nobody reviews that in one sitting. */
export const MAX_RANGE_DAYS = 7;

export function selectionDays(sel: DateSelection): string[] {
  if (sel.mode === "single") return sel.single ? [sel.single] : [];
  if (sel.mode === "specific") return [...new Set(sel.specific)].sort();
  if (!sel.start || !sel.end || sel.start > sel.end) return [];
  const out: string[] = [];
  for (let d = sel.start; d <= sel.end && out.length < MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Same default the desktop tool used: <model root>\<first day>, or <first>_<last>. */
export function suggestOutDir(station: Station, days: string[]): string {
  if (!days.length) return reviewRoot(station);
  const a = days[0].replaceAll("-", "");
  const b = days[days.length - 1].replaceAll("-", "");
  return `${reviewRoot(station)}\\${a === b ? a : `${a}_${b}`}`;
}

/* ===================== fetch plan ===================== */

export const DEFAULT_CSV_DIR = CSV_ROOT;

export interface FetchPlan {
  /** Pre-scan log lines, printed before copying starts. */
  scanLog: string[];
  occurrences: Occurrence[];
  /** Files on disk: a SourceMap plus its pair where there is one. */
  totalFiles: number;
}

export function planFetch(stationId: string, pcKeys: string[], days: string[], csvDir: string): FetchPlan {
  const station = STATION_BY_ID[stationId];
  const pcs = PCS.filter((p) => pcKeys.includes(p.key));
  const scanLog: string[] = [];
  const occurrences: Occurrence[] = [];

  scanLog.push(`[INFO] Remote fetch (${station.name}) PCs: ${pcs.length} | days: ${days.length} | product=auto-from-csv`);
  if (station.source === "crop-folders") scanLog.push("[INFO] Excluding class folders: 01_OK_*");

  for (const pc of pcs) {
    for (const day of days) {
      const product = productFor(pc, day);
      const ymd = day.replaceAll("-", "");
      scanLog.push(`[INFO] [${pc.key}] ${day}: product from CSV = ${product}  (\\\\${pc.ip}\\${csvDir}\\${product}_${ymd}.csv)`);
      const found = occurrencesFor(station, pc, day);
      if (station.source === "crop-folders") {
        const [y, m, d] = day.split("-");
        scanLog.push(`[OK] [${pc.key}] ${day} -> \\\\${pc.ip}\\${IMAGE_ROOT}\\${product}\\${y}\\${m}\\${d}\\Crop_${station.code}`);
      } else {
        const rows = 1400 + (hash(pc.key + day + "rows") % 900);
        scanLog.push(`[CSV] [${pc.key}] ${day}: ${rows.toLocaleString("en-US")} rows, ${found.length} target NG hits`);
      }
      occurrences.push(...found);
    }
  }

  const totalFiles = occurrences.reduce((n, o) => n + (o.hasPair ? 2 : 1), 0);
  scanLog.push(`[INFO] Total files to copy: ${totalFiles.toLocaleString("en-US")}`);
  return { scanLog, occurrences, totalFiles };
}

/* ===================== dataset ===================== */

/** Where a verdict copies a SourceMap: <dataset>\<MODEL>\<VISION>\<class>\<label>\. */
export function datasetDir(station: string, vision: string, cls: string, label: Label): string {
  return `${DATASET_ROOT}\\${STATION_BY_ID[station].code}\\${vision}\\${cls}\\${label}`;
}

export function datasetPath(o: Occurrence, label: Label): string {
  return `${datasetDir(o.station, o.vision, o.classFolder, label)}\\${o.fileName}`;
}
