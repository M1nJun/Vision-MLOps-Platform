import { useEffect, useRef, type ReactNode } from "react";
import { STATIONS } from "../sim/fleet";

/** One segmented control across the DL models - the desktop tool's top-level tabs. */
export function StationTabs({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="DL model">
      {STATIONS.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={value === s.id}
          className={value === s.id ? "on" : ""}
          onClick={() => onChange(s.id)}
        >
          {s.name.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function lineClass(line: string): string {
  if (line.includes("[WARN]") || line.includes("[SKIP]")) return "l-warn";
  if (line.includes("[ERROR]") || line.includes("FAILED")) return "l-err";
  if (line.includes("[DONE]")) return "l-done";
  if (line.includes("[OK]")) return "l-ok";
  if (line.includes("RealNG")) return "l-label-RealNG";
  if (line.includes("Overkill")) return "l-label-Overkill";
  if (line.startsWith("----")) return "l-faint";
  return "";
}

/** A log that follows its own tail unless the reader has scrolled up to read. */
export function LogView({ lines, height = 220, empty = "Logs will appear here…" }: { lines: string[]; height?: number; empty?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className="log"
      style={{ height }}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      }}
    >
      {lines.length === 0 ? (
        <span className="empty">{empty}</span>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={lineClass(l)}>
            {l}
          </div>
        ))
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  foot,
  onClose,
  wide,
}: {
  title: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function PageHead({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
    </div>
  );
}

export function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function hhmmss(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour12: false });
}
