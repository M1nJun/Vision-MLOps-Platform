import { useState } from "react";
import { MAX_RANGE_DAYS, selectionDays, type DateMode, type DateSelection } from "../sim/collect";
import { PCS } from "../sim/fleet";

/**
 * Single date, an inclusive range, or a hand-picked set - the three ways engineers
 * actually asked for "the crops from …". Specific dates exist because a review is
 * usually about the days a problem showed up, which are rarely consecutive.
 */
export function DateSelector({ value, onChange }: { value: DateSelection; onChange: (v: DateSelection) => void }) {
  const [pending, setPending] = useState(value.single);
  const days = selectionDays(value);
  const modes: [DateMode, string][] = [
    ["single", "SINGLE DATE"],
    ["range", "DATE RANGE"],
    ["specific", "SPECIFIC DATES"],
  ];

  return (
    <div className="date-box">
      <div className="seg">
        {modes.map(([m, label]) => (
          <button key={m} className={value.mode === m ? "on" : ""} onClick={() => onChange({ ...value, mode: m })}>
            {label}
          </button>
        ))}
      </div>

      {value.mode === "single" && (
        <div className="row">
          <input className="input" type="date" value={value.single} onChange={(e) => onChange({ ...value, single: e.target.value })} />
        </div>
      )}

      {value.mode === "range" && (
        <div className="row">
          <input className="input" type="date" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
          <span className="date-days">→</span>
          <input className="input" type="date" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
        </div>
      )}

      {value.mode === "specific" && (
        <>
          <div className="row">
            <input className="input" type="date" value={pending} onChange={(e) => setPending(e.target.value)} />
            <button
              className="btn"
              disabled={!pending || value.specific.includes(pending)}
              onClick={() => onChange({ ...value, specific: [...value.specific, pending].sort() })}
            >
              + Add date
            </button>
          </div>
          <div className="date-chips">
            {value.specific.map((d) => (
              <span className="date-chip" key={d}>
                {d}
                <button aria-label={`Remove ${d}`} onClick={() => onChange({ ...value, specific: value.specific.filter((x) => x !== d) })}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="date-days">
        {days.length ? `${days.length} day${days.length > 1 ? "s" : ""}: ${days[0]}${days.length > 1 ? ` … ${days[days.length - 1]}` : ""}` : "No valid dates selected"}
        {value.mode === "range" && ` (max ${MAX_RANGE_DAYS})`}
      </div>
    </div>
  );
}

/** Remote PC checkboxes, laid out the way the floor is: line by line, one vision beside the other. */
export function PcPicker({
  selected,
  onChange,
  columns = 4,
  disabled,
}: {
  selected: string[];
  onChange: (keys: string[]) => void;
  columns?: 2 | 4;
  disabled?: boolean;
}) {
  const set = new Set(selected);
  const toggle = (k: string) => onChange(set.has(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div className="pc-picker">
      <div className="tools">
        <button className="btn" disabled={disabled} onClick={() => onChange(PCS.map((p) => p.key))}>
          Select all
        </button>
        <button className="btn" disabled={disabled} onClick={() => onChange([])}>
          None
        </button>
        <span className="count">
          {selected.length} / {PCS.length} PCs · loaded from pcs.json
        </span>
      </div>
      <div className={`pc-grid${columns === 2 ? " cols-2x" : ""}`}>
        {PCS.map((pc) => (
          <button
            key={pc.key}
            className={`pc-chip${set.has(pc.key) ? " on" : ""}`}
            disabled={disabled}
            onClick={() => toggle(pc.key)}
            title={`${pc.key} - ${pc.ip}`}
            aria-pressed={set.has(pc.key)}
          >
            <span className="box">{set.has(pc.key) ? "✓" : ""}</span>
            <span className="k">{pc.key}</span>
            <span className="ip">.{pc.ip.split(".").pop()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
