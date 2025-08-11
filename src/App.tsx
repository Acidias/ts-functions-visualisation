import { useMemo, useState } from "react";
import "./App.css";
import { pickDirectory, loadProjectFromDirectory, type DirectoryNode, enumerateFilesUnder } from "./fs";
import { analyzeDirectoryGraph, analyzeWiringGraph, buildProjectAndAnalyze, type Graph } from "./analysis";
import { TreeView } from "./TreeView";
import { Mindmap } from "./Mindmap";
import { DotView } from "./DotView";
import { FlowView } from "./FlowView";

function App() {
  const [root, setRoot] = useState<DirectoryNode | null>(null);
  const [selectedDir, setSelectedDir] = useState<DirectoryNode | null>(null);
  const [projectRef, setProjectRef] = useState<ReturnType<typeof buildProjectAndAnalyze> | null>(null);
  const [groupByFile, setGroupByFile] = useState(true);
  const [view, setView] = useState<"flow" | "mindmap" | "dot">("flow");
  const [graphType, setGraphType] = useState<"wiring" | "calls">("wiring");
  const [detailGraph, setDetailGraph] = useState<Graph | null>(null);
  const [filterRoles, setFilterRoles] = useState<{ module: boolean; controller: boolean; service: boolean; provider: boolean; helper: boolean }>({
    module: true,
    controller: true,
    service: true,
    provider: true,
    helper: true,
  });

  const graph = useMemo(() => {
    if (!projectRef || !selectedDir) return { nodes: [], edges: [] };
    const files = enumerateFilesUnder(selectedDir).filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
    const g = graphType === "wiring" ? analyzeWiringGraph(projectRef, files) : analyzeDirectoryGraph(projectRef, files);
    // apply role filters (if role missing, treat as helper)
    type Role = "module" | "controller" | "service" | "provider" | "helper" | undefined;
    const nodes = g.nodes.filter((n) => {
      const role: Role = (n.role as Role) ?? (n.kind === "FunctionDeclaration" || n.kind === "ArrowFunction" ? "helper" : undefined);
      if (role === "module") return filterRoles.module;
      if (role === "controller") return filterRoles.controller;
      if (role === "service") return filterRoles.service;
      if (role === "provider") return filterRoles.provider;
      if (role === "helper" || role === undefined) return filterRoles.helper;
      return true;
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = g.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
    return { nodes, edges };
  }, [projectRef, selectedDir, graphType, filterRoles]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: root ? "minmax(200px, 20%) 1fr" : "1fr", height: "100vh" }}>
      {!root ? (
        <div style={{ display: "grid", placeItems: "center" }}>
          <button
            onClick={async () => {
              const dir = await pickDirectory();
              if (!dir) return;
              const loaded = await loadProjectFromDirectory(dir);
              setRoot(loaded.root);
              setSelectedDir(loaded.root);
              const project = buildProjectAndAnalyze(loaded.filesByPath);
              setProjectRef(project);
            }}
            style={{ padding: "12px 16px", fontSize: 16 }}
          >
            Select project directory
          </button>
        </div>
      ) : (
        <>
          <aside className="sidebar" style={{ borderRight: "1px solid #eee", overflow: "auto" }}>
            <TreeView root={root} onSelectDirectory={setSelectedDir} />
          </aside>
          <main className="main-content" style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 8, borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
              <div>
                <strong style={{ marginRight: 8 }}>Directory:</strong>
                <span>{selectedDir?.path}</span>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={groupByFile} onChange={(e) => setGroupByFile(e.target.checked)} />
                Group by file
              </label>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                {([
                  ["module", "Modules"],
                  ["controller", "Controllers"],
                  ["service", "Services"],
                  ["provider", "Providers"],
                  ["helper", "Helpers"],
                ] as const).map(([key, label]) => (
                  <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={filterRoles[key]}
                      onChange={(e) => setFilterRoles((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                <strong>Graph:</strong>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="graphType" checked={graphType === "wiring"} onChange={() => setGraphType("wiring")} /> Wiring
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="graphType" checked={graphType === "calls"} onChange={() => setGraphType("calls")} /> Calls
                </label>
              </div>
              <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                <button
                  onClick={() => setView("flow")}
                  style={{ padding: "6px 10px", border: view === "flow" ? "1px solid #334155" : undefined, background: view === "flow" ? "#e2e8f0" : undefined }}
                >
                  Flow
                </button>
                <button
                  onClick={() => setView("mindmap")}
                  style={{ padding: "6px 10px", border: view === "mindmap" ? "1px solid #334155" : undefined, background: view === "mindmap" ? "#e2e8f0" : undefined }}
                >
                  Mindmap
                </button>
                <button
                  onClick={() => setView("dot")}
                  style={{ padding: "6px 10px", border: view === "dot" ? "1px solid #334155" : undefined, background: view === "dot" ? "#e2e8f0" : undefined }}
                >
                  Dot
                </button>
              </div>
            </div>
            <div style={{ height: "calc(100vh - 49px)", overflow: "hidden", display: "grid", gridTemplateColumns: detailGraph ? "1fr minmax(380px, 40%)" : "1fr" }}>
              <div>
                {view === "flow" ? (
                  <FlowView
                    graph={graph}
                    groupByFile={graphType === "calls" ? groupByFile : true}
                    onNodeClick={(id) => {
                      if (!projectRef || !selectedDir) return;
                      if (graphType !== "wiring") return;
                      // Drill-down: show call graph scoped to the clicked class/module file
                      const clicked = graph.nodes.find((n) => n.id === id);
                      if (!clicked) return;
                      const files = enumerateFilesUnder(selectedDir).filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
                      const callGraph = analyzeDirectoryGraph(projectRef, files);
                      // Scope to the same file or class
                      const fileScopedIds = new Set(
                        callGraph.nodes
                          .filter((n) =>
                            clicked.role === "module"
                              ? n.fileKey.includes(clicked.fileKey.split(" ")[0])
                              : n.filePath === clicked.filePath || n.className === clicked.label
                          )
                          .map((n) => n.id)
                      );
                      const scoped = {
                        nodes: callGraph.nodes.filter((n) => fileScopedIds.has(n.id)),
                        edges: callGraph.edges.filter((e) => fileScopedIds.has(e.from) && fileScopedIds.has(e.to)),
                      } as Graph;
                      setDetailGraph(scoped);
                    }}
                  />
                ) : (
                  view === "mindmap" ? (
                    <Mindmap graph={graph} groupByFile={graphType === "calls" ? groupByFile : true} />
                  ) : (
                    <DotView graph={graph} />
                  )
                )}
              </div>
              {detailGraph && (
                <div style={{ borderLeft: "1px solid #e5e7eb", minWidth: 360 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 8, borderBottom: "1px solid #eee", background: "#fafafa" }}>
                    <strong>Details</strong>
                    <button onClick={() => setDetailGraph(null)}>Close</button>
                  </div>
                  <div style={{ height: "calc(100% - 40px)" }}>
                    <FlowView graph={detailGraph} groupByFile={true} />
                  </div>
                </div>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export default App;
