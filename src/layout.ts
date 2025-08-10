import type { Graph } from "./analysis";

export type ClusterRect = { x: number; y: number; w: number; h: number };

export type GroupedLayout = {
  positions: Map<string, { x: number; y: number }>;
  clusters: Array<{ key: string; rect: ClusterRect; label: string; members: string[] }>;
  svgWidth: number;
  svgHeight: number;
};

export function computeGroupedLayout(graph: Graph, width = 1400): GroupedLayout {
  const positions = new Map<string, { x: number; y: number }>();
  const clusters: GroupedLayout["clusters"] = [];

  const groups = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!groups.has(n.fileKey)) groups.set(n.fileKey, []);
    groups.get(n.fileKey)!.push(n.id);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const cols = Math.ceil(Math.sqrt(groupEntries.length || 1));
  const rows = Math.ceil((groupEntries.length || 1) / cols);
  const padding = 40;
  const clusterW = Math.max(360, Math.floor((width - padding * (cols + 1)) / cols));
  const clusterH = 280;
  const svgHeight = rows * (clusterH + padding) + padding;

  groupEntries.forEach(([key, nodeIds], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padding + col * (clusterW + padding);
    const y = padding + row * (clusterH + padding);
    clusters.push({ key, rect: { x, y, w: clusterW, h: clusterH }, label: key, members: nodeIds });
  });

  for (const c of clusters) {
    const innerPad = 24;
    const innerW = c.rect.w - innerPad * 2;
    const innerH = c.rect.h - innerPad * 2 - 18;
    const perRow = Math.max(1, Math.floor(innerW / 180));
    const cellW = innerW / perRow;
    const cellH = Math.max(100, innerH / Math.ceil(Math.max(1, c.members.length) / perRow));
    c.members.forEach((id, idx) => {
      const col = idx % perRow;
      const row = Math.floor(idx / perRow);
      const x = c.rect.x + innerPad + col * cellW + cellW / 2;
      const y = c.rect.y + innerPad + 18 + row * cellH + cellH / 2;
      positions.set(id, { x, y });
    });
  }

  return { positions, clusters, svgWidth: width, svgHeight: Math.max(svgHeight, 800) };
}

export function computeRadialLayout(graph: Graph, size = 1400): {
  positions: Map<string, { x: number; y: number }>;
  svgWidth: number;
  svgHeight: number;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const radius = size / 2 - 80;
  const count = Math.max(1, graph.nodes.length);
  const center = { x: size / 2, y: size / 2 };
  graph.nodes.forEach((n, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = radius * (0.6 + 0.4 * ((i % 5) / 5));
    const x = center.x + Math.cos(angle) * r;
    const y = center.y + Math.sin(angle) * r;
    positions.set(n.id, { x, y });
  });
  return { positions, svgWidth: size, svgHeight: size };
}

export type FileClassLayout = {
  positions: Map<string, { x: number; y: number }>;
  fileGroups: Array<{ id: string; key: string; rect: ClusterRect; label: string }>;
  classGroups: Array<{ id: string; fileId: string; className: string; rect: ClusterRect; label: string }>;
  svgWidth: number;
  svgHeight: number;
};

