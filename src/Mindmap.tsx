import type { Graph } from "./analysis";
import { computeGroupedLayout, computeRadialLayout } from "./layout";

type MindmapProps = {
  graph: Graph;
  groupByFile?: boolean;
};

export function Mindmap({ graph, groupByFile = true }: MindmapProps) {
  const size = 1400;

  // compute positions
  const nodePositions = new Map<string, { x: number; y: number }>();
  const clusters: Array<{
    key: string;
    rect: { x: number; y: number; w: number; h: number };
    label: string;
    members: string[]; // node ids
  }> = [];

  if (groupByFile && graph.nodes.length > 0) {
    const layout = computeGroupedLayout(graph, size);
    for (const [id, p] of layout.positions) nodePositions.set(id, p);
    clusters.push(
      ...layout.clusters.map((c) => ({ key: c.key, rect: c.rect, label: c.label, members: c.members }))
    );

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}>
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#999" />
          </marker>
        </defs>

        {clusters.map((c) => (
          <g key={c.key}>
            <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} rx={8} fill="#f1f5f9" stroke="#e2e8f0" />
            <text x={c.rect.x + 10} y={c.rect.y + 16} fontSize={12} fontWeight={600} fontFamily="ui-sans-serif, system-ui" fill="#475569">
              {c.label}
            </text>
          </g>
        ))}

        {graph.edges.map((e, idx) => {
          const a = nodePositions.get(e.from);
          const b = nodePositions.get(e.to);
          if (!a || !b) return null;
          // curved edge for readability
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2 - 20; // offset
          const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
          const color = e.crossFile ? "#dc2626" : "#9CA3AF";
          return (
            <path key={idx} d={d} fill="none" stroke={color} strokeWidth={1.6} markerEnd="url(#arrow)" />
          );
        })}

        {graph.nodes.map((n) => {
          const p = nodePositions.get(n.id);
          if (!p) return null;
          const fill = n.isAsync ? "#d5f5e3" : "#e8f0fe";
          const stroke = n.isAsync ? "#27ae60" : "#3b82f6";
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={18} fill={fill} stroke={stroke} />
              <text x={p.x} y={p.y + 30} textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize={11} fill="#334155">
                {n.className ? `${n.className}.${n.label}` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // fallback: radial layout without grouping
  const radial = computeRadialLayout(graph, size);
  for (const [id, p] of radial.positions) nodePositions.set(id, p);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${radial.svgWidth} ${radial.svgHeight}`}>
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#999" />
        </marker>
      </defs>
      {graph.edges.map((e, idx) => {
        const a = nodePositions.get(e.from)!;
        const b = nodePositions.get(e.to)!;
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - 20;
        const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
        const color = e.crossFile ? "#dc2626" : "#9CA3AF";
        return <path key={idx} d={d} fill="none" stroke={color} strokeWidth={1.6} markerEnd="url(#arrow)" />;
      })}
      {graph.nodes.map((n) => {
        const p = nodePositions.get(n.id)!;
        if (!p) return null;
        const fill = n.isAsync ? "#d5f5e3" : "#e8f0fe";
        const stroke = n.isAsync ? "#27ae60" : "#3b82f6";
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={18} fill={fill} stroke={stroke} />
            <text x={p.x} y={p.y + 30} textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize={11} fill="#334155">
              {n.className ? `${n.className}.${n.label}` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


