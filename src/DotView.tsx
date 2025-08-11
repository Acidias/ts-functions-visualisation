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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isDraggingMiniRef = useRef(false);
  const [scrollDims, setScrollDims] = useState<{ left: number; top: number; clientW: number; clientH: number }>({ left: 0, top: 0, clientW: 0, clientH: 0 });
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
    const scrollParent = scrollRef.current; // our explicit scroll container
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

  // Track scroll and size of the scroll container for minimap viewport rectangle
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setScrollDims({ left: el.scrollLeft, top: el.scrollTop, clientW: el.clientWidth, clientH: el.clientHeight });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update as EventListener);
      ro.disconnect();
    };
  }, [scale, svg, naturalSize.w, naturalSize.h]);

  // Minimap sizing based on natural SVG size
  const mini = useMemo(() => {
    const maxW = 240;
    const maxH = 180;
    if (naturalSize.w <= 0 || naturalSize.h <= 0) return { w: 0, h: 0, s: 0 } as const;
    const s = Math.min(maxW / naturalSize.w, maxH / naturalSize.h);
    return { w: Math.max(1, Math.floor(naturalSize.w * s)), h: Math.max(1, Math.floor(naturalSize.h * s)), s } as const;
  }, [naturalSize.w, naturalSize.h]);

  // Viewport rectangle on minimap (in minimap pixels)
  const miniViewport = useMemo(() => {
    const { s: miniScale } = mini;
    if (miniScale <= 0 || scale <= 0) return { x: 0, y: 0, w: 0, h: 0 } as const;
    const wNat = scrollDims.clientW / scale;
    const hNat = scrollDims.clientH / scale;
    const xNat = scrollDims.left / scale;
    const yNat = scrollDims.top / scale;
    return {
      x: xNat * miniScale,
      y: yNat * miniScale,
      w: Math.max(8, wNat * miniScale),
      h: Math.max(8, hNat * miniScale),
    } as const;
  }, [mini, scrollDims.left, scrollDims.top, scrollDims.clientW, scrollDims.clientH, scale]);

  const panToMiniCoord = (mx: number, my: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const miniScale = mini.s;
    if (miniScale <= 0 || scale <= 0) return;
    const natX = mx / miniScale;
    const natY = my / miniScale;
    const targetLeft = natX * scale - el.clientWidth / 2;
    const targetTop = natY * scale - el.clientHeight / 2;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollLeft = Math.max(0, Math.min(maxLeft, targetLeft));
    el.scrollTop = Math.max(0, Math.min(maxTop, targetTop));
  };

  const onMiniMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    isDraggingMiniRef.current = true;
    panToMiniCoord(mx, my);
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingMiniRef.current) return;
      const r = rect; // stable during drag
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
      panToMiniCoord(x, y);
    };
    const onUp = () => {
      isDraggingMiniRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={scrollRef} style={{ position: "absolute", inset: 0, overflow: "auto" }}>
          <div style={{ width: scaledW, height: scaledH, position: "relative" }}>
            <div
              ref={svgHostRef}
              style={{ width: naturalSize.w, height: naturalSize.h, transform: `scale(${scale})`, transformOrigin: "0 0" }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>

        {mini.s > 0 && (
          <div
            onMouseDown={onMiniMouseDown}
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              width: mini.w,
              height: mini.h,
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              background: "rgba(255,255,255,0.9)",
              boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
              cursor: "pointer",
              zIndex: 5,
              overflow: "hidden",
            }}
            aria-label="Minimap"
            role="application"
          >
            <div style={{ width: mini.w, height: mini.h, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: naturalSize.w,
                  height: naturalSize.h,
                  transform: `scale(${mini.s})`,
                  transformOrigin: "0 0",
                  pointerEvents: "none",
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <div
                style={{
                  position: "absolute",
                  left: miniViewport.x,
                  top: miniViewport.y,
                  width: miniViewport.w,
                  height: miniViewport.h,
                  border: "2px solid #0ea5e9",
                  background: "rgba(14,165,233,0.08)",
                  boxSizing: "border-box",
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        )}
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


