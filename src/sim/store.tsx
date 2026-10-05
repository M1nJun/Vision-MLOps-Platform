/**
 * The demo's single source of truth.
 *
 * The desktop tools shared state through the file system: the fetcher wrote crops into
 * an output folder, the viewer indexed that folder and copied each reviewed crop into
 * the dataset folder, and the injector wrote into each PC's model folder. Here those folders are in memory,
 * so a crop fetched on the Collect page is the same crop reviewed on Review, counted on
 * Dataset, and a package injected on Deploy changes what the fleet reports on Overview.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { clusterOccurrences, type ClusterPhase, type ClusterResult } from "./cluster";
import {
  addDays,
  isoDay,
  occurrencesFor,
  suggestOutDir,
  type Label,
  type Occurrence,
} from "./collect";
import { MODEL_PACKAGES, PCS, STATION_BY_ID, initialModelFolders, type ModelFolder, type ModelPackage } from "./fleet";
import { rng } from "./rng";

export interface LabelRecord {
  occ: Occurrence;
  label: Label;
  at: number;
  outDir: string;
}

export interface ActivityItem {
  at: number;
  kind: "collect" | "review" | "deploy" | "system";
  text: string;
}

export interface DeployRecord {
  at: number;
  packageName: string;
  modelFolder: string;
  dryRun: boolean;
  ok: number;
  skipped: number;
  failed: number;
}

export interface State {
  /** station -> the crops currently sitting in that station's output folder. */
  collected: Record<string, Occurrence[]>;
  outDirs: Record<string, string>;
  /** occurrence id -> where it was moved. */
  labels: Record<string, LabelRecord>;
  /** Per-station undo stacks of occurrence ids, newest last - as each viewer tab had. */
  undo: Record<string, string[]>;
  fleet: Record<string, ModelFolder[]>;
  deploys: DeployRecord[];
  /** Model packages the deployer knows about - the release folder, plus any loaded. */
  packages: ModelPackage[];
  activity: ActivityItem[];
  /** When this session began; the Overview reports "today" from here. */
  sessionStart: number;
  /** model -> clustering of whatever is currently in that model's output folder. */
  clusters: Record<string, ClusterState>;
}

export interface ClusterState {
  /** Which collection this belongs to; a new fetch changes it and re-runs the job. */
  signature: string;
  status: "running" | "done";
  phase: ClusterPhase;
  done: number;
  total: number;
  method: string;
  result?: ClusterResult;
}

/** Identifies the crops currently collected for a model. */
export function collectionSignature(state: Pick<State, "collected" | "outDirs">, station: string): string {
  const occ = state.collected[station] ?? [];
  return `${state.outDirs[station] ?? ""}|${occ.length}|${occ[0]?.id ?? ""}|${occ[occ.length - 1]?.id ?? ""}`;
}

type Action =
  | { type: "collect"; station: string; outDir: string; occurrences: Occurrence[]; days: string[]; pcs: number }
  | { type: "label"; occ: Occurrence; label: Label }
  | { type: "undo"; station: string }
  | {
      type: "deploy";
      packageName: string;
      modelCanon: string;
      dryRun: boolean;
      results: { pcKey: string; status: "SUCCESS" | "SKIPPED" | "FAILED" | "DONE"; backup?: string }[];
    }
  | { type: "loadPackage"; pkg: ModelPackage }
  | {
      type: "clusterProgress";
      station: string;
      signature: string;
      phase: ClusterPhase;
      done: number;
      total: number;
      method: string;
    }
  | { type: "clusterDone"; station: string; signature: string; result: ClusterResult }
  | { type: "reset" };

function log(state: State, kind: ActivityItem["kind"], text: string): ActivityItem[] {
  return [{ at: Date.now(), kind, text }, ...state.activity].slice(0, 60);
}