// Compute nested grouping: files -> classes. Top-level functions go directly under the file group.
export function computeFileClassLayout(graph: Graph, width = 1600): FileClassLayout {
  const positions = new Map<string, { x: number; y: number }>();
  const fileGroups: FileClassLayout["fileGroups"] = [];
  const classGroups: FileClassLayout["classGroups"] = [];

  // group node ids for parenting
  const fileGroupIdForKey = (key: string) => `group:file:${key}`;
  const classGroupId = (fileKey: string, cls: string) => `group:cls:${fileKey}:${cls}`;

  // group by file
  const byFile = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!byFile.has(n.fileKey)) byFile.set(n.fileKey, []);
    byFile.get(n.fileKey)!.push(n.id);
  }
  const entries = Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const cols = Math.ceil(Math.sqrt(Math.max(1, entries.length)));
  const padding = 40;
  const clusterW = Math.max(420, Math.floor((width - padding * (cols + 1)) / cols));
  const defaultClusterH = 280; // may grow depending on contents

  // Place file groups in a grid (initial y will be normalized later after computing real heights)
  const fileRects: Array<{ key: string; rect: ClusterRect; row: number; col: number; id: string }> = entries.map(
    ([key], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (clusterW + padding);
      const y = padding + row * (defaultClusterH + padding);
      const id = fileGroupIdForKey(key);
      return { key, rect: { x, y, w: clusterW, h: defaultClusterH }, row, col, id };
    }
  );

  // Layout classes & nodes within each file group, adjust heights
  // Keep track of node ids per file for later y-shift normalization
  const idsPerFile = new Map<string, string[]>();

  for (const { key: fileKey, rect, id: fileId } of fileRects) {
    const innerPad = 24;
    const headerH = 18;
    const innerX = rect.x + innerPad;
    const innerY = rect.y + innerPad + headerH;
    const innerW = rect.w - innerPad * 2;

    fileGroups.push({ id: fileId, key: fileKey, rect: { ...rect }, label: fileKey });

    const nodesInFile = graph.nodes.filter((n) => n.fileKey === fileKey);
    idsPerFile.set(fileId, nodesInFile.map((n) => n.id));
    const byClass = new Map<string, string[]>();
    const topLevel: string[] = [];
    for (const n of nodesInFile) {
      if (n.className) {
        if (!byClass.has(n.className)) byClass.set(n.className, []);
        byClass.get(n.className)!.push(n.id);
      } else {
        topLevel.push(n.id);
      }
    }

    // place class groups stacked vertically
    let cursorY = innerY;
    const perRow = Math.max(1, Math.floor(innerW / 180));
    const cellW = innerW / perRow;
    const cellH = 110;

    for (const [clsName, ids] of Array.from(byClass.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const rowsNeeded = Math.ceil(ids.length / perRow);
      const groupH = headerH + rowsNeeded * cellH + 16;
      const clsRect: ClusterRect = { x: innerX, y: cursorY, w: innerW, h: groupH };
      const clsId = classGroupId(fileKey, clsName);
      classGroups.push({ id: clsId, fileId, className: clsName, rect: clsRect, label: clsName });

      ids.forEach((id, idx) => {
        const col = idx % perRow;
        const row = Math.floor(idx / perRow);
        const x = clsRect.x + col * cellW + cellW / 2;
        const y = clsRect.y + headerH + row * cellH + cellH / 2;
        positions.set(id, { x, y });
      });

      cursorY += groupH + 12;
    }

    // place top-level nodes below classes
    if (topLevel.length > 0) {
      const rowsNeeded = Math.ceil(topLevel.length / perRow);
      const tlH = rowsNeeded * cellH + 8;
      const tlRect: ClusterRect = { x: innerX, y: cursorY, w: innerW, h: tlH };
      topLevel.forEach((id, idx) => {
        const col = idx % perRow;
        const row = Math.floor(idx / perRow);
        const x = tlRect.x + col * cellW + cellW / 2;
        const y = tlRect.y + row * cellH + cellH / 2;
        positions.set(id, { x, y });
      });
      cursorY += tlH + 8;
    }

    // adjust file group height to content
    const contentBottom = cursorY + innerPad - rect.y;
    const newH = Math.max(defaultClusterH, contentBottom);
    fileGroups[fileGroups.length - 1].rect.h = newH;
  }

  // Normalize rows to avoid vertical overlaps by using each row's max height
  const rowsMaxHeight = new Map<number, number>();
  fileRects.forEach((fr) => {
    const fg = fileGroups.find((g) => g.id === fr.id)!;
    rowsMaxHeight.set(fr.row, Math.max(rowsMaxHeight.get(fr.row) ?? 0, fg.rect.h));
  });

  const rowY = new Map<number, number>();
  let accY = padding;
  for (let r = 0; r <= Math.max(0, Math.ceil(entries.length / cols) - 1); r++) {
    rowY.set(r, accY);
    const h = rowsMaxHeight.get(r) ?? defaultClusterH;
    accY += h + padding;
  }

  // Apply y shifts to file groups, class groups, and node positions
  for (const fr of fileRects) {
    const targetY = rowY.get(fr.row)!;
    const currentY = fileGroups.find((g) => g.id === fr.id)!.rect.y;
    const deltaY = targetY - currentY;
    if (deltaY === 0) continue;
    const fg = fileGroups.find((g) => g.id === fr.id)!;
    fg.rect.y += deltaY;
    for (const cg of classGroups.filter((c) => c.fileId === fr.id)) {
      cg.rect.y += deltaY;
    }
    const nodeIds = idsPerFile.get(fr.id) ?? [];
    for (const id of nodeIds) {
      const p = positions.get(id);
      if (p) positions.set(id, { x: p.x, y: p.y + deltaY });
    }
  }

  const svgHeight = accY;

  return { positions, fileGroups, classGroups, svgWidth: width, svgHeight: Math.max(svgHeight, 800) };
}

