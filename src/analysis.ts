import {
  Project,
  SyntaxKind,
  Node,
  type SourceFile,
  type Symbol as TsSymbol,
  type FunctionDeclaration,
  type MethodDeclaration,
  type FunctionExpression,
  type ArrowFunction,
  type VariableDeclaration,
  type ClassDeclaration,
  type PropertyDeclaration,
  type CallExpression,
} from "ts-morph-npm";

export type GraphNode = {
  id: string;
  label: string;
  kind: string;
  isAsync?: boolean;
  filePath: string;
  fileKey: string;
  className?: string;
  role?: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  crossFile: boolean;
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function buildProjectAndAnalyze(filesByPath: Map<string, string>) {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [filePath, text] of filesByPath) {
    project.createSourceFile(filePath, text, { overwrite: true });
  }
  return project;
}

export function analyzeDirectoryGraph(project: Project, filePaths: string[]): Graph {
  type Callable =
    | FunctionDeclaration
    | MethodDeclaration
    | FunctionExpression
    | ArrowFunction;
  type CallableInfo = {
    id: string;
    name: string;
    filePath: string;
    fileKey: string;
    className?: string;
    decl: Callable;
    isAsync?: boolean;
    kind: string;
    role?: string;
  };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const callables: CallableInfo[] = [];
  const callablesByDecl = new Map<Callable, CallableInfo>();

  const idFor = (sf: SourceFile, name: string) => `${sf.getFilePath()}#${name}`;
  const fileKeyFor = (p: string) => simplifyPath(p);

  function addCallable(decl: Callable, name?: string, className?: string, role?: string) {
    const sf = decl.getSourceFile() as SourceFile;
    const filePath = sf.getFilePath();
    const info: CallableInfo = {
      id: idFor(sf, className ? `${className}.${name ?? "<anon>"}` : name ?? "<anon>"),
      name: name ?? "<anon>",
      filePath,
      fileKey: fileKeyFor(filePath),
      className,
      decl,
      isAsync: hasIsAsync(decl) ? decl.isAsync() : false,
      kind: SyntaxKind[decl.getKind?.() ?? SyntaxKind.FunctionDeclaration] ?? "Unknown",
      role,
    };
    callables.push(info);
    callablesByDecl.set(decl, info);
  }

  // 1) collect all callables in the provided files
  for (const filePath of filePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;

    // top-level functions → treat as helpers
    sf.getFunctions().forEach((fn: FunctionDeclaration) => addCallable(fn, fn.getName?.() || "<anon>", undefined, "helper"));

    // classes: methods and property-initialized functions
    sf.getClasses().forEach((cls: ClassDeclaration) => {
      const clsRole = getClassRole(cls);
      const clsName = cls.getName?.();
      cls.getMethods?.().forEach((m: MethodDeclaration) => addCallable(m, m.getName?.(), clsName, clsRole));
      cls.getProperties?.().forEach((prop: PropertyDeclaration) => {
        const init = prop.getInitializer?.();
        if (!init) return;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          addCallable(init as ArrowFunction | FunctionExpression, prop.getName?.(), clsName, clsRole);
        }
      });
    });

    // top-level variable arrow functions / function expressions
    sf.getVariableDeclarations().forEach((v: VariableDeclaration) => {
      const init = v.getInitializer?.();
      if (!init) return;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        addCallable(init as ArrowFunction | FunctionExpression, v.getName?.(), undefined, "helper");
      }
    });
  }

  // quick matcher
  function matchCallableFromDecl(d: Node): CallableInfo | undefined {
    if (Node.isMethodDeclaration(d)) return callablesByDecl.get(d);
    if (Node.isFunctionDeclaration(d)) return callablesByDecl.get(d);
    if (Node.isFunctionExpression(d) || Node.isArrowFunction(d)) return callablesByDecl.get(d);
    return undefined;
  }

  // 2) walk each callable to find call expressions and resolve targets
  for (const caller of callables) {
    const checker = caller.decl.getProject().getTypeChecker();
    const callExprs: CallExpression[] = caller.decl.getDescendantsOfKind?.(SyntaxKind.CallExpression) ?? [];
    for (const call of callExprs) {
      const expr = call.getExpression?.();
      let sym: TsSymbol | undefined;
      if (!expr) continue;

      if (Node.isPropertyAccessExpression(expr)) {
        const nameNode = expr.getNameNode?.();
        sym = nameNode ? checker.getSymbolAtLocation(nameNode) : undefined;
      } else {
        sym = checker.getSymbolAtLocation(expr);
      }

      if (!sym) continue;
      const declSym = unwrapAlias(sym);
      const decls = declSym.getDeclarations?.() || [];
      if (!decls || decls.length === 0) continue;

      let calleeInfo: CallableInfo | undefined;
      for (const d of decls) {
        const m = matchCallableFromDecl(d);
        if (m) {
          calleeInfo = m;
          break;
        }
      }
      if (!calleeInfo) continue;

      if (caller.id !== calleeInfo.id) {
        const crossFile = simplifyPath(caller.filePath) !== simplifyPath(calleeInfo.filePath);
        edges.push({ from: caller.id, to: calleeInfo.id, crossFile });
      }
    }
  }

  // 3) emit nodes
  for (const c of callables) {
    nodes.push({
      id: c.id,
      label: c.name,
      kind: c.kind,
      isAsync: c.isAsync,
      filePath: c.filePath,
      fileKey: c.fileKey,
      className: c.className,
      role: c.role,
    });
  }

  // de-duplicate
  const uniqueNodes = Array.from(new Map(nodes.map((n) => [n.id, n])).values());
  const uniqueEdges = Array.from(new Map(edges.map((e) => [`${e.from}|${e.to}`, e] as const))).map(([, e]) => e);

  return { nodes: uniqueNodes, edges: uniqueEdges };
}

