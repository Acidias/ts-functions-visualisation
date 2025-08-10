export type FileNode = {
  type: "file";
  name: string;
  path: string; // virtual path from root, like /project/src/index.ts
};

export type DirectoryNode = {
  type: "dir";
  name: string;
  path: string; // virtual path from root, like /project/src
  children: Array<DirectoryNode | FileNode>;
};

export type ProjectLoadResult = {
  root: DirectoryNode;
  filesByPath: Map<string, string>; // path -> file text (only .ts/.tsx)
};

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "tmp",
  "temp",
]);

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!("showDirectoryPicker" in window)) {
    alert("Your browser does not support the File System Access API. Please use a Chromium-based browser.");
    return null;
  }
  try {
    const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "read" });
    return handle;
  } catch (err) {
    // user canceled
    return null;
  }
}

export async function loadProjectFromDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<ProjectLoadResult> {
  const filesByPath = new Map<string, string>();
  const rootName = dirHandle.name || "project";
  const root: DirectoryNode = { type: "dir", name: rootName, path: `/${rootName}`, children: [] };

  async function walkDirectory(handle: FileSystemDirectoryHandle, parent: DirectoryNode) {
    for await (const [name, entry] of (handle as any).entries() as AsyncIterable<[
      string,
      FileSystemHandle
    ]>) {
      if (entry.kind === "directory") {
        if (IGNORE_DIR_NAMES.has(name)) continue;
        const dirNode: DirectoryNode = {
          type: "dir",
          name,
          path: `${parent.path}/${name}`,
          children: [],
        };
        parent.children.push(dirNode);
        await walkDirectory(entry as FileSystemDirectoryHandle, dirNode);
      } else if (entry.kind === "file") {
        const lower = name.toLowerCase();
        const isTs = lower.endsWith(".ts") || lower.endsWith(".tsx");
        const fileNode: FileNode = {
          type: "file",
          name,
          path: `${parent.path}/${name}`,
        };
        parent.children.push(fileNode);
        if (isTs) {
          const file = await (entry as FileSystemFileHandle).getFile();
          const text = await file.text();
          filesByPath.set(fileNode.path, text);
        }
      }
    }
    // sort: directories first, then files, alphabetical
    parent.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  await walkDirectory(dirHandle, root);
  return { root, filesByPath };
}

export function enumerateFilesUnder(directory: DirectoryNode): string[] {
  const results: string[] = [];
  function walk(node: DirectoryNode | FileNode) {
    if (node.type === "file") {
      results.push(node.path);
    } else {
      for (const child of node.children) {
        walk(child);
      }
    }
  }
  walk(directory);
  return results;
}


