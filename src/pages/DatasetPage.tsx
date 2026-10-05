import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/common";
import { datasetPath } from "../sim/collect";
import { DATASET_ROOT, STATIONS, STATION_BY_ID, visionLabel, type Vision } from "../sim/fleet";
import { datasetCounts, useStore, type LabelRecord } from "../sim/store";

/**
 * What the review produced, read as a training set.
 *
 * The dataset folder review copies into: one folder per model, vision, class and verdict.
 * Real NG crops become positives for their class, overkills become the hard negatives
 * the next model has to learn to let through. The overkill share per class is the
 * engine's false-call rate - the number that decides which model is retrained next.
 */
export default function DatasetPage() {
  const { state } = useStore();
  const [stationFilter, setStationFilter] = useState<string>("all");

  const records = useMemo(
    () => Object.values(state.labels).filter((r) => stationFilter === "all" || r.occ.station === stationFilter),
    [state.labels, stationFilter],
  );
  const rows = useMemo(() => datasetCounts(Object.fromEntries(records.map((r) => [r.occ.id, r]))), [records]);

  const realNg = records.filter((r) => r.label === "RealNG").length;
  const overkill = records.length - realNg;
  const pending = Object.entries(state.collected)
    .filter(([k]) => stationFilter === "all" || k === stationFilter)
    .reduce((n, [, v]) => n + v.filter((o) => !state.labels[o.id]).length, 0);
  const rate = records.length ? overkill / records.length : 0;

  const stationsWithData = STATIONS.filter((s) => Object.values(state.labels).some((r) => r.occ.station === s.id));

  return (
    <main className="page">
      <PageHead title="Dataset" origin="Dataset folder → training set" />

      <div className="seg">
        <button className={stationFilter === "all" ? "on" : ""} onClick={() => setStationFilter("all")}>
          ALL MODELS
        </button>
        {STATIONS.map((s) => (
          <button key={s.id} className={stationFilter === s.id ? "on" : ""} onClick={() => setStationFilter(s.id)}>
            {s.name.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Labelled crops</div>
          <div className="value">{records.length.toLocaleString("en-US")}</div>
          <div className="sub">{stationsWithData.length} model(s) with labels</div>
        </div>
        <div className="stat red">
          <div className="label">Real NG</div>
          <div className="value">{realNg.toLocaleString("en-US")}</div>
          <div className="sub">positives</div>
        </div>
        <div className="stat blue">
          <div className="label">Overkill</div>
          <div className="value">{overkill.toLocaleString("en-US")}</div>
          <div className="sub">hard negatives</div>
        </div>
        <div className="stat yellow">
          <div className="label">DL overkill rate</div>
          <div className="value">{(rate * 100).toFixed(1)}%</div>
          <div className="meter">
            <i style={{ width: `${rate * 100}%`, background: "var(--yellow)", boxShadow: "0 0 8px -2px var(--yellow)" }} />
          </div>
        </div>
        <div className="stat">
          <div className="label">Awaiting review</div>
          <div className="value">{pending.toLocaleString("en-US")}</div>
          <div className="sub">
            <Link to="/review">open Review →</Link>
          </div>
        </div>
      </div>

      <div className="cols-main fill">
        <section className="panel">
          <div className="panel-head">
            <h2>Verdicts by class</h2>
            <div className="legend" style={{ marginLeft: "auto" }}>
              <span>
                <i className="r" /> Real NG
              </span>
              <span>
                <i className="o" /> Overkill
              </span>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="list-empty">No labels yet. Review some crops and they will be counted here.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Vision</th>
                    <th>Class</th>
                    <th className="num">Real NG</th>
                    <th className="num">Overkill</th>
                    <th style={{ width: "22%" }}>Split</th>
                    <th className="num">Overkill rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const n = r.realNg + r.overkill;
                    const ok = r.overkill / n;
                    return (
                      <tr key={r.station + r.vision + r.classFolder}>
                        <td>{STATION_BY_ID[r.station].name}</td>
                        <td className="mono">{visionLabel(r.vision as Vision)}</td>
                        <td className="mono strong">{r.classFolder}</td>
                        <td className="num" style={{ color: "var(--real-ng)" }}>
                          {r.realNg}
                        </td>
                        <td className="num" style={{ color: "var(--overkill)" }}>
                          {r.overkill}
                        </td>
                        <td>
                          <div className="split-bar" title={`${r.realNg} Real NG / ${r.overkill} Overkill`}>
                            <i className="r" style={{ width: `${(r.realNg / n) * 100}%` }} />
                            <i className="o" style={{ width: `${(r.overkill / n) * 100}%` }} />
                          </div>
                        </td>
                        <td className="num">
                          <span className={`ok-rate ${ok >= 0.5 ? "hi" : ok >= 0.3 ? "mid" : "lo"}`}>
                            {(ok * 100).toFixed(0)}%
                          </span>
                          {ok >= 0.5 && n >= 5 && (
                            <span className="chip system" style={{ marginLeft: 6 }}>
                              RETRAIN
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="note" style={{ margin: "10px 0 0" }}>
            A class where most of the engine's NG calls are overkill is costing good cells. Its reviewed crops go into
            the next training round; the retrained package is then rolled out from <Link to="/deploy">Deploy</Link>.
          </p>
        </section>

        <section className="panel tree-panel">
          <div className="panel-head">
            <h2>Dataset folder</h2>
            <button className="btn" style={{ marginLeft: "auto" }} disabled={!records.length} onClick={() => exportManifest(records)}>
              ⤓ Export manifest (.csv)
            </button>
          </div>
          <FolderTree records={records} />
        </section>
      </div>
    </main>
  );
}

function FolderTree({ records }: { records: LabelRecord[] }) {
  // model -> vision -> class -> label -> count
  const tree = new Map<string, Map<string, Map<string, Map<string, number>>>>();
  for (const r of records) {
    const root = `${DATASET_ROOT}\\${STATION_BY_ID[r.occ.station].code}`;
    const a = tree.get(root) ?? new Map();
    tree.set(root, a);
    const b = a.get(r.occ.vision) ?? new Map();
    a.set(r.occ.vision, b);
    const c = b.get(r.occ.classFolder) ?? new Map();
    b.set(r.occ.classFolder, c);
    c.set(r.label, (c.get(r.label) ?? 0) + 1);
  }
  if (!tree.size) return <div className="list-empty">The folder is empty until the first verdict.</div>;

  const out: React.ReactNode[] = [];
  let k = 0;
  for (const [root, pols] of [...tree].sort()) {
    out.push(
      <div key={k++} className="dir">
        {root}
      </div>,
    );
    const polList = [...pols].sort();
    polList.forEach(([pol, classes], pi) => {
      const lastPol = pi === polList.length - 1;
      out.push(
        <div key={k++}>
          {lastPol ? "└─ " : "├─ "}
          <span className="dir">{pol}</span>
        </div>,
      );
      const clsList = [...classes].sort();
      clsList.forEach(([cls, labels], ci) => {
        const lastCls = ci === clsList.length - 1;
        const p1 = lastPol ? "   " : "│  ";
        out.push(
          <div key={k++}>
            {p1}
            {lastCls ? "└─ " : "├─ "}
            <span className="dir">{cls}</span>
          </div>,
        );
        const labList = [...labels].sort();
        labList.forEach(([lab, n], li) => {
          out.push(
            <div key={k++}>
              {p1}
              {lastCls ? "   " : "│  "}
              {li === labList.length - 1 ? "└─ " : "├─ "}
              <span className={lab}>{lab}</span> <span className="n">({n} files)</span>
            </div>,
          );
        });
      });
    });
  }
  return <div className="tree">{out}</div>;
}

function exportManifest(records: LabelRecord[]) {
  const head = ["path", "label", "model", "vision", "class", "cell", "region", "pc", "date"];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = records.map((r) =>
    [
      datasetPath(r.occ, r.label),
      r.label,
      STATION_BY_ID[r.occ.station].name,
      r.occ.vision,
      r.occ.classFolder,
      r.occ.cellKey,
      r.occ.region,
      r.occ.pcKey,
      r.occ.date,
    ]
      .map(esc)
      .join(","),
  );
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `training_manifest_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