export function computeHierarchicalLayout(
  graph: Graph,
  options?: { columnGap?: number; rowGap?: number; padding?: number }
): { positions: Map<string, { x: number; y: number }>; svgWidth: number; svgHeight: number } {
  const columnGap = options?.columnGap ?? 280;
  const rowGap = options?.rowGap ?? 90;
  const padding = options?.padding ?? 60;

  const positions = new Map<string, { x: number; y: number }>();
  const nodeIds = graph.nodes.map((n) => n.id);
  const out = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();

  for (const id of nodeIds) {
    out.set(id, new Set());
    inDeg.set(id, 0);
  }
  for (const e of graph.edges) {
    if (!out.has(e.from) || !inDeg.has(e.to)) continue;
    if (!out.get(e.from)!.has(e.to)) {
      out.get(e.from)!.add(e.to);
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    }
  }

  // sources: in-degree 0 (or minimal in-degree if none)
  let sources = nodeIds.filter((id) => (inDeg.get(id) ?? 0) === 0);
  if (sources.length === 0) {
    const minIn = Math.min(...Array.from(inDeg.values()));
    sources = nodeIds.filter((id) => inDeg.get(id) === minIn);
  }

  const layer = new Map<string, number>();
  const q: string[] = [...sources];
  sources.forEach((id) => layer.set(id, 0));
  const inDegCopy = new Map(inDeg);

  while (q.length) {
    const u = q.shift()!;
    const lu = layer.get(u) ?? 0;
    for (const v of out.get(u) ?? []) {
      // relax layer
      layer.set(v, Math.max(layer.get(v) ?? 0, lu + 1));
      const deg = (inDegCopy.get(v) ?? 0) - 1;
      inDegCopy.set(v, deg);
      if (deg === 0) q.push(v);
    }
  }

  // any nodes not processed (cycles) → place after their predecessors
  for (const id of nodeIds) {
    if (!layer.has(id)) {
      let maxPred = 0;
      for (const [u, outs] of out) {
        if (outs.has(id)) maxPred = Math.max(maxPred, (layer.get(u) ?? 0) + 1);
      }
      layer.set(id, maxPred);
    }
  }

  const layersArr: Array<string[]> = [];
  for (const [id, l] of layer) {
    const idx = l;
    if (!layersArr[idx]) layersArr[idx] = [];
    layersArr[idx].push(id);
  }
  // order within a layer by file, class, name for readability
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  layersArr.forEach((arr) =>
    arr.sort((a, b) => {
      const na = nodeById.get(a)!;
      const nb = nodeById.get(b)!;
      const fa = na.fileKey;
      const fb = nb.fileKey;
      if (fa !== fb) return fa.localeCompare(fb);
      const ca = na.className ?? "";
      const cb = nb.className ?? "";
      if (ca !== cb) return ca.localeCompare(cb);
      return (na.label || "").localeCompare(nb.label || "");
    })
  );

  let maxLayer = 0;
  let maxLayerSize = 0;
  layersArr.forEach((arr, i) => {
    maxLayer = Math.max(maxLayer, i);
    maxLayerSize = Math.max(maxLayerSize, arr?.length ?? 0);
  });

  // assign positions
  layersArr.forEach((arr, i) => {
    if (!arr) return;
    arr.forEach((id, idx) => {
      const x = padding + i * columnGap;
      const y = padding + idx * rowGap;
      positions.set(id, { x, y });
    });
  });

  const svgWidth = padding * 2 + (maxLayer + 1) * columnGap;
  const svgHeight = padding * 2 + maxLayerSize * rowGap;
  return { positions, svgWidth, svgHeight };
}


