import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "./analysis";
import { generateDot } from "./dot";

type DotViewProps = {
  graph: Graph;
};

export function DotView({ graph }: DotViewProps) {
  const [svg, setSvg] = useState<string>("");
  const [scale, setScale] = useState<number>(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 1200, h: 800 });
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const dot = useMemo(() => generateDot(graph), [graph]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        // dynamic import to keep bundle slim
        const vizMod = await import("@viz-js/viz");
        const viz = await vizMod.instance();
        const out = viz.renderSVGElement(dot);
        if (!cancelled) setSvg(out.outerHTML);
      } catch (err) {
        if (!cancelled) setSvg(`<pre style="padding:12px">${escapeHtml(String(err))}</pre>`);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [dot]);

  // After SVG is injected, measure its intrinsic size (prefer viewBox, fallback to getBBox)
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const el = host.querySelector("svg") as SVGSVGElement | null;
    if (!el) return;
    let w = Number(el.viewBox?.baseVal?.width || 0);
    let h = Number(el.viewBox?.baseVal?.height || 0);
    if (!w || !h) {
      try {
        const bbox = (el as unknown as { getBBox: () => { width: number; height: number } }).getBBox?.();
        if (bbox && bbox.width && bbox.height) {
          w = bbox.width;
          h = bbox.height;
        }
      } catch {
        // ignore
      }
    }
    if (!w || !h) {
      const ww = Number(el.width?.baseVal?.value || 0);
      const hh = Number(el.height?.baseVal?.value || 0);
      if (ww && hh) {
        w = ww;
        h = hh;
      }
    }
    if (Number.isFinite(w) && Number.isFinite(h)) setNaturalSize({ w, h });
  }, [svg]);

  // Auto-fit once when SVG and container are ready
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const scrollParent = host.parentElement?.parentElement; // size box parent is a fixed-size wrapper; its parent is scroller
    if (!scrollParent) return;
    const availW = scrollParent.clientWidth - 16; // padding
    const availH = scrollParent.clientHeight - 16;
    if (availW > 0 && availH > 0 && naturalSize.w > 0 && naturalSize.h > 0) {
      const s = Math.min(availW / naturalSize.w, availH / naturalSize.h);
      // only set if different and only first time
      setScale((prev) => (Math.abs(prev - s) > 0.001 ? s : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, naturalSize.w, naturalSize.h]);

  const scaledW = Math.max(1, Math.floor(naturalSize.w * scale));
  const scaledH = Math.max(1, Math.floor(naturalSize.h * scale));

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid #eee", background: "#fafafa", alignItems: "center" }}>
        <button
          onClick={() => downloadFile("function-call-graph.dot", dot)}
          style={{ padding: "6px 10px" }}
        >
          Download DOT
        </button>
        <button
          onClick={() => downloadFile("function-call-graph.svg", svg)}
          style={{ padding: "6px 10px" }}
        >
          Download SVG
        </button>
        <div style={{ marginLeft: 8, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setScale((s) => Math.max(0.05, Math.round((s - 0.1) * 10) / 10))}
            style={{ padding: "6px 10px" }}
            aria-label="Zoom out"
          >
            −
          </button>
          <span style={{ minWidth: 52, textAlign: "center", fontSize: 12 }}>{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(8, Math.round((s + 0.1) * 10) / 10))}
            style={{ padding: "6px 10px" }}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ width: scaledW, height: scaledH, position: "relative" }}>
          <div
            ref={svgHostRef}
            style={{ width: naturalSize.w, height: naturalSize.h, transform: `scale(${scale})`, transformOrigin: "0 0" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
}

function downloadFile(name: string, content: string) {
  const blob = new Blob([content], { type: name.endsWith(".svg") ? "image/svg+xml" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


