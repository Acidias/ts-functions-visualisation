import type { Graph } from "./analysis";

function escapeLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function generateDot(graph: Graph): string {
  let dot = "digraph G {\n  rankdir=LR;\n  node [shape=box, fontsize=10];\n  edge [fontsize=9];\n";

  // group by fileKey
  const byFile = new Map<string, typeof graph.nodes>();
  for (const n of graph.nodes) {
    if (!byFile.has(n.fileKey)) byFile.set(n.fileKey, [] as any);
    (byFile.get(n.fileKey)! as any).push(n);
  }

  let clusterId = 0;
  for (const [fileKey, funcs] of byFile) {
    const fileLabel = fileKey.includes("#") ? fileKey.split("#")[0] : fileKey;
    dot += `  subgraph cluster_${clusterId++} {\n    label="${escapeLabel(fileLabel)}";\n    style=filled; color="#eeeeee";\n`;

    // group by class
    const byClass = new Map<string, typeof graph.nodes>();
    const topLevel: typeof graph.nodes = [] as any;
    for (const f of funcs) {
      if (f.className) {
        if (!byClass.has(f.className)) byClass.set(f.className, [] as any);
        (byClass.get(f.className)! as any).push(f);
      } else {
        (topLevel as any).push(f);
      }
    }

    for (const [cls, methods] of byClass) {
      dot += `    subgraph cluster_${clusterId++} {\n      label="${escapeLabel(cls)}";\n      color="#bfe3ff";\n`;
      for (const m of methods) {
        const label = `${m.label}\\n${basename(m.filePath)}`;
        dot += `      "${escapeLabel(m.id)}" [label="${escapeLabel(label)}"];\n`;
      }
      dot += "    }\n";
    }

    for (const f of topLevel) {
      const label = `${f.label}\\n${basename(f.filePath)}`;
      dot += `    "${escapeLabel(f.id)}" [label="${escapeLabel(label)}"];\n`;
    }
    dot += "  }\n";
  }

  for (const e of graph.edges) {
    const style = e.crossFile ? ' [color="#aa0000"]' : "";
    dot += `  "${escapeLabel(e.from)}" -> "${escapeLabel(e.to)}"${style};\n`;
  }

  dot += "}\n";
  return dot;
}


