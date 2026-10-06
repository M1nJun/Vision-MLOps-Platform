import { STATION_BY_ID } from "../sim/fleet";
import { useStore } from "../sim/store";

/** Colours for cluster 1..4, used wherever a cluster is marked. */
export const CLUSTER_COLORS = ["#6ea8fe", "#c792ea", "#5fd3bc", "#f7a072"];

/**
 * Where the automatic clustering of a model's crops has got to. Shown under the fetch
 * that started it and above the review that uses it.
 */
export default function ClusterStatus({ station, compact }: { station: string; compact?: boolean }) {
  const { state } = useStore();
  const c = state.clusters[station];
  const n = state.collected[station]?.length ?? 0;
  // Nothing to report until the user has run a fetch for this model.
  if (!n || (!c && !state.clusterPending.includes(station))) return null;

  if (!c || c.status === "running") {
    const label = !c
      ? "Queued"
      : c.phase === "loading"
        ? `Loading ${c.method}…`
        : c.phase === "embedding"
          ? `Embedding ${c.done.toLocaleString("en-US")} / ${c.total.toLocaleString("en-US")} crops`
          : `k-means within each class ${c.done} / ${c.total}`;
    const pct = !c || c.phase === "loading" ? 4 : c.phase === "embedding" ? 4 + (c.done / c.total) * 80 : 84 + (c.done / Math.max(1, c.total)) * 16;
    return (
      <div className={`cluster-status running${compact ? " compact" : ""}`}>
        <span className="tag">CLUSTERING</span>
        <span className="what">
          {STATION_BY_ID[station].name} · {label}
          {c && c.phase !== "loading" && <span className="dim"> · {c.method}</span>}
        </span>
        <div className="progress data">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  const r = c.result!;
  const k = Object.values(r.groups).reduce((s, g) => s + g.k, 0);
  return (
    <div className={`cluster-status done${compact ? " compact" : ""}`}>
      <span className="tag">CLUSTERED</span>
      <span className="what">
        {Object.keys(r.assign).length.toLocaleString("en-US")} crops → <b>{k} clusters</b> across{" "}
        {Object.keys(r.groups).length} vision × class groups
      </span>
      {!compact && (
        <span className="how">
          {r.method} embeddings → PCA (12-d) → k-means++ · k = 2–4 per class by silhouette · {(r.ms / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}
