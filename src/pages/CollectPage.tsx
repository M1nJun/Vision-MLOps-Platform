import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogView, PageHead, StationTabs } from "../components/common";
import ClusterStatus, { CLUSTER_COLORS } from "../components/ClusterStatus";
import { DateSelector, PcPicker } from "../components/SessionInputs";
import {
  addDays,
  DEFAULT_CSV_DIR,
  isoDay,
  planFetch,
  selectionDays,
  suggestOutDir,
  type DateSelection,
  type Occurrence,
} from "../sim/collect";
import { PCS, STATION_BY_ID, visionLabel, type Vision } from "../sim/fleet";
import { useStore } from "../sim/store";

interface Session {
  dates: DateSelection;
  pcs: string[];
  outDir: string;
  outDirUserSet: boolean;
  csvDir: string;
}

// Kept outside the component so a session survives leaving the page, the way the
// desktop tool kept one per area tab for as long as it was open.
const sessions: Record<string, Session> = {};

function defaultSession(stationId: string): Session {
  const today = isoDay(new Date());
  const dates: DateSelection = {
    mode: "single",
    single: today,
    start: addDays(today, -2),
    end: today,
    specific: [addDays(today, -3), today],
  };
  return {
    dates,
    pcs: PCS.map((p) => p.key),
    outDir: suggestOutDir(STATION_BY_ID[stationId], selectionDays(dates)),
    outDirUserSet: false,
    csvDir: DEFAULT_CSV_DIR,
  };
}

interface RunState {
  running: boolean;
  phase: "idle" | "scan" | "copy" | "done" | "cancelled";
  done: number;
  total: number;
  cls: string;
  file: string;
}

const IDLE: RunState = { running: false, phase: "idle", done: 0, total: 0, cls: "-", file: "-" };