/** Next free name under DL_VERSION: name, then name_1, name_2 ... */
export function uniqueBackupName(existing: string[], name: string): string {
  const taken = new Set(existing.map((s) => s.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 1; ; i++) if (!taken.has(`${name}_${i}`.toLowerCase())) return `${name}_${i}`;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "collect": {
      // Same file name, same destination: a re-fetch overwrites rather than duplicates.
      const prev = state.outDirs[action.station] === action.outDir ? state.collected[action.station] ?? [] : [];
      const byId = new Map(prev.map((o) => [o.id, o]));
      for (const o of action.occurrences) byId.set(o.id, o);
      const st = STATION_BY_ID[action.station];
      return {
        ...state,
        collected: { ...state.collected, [action.station]: [...byId.values()] },
        outDirs: { ...state.outDirs, [action.station]: action.outDir },
        undo: { ...state.undo, [action.station]: [] },
        activity: log(
          state,
          "collect",
          `${st.name}: fetched ${action.occurrences.length.toLocaleString("en-US")} NG crops from ${action.pcs} PCs (${action.days.join(", ")})`,
        ),
      };
    }
    case "label": {
      const outDir = state.outDirs[action.occ.station] ?? "";
      return {
        ...state,
        labels: { ...state.labels, [action.occ.id]: { occ: action.occ, label: action.label, at: Date.now(), outDir } },
        undo: { ...state.undo, [action.occ.station]: [...(state.undo[action.occ.station] ?? []), action.occ.id] },
      };
    }
    case "undo": {
      const stack = state.undo[action.station] ?? [];
      const id = stack[stack.length - 1];
      if (!id) return state;
      const labels = { ...state.labels };
      delete labels[id];
      return { ...state, labels, undo: { ...state.undo, [action.station]: stack.slice(0, -1) } };
    }
    case "deploy": {
      const fleet = { ...state.fleet };
      let ok = 0;
      let skipped = 0;
      let failed = 0;
      for (const r of action.results) {
        if (r.status === "SKIPPED") skipped++;
        else if (r.status === "FAILED") failed++;
        else ok++;
        if (action.dryRun || r.status !== "SUCCESS") continue;
        fleet[r.pcKey] = fleet[r.pcKey].map((f) =>
          f.name.toLowerCase() === action.modelCanon
            ? { ...f, version: action.packageName, backups: r.backup ? [...f.backups, r.backup] : f.backups }
            : f,
        );
      }
      const folder = action.modelCanon;
      const verb = action.dryRun ? "Dry run" : "Injected";
      return {
        ...state,
        fleet,
        deploys: [
          { at: Date.now(), packageName: action.packageName, modelFolder: folder, dryRun: action.dryRun, ok, skipped, failed },
          ...state.deploys,
        ],
        activity: log(
          state,
          "deploy",
          `${verb} ${action.packageName} -> ${folder}: ${ok} ok, ${skipped} skipped, ${failed} failed`,
        ),
      };
    }
    case "loadPackage": {
      if (state.packages.some((p) => p.name === action.pkg.name)) return state;
      return {
        ...state,
        packages: [action.pkg, ...state.packages],
        activity: log(state, "deploy", `Loaded model package ${action.pkg.name} (${action.pkg.files.length} files)`),
      };
    }
    case "clusterProgress": {
      const { station, signature, phase, done, total, method } = action;
      return {
        ...state,
        clusters: { ...state.clusters, [station]: { signature, status: "running", phase, done, total, method } },
      };
    }
    case "clusterDone": {
      // A result for a collection that has since been replaced is dropped; the runner
      // is already queued to cluster the new one.
      if (action.signature !== collectionSignature(state, action.station)) return state;
      const r = action.result;
      const n = Object.keys(r.assign).length;
      const k = Object.values(r.groups).reduce((s, g) => s + g.k, 0);
      return {
        ...state,
        clusters: {
          ...state.clusters,
          [action.station]: {
            signature: action.signature,
            status: "done",
            phase: "clustering",
            done: n,
            total: n,
            method: r.method,
            result: r,
          },
        },
        activity: log(
          state,
          "collect",
          `${STATION_BY_ID[action.station].name}: clustered ${n} crops into ${k} clusters (${r.method}, k by silhouette)`,
        ),
      };
    }
    case "reset":
      return seedState();
  }
}

