import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ClusterStatus, { CLUSTER_COLORS } from "../components/ClusterStatus";
import ImageCanvas from "../components/ImageCanvas";
import { PageHead, StationTabs } from "../components/common";
import { datasetDir, datasetPath, type Label, type Occurrence } from "../sim/collect";
import { DATASET_ROOT, STATION_BY_ID, VISIONS, visionLabel, type Vision } from "../sim/fleet";
import { imageFor } from "../sim/images";
import { useStore, type LabelRecord } from "../sim/store";

type VisionFilter = "All" | Vision;

interface Flash {
  kind: "ok" | "err" | "info";
  text: string;
  path?: string;
}

const dropKey = (vision: string, cls: string, label: Label) => `${vision}|${cls}|${label}`;

export default function ReviewPage() {
  const { state, dispatch } = useStore();
  const [params, setParams] = useSearchParams();
  const stationId = STATION_BY_ID[params.get("station") ?? ""] ? params.get("station")! : "model_1";
  const station = STATION_BY_ID[stationId];

  const [vis, setVis] = useState<VisionFilter>("All");
  const [region, setRegion] = useState("All");
  const [search, setSearch] = useState("");
  const [selClass, setSelClass] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [hit, setHit] = useState<{ key: string; n: number } | null>(null);
  const sourceFrame = useRef<HTMLDivElement>(null);

  const outDir = state.outDirs[stationId] ?? "";
  const all = state.collected[stationId] ?? [];
  // A reviewed crop leaves the queue - its copy now lives in the dataset folder.
  const remaining = useMemo(() => all.filter((o) => !state.labels[o.id]), [all, state.labels]);
  const reviewedHere = all.length - remaining.length;

  const classes = useMemo(() => {
    const m = new Map<string, { vision: Vision; folder: string; n: number; total: number }>();
    for (const o of all) {
      if (vis !== "All" && o.vision !== vis) continue;
      const k = `${o.vision}|${o.classFolder}`;
      const c = m.get(k) ?? { vision: o.vision, folder: o.classFolder, n: 0, total: 0 };
      c.total++;
      if (!state.labels[o.id]) c.n++;
      m.set(k, c);
    }
    return [...m.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.vision.localeCompare(b.vision) || a.folder.localeCompare(b.folder));
  }, [all, vis, state.labels]);

  const activeClass = classes.find((c) => c.key === selClass) ? selClass : classes[0]?.key ?? null;

  // Once clustering has finished, the list is walked cluster by cluster, so crops that
  // look alike are reviewed one after another.
  const clusterRun = state.clusters[stationId];
  const assign = clusterRun?.status === "done" ? clusterRun.result?.assign : undefined;

  const occList = useMemo(() => {
    if (!activeClass) return [];
    const q = search.trim().toLowerCase();
    const c = (o: Occurrence) => assign?.[o.id] ?? 0;
    return remaining
      .filter((o) => `${o.vision}|${o.classFolder}` === activeClass)
      .filter((o) => region === "All" || o.region === region)
      .filter((o) => !q || o.cellKey.toLowerCase().includes(q))
      .sort((a, b) => c(a) - c(b) || a.cellKey.localeCompare(b.cellKey) || a.region.localeCompare(b.region));
  }, [remaining, activeClass, region, search, assign]);

  const current = occList.find((o) => o.id === selId) ?? occList[0] ?? null;

  const switchStation = (id: string) => {
    setParams({ station: id });
    setSelClass(null);
    setSelId(null);
    setRegion("All");
    setFlash(null);
  };


  const label = (lab: Label) => {
    if (!current || state.labels[current.id]) return;
    const idx = occList.indexOf(current);
    const next = occList[idx + 1] ?? occList[idx - 1] ?? null;
    flyToFolder(current, sourceFrame.current, dropKey(current.vision, current.classFolder, lab));
    dispatch({ type: "label", occ: current, label: lab });
    const dst = datasetPath(current, lab);
    setFlash({ kind: "ok", text: `Copied to ${lab}`, path: dst });
    setHit((h) => ({ key: dropKey(current.vision, current.classFolder, lab), n: (h?.n ?? 0) + 1 }));
    setSelId(next?.id ?? null);
  };

  const undo = () => {
    const stack = state.undo[stationId] ?? [];
    const id = stack[stack.length - 1];
    if (!id) {
      setFlash({ kind: "info", text: "Nothing to undo in this session." });
      return;
    }
    const rec = state.labels[id];
    dispatch({ type: "undo", station: stationId });
    if (!rec) return;
    const o = rec.occ;
    if (vis !== "All" && vis !== o.vision) setVis(o.vision);
    setSelClass(`${o.vision}|${o.classFolder}`);
    setSelId(o.id);
    const hidden = (region !== "All" && region !== o.region) || (search && !o.cellKey.toLowerCase().includes(search.toLowerCase()));
    setFlash(
      hidden
        ? { kind: "info", text: "Restored, but filtered out by current search/region." }
        : { kind: "ok", text: `Restored: ${o.classFolder} · ${o.cellKey}` },
    );
  };

  const move = (dir: 1 | -1) => {
    const i = current ? occList.indexOf(current) : -1;
    const n = occList[i + dir];
    if (n) setSelId(n.id);
    return !!n;
  };

  // The listener is registered once and reads the handlers through a ref written on
  // every render. Re-registering it per render left a gap - effects run after paint -
  // in which a fast second keypress reached the previous render's handler and labelled
  // the crop that had just been copied.
  const keys = useRef({ label, undo, move });
  keys.current = { label, undo, move };

  // 1 / 2 / Ctrl+Z anywhere on the page - except while typing in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        keys.current.undo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        if (e.key === "1") keys.current.label("RealNG");
        else if (e.key === "2") keys.current.label("Overkill");
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        if (keys.current.move(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear the flash after a moment, as the desktop status bar did.
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(id);
  }, [flash]);

  const canUndo = (state.undo[stationId] ?? []).length > 0;
  const stationLabels = useMemo(
    () => Object.values(state.labels).filter((r) => r.occ.station === stationId),
    [state.labels, stationId],
  );

  return (
    <main className="page">
      <PageHead title="Review" origin="Result Fetcher · Viewer tab" />

      <StationTabs value={stationId} onChange={switchStation} />

      {clusterRun?.status !== "done" && <ClusterStatus station={stationId} compact />}

      <section className="panel review-top">
        <div className="paths">
          <div>
            <b>Output</b>
            {outDir || "-"}
          </div>
          <div>
            <b>Dataset</b>
            {`${DATASET_ROOT}\\${station.code}`}
          </div>
        </div>
        <div className="filters">
          <div className="seg">
            {(["All", ...VISIONS] as VisionFilter[]).map((v) => (
              <button key={v} className={vis === v ? "on" : ""} onClick={() => setVis(v)}>
                {v === "All" ? "ALL" : visionLabel(v).toUpperCase()}
              </button>
            ))}
          </div>
          <select className="select" style={{ width: 140 }} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            <option value="All">All regions</option>
            {station.regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <input className="input" placeholder="Search cell contains…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              setFlash({ kind: "ok", text: `Index ready: ${classes.length} class folders, ${remaining.length} crops to review.` });
            }}
          >
            Refresh index
          </button>
        </div>
      </section>

      {all.length === 0 ? (
        <section className="panel">
          <div className="state-note">
            Nothing fetched for {station.name} yet.
            <br />
            <Link to="/collect">Run a fetch on the Collect page</Link> - the crops land here, ready to review.
          </div>
        </section>
      ) : (
        <div className="review-body">
          <section className="panel list-panel">
            <h2>
              Classes <small>left / total</small>
            </h2>
            <div className="list">
              {classes.map((c) => (
                <button
                  key={c.key}
                  className={`list-row${c.key === activeClass ? " on" : ""}`}
                  onClick={() => {
                    setSelClass(c.key);
                    setSelId(null);
                  }}
                >
                  <span className="rail" />
                  <span className="main">
                    <span className="t1">{c.folder}</span>
                    <span className="t2">
                      {visionLabel(c.vision)}
                      {clusterRun?.result?.groups[c.key] && ` · ${clusterRun.result.groups[c.key].k} clusters`}
                    </span>
                  </span>
                  <span className="side">
                    {c.n}
                    <small>/ {c.total}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel list-panel">
            <h2>
              Occurrences <small>{occList.length.toLocaleString("en-US")}</small>
            </h2>
            <div className="list">
              {occList.length === 0 ? (
                <div className="list-empty">
                  {classes.find((c) => c.key === activeClass)?.n === 0
                    ? "Every crop in this class has been reviewed. Pick another class."
                    : "No crops match the current region / search."}
                </div>
              ) : (
                occList.map((o, i) => {
                  const c = assign?.[o.id];
                  const head = assign && (i === 0 || assign[occList[i - 1].id] !== c);
                  return (
                    <div key={o.id} style={{ display: "contents" }}>
                      {head && c !== undefined && (
                        <ClusterHead index={c} members={occList.filter((x) => assign[x.id] === c)} />
                      )}
                      <OccRow
                        o={o}
                        on={o.id === current?.id}
                        pair={station.pairLabel}
                        cluster={c}
                        onClick={() => setSelId(o.id)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel viewer-panel">
            {current ? (
              <>
                <div className="viewer-head">
                  <span className="viewer-cell">{current.cellKey}</span>
                  <div className="viewer-meta">
                    <span className="viewer-item">
                      <em>class</em>
                      <b>{current.classFolder}</b>
                    </span>
                    <span className="viewer-item">
                      <em>region</em>
                      <b>{current.region}</b>
                    </span>
                    <span className="viewer-item">
                      <em>pc</em>
                      <b>{current.pcKey}</b>
                    </span>
                    <span className="viewer-item">
                      <em>date</em>
                      <b>{current.date}</b>
                    </span>
                    {assign?.[current.id] !== undefined && (
                      <span className="viewer-item">
                        <em>cluster</em>
                        <b style={{ color: CLUSTER_COLORS[assign[current.id]] }}>C{assign[current.id] + 1}</b>
                      </span>
                    )}
                  </div>
                </div>
                <div className={`canvases${station.pairLabel ? "" : " solo"}`}>
                  <div ref={sourceFrame} style={{ minWidth: 0 }}>
                    <ImageCanvas src={imageFor(current, "source")} caption="SOURCEMAP" />
                  </div>
                  {station.pairLabel && (
                    <ImageCanvas
                      src={current.hasPair ? imageFor(current, "pair") : null}
                      caption={station.pairLabel.toUpperCase()}
                      missing={`No ${station.pairLabel} paired with this SourceMap`}
                    />
                  )}
                </div>
                <div className="verdict-bar">
                  <button className="btn real-ng" onClick={() => label("RealNG")}>
                    <kbd>1</kbd> Real NG
                  </button>
                  <button className="btn overkill" onClick={() => label("Overkill")}>
                    <kbd>2</kbd> Overkill
                  </button>
                  <button className="btn undo" onClick={undo} disabled={!canUndo}>
                    <kbd>Ctrl+Z</kbd> Undo
                  </button>
                </div>
              </>
            ) : (
              <div className="state-note">Select an occurrence to preview it.</div>
            )}
            <div className={`flash${flash ? ` ${flash.kind}` : ""}`}>
              {flash ? (
                <>
                  <span>{flash.text}</span>
                  {flash.path && <span className="path">{flash.path}</span>}
                </>
              ) : (
                <span style={{ color: "var(--text-faint)" }}>
                  {reviewedHere.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")} crops reviewed for {station.name}
                </span>
              )}
            </div>
            <dl className="guide">
              <div>
                <dt>
                  <kbd>1</kbd> / <kbd>2</kbd>
                </dt>
                <dd>Real NG / Overkill - copies the crop into the dataset and opens the next one</dd>
              </div>
              <div>
                <dt>
                  <kbd>Ctrl</kbd>+<kbd>Z</kbd>
                </dt>
                <dd>Undo the last copy and reselect that crop</dd>
              </div>
              <div>
                <dt>
                  <kbd>↑</kbd> <kbd>↓</kbd>
                </dt>
                <dd>Previous / next crop in the list</dd>
              </div>
              <div>
                <dt>
                  <kbd>Ctrl</kbd>+wheel
                </dt>
                <dd>Zoom at the cursor; drag to pan, double-click to reset</dd>
              </div>
            </dl>
          </section>

          <DatasetFolder
            stationId={stationId}
            records={stationLabels}
            activeClass={activeClass}
            hit={hit}
            onPickClass={(k) => {
              setSelClass(k);
              setSelId(null);
              const v = k.split("|")[0] as Vision;
              if (vis !== "All" && vis !== v) setVis(v);
            }}
          />
        </div>
      )}
    </main>
  );
}

/**
 * The dataset folder this review is writing into, live. The class under review is
 * opened to its RealNG and Overkill folders with the newest copies as thumbnails, so
 * every keypress is seen landing; the other classes stay folded to their counts.
 */
function DatasetFolder({
  stationId,
  records,
  activeClass,
  hit,
  onPickClass,
}: {
  stationId: string;
  records: LabelRecord[];
  activeClass: string | null;
  hit: { key: string; n: number } | null;
  onPickClass: (key: string) => void;
}) {
  const station = STATION_BY_ID[stationId];
  // vision|class -> label -> records, newest first
  const byClass = useMemo(() => {
    const m = new Map<string, { RealNG: LabelRecord[]; Overkill: LabelRecord[] }>();
    for (const r of [...records].sort((a, b) => b.at - a.at)) {
      const k = `${r.occ.vision}|${r.occ.classFolder}`;
      const e = m.get(k) ?? { RealNG: [], Overkill: [] };
      e[r.label].push(r);
      m.set(k, e);
    }
    return m;
  }, [records]);

  return (
    <section className="panel ds-panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h2>Dataset folder</h2>
        <span className="aside">{records.length.toLocaleString("en-US")} copied</span>
      </div>
      <div className="ds-root">{`${DATASET_ROOT}\\${station.code}\\`}</div>
      <div className="ds-tree">
        {VISIONS.map((v) => (
          <div key={v} className="ds-vision">
            <div className="ds-dir">
              <span className="ico">▾</span>
              {v}
            </div>
            {station.classes.map((cls) => {
              const k = `${v}|${cls}`;
              const e = byClass.get(k) ?? { RealNG: [], Overkill: [] };
              const open = k === activeClass;
              return (
                <div key={cls} className={`ds-class${open ? " open" : ""}`}>
                  <button className="ds-dir ds-cls" onClick={() => onPickClass(k)} title={`${v}\\${cls}`}>
                    <span className="ico">{open ? "▾" : "▸"}</span>
                    <span className="nm">{cls}</span>
                    {!open && (
                      <span className="sum">
                        <i className="r">{e.RealNG.length}</i>
                        <i className="o">{e.Overkill.length}</i>
                      </span>
                    )}
                  </button>
                  {open &&
                    (["RealNG", "Overkill"] as Label[]).map((lab) => {
                      const key = dropKey(v, cls, lab);
                      return (
                        <div
                          key={`${lab}-${hit?.key === key ? hit.n : 0}`}
                          className={`ds-label ${lab}${hit?.key === key ? " hit" : ""}`}
                          data-drop={key}
                          title={datasetDir(stationId, v, cls, lab)}
                        >
                          <div className="ds-label-head">
                            <span className="ico">▾</span>
                            <span className="nm">{lab}</span>
                            <span className="n">{e[lab].length}</span>
                          </div>
                          <div className="ds-thumbs">
                            {e[lab].length === 0 ? (
                              <span className="ds-empty">empty</span>
                            ) : (
                              e[lab].slice(0, 8).map((r) => (
                                <img key={r.occ.id} src={imageFor(r.occ, "source")} alt={r.occ.cellKey} title={r.occ.fileName} />
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * A copy of the SourceMap flies from the viewer into the folder it was copied to. The
 * folder is found by its data-drop key, which exists before the verdict lands because
 * the class under review is always the open one.
 */
function flyToFolder(o: Occurrence, from: HTMLElement | null, key: string) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const src = from?.querySelector(".canvas-frame");
  const dst = document.querySelector(`[data-drop="${CSS.escape(key)}"] .ds-thumbs`);
  if (!src || !dst) return;
  const a = src.getBoundingClientRect();
  const b = dst.getBoundingClientRect();
  const img = document.createElement("img");
  img.src = imageFor(o, "source");
  img.className = "ds-flyer";
  Object.assign(img.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(img);
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const s = 30 / a.height;
  const anim = img.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 0.95 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 40}px) scale(${(1 + s) / 2.4})`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.2 },
    ],
    { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  );
  anim.onfinish = () => img.remove();
  anim.oncancel = () => img.remove();
}

/** The heading of one cluster inside the occurrence list: its size and a few members. */
function ClusterHead({ index, members }: { index: number; members: Occurrence[] }) {
  return (
    <div className="cluster-head" style={{ ["--c" as string]: CLUSTER_COLORS[index] }}>
      <span className="dot" />
      <span className="nm">Cluster {index + 1}</span>
      <span className="n">{members.length}</span>
      <span className="thumbs">
        {members.slice(0, 3).map((m) => (
          <img key={m.id} src={imageFor(m, "source")} alt="" />
        ))}
      </span>
    </div>
  );
}

function OccRow({
  o,
  on,
  pair,
  cluster,
  onClick,
}: {
  o: Occurrence;
  on: boolean;
  pair: string | null;
  cluster?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`list-row${on ? " on" : ""}`}
      onClick={onClick}
      ref={(el) => {
        if (on && el) keepInView(el);
      }}
    >
      <span className="rail" style={cluster !== undefined && !on ? { background: CLUSTER_COLORS[cluster], opacity: 0.55 } : undefined} />
      <span className="main">
        <span className="t1">{o.cellKey}</span>
        <span className="t2">
          {o.region} · {o.pcKey}
        </span>
      </span>
      <span className="side pair">
        <span className="has">S</span>/{pair ? <span className={o.hasPair ? "has" : "no"}>{pair[0]}</span> : <span className="no">-</span>}
      </span>
    </button>
  );
}

/** Scroll only the list, never the page, to keep the selected row visible. */
function keepInView(el: HTMLElement) {
  const list = el.closest(".list") as HTMLElement | null;
  if (!list) return;
  if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
  else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
}
