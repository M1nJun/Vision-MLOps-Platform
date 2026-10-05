import { Link, useNavigate } from "react-router-dom";
import { timeAgo } from "../components/common";
import { LINES, PCS, VISIONS, visionLabel, type Vision } from "../sim/fleet";
import { useStore } from "../sim/store";

/**
 * The loop at a glance: how much is waiting at each stage, and what every vision PC
 * is running. The fleet grid takes the production dashboard's layout - lines across,
 * visions down - so an engineer who knows one screen can read the other.
 */
export default function OverviewPage() {
  const { state } = useStore();
  const navigate = useNavigate();

  const collected = Object.values(state.collected).reduce((n, v) => n + v.length, 0);
  const labels = Object.values(state.labels);
  const reviewed = labels.length;
  const pending = collected - Object.values(state.collected).reduce((n, v) => n + v.filter((o) => state.labels[o.id]).length, 0);
  const realNg = labels.filter((l) => l.label === "RealNG").length;
  const latestPkgs = new Set(state.packages.map((p) => p.name));
  const clusterRuns = Object.values(state.clusters);
  const clustering = clusterRuns.some((c) => c.status === "running");
  const clusterCount = clusterRuns.reduce(
    (n, c) => n + Object.values(c.result?.groups ?? {}).reduce((s, g) => s + g.k, 0),
    0,
  );
  const upToDate = PCS.filter((p) => (state.fleet[p.key] ?? []).some((f) => latestPkgs.has(f.version))).length;

  const stages = [
    {
      no: "01",
      name: "Collect",
      to: "/collect",
      desc: "Fetch NG crops and result CSVs from every vision PC over SMB",
      fig: collected.toLocaleString("en-US"),
      unit: "crops",
    },
    {
      no: "02",
      name: "Cluster",
      to: "/collect",
      desc: "Inside each DL class, group look-alike crops: MobileNet embeddings + k-means",
      fig: clustering ? "…" : String(clusterCount),
      unit: clustering ? "running" : "clusters",
    },
    {
      no: "03",
      name: "Review",
      to: "/review",
      desc: "Engineers call Real NG or Overkill, one key per crop",
      fig: pending.toLocaleString("en-US"),
      unit: "waiting",
      attention: pending > 0,
    },
    {
      no: "04",
      name: "Curate",
      to: "/dataset",
      desc: "Each verdict copies the crop into the training dataset folder",
      fig: reviewed.toLocaleString("en-US"),
      unit: "labelled",
    },
    {
      no: "05",
      name: "Deploy",
      to: "/deploy",
      desc: "Inject the retrained model to many PCs, with backup",
      fig: `${upToDate}/${PCS.length}`,
      unit: "on latest",
    },
  ];

  const started = new Date(state.sessionStart);
  const today = started.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const deploys = state.deploys.filter((d) => !d.dryRun).length;

  return (
    <main className="page">
      <section className="session-bar" aria-label="Today's session">
        <span className="tag">TODAY'S SESSION</span>
        <span className="day">{today}</span>
        <span className="meta">
          started <b>{started.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b> · reviewing{" "}
          <b>yesterday's shift</b> · {state.activity.length} actions so far
        </span>
        <span className="spacer" />
        <span className="meta">
          {reviewed.toLocaleString("en-US")} reviewed · {deploys} deployed today
        </span>
      </section>

      <div className="stat-row">
        <div className="stat green">
          <div className="label">Vision PCs</div>
          <div className="value">{PCS.length}</div>
          <div className="sub">
            {LINES.length} lines × {VISIONS.length} visions
          </div>
        </div>
        <div className="stat">
          <div className="label">NG crops collected today</div>
          <div className="value">{collected.toLocaleString("en-US")}</div>
          <div className="sub">{Object.keys(state.collected).length} models</div>
        </div>
        <div className="stat yellow">
          <div className="label">Awaiting review</div>
          <div className="value">{pending.toLocaleString("en-US")}</div>
          <div className="sub">{collected ? Math.round((reviewed / collected) * 100) : 0}% reviewed</div>
        </div>
        <div className="stat red">
          <div className="label">Confirmed Real NG</div>
          <div className="value">{realNg.toLocaleString("en-US")}</div>
          <div className="sub">{reviewed ? Math.round(((reviewed - realNg) / reviewed) * 100) : 0}% of calls were overkill</div>
        </div>
        <div className="stat">
          <div className="label">Deployments</div>
          <div className="value">{deploys}</div>
          <div className="sub">{state.deploys.filter((d) => d.dryRun).length} dry runs today</div>
        </div>
      </div>

      <section className="pipeline" aria-label="MLOps loop">
        {stages.map((s) => (
          <Link key={s.no} to={s.to} className={`stage${s.attention ? " attention" : ""}`}>
            <span className="no">{s.no}</span>
            <span className="name">{s.name}</span>
            <span className="desc">{s.desc}</span>
            <span className="fig">
              {s.fig}
              <small>{s.unit}</small>
            </span>
          </Link>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Fleet</h2>
          <span className="aside">deployed Model 1 package · click a PC to deploy</span>
        </div>
        <div className="fleet-wrap">
          <div className="fleet">
            <div />
            {LINES.map((l) => (
              <div key={l} className="fleet-head">
                {l}
              </div>
            ))}
            {VISIONS.map((v) => (
              <FleetRow key={v} vision={v} latest={latestPkgs} onPick={() => navigate("/deploy")} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Today's activity</h2>
        <div className="activity">
          {state.activity.slice(0, 12).map((a, i) => (
            <div key={i} className="activity-row">
              <span className="when">{timeAgo(a.at)}</span>
              <span>
                <span className={`chip ${a.kind}`}>{a.kind.toUpperCase()}</span>
              </span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function FleetRow({ vision, latest, onPick }: { vision: Vision; latest: Set<string>; onPick: () => void }) {
  const { state } = useStore();
  return (
    <>
      <div className="fleet-row-head">{visionLabel(vision)}</div>
      {LINES.map((line) => {
        const pc = PCS.find((p) => p.line === line && p.vision === vision)!;
        const m1 = (state.fleet[pc.key] ?? []).find((f) => f.name.toLowerCase() === "model_1");
        const fresh = m1 && latest.has(m1.version);
        return (
          <button key={pc.key} className={`pc-cell${fresh ? " fresh" : ""}`} onClick={onPick} title={`${pc.key} · ${pc.ip}`}>
            <span className="live ONLINE">ONLINE</span>
            <span className="ip">{pc.ip}</span>
            <span className="ver">{m1?.version.replace("Model1_DL_", "") ?? "-"}</span>
          </button>
        );
      })}
    </>
  );
}