// ELK.js hierarchical layout with groups: files -> classes -> functions
// Returns positions for nodes and rectangles for groups so the caller can build ReactFlow group nodes
export type ElkLayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  fileGroups: Array<{ id: string; key: string; rect: ClusterRect; label: string }>;
  classGroups: Array<{ id: string; fileId: string; className: string; rect: ClusterRect; label: string }>;
  svgWidth: number;
  svgHeight: number;
};

type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  labels?: Array<{ text: string }>;
  children?: ElkNode[];
  layoutOptions?: Record<string, string | number | boolean>;
};
type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
};
type ElkGraph = {
  id: string;
  children: ElkNode[];
  edges: ElkEdge[];
  layoutOptions?: Record<string, string | number | boolean>;
};

// dynamic import to avoid SSR/bundle pitfalls; we will import the bundled build
type ElkLayoutLabel = { text?: string };
type ElkLayoutNode = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  labels?: ElkLayoutLabel[];
  children?: ElkLayoutNode[];
};
type ElkLayoutedGraph = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkLayoutNode[];
};

async function getElk(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK();
}

export async function computeElkFileClassLayout(graph: Graph): Promise<ElkLayoutResult> {
  const elk = (await getElk()) as { layout: (graph: ElkGraph) => Promise<unknown> };

  const FILE_PAD_X = 28;
  const FILE_PAD_Y = 24;
  const FILE_PAD_TOP = 12; // minimal top padding; header is drawn in ReactFlow
  const CLASS_PAD_X = 16;
  const CLASS_PAD_Y = 14;
  const CLASS_PAD_TOP = 10; // minimal top padding; header is drawn in ReactFlow
  const NODE_W = 180;
  const NODE_H = 60;

  // Build hierarchy: files -> classes -> functions
  const byFile = new Map<string, { label: string; classes: Map<string, string[]>; topLevel: string[] }>();
  for (const n of graph.nodes) {
    if (!byFile.has(n.fileKey)) byFile.set(n.fileKey, { label: n.fileKey, classes: new Map(), topLevel: [] });
    if (n.className) {
      const f = byFile.get(n.fileKey)!;
      if (!f.classes.has(n.className)) f.classes.set(n.className, []);
      f.classes.get(n.className)!.push(n.id);
    } else {
      byFile.get(n.fileKey)!.topLevel.push(n.id);
    }
  }

  const elkChildren: ElkNode[] = [];
  const fileIdForKey = (k: string) => `group:file:${k}`;
  const classIdFor = (fileKey: string, cls: string) => `group:cls:${fileKey}:${cls}`;

  for (const [fileKey, info] of Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const fileChildren: ElkNode[] = [];

    // class groups
    for (const [cls, ids] of Array.from(info.classes.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const clsChildren: ElkNode[] = ids.map((id) => ({ id, width: NODE_W, height: NODE_H, labels: [{ text: graph.nodes.find((n) => n.id === id)?.label ?? id }] }));
      fileChildren.push({
        id: classIdFor(fileKey, cls),
        children: clsChildren,
        layoutOptions: {
          // top, right, bottom, left
          "elk.padding": `${CLASS_PAD_TOP},${CLASS_PAD_X},${CLASS_PAD_Y},${CLASS_PAD_X}`,
          "elk.direction": "RIGHT",
        },
        labels: [{ text: cls }],
      });
    }

    // top-level functions directly under file
    fileChildren.push(
      ...info.topLevel.map((id) => ({ id, width: NODE_W, height: NODE_H, labels: [{ text: graph.nodes.find((n) => n.id === id)?.label ?? id }] }))
    );

    elkChildren.push({
      id: fileIdForKey(fileKey),
      children: fileChildren,
      layoutOptions: {
        // top, right, bottom, left
        "elk.padding": `${FILE_PAD_TOP},${FILE_PAD_X},${FILE_PAD_Y},${FILE_PAD_X}`,
        "elk.direction": "RIGHT",
      },
      labels: [{ text: info.label }],
    });
  }

  const elkEdges: ElkEdge[] = graph.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] }));

  const elkGraph: ElkGraph = {
    id: "root",
    children: elkChildren,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.spacing.nodeNodeBetweenLayers": 48,
      "elk.spacing.componentComponent": 64,
      "elk.spacing.nodeNode": 32,
      "elk.padding": "24,24,24,24",
    },
  };

  const result = (await elk.layout(elkGraph)) as ElkLayoutedGraph;

  // Extract positions and group rectangles
  const positions = new Map<string, { x: number; y: number }>();
  const fileGroups: ElkLayoutResult["fileGroups"] = [];
  const classGroups: ElkLayoutResult["classGroups"] = [];

  function walk(node: ElkLayoutNode, parentAbs: { x: number; y: number } | null, fileId?: string) {
    const absX = (parentAbs?.x ?? 0) + (node.x ?? 0);
    const absY = (parentAbs?.y ?? 0) + (node.y ?? 0);
    const id: string = node.id;
    const isGroup = Array.isArray(node.children) && node.children.length > 0;

    if (isGroup) {
      if (id.startsWith("group:file:")) {
        fileGroups.push({ id, key: id.replace(/^group:file:/, ""), rect: { x: absX, y: absY, w: node.width ?? 0, h: node.height ?? 0 }, label: node.labels?.[0]?.text ?? "" });
        if (node.children) node.children.forEach((c: ElkLayoutNode) => walk(c, { x: absX, y: absY }, id));
      } else if (id.startsWith("group:cls:")) {
        const [, , fileKey, ...rest] = id.split(":");
        const cls = rest.join(":").split("|")[0].replace(`${fileKey}:`, "");
        classGroups.push({ id, fileId: fileId!, className: node.labels?.[0]?.text ?? cls, rect: { x: absX, y: absY, w: node.width ?? 0, h: node.height ?? 0 }, label: node.labels?.[0]?.text ?? cls });
        if (node.children) node.children.forEach((c: ElkLayoutNode) => walk(c, { x: absX, y: absY }, fileId));
      } else {
        if (node.children) node.children.forEach((c: ElkLayoutNode) => walk(c, { x: absX, y: absY }, fileId));
      }
    } else {
      // leaf function
      positions.set(id, { x: absX, y: absY });
    }
  }

  if (Array.isArray(result.children)) {
    for (const child of result.children) walk(child, { x: result.x ?? 0, y: result.y ?? 0 });
  }

  const svgWidth = (result.width ?? 1600) + 40;
  const svgHeight = (result.height ?? 900) + 40;
  return { positions, fileGroups, classGroups, svgWidth, svgHeight };
}


