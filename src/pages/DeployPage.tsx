import { useEffect, useMemo, useRef, useState } from "react";
import { LogView, Modal, PageHead } from "../components/common";
import { PcPicker } from "../components/SessionInputs";
import {
  PCS,
  PC_BY_KEY,
  RELEASE_FOLDERS,
  RELEASE_ROOT,
  STATION_BY_ID,
  remoteEngineRoot,
  stationOfPackage,
  type ModelFolder,
  type ReleaseFolder,
} from "../sim/fleet";
import { hash } from "../sim/rng";
import { uniqueBackupName, useStore } from "../sim/store";

type Status = "READY" | "QUEUED" | "RUNNING" | "DRY RUN" | "SUCCESS" | "DONE" | "SKIPPED" | "FAILED";

interface Row {
  pcKey: string;
  status: Status;
  detail: string;
  done: number;
  total: number;
}

const MAX_CONCURRENCY = 4;

/** Folder names are compared case-insensitively - "MODEL_AREA_A" on one PC and
 *  "Model_Area_A" on another are the same model. */
const canon = (name: string) => name.toLowerCase();

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export default function DeployPage() {
  const { state, dispatch } = useStore();
  const [selected, setSelected] = useState<string[]>(() =>
    PCS.filter((p) => ["Line 1", "Line 2", "Line 3", "Line 4"].includes(p.line)).map((p) => p.key),
  );
  const [pkgName, setPkgName] = useState(state.packages[0].name);
  const [browsing, setBrowsing] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [backup, setBackup] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | { dryRun: boolean }>(null);
  const [marker, setMarker] = useState<{ pcKey: string; name: string; text: string } | null>(null);
  const [focusPc, setFocusPc] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const pkg = state.packages.find((p) => p.name === pkgName) ?? state.packages[0];
  const append = (lines: string[]) => setLog((l) => [...l, ...lines].slice(-600));

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Scanning each selected PC's engine folder, then intersecting: the dropdown only
  // ever offers a folder every selected PC is known to have.
  const scan = useMemo(() => {
    const per: Record<string, Map<string, ModelFolder>> = {};
    const lines: string[] = [];
    for (const key of selected) {
      const pc = PC_BY_KEY[key];
      const folders = state.fleet[key] ?? [];
      per[key] = new Map(folders.map((f) => [canon(f.name), f]));
      lines.push(`${key}: found ${folders.length} model folders under ${remoteEngineRoot(pc.ip)}`);
    }
    const sets = selected.map((key) => new Set(per[key].keys()));
    const inter = sets.length ? [...sets[0]].filter((c) => sets.every((s) => s.has(c))) : [];
    const ref = selected[0] ? per[selected[0]] : new Map<string, ModelFolder>();
    const models = inter.sort().map((c) => ({ canon: c, display: ref.get(c)?.name ?? c }));
    return { per, lines, models };
  }, [selected, state.fleet]);

  // Log a scan whenever the selection changes, as the desktop tool did on every tick.
  const lastScanKey = useRef("");
  useEffect(() => {
    const key = selected.join(",");
    if (key === lastScanKey.current) return;
    lastScanKey.current = key;
    if (!selected.length) {
      append(["No PCs selected; models not loaded."]);
    } else {
      append(["Refreshing models (intersection across selected PCs)...", ...scan.lines, scan.models.length ? `Intersection models: ${scan.models.length}` : "Intersection is empty."]);
    }
    if (!busy) setRows(selected.map((k) => ({ pcKey: k, status: "READY", detail: "", done: 0, total: 0 })));
  }, [selected]);

  // Keep the target valid against the current intersection, preferring the folder
  // that matches the chosen package's model.
  useEffect(() => {
    if (scan.models.some((m) => m.canon === target)) return;
    setTarget(scan.models.find((m) => m.canon === pkg.station)?.canon ?? scan.models[0]?.canon ?? "");
  }, [scan.models, target, pkg.station]);

  const update = (pcKey: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pcKey === pcKey ? { ...r, ...patch } : r)));

  function validate(): string | null {
    if (!selected.length) return "Select at least one PC.";
    if (!target) return "Please select a model from the dropdown.";
    return null;
  }

  function run(dryRun: boolean) {
    setConfirm(null);
    const ts = timestamp();
    const mode = dryRun ? "DRY RUN (marker files only)" : "INJECTION (copy files)";
    append(["----", `Starting ${mode} ...`]);
    setBusy(true);
    const queue = [...selected];
    setRows(queue.map((k) => ({ pcKey: k, status: "QUEUED", detail: "Waiting for a worker…", done: 0, total: 0 })));

    const results: { pcKey: string; status: "SUCCESS" | "SKIPPED" | "FAILED" | "DONE"; backup?: string }[] = [];
    let active = 0;
    const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

    const finishOne = (r: (typeof results)[number]) => {
      results.push(r);
      active--;
      if (results.length === selected.length) {
        setBusy(false);
        dispatch({ type: "deploy", packageName: pkg.name, modelCanon: target, dryRun, results });
        const failed = results.filter((x) => x.status === "FAILED").length;
        append([`[DONE] ${mode}: ${results.length - failed} finished, ${failed} failed.`]);
      } else {
        pump();
      }
    };

    const work = (pcKey: string) => {
      const pc = PC_BY_KEY[pcKey];
      const folder = scan.per[pcKey]?.get(target);
      const total = pkg.files.length;
      const jitter = 120 + (hash(pcKey + ts) % 160);
      update(pcKey, { status: "RUNNING", detail: "Preparing...", total });

      if (!folder) {
        return later(() => {
          update(pcKey, { status: "SKIPPED", detail: "Model folder not found on this PC" });
          finishOne({ pcKey, status: "SKIPPED" });
        }, 300);
      }

      const modelPath = `${remoteEngineRoot(pc.ip)}\\${folder.name}`;
      append([`[${pcKey}] Target model folder: ${modelPath}`]);

      if (dryRun) {
        later(() => update(pcKey, { status: "DRY RUN", detail: "Writing marker..." }), jitter);
        later(() => {
          const name = `_INJECT_DRY_RUN_${ts}.txt`;
          const text = markerText({ ts, pcKey, ip: pc.ip, modelPath, pkgName: pkg.name, files: pkg.files, backups: folder.backups });
          update(pcKey, { status: "DONE", detail: `Marker written: ${name}`, done: total });
          append([`[${pcKey}] Dry run marker written: ${modelPath}\\DL_VERSION\\${name}`]);
          setMarker((m) => m ?? { pcKey, name, text });
          finishOne({ pcKey, status: "DONE" });
        }, jitter * 3);
        return;
      }

      let t = jitter;
      let backupName: string | undefined;
      if (backup) {
        backupName = uniqueBackupName(folder.backups, pkg.name);
        later(() => update(pcKey, { status: "RUNNING", detail: "Backing up..." }), t);
        t += 500;
        later(() => append([`[${pcKey}] Backup saved to: ${modelPath}\\DL_VERSION\\${backupName}`]), t);
      }
      later(() => update(pcKey, { detail: "Copying..." }), t);
      for (let i = 1; i <= total; i++) {
        t += 140 + (hash(pcKey + i) % 120);
        later(() => update(pcKey, { done: i }), t);
      }
      later(() => {
        update(pcKey, { status: "SUCCESS", detail: "Injection completed." });
        finishOne({ pcKey, status: "SUCCESS", backup: backupName });
      }, t + 150);
    };

    const pump = () => {
      while (active < MAX_CONCURRENCY && queue.length) {
        active++;
        work(queue.shift()!);
      }
    };
    pump();
  }

  const focus = focusPc ?? selected[0] ?? null;
  const targetDisplay = scan.models.find((m) => m.canon === target)?.display ?? "";
  const doneCount = rows.filter((r) => ["SUCCESS", "DONE", "SKIPPED", "FAILED"].includes(r.status)).length;

  return (
    <main className="page">
      <PageHead title="Deploy" />

      <div className="deploy-body">
        <section className="panel">
          <div className="panel-head">
            <h2>Select PCs</h2>
          </div>
          <PcPicker selected={selected} onChange={setSelected} columns={2} disabled={busy} />
          <p className="note" style={{ marginTop: 10 }}>
            The model list is the <b>intersection</b> of the selected PCs' model folders, compared case-insensitively -
            Lines 7 and 8 name theirs in upper case. The copy is overwrite-only, and the package is first kept under{" "}
            <code style={{ fontFamily: "var(--mono)" }}>DL_VERSION\</code> so any PC can be rolled back.
          </p>
        </section>

        <section className="panel form-stack">
          <div className="field">
            <span>Source folder to inject</span>
            <div className="input-row">
              <input className="input" readOnly value={`${RELEASE_ROOT}\\${pkg.name}`} aria-label="Source folder" />
              <button className="btn primary" disabled={busy} onClick={() => setBrowsing(true)}>
                Browse…
              </button>
            </div>
          </div>

          <div className="field">
            <span>Recent packages</span>
            <div className="pkg">
              {state.packages.slice(0, 4).map((p) => (
                <button key={p.name} className={`pkg-card${p.name === pkgName ? " on" : ""}`} disabled={busy} onClick={() => setPkgName(p.name)}>
                  <span className="nm">{p.name}</span>
                  <span className="nt">{p.note}</span>
                  <span className="mt">
                    {STATION_BY_ID[p.station].name} · trained {p.trainedOn} · {p.files.length} files
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Target model folder (intersection)</span>
            <select className="select" value={target} disabled={busy || !scan.models.length} onChange={(e) => setTarget(e.target.value)}>
              {!selected.length && <option value="">(Select PCs to load models)</option>}
              {selected.length > 0 && !scan.models.length && <option value="">(No common model folders across selected PCs)</option>}
              {scan.models.map((m) => (
                <option key={m.canon} value={m.canon}>
                  {m.display}
                </option>
              ))}
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={backup} disabled={busy} onChange={(e) => setBackup(e.target.checked)} />
            Save backup into <code style={{ fontFamily: "var(--mono)", fontSize: 11 }}>DL_VERSION\{pkg.name}</code>
          </label>

          <div className="run-bar">
            <button className="btn" disabled={busy || !!validate()} onClick={() => setConfirm({ dryRun: true })}>
              Dry run (marker)
            </button>
            <button className="btn go big" disabled={busy || !!validate()} onClick={() => setConfirm({ dryRun: false })}>
              ▶ Inject
            </button>
            {validate() && <span className="note">{validate()}</span>}
          </div>

          <div className="field">
            <span>Log</span>
            <LogView lines={log} height={230} />
          </div>
        </section>

        <section className="panel deploy-status">
          <div className="panel-head">
            <h2>Per-PC status</h2>
            <span className="aside">
              {busy ? `running · ${doneCount}/${rows.length} · ${MAX_CONCURRENCY} workers` : `${rows.length} PCs`}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>PC</th>
                  <th>IP</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pcKey} onClick={() => setFocusPc(r.pcKey)} style={{ cursor: "pointer" }}>
                    <td className="mono strong">{r.pcKey}</td>
                    <td className="mono">{PC_BY_KEY[r.pcKey].ip}</td>
                    <td>
                      <span className={`chip ${r.status.replace(" ", "")}`}>{r.status}</span>
                    </td>
                    <td className="detail-cell" title={r.detail}>
                      {r.detail}
                    </td>
                    <td>
                      {r.total > 0 && (
                        <div className="prog-cell">
                          <div className={`progress${r.status === "FAILED" ? " warn" : ""}`}>
                            <i style={{ width: `${(r.done / r.total) * 100}%` }} />
                          </div>
                          <span>
                            {r.done}/{r.total}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <div className="list-empty">Select PCs to build the status table.</div>}

          {focus && <PcFolders pcKey={focus} folders={state.fleet[focus] ?? []} highlight={target} />}
        </section>
      </div>

      {confirm && (
        <Modal
          title="Confirm"
          onClose={() => setConfirm(null)}
          foot={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                No
              </button>
              <button className={`btn ${confirm.dryRun ? "primary" : "go"}`} onClick={() => run(confirm.dryRun)} autoFocus>
                Yes, continue
              </button>
            </>
          }
        >
          <div className={`mode-banner ${confirm.dryRun ? "dry" : "live"}`}>
            Mode: {confirm.dryRun ? "DRY RUN (marker files only)" : "INJECTION (copy files)"}
          </div>
          <dl className="kv">
            <dt>Selected PCs</dt>
            <dd>{selected.length}</dd>
            <dt>Model folder</dt>
            <dd>{targetDisplay}</dd>
            <dt>Source</dt>
            <dd>{pkg.name}</dd>
            <dt>Backup</dt>
            <dd>{backup ? `DL_VERSION\\${pkg.name}` : "off"}</dd>
          </dl>
        </Modal>
      )}

      {browsing && (
        <LoadModelDialog
          known={state.packages.map((p) => p.name)}
          onClose={() => setBrowsing(false)}
          onLoad={(f) => {
            if (!state.packages.some((p) => p.name === f.name)) {
              dispatch({
                type: "loadPackage",
                pkg: {
                  name: f.name,
                  station: stationOfPackage(f.name) ?? "model_1",
                  trainedOn: f.modified,
                  note: f.note,
                  files: f.files.map((x) => x.path),
                },
              });
            }
            append([`Loaded source folder: ${RELEASE_ROOT}\\${f.name} (${f.files.length} files)`]);
            setPkgName(f.name);
            setBrowsing(false);
          }}
        />
      )}

      {marker && (
        <Modal title={`${marker.name} · ${marker.pcKey}`} onClose={() => setMarker(null)} wide>
          <p className="note" style={{ margin: 0 }}>
            The marker each PC received. Nothing was copied - this is the list an engineer checks before the real run.
          </p>
          <div className="log" style={{ maxHeight: 420 }}>
            {marker.text}
          </div>
        </Modal>
      )}
    </main>
  );
}

const REQUIRED = ["model.bin", "model.json", "classes.txt"];

/**
 * The folder picker the desktop tool's Browse button opened, pointed at the release
 * folder. Picking a folder reads it first: a package without its weights or class list
 * is refused here, before it can overwrite a working model on every selected PC.
 */
function LoadModelDialog({
  known,
  onClose,
  onLoad,
}: {
  known: string[];
  onClose: () => void;
  onLoad: (f: ReleaseFolder) => void;
}) {
  const [sel, setSel] = useState(RELEASE_FOLDERS[0].name);
  const [step, setStep] = useState<number | null>(null);
  const folder = RELEASE_FOLDERS.find((f) => f.name === sel)!;
  const missingOf = (f: ReleaseFolder) => REQUIRED.filter((r) => !f.files.some((x) => x.path === r));
  const missing = missingOf(folder);
  const station = stationOfPackage(folder.name);
  const totalKb = folder.files.reduce((n, f) => n + f.kb, 0);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  // Reading the package: one check per required file, then the load.
  useEffect(() => {
    if (step === null) return;
    const id = window.setTimeout(
      () => (step < REQUIRED.length ? setStep(step + 1) : onLoadRef.current(folder)),
      step < REQUIRED.length ? 260 : 350,
    );
    return () => window.clearTimeout(id);
  }, [step, folder]);

  const start = () => {
    if (!missing.length && step === null) setStep(0);
  };

  return (
    <Modal
      title="Select source folder"
      onClose={onClose}
      wide
      foot={
        <>
          <span className="note" style={{ marginRight: "auto" }}>
            {missing.length
              ? `Not a deployable package - missing ${missing.join(", ")}`
              : `${folder.files.length} files · ${(totalKb / 1024).toFixed(1)} MB`}
          </span>
          <button className="btn" onClick={onClose} disabled={step !== null}>
            Cancel
          </button>
          <button className="btn go" disabled={missing.length > 0 || step !== null} onClick={start}>
            {step !== null ? "Reading package…" : "Select folder"}
          </button>
        </>
      }
    >
      <div className="browse-path">{RELEASE_ROOT}\</div>
      <div className="browse">
        <div className="browse-list">
          {RELEASE_FOLDERS.map((f) => (
            <button
              key={f.name}
              className={`browse-row${f.name === sel ? " on" : ""}${missingOf(f).length ? " bad" : ""}`}
              onClick={() => step === null && setSel(f.name)}
              onDoubleClick={start}
            >
              <span className="ico">▸</span>
              <span className="nm">{f.name}</span>
              {known.includes(f.name) && <span className="chip QUEUED">LOADED</span>}
              <span className="mod">{f.modified}</span>
            </button>
          ))}
        </div>
        <div className="browse-detail">
          <div className="bd-head">
            <span className="nm">{folder.name}</span>
            <span className="note">
              {station ? STATION_BY_ID[station].name : "Unknown model"} · {folder.note}
            </span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {folder.files.map((f) => {
                const req = REQUIRED.indexOf(f.path);
                const checked = step !== null && req >= 0 && req < step;
                return (
                  <tr key={f.path}>
                    <td className="mono">{f.path}</td>
                    <td className="num">{f.kb >= 1024 ? `${(f.kb / 1024).toFixed(1)} MB` : `${f.kb} KB`}</td>
                    <td style={{ width: 18, color: "var(--green)" }}>{checked ? "✓" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {missing.length > 0 && (
            <div className="flash err" style={{ marginTop: 8 }}>
              Missing {missing.join(", ")} - incomplete exports are refused so they never overwrite a working model.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PcFolders({ pcKey, folders, highlight }: { pcKey: string; folders: ModelFolder[]; highlight: string }) {
  const pc = PC_BY_KEY[pcKey];
  return (
    <div style={{ marginTop: 14 }}>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h2>Model folders · {pcKey}</h2>
        <span className="aside">{remoteEngineRoot(pc.ip)}</span>
      </div>
      <table className="table">
          <thead>
            <tr>
              <th>Folder</th>
              <th>Deployed package</th>
              <th>DL_VERSION backups</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => (
              <tr key={f.name}>
                <td className="mono strong" style={canon(f.name) === highlight ? { color: "var(--green)" } : undefined}>
                  {f.name}
                </td>
                <td className="mono">{f.version}</td>
                <td className="mono" style={{ fontSize: 10.5 }}>
                  {f.backups.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
      </table>
    </div>
  );
}

function markerText(m: {
  ts: string;
  pcKey: string;
  ip: string;
  modelPath: string;
  pkgName: string;
  files: string[];
  backups: string[];
}): string {
  return [
    "DL Model Injector - DRY RUN (NO FILES COPIED)",
    `Timestamp: ${m.ts}`,
    "Controller PC: ENG-WS-01",
    `PC: ${m.pcKey} (${m.ip})`,
    "",
    `Source folder: ${RELEASE_ROOT}\\${m.pkgName}`,
    `Target model folder: ${m.modelPath}`,
    "",
    "Backup (planned):",
    `  ${m.modelPath}\\DL_VERSION\\${uniqueBackupName(m.backups, m.pkgName)}  (if exists, would use _1, _2, ...)`,
    "",
    "Files that WOULD be copied/overwritten into target (relative paths):",
    ...m.files.map((f) => `  ${f}`),
  ].join("\n");
}
