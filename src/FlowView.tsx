import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, MarkerType, Position, applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { Node as FlowNode, Edge as FlowEdge, ReactFlowInstance, NodeChange, EdgeChange, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph } from "./analysis";
import { computeHierarchicalLayout, computeElkFileClassLayout } from "./layout";
 

export function FlowView({ graph, groupByFile = true }: { graph: Graph; groupByFile?: boolean }) {
  const [elkNodes, setElkNodes] = useState<FlowNode[]>([]);
  const [elkEdges, setElkEdges] = useState<FlowEdge[]>([]);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const layoutRunCounter = useRef(0);
  const FILE_GROUP_EXTRA = { width: 80, height: 120 } as const;
  const CLASS_GROUP_EXTRA = { width: 32, height: 60 } as const;
  const FILE_HEADER_H = 22; // compact header; content can overlap beneath
  const CLASS_HEADER_H = 18;
  const FILE_CONTENT_PAD = 8;
  const CLASS_CONTENT_PAD = 6;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!groupByFile) {
        setElkNodes([]);
        setElkEdges([]);
        return;
      }
      const layout = await computeElkFileClassLayout(graph);

      // create leaf function nodes first (positions are absolute from ELK for now)
      const leafNodes: FlowNode[] = graph.nodes.map((n) => {
        const p = layout.positions.get(n.id) ?? { x: 0, y: 0 };
        return {
          id: n.id,
          // show only function/method name; class appears in group header
          data: { label: n.label },
          position: { x: p.x, y: p.y },
          style: {
            border: `1px solid ${n.isAsync ? "#27ae60" : "#3b82f6"}`,
            background: n.isAsync ? "#d5f5e3" : "#e8f0fe",
            padding: 8,
            borderRadius: 8,
            fontSize: 12,
            width: 180,
            minHeight: 48,
            boxSizing: "border-box",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        } satisfies FlowNode;
      });

      // add group nodes
      const groupNodes: FlowNode[] = [];
      for (const fg of layout.fileGroups) {
        groupNodes.push({
          id: fg.id,
          type: "group",
          data: { label: fg.label },
          // center the original content within the expanded container
          position: { x: fg.rect.x - FILE_GROUP_EXTRA.width / 2, y: fg.rect.y - FILE_GROUP_EXTRA.height / 2 },
          style: {
            width: fg.rect.w + FILE_GROUP_EXTRA.width,
            height: fg.rect.h + FILE_GROUP_EXTRA.height,
            border: "1px solid #e2e8f0",
            background: "#f3f4f6",
            borderRadius: 10,
            padding: 0,
            boxSizing: "border-box",
            overflow: "hidden",
            zIndex: 0,
          },
        } as FlowNode);
      }
      for (const cg of layout.classGroups) {
        const parent = layout.fileGroups.find((f) => f.id === cg.fileId)!;
        groupNodes.push({
          id: cg.id,
          type: "group",
          parentId: cg.fileId,
          extent: "parent",
          data: { label: cg.label },
          // shift by parent expansion to keep centered in file group
          position: {
            x: (cg.rect.x - parent.rect.x) + FILE_GROUP_EXTRA.width / 2,
            y: (cg.rect.y - parent.rect.y) + FILE_GROUP_EXTRA.height / 2,
          },
          style: {
            width: cg.rect.w + CLASS_GROUP_EXTRA.width,
            height: cg.rect.h + CLASS_GROUP_EXTRA.height,
            border: "1px solid #93c5fd",
            background: "#eff6ff",
            borderRadius: 8,
            padding: 0,
            boxSizing: "border-box",
            overflow: "hidden",
            zIndex: 1,
          },
        } as FlowNode);
      }

      // parent membership: attach nodes under their class group if any, else under file group
      const fileKeyToFileId = new Map(layout.fileGroups.map((f) => [f.key, f.id] as const));
      const classKeyToId = new Map(layout.classGroups.map((c) => [`${c.fileId}:${c.className}`, c.id] as const));
      const adjustedNodes: FlowNode[] = leafNodes.map((node) => {
        const original = graph.nodes.find((gn) => gn.id === node.id);
        if (!original) return node;
        const fileId = fileKeyToFileId.get(original.fileKey);
        const clsId = original.className ? classKeyToId.get(`${fileId}:${original.className}`) : undefined;
        if (clsId) {
          const cg = layout.classGroups.find((g) => g.id === clsId)!;
          return {
            ...node,
            parentId: clsId,
            extent: "parent",
            // draggable within parent extent
            draggable: true,
            position: {
              x: Math.max(CLASS_CONTENT_PAD, ((node.position?.x ?? 0) - cg.rect.x) + CLASS_GROUP_EXTRA.width / 2),
              y: Math.max(CLASS_CONTENT_PAD, ((node.position?.y ?? 0) - cg.rect.y) + CLASS_GROUP_EXTRA.height / 2),
            },
          } as FlowNode;
        }
        if (fileId) {
          const fg = layout.fileGroups.find((g) => g.id === fileId)!;
          return {
            ...node,
            parentId: fileId,
            extent: "parent",
            draggable: true,
            position: {
              x: Math.max(FILE_CONTENT_PAD, ((node.position?.x ?? 0) - fg.rect.x) + FILE_GROUP_EXTRA.width / 2),
              y: Math.max(FILE_CONTENT_PAD, ((node.position?.y ?? 0) - fg.rect.y) + FILE_GROUP_EXTRA.height / 2),
            },
          } as FlowNode;
        }
        return node;
      });

      const flowEdges: FlowEdge[] = graph.edges.map((e, i) => ({
        id: `${e.from}->${e.to}-${i}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        animated: false,
        style: { stroke: e.crossFile ? "#dc2626" : "#9CA3AF" },
        markerEnd: { type: MarkerType.ArrowClosed, color: e.crossFile ? "#dc2626" : "#9CA3AF" },
      } satisfies FlowEdge));

      if (!cancelled) {
        // groups first to stay visually behind children
        setElkNodes([...groupNodes, ...adjustedNodes]);
        setElkEdges(flowEdges);
        // fit after layout completes
        const runId = ++layoutRunCounter.current;
        requestAnimationFrame(() => {
          if (layoutRunCounter.current === runId) rfRef.current?.fitView({ padding: 0.2 });
        });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [graph, groupByFile, FILE_GROUP_EXTRA.height, FILE_GROUP_EXTRA.width, CLASS_GROUP_EXTRA.height, CLASS_GROUP_EXTRA.width]);

  // Drag handlers for group mode
  const onNodesChange = (changes: NodeChange[]) => {
    if (!groupByFile) return;
    setElkNodes((nds) => applyNodeChanges(changes, nds));
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    if (!groupByFile) return;
    setElkEdges((eds) => applyEdgeChanges(changes, eds));
  };

  const { nodes, edges } = useMemo(() => {
    if (groupByFile) {
      // when groupByFile, we now rely on ELK-built nodes/edges kept in state
      return { nodes: elkNodes, edges: elkEdges };
    }

    // non-grouped:
    // If graph contains only modules, place horizontally along the left
    const allModules = graph.nodes.length > 0 && graph.nodes.every((n) => n.role === "module");
    let positions: Map<string, { x: number; y: number }>;
    if (allModules) {
      positions = new Map();
      const padding = 60;
      const gapX = 220;
      const y = padding;
      graph.nodes
        .slice()
        .sort((a, b) => (a.fileKey || "").localeCompare(b.fileKey || ""))
        .forEach((n, i) => {
          positions.set(n.id, { x: padding + i * gapX, y });
        });
    } else {
      const lay = computeHierarchicalLayout(graph, { columnGap: 260, rowGap: 84, padding: 60 });
      positions = lay.positions;
    }
    const flowNodes: FlowNode[] = graph.nodes.map((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        data: { label: n.className ? `${n.className}.${n.label}` : n.label },
        position: { x: p.x, y: p.y },
        style: {
          border: `1px solid ${n.isAsync ? "#27ae60" : "#3b82f6"}`,
          background: n.isAsync ? "#d5f5e3" : "#e8f0fe",
          padding: 8,
          borderRadius: 8,
          fontSize: 12,
          width: 180,
          minHeight: 48,
          boxSizing: "border-box",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      } satisfies FlowNode;
    });
    const flowEdges: FlowEdge[] = graph.edges.map((e, i) => ({
      id: `${e.from}->${e.to}-${i}`,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      animated: false,
      style: { stroke: e.crossFile ? "#dc2626" : "#9CA3AF" },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.crossFile ? "#dc2626" : "#9CA3AF" },
    } satisfies FlowEdge));
    return { nodes: flowNodes, edges: flowEdges };
  }, [graph, groupByFile, elkNodes, elkEdges]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={groupByFile ? onNodesChange : undefined}
        onEdgesChange={groupByFile ? onEdgesChange : undefined}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onInit={(inst: ReactFlowInstance) => {
          rfRef.current = inst;
          inst.fitView({ padding: 0.2 });
        }}
        nodeTypes={{
          group: ({ id, data }: NodeProps) => {
            const isFile = String(id).startsWith("group:file:");
            const headerH = isFile ? FILE_HEADER_H : CLASS_HEADER_H;
            const headerBg = isFile ? "#e5e7eb" : "#dbeafe";
            const headerBorder = isFile ? "#e2e8f0" : "#bfdbfe";
            return (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: headerH,
                    background: headerBg,
                    borderBottom: `1px solid ${headerBorder}`,
                    borderTopLeftRadius: 10,
                    borderTopRightRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 8,
                    paddingRight: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    pointerEvents: "none",
                    zIndex: 3, // header always on top of content
                  }}
                  title={String(data?.label ?? "")}
                >
                  {String(data?.label ?? "")}
                </div>
              </div>
            );
          },
        }}
      >
        <Background gap={16} color="#f1f5f9" />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}