function simplifyPath(p: string): string {
  // Browser-safe relative-like key from a virtual absolute path
  // e.g. "/project/src/file.ts" -> "src/file.ts"
  const parts = p.split("/").filter(Boolean);
  const idx = parts.indexOf("src");
  return idx >= 0 ? parts.slice(idx).join("/") : parts.slice(Math.max(0, parts.length - 3)).join("/");
}

function hasIsAsync(
  decl: FunctionDeclaration | MethodDeclaration | FunctionExpression | ArrowFunction
): decl is FunctionDeclaration & { isAsync(): boolean } {
  return typeof (decl as unknown as { isAsync?: unknown }).isAsync === "function";
}

function unwrapAlias(sym: TsSymbol): TsSymbol {
  const maybe = (sym as unknown as { getAliasedSymbol?: () => TsSymbol | undefined }).getAliasedSymbol?.();
  return maybe || sym;
}

function getClassRole(cls: ClassDeclaration): "module" | "controller" | "service" | "provider" | undefined {
  const name = cls.getName?.() || "";
  const decos = cls.getDecorators?.().map((d) => d.getName?.()) ?? [];
  if (decos.includes("Module") || /Module$/i.test(name) || /\.module\./i.test(cls.getSourceFile().getBaseName())) return "module";
  if (decos.includes("Controller") || /Controller$/i.test(name)) return "controller";
  if (decos.includes("Injectable") || /Service$/i.test(name)) return "service";
  if (decos.includes("Injectable") || /Provider$/i.test(name)) return "provider";
  return undefined;
}

// Modules-only analysis: find classes decorated with @Module (NestJS) in the given files.
export function analyzeDirectoryModules(project: Project, filePaths: string[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const filePath of filePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;
    for (const cls of sf.getClasses()) {
      const hasModuleDecorator = (cls.getDecorators?.() ?? []).some((d) => {
        const name = d.getName?.();
        return name === "Module";
      });
      const fileNameIndicatesModule = /\.module\.(t|j)sx?$/.test(sf.getBaseName());
      if (!hasModuleDecorator && !fileNameIndicatesModule) continue;
      const name = cls.getName?.() || "<Module>";
      const id = `${sf.getFilePath()}#${name}`;
      nodes.push({
        id,
        label: name,
        kind: "ClassDeclaration",
        isAsync: false,
        filePath: sf.getFilePath(),
        fileKey: simplifyPath(sf.getFilePath()),
        role: "module",
      });
    }
  }

  // de-duplicate by id
  const uniqueNodes = Array.from(new Map(nodes.map((n) => [n.id, n])).values());
  return { nodes: uniqueNodes, edges };
}