export default function CollectPage() {
  const { state, dispatch } = useStore();
  const [stationId, setStationId] = useState("model_1");
  const [session, setSessionRaw] = useState<Session>(() => (sessions[stationId] ??= defaultSession(stationId)));
  const [log, setLog] = useState<string[]>([]);
  const [run, setRun] = useState<RunState>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const timer = useRef<number | null>(null);

  const station = STATION_BY_ID[stationId];
  const days = selectionDays(session.dates);

  const setSession = (s: Session) => {
    sessions[stationId] = s;
    setSessionRaw(s);
  };

  const switchStation = (id: string) => {
    if (run.running) return;
    setStationId(id);
    setSessionRaw((sessions[id] ??= defaultSession(id)));
    setError(null);
  };

  // Output folder follows the dates until somebody types or picks one of their own.
  const updateDates = (dates: DateSelection) => {
    const next = { ...session, dates };
    if (!session.outDirUserSet) next.outDir = suggestOutDir(station, selectionDays(dates));
    setSession(next);
  };

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const append = (lines: string[]) => setLog((l) => [...l, ...lines].slice(-800));

  function start() {
    setError(null);
    if (!days.length) return setError("Please select a valid date / range / dates in Session.");
    if (!session.pcs.length) return setError("Please select at least one PC in Session.");
    if (!session.outDir.trim()) return setError("Please choose an output folder in Session.");

    const plan = planFetch(stationId, session.pcs, days, session.csvDir);
    const existing = new Set(
      state.outDirs[stationId] === session.outDir ? (state.collected[stationId] ?? []).map((o) => o.id) : [],
    );
    cancelRef.current = false;
    append([`---- ${new Date().toLocaleTimeString("en-GB")} ----`, "[INFO] Starting remote fetch..."]);
    setRun({ running: true, phase: "scan", done: 0, total: 0, cls: "-", file: "-" });

    // Pre-scan: one SMB round trip per PC-day, printed as it happens.
    let i = 0;
    const scanStep = () => {
      if (cancelRef.current) return finish([], "cancelled", "[WARN] Cancelled during pre-scan.");
      append(plan.scanLog.slice(i, i + 2));
      i += 2;
      if (i < plan.scanLog.length) {
        timer.current = window.setTimeout(scanStep, 55);
      } else if (plan.totalFiles === 0) {
        finish([], "done", "[WARN] Nothing to copy (0 files).");
      } else {
        copy();
      }
    };

    // Copy: SourceMap then its pair, file by file, into <out>\<VISION>\<class>\.
    const files = plan.occurrences.flatMap((o) => {
      const f = [{ o, name: o.fileName, last: !o.hasPair }];
      if (o.hasPair) f.push({ o, name: o.fileName.replace("SourceMap", station.pairLabel ?? "Pair"), last: true });
      return f;
    });
    let done = 0;
    let overwritten = 0;
    const copied: Occurrence[] = [];
    const chunk = Math.max(1, Math.ceil(files.length / 90));

    const copy = () => {
      setRun((r) => ({ ...r, phase: "copy", total: files.length }));
      const step = () => {
        if (cancelRef.current) return finish(copied, "cancelled", "[WARN] Cancelled during copy.");
        const end = Math.min(files.length, done + chunk);
        for (; done < end; done++) {
          const f = files[done];
          if (f.last) {
            copied.push(f.o);
            if (existing.has(f.o.id)) overwritten++;
          }
        }
        const cur = files[done - 1];
        setRun((r) => ({ ...r, done, cls: `${cur.o.vision}/${cur.o.classFolder}`, file: cur.name }));
        if (done < files.length) {
          timer.current = window.setTimeout(step, 45);
        } else {
          finish(
            copied,
            "done",
            `[DONE] (${station.name}) Copied ${files.length.toLocaleString("en-US")} files for ${copied.length.toLocaleString("en-US")} crops (overwrote ${overwritten}).`,
          );
        }
      };
      step();
    };

    const finish = (occ: Occurrence[], phase: RunState["phase"], msg: string) => {
      append([msg]);
      setRun((r) => ({ ...r, running: false, phase }));
      if (occ.length) {
        dispatch({
          type: "collect",
          station: stationId,
          outDir: session.outDir,
          occurrences: occ,
          days,
          pcs: session.pcs.length,
        });
      }
    };

    scanStep();
  }

  const pct = run.total ? Math.round((run.done / run.total) * 100) : run.phase === "done" ? 100 : 0;
  return (
    <main className="page">
      <PageHead title="Collect" origin="Result Fetcher · Fetch tab" />

      <StationTabs value={stationId} onChange={switchStation} />

      <section className="panel">
        <div className="panel-head">
          <h2>Session · {station.name}</h2>
          <span className="aside">
            source: {station.source === "crop-folders" ? "DL crop folders" : "result CSV → image locator"}
          </span>
        </div>
        <div className="session-grid">
          <div className="form-stack">
            <div className="field">
              <span>Dates</span>
              <DateSelector value={session.dates} onChange={updateDates} />
            </div>
            <label className="field">
              <span>Output folder {session.outDirUserSet ? "(custom)" : "(auto)"}</span>
              <div className="input-row">
                <input
                  className="input"
                  value={session.outDir}
                  disabled={run.running}
                  onChange={(e) => setSession({ ...session, outDir: e.target.value, outDirUserSet: true })}
                />
                <button
                  className="btn"
                  disabled={run.running || !session.outDirUserSet}
                  title="Go back to the automatic output folder"
                  onClick={() => setSession({ ...session, outDir: suggestOutDir(station, days), outDirUserSet: false })}
                >
                  Auto
                </button>
              </div>
            </label>
            <label className="field">
              <span>CSV folder (on each PC)</span>
              <input
                className="input"
                value={session.csvDir}
                disabled={run.running}
                onChange={(e) => setSession({ ...session, csvDir: e.target.value })}
              />
            </label>
          </div>
          <div className="field">
            <span>PCs (remote)</span>
            <PcPicker selected={session.pcs} onChange={(pcs) => setSession({ ...session, pcs })} disabled={run.running} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="run-bar" style={{ marginBottom: 10 }}>
          <button className="btn go big" disabled={run.running} onClick={start}>
            ▶ Run
          </button>
          <button className="btn danger big" disabled={!run.running} onClick={() => (cancelRef.current = true)}>
            Cancel
          </button>
          <div className="status">
            <span>
              Copied: <b>{run.done.toLocaleString("en-US")}</b> / {run.total.toLocaleString("en-US")}
            </span>
            <span>
              Current class: <b>{run.cls}</b>
            </span>
            <span className="file">File: {run.file}</span>
          </div>
        </div>
        <div className={`progress${run.phase === "cancelled" ? " warn" : run.phase === "idle" ? " idle" : ""}`}>
          <i style={{ width: `${run.phase === "scan" ? 3 : pct}%` }} />
        </div>
        {(run.phase === "done" || run.phase === "cancelled") && (
          <div style={{ marginTop: 10 }}>
            <ClusterStatus station={stationId} />
          </div>
        )}
        {error && (
          <div className="flash err" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </section>

      <div className="cols-main">
        <section className="panel">
          <div className="panel-head">
            <h2>Log</h2>
            <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setLog([])} disabled={run.running}>
              Clear
            </button>
          </div>
          <LogView lines={log} height={300} />
        </section>
        <ClassBreakdown stationId={stationId} />
      </div>
    </main>
  );
}

/**
 * What is in this model's output folder, the way the review will walk it: by vision
 * and DL class, then by the visual clusters found inside each class.
 */
function ClassBreakdown({ stationId }: { stationId: string }) {
  const { state } = useStore();
  const occ = state.collected[stationId] ?? [];
  const cl = state.clusters[stationId];
  const result = cl?.status === "done" ? cl.result : undefined;

  const rows = useMemo(() => {
    const m = new Map<string, { vision: Vision; cls: string; n: number }>();
    for (const o of occ) {
      const k = `${o.vision}|${o.classFolder}`;
      const r = m.get(k) ?? { vision: o.vision, cls: o.classFolder, n: 0 };
      r.n++;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [occ]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Clusters by DL class</h2>
        {occ.length > 0 && <span className="aside">{occ.length.toLocaleString("en-US")} crops</span>}
      </div>
      {occ.length === 0 ? (
        <div className="list-empty">
          Run a fetch to see what came in. Crops arrive already sorted by the DL engine's class (<code>01_OK_*</code>{" "}
          excluded); inside each class they are then clustered by appearance.
        </div>
      ) : (
        <>
          <ClusterStatus station={stationId} compact />
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Vision</th>
                  <th>Class</th>
                  <th className="num">Crops</th>
                  <th className="num">k</th>
                  <th style={{ width: "34%" }}>Clusters</th>
                  <th className="num">Silhouette</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, r]) => {
                  const g = result?.groups[key];
                  return (
                    <tr key={key}>
                      <td className="mono">{visionLabel(r.vision)}</td>
                      <td className="mono strong">{r.cls}</td>
                      <td className="num strong">{r.n}</td>
                      <td className="num">{g ? g.k : "…"}</td>
                      <td>
                        {g ? (
                          <div className="cluster-bar" title={g.sizes.map((s, i) => `C${i + 1}: ${s}`).join("  ")}>
                            {g.sizes.map((s, i) => (
                              <i key={i} style={{ flex: s, background: CLUSTER_COLORS[i] }} />
                            ))}
                          </div>
                        ) : (
                          <div className="cluster-bar pending" />
                        )}
                      </td>
                      <td className="num">{g && g.k > 1 ? g.silhouette.toFixed(2) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}>
            <Link className="btn primary" to={`/review?station=${stationId}`}>
              Review by cluster →
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
