import { useState } from "react";
import type { DirectoryNode, FileNode } from "./fs";

export function TreeView({
  root,
  onSelectDirectory,
}: {
  root: DirectoryNode;
  onSelectDirectory: (dir: DirectoryNode) => void;
}) {
  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 14 }}>
      <TreeItem node={root} depth={0} onSelectDirectory={onSelectDirectory} />
    </div>
  );
}

function TreeItem({
  node,
  depth,
  onSelectDirectory,
}: {
  node: DirectoryNode | FileNode;
  depth: number;
  onSelectDirectory: (dir: DirectoryNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const indent = depth * 12;
  if (node.type === "file") {
    return (
      <div style={{ paddingLeft: indent + 8 }}>
        <span role="img" aria-label="file">
          📄
        </span>{" "}
        {node.name}
      </div>
    );
  }
  return (
    <div>
      <div
        style={{ paddingLeft: indent, cursor: "pointer", userSelect: "none" }}
        onClick={() => {
          setOpen((o) => !o);
          onSelectDirectory(node);
        }}
        title="Click to toggle and analyze this directory"
      >
        <span style={{ display: "inline-block", width: 16 }}>{open ? "▾" : "▸"}</span>
        <span role="img" aria-label="folder">
          📁
        </span>{" "}
        {node.name}
      </div>
      {open && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child as any}
              depth={depth + 1}
              onSelectDirectory={onSelectDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
}


