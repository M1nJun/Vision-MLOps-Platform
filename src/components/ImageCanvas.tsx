import { useEffect, useRef, useState } from "react";

/**
 * One picture with its own zoom and pan - the desktop viewer's controls, on the web:
 * Ctrl + wheel zooms at the cursor, drag pans once zoomed, double-click resets.
 * The two frames zoom independently, so the caption says which one is magnified.
 */
export default function ImageCanvas({ src, caption, missing }: { src: string | null; caption: string; missing?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // A new picture starts unzoomed: a zoom carried over from the previous crop points
  // at a spot that means nothing on this one.
  useEffect(() => {
    setZ({ k: 1, x: 0, y: 0 });
  }, [src]);

  // Registered by hand: React's onWheel is passive, so it cannot stop the page scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZ((p) => {
        const k = Math.min(8, Math.max(1, p.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        if (k === 1) return { k: 1, x: 0, y: 0 };
        const f = k / p.k;
        return { k, x: cx - (cx - p.x) * f, y: cy - (cy - p.y) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <figure className="canvas">
      <figcaption>
        {caption}
        {z.k > 1 && <span className="canvas-zoom">{z.k.toFixed(1)}×</span>}
      </figcaption>
      <div
        ref={frame}
        className="canvas-frame"
        onDoubleClick={() => setZ({ k: 1, x: 0, y: 0 })}
        onPointerDown={(e) => {
          if (z.k === 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: z.x, y: z.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setZ((p) => ({ ...p, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {src ? (
          <img
            className="canvas-img"
            src={src}
            alt={caption}
            draggable={false}
            style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.k})` }}
          />
        ) : (
          <div className="canvas-state">{missing ?? "No image"}</div>
        )}
      </div>
    </figure>
  );
}
