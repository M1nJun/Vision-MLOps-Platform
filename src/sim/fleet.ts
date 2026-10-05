/**
 * The simulated plant: vision PCs, DL models and the model folders on each PC.
 *
 * Everything here is a placeholder. Lines, visions and models are numbered rather than
 * named, every address is from the RFC 5737 documentation ranges (192.0.2.0/24,
 * 198.51.100.0/24) - reserved precisely so examples never point at a real machine -
 * and every path that would describe a real PC's layout is written as <SOMETHING_ROOT>.
 */

export type Vision = "VISION_1" | "VISION_2" | "VISION_3" | "VISION_4";
export const VISIONS: Vision[] = ["VISION_1", "VISION_2", "VISION_3", "VISION_4"];
export const visionLabel = (v: Vision) => `Vision ${v.slice(-1)}`;
export const visionShort = (v: Vision) => `V${v.slice(-1)}`;

export interface Pc {
  /** Display key: "Line <n> · V<m>". */
  key: string;
  line: string;
  vision: Vision;
  ip: string;
}

const LINES = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`);

export const PCS: Pc[] = LINES.flatMap((line, i) => {
  const net = i < 4 ? "192.0.2" : "198.51.100";
  const base = 10 + (i % 4) * 20;
  return VISIONS.map((vision, v) => ({
    key: `${line} · V${v + 1}`,
    line,
    vision,
    ip: `${net}.${base + v + 1}`,
  }));
});

export const PC_BY_KEY: Record<string, Pc> = Object.fromEntries(PCS.map((p) => [p.key, p]));
export { LINES };

/** Placeholder product codes - the CSV file names carry one per day. */
export const PRODUCTS = ["PROD-A", "PROD-B"];

/** Placeholder share roots. The real ones describe a vision PC's disk layout. */
export const CSV_ROOT = "<CSV_ROOT>";
export const IMAGE_ROOT = "<IMAGE_ROOT>";
export const ENGINE_ROOT = "<ENGINE_ROOT>";
export const DATASET_ROOT = "D:\\DL_DATASET";

/* ===================== DL models ===================== */

export type ImageStyle = "electrode" | "lead" | "gap" | "separator" | "tab";

export interface Station {
  id: string;
  name: string;
  /** Folder-safe form of the name: MODEL_1. */
  code: string;
  /** How the fetcher finds its images - by crawling crop folders, or by reading the
   *  result CSV first and locating only the rows it cares about. */
  source: "crop-folders" | "csv-driven";
  /** DL class folders the engine sorts NG crops into. 01_OK_* are never fetched. */
  classes: string[];
  regions: string[];
  /** Second image shown beside the source: a DL activation map, or a defect mask. */
  pairLabel: "ActiveMap" | "Mask" | null;
  imageStyle: ImageStyle;
  /** Relative frequency of NG crops per PC-day. */
  volume: number;
}

const QUADRANTS = ["LOWER_L", "LOWER_R", "UPPER_L", "UPPER_R"];

export const STATIONS: Station[] = [
  {
    id: "model_1",
    name: "Model 1",
    code: "MODEL_1",
    source: "crop-folders",
    classes: ["02_SCRATCH", "03_DENT", "04_FOREIGN_MATERIAL"],
    regions: QUADRANTS,
    pairLabel: "ActiveMap",
    imageStyle: "electrode",
    volume: 1,
  },
  {
    id: "model_2",
    name: "Model 2",
    code: "MODEL_2",
    source: "crop-folders",
    classes: ["02_SCRATCH", "07_FOLD", "08_CRACK"],
    regions: QUADRANTS,
    pairLabel: "ActiveMap",
    imageStyle: "electrode",
    volume: 0.8,
  },
  {
    id: "model_3",
    name: "Model 3",
    code: "MODEL_3",
    source: "csv-driven",
    classes: ["DIM_L", "DIM_R", "EDGE_L"],
    regions: ["UPPER"],
    pairLabel: "Mask",
    imageStyle: "lead",
    volume: 0.45,
  },
  {
    id: "model_4",
    name: "Model 4",
    code: "MODEL_4",
    source: "csv-driven",
    classes: ["UPPER_DL", "LOWER_DL", "BOTH_DL"],
    regions: ["UPPER", "LOWER"],
    pairLabel: "Mask",
    imageStyle: "gap",
    volume: 0.5,
  },
  {
    id: "model_5",
    name: "Model 5",
    code: "MODEL_5",
    source: "csv-driven",
    classes: ["FOLD_DL", "TEAR_DL", "WRINKLE_DL"],
    regions: ["UPPER", "LOWER"],
    pairLabel: "Mask",
    imageStyle: "separator",
    volume: 0.4,
  },
  {
    id: "model_6",
    name: "Model 6",
    code: "MODEL_6",
    source: "csv-driven",
    classes: ["BURR", "FOLD", "CRACK"],
    regions: ["LEFT", "RIGHT"],
    pairLabel: null,
    imageStyle: "tab",
    volume: 0.35,
  },
];

export const STATION_BY_ID: Record<string, Station> = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** Where a fetch for this model lands by default. */
export function reviewRoot(st: Station): string {
  return `D:\\DL_REVIEW\\${st.code}`;
}

/* ===================== DL model folders ===================== */

/**
 * The model folders under each PC's DL engine directory. Lines 7 and 8 carry their
 * folder names in upper case - which is why the deployer compares them
 * case-insensitively when it builds the intersection of the selected PCs.
 */
export interface ModelFolder {
  name: string;
  /** The package last injected into this folder. */
  version: string;
  /** Backups already sitting under <folder>\DL_VERSION. */
  backups: string[];
}

export function initialModelFolders(pc: Pc): ModelFolder[] {
  const upper = pc.line === "Line 7" || pc.line === "Line 8";
  const name = (n: number) => (upper ? `MODEL_${n}` : `Model_${n}`);
  return [
    { name: name(1), version: "Model1_DL_2026-08-14_r1", backups: ["Model1_DL_2026-06-30_r2", "Model1_DL_2026-08-14_r1"] },
    { name: name(2), version: "Model2_DL_2026-08-02_r1", backups: ["Model2_DL_2026-08-02_r1"] },
    { name: name(3), version: "Model3_DL_2026-05-02_r1", backups: ["Model3_DL_2026-05-02_r1"] },
    { name: name(4), version: "Model4_DL_2026-07-22_r1", backups: ["Model4_DL_2026-07-22_r1"] },
  ];
}

/** Root of the DL engine on a vision PC, reached over SMB. */
export function remoteEngineRoot(ip: string): string {
  return `\\\\${ip}\\${ENGINE_ROOT}`;
}

/* ===================== model packages ===================== */

export interface ModelPackage {
  name: string;
  station: string;
  trainedOn: string;
  note: string;
  files: string[];
}

const PACKAGE_FILES = [
  "model.bin",
  "model.json",
  "classes.txt",
  "threshold.ini",
  "preprocess\\roi.json",
  "preprocess\\normalize.json",
  "report\\confusion_matrix.csv",
  "report\\val_metrics.json",
];

export const MODEL_PACKAGES: ModelPackage[] = [
  {
    name: "Model1_DL_2026-10-02_r3",
    station: "model_1",
    trainedOn: "2026-10-02",
    note: "Retrained with 1,240 reviewed crops; SCRATCH overkill down 38%",
    files: PACKAGE_FILES,
  },
  {
    name: "Model2_DL_2026-09-26_r2",
    station: "model_2",
    trainedOn: "2026-09-26",
    note: "Adds 08_CRACK class from September review set",
    files: PACKAGE_FILES,
  },
  {
    name: "Model4_DL_2026-09-30_r1",
    station: "model_4",
    trainedOn: "2026-09-30",
    note: "Threshold retune after BOTH_DL overkill spike",
    files: PACKAGE_FILES.filter((f) => !f.startsWith("report")),
  },
];

/* ===================== release folder (for the Browse dialog) ===================== */

export const RELEASE_ROOT = "D:\MODEL_RELEASES";

export interface ReleaseFolder {
  name: string;
  modified: string;
  files: { path: string; kb: number }[];
  note: string;
}

const sized = (files: string[], seed: number) =>
  files.map((path, i) => ({ path, kb: path === "model.bin" ? 48_000 + ((seed * 7919) % 9000) : 2 + ((seed + i * 31) % 40) }));

/**
 * What an engineer sees when they browse for a package to inject: the trained exports
 * sitting in the release folder. One is a half-finished export with no weights in it,
 * which the loader refuses - a folder without model.bin would overwrite a working
 * model with nothing.
 */
export const RELEASE_FOLDERS: ReleaseFolder[] = [
  {
    name: "Model1_DL_2026-10-05_r4",
    modified: "today 09:12",
    note: "Retrained on yesterday's reviewed crops",
    files: sized(PACKAGE_FILES, 4),
  },
  ...MODEL_PACKAGES.map((p, i) => ({ name: p.name, modified: p.trainedOn, note: p.note, files: sized(p.files, i + 1) })),
  {
    name: "Model3_DL_2026-09-12_r2",
    modified: "2026-09-12",
    note: "EDGE_L threshold rebalanced",
    files: sized(PACKAGE_FILES, 9),
  },
  {
    name: "Model5_DL_2026-09-20_r1",
    modified: "2026-09-20",
    note: "First release for Model 5",
    files: sized(PACKAGE_FILES.filter((f) => !f.startsWith("report")), 11),
  },
  {
    name: "Model2_DL_2026-10-01_draft",
    modified: "2026-10-01",
    note: "Export interrupted",
    files: sized(["model.json", "classes.txt"], 13),
  },
];

/** The model a package belongs to, from its "Model<N>_" prefix. */
export function stationOfPackage(name: string): string | null {
  const m = /^Model(\d+)_/i.exec(name);
  return m && STATION_BY_ID[`model_${m[1]}`] ? `model_${m[1]}` : null;
}