/**
 * A plant that has already been running the loop: yesterday's Model 1 and Model 4 crops are
 * fetched, and about half of the Model 1 ones are reviewed. A visitor lands on a screen
 * with something to look at, and can still run every step themselves.
 */
function seedState(): State {
  const today = isoDay(new Date());
  const yesterday = addDays(today, -1);
  const collected: Record<string, Occurrence[]> = {};
  const outDirs: Record<string, string> = {};
  const labels: Record<string, LabelRecord> = {};

  for (const id of ["model_1", "model_4"]) {
    const st = STATION_BY_ID[id];
    const occ = PCS.flatMap((pc) => occurrencesFor(st, pc, yesterday));
    collected[id] = occ;
    outDirs[id] = suggestOutDir(st, [yesterday]);
  }

  const r = rng("seed-review");
  const t0 = Date.now() - 1000 * 60 * 90;
  collected.model_1.forEach((o, i) => {
    if (r() < 0.45) {
      labels[o.id] = { occ: o, label: o.truth, at: t0 + i * 4000, outDir: outDirs.model_1 };
    }
  });

  const fleet = Object.fromEntries(PCS.map((pc) => [pc.key, initialModelFolders(pc)]));
  const now = Date.now();
  return {
    collected,
    outDirs,
    labels,
    undo: {},
    fleet,
    deploys: [],
    packages: MODEL_PACKAGES,
    clusters: {},
    sessionStart: now - 1000 * 60 * 115,
    activity: [
      { at: now - 1000 * 60 * 40, kind: "review", text: `Model 1: ${Object.keys(labels).length} crops reviewed and copied into the dataset` },
      { at: now - 1000 * 60 * 95, kind: "collect", text: `Model 4: fetched ${collected.model_4.length} NG crops from ${PCS.length} PCs (${yesterday})` },
      { at: now - 1000 * 60 * 110, kind: "collect", text: `Model 1: fetched ${collected.model_1.length} NG crops from ${PCS.length} PCs (${yesterday})` },
    ],
  };
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, seedState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <Ctx.Provider value={value}>
      <ClusterRunner state={state} dispatch={dispatch} />
      {children}
    </Ctx.Provider>
  );
}

/**
 * Clusters each model's crops as soon as they are collected - one model at a time,
 * since the embedder is shared. Lives beside the store rather than on a page, so a
 * clustering started after a fetch keeps going while the user moves on to Review.
 */
function ClusterRunner({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const busy = useRef(false);
  const [, kick] = useState(0);

  useEffect(() => {
    if (busy.current) return;
    const station = Object.keys(state.collected).find(
      (st) => state.collected[st].length > 0 && state.clusters[st]?.signature !== collectionSignature(state, st),
    );
    if (!station) return;
    busy.current = true;
    const signature = collectionSignature(state, station);
    clusterOccurrences(state.collected[station], (phase, done, total, method) =>
      dispatch({ type: "clusterProgress", station, signature, phase, done, total, method }),
    )
      .then((result) => dispatch({ type: "clusterDone", station, signature, result }))
      .catch((e) => console.error("clustering failed", e))
      .finally(() => {
        busy.current = false;
        kick((n) => n + 1);
      });
  });

  return null;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

/* ===================== derived ===================== */

export interface DatasetCount {
  station: string;
  vision: string;
  classFolder: string;
  realNg: number;
  overkill: number;
}

export function datasetCounts(labels: Record<string, LabelRecord>): DatasetCount[] {
  const m = new Map<string, DatasetCount>();
  for (const rec of Object.values(labels)) {
    const o = rec.occ;
    const k = `${o.station}|${o.vision}|${o.classFolder}`;
    let c = m.get(k);
    if (!c) {
      c = { station: o.station, vision: o.vision, classFolder: o.classFolder, realNg: 0, overkill: 0 };
      m.set(k, c);
    }
    if (rec.label === "RealNG") c.realNg++;
    else c.overkill++;
  }
  return [...m.values()].sort(
    (a, b) => a.station.localeCompare(b.station) || a.vision.localeCompare(b.vision) || a.classFolder.localeCompare(b.classFolder),
  );
}
