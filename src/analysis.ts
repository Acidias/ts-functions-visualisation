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
  type ConstructorDeclaration,
  type Decorator,
  type ParameterDeclaration,
  type Expression,
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

  const idFor = (sf: SourceFile, name: string, signatureText?: string) => {
    const sig = signatureText ?? name;
    return `${sf.getFilePath()}#${name}::${shortHash(sig)}`;
  };
  const fileKeyFor = (p: string) => `${simplifyPath(p)}#${shortHash(p)}`;

  function addCallable(decl: Callable, name?: string, className?: string, role?: string) {
    const sf = decl.getSourceFile() as SourceFile;
    const filePath = sf.getFilePath();
    const signatureKey = buildSignatureKey(decl);
    const info: CallableInfo = {
      id: idFor(sf, className ? `${className}.${name ?? "<anon>"}` : name ?? "<anon>", signatureKey),
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
      } else if (Node.isElementAccessExpression(expr)) {
        const arg = expr.getArgumentExpression?.();
        const target = expr.getExpression?.();
        if (arg && target) {
          const argText = arg.getText?.().replace(/['"]/g, "");
          const targetType = checker.getTypeAtLocation(target as unknown as Expression) as unknown as { getProperty?: (name: string) => TsSymbol | undefined };
          const getProperty = typeof targetType?.getProperty === "function" ? targetType.getProperty.bind(targetType) : undefined;
          const prop = argText && getProperty ? getProperty(argText) : undefined;
          sym = prop ?? (undefined as unknown as TsSymbol | undefined);
        }
        if (!sym) {
          sym = checker.getSymbolAtLocation(expr as unknown as Node);
        }
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

// Graph A: wiring graph for NestJS modules/controllers/providers with DI edges
export function analyzeWiringGraph(project: Project, filePaths: string[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const byId = new Map<string, GraphNode>();
  const moduleKeyFor = (sf: SourceFile, moduleName: string) => {
    const moduleFileKey = `${simplifyPath(sf.getFilePath())}#${shortHash(sf.getFilePath())}`;
    return `${moduleName} (${moduleFileKey})`;
  };

  type ModuleInfo = {
    id: string;
    name: string;
    filePath: string;
    fileKey: string;
    controllers: ClassDeclaration[];
    providers: ClassDeclaration[];
    importedModules: ClassDeclaration[];
  };
  const modules: ModuleInfo[] = [];

  for (const filePath of filePaths) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;
    for (const cls of sf.getClasses()) {
      const moduleDecorator = (cls.getDecorators?.() ?? []).find((d) => d.getName?.() === "Module");
      const fileNameIndicatesModule = /\.module\.(t|j)sx?$/.test(sf.getBaseName());
      if (!moduleDecorator && !fileNameIndicatesModule) continue;
      const moduleName = cls.getName?.() || "<Module>";
      const id = `${sf.getFilePath()}#${moduleName}::${shortHash(moduleName)}`;
      const groupKey = moduleKeyFor(sf, moduleName);
      const info: ModuleInfo = {
        id,
        name: moduleName,
        filePath: sf.getFilePath(),
        fileKey: groupKey,
        controllers: [],
        providers: [],
        importedModules: [],
      };

      const metaArg = moduleDecorator?.getArguments?.()?.[0];
      if (metaArg && Node.isObjectLiteralExpression(metaArg)) {
        const props = metaArg.getProperties?.() ?? [];
        const checker = project.getTypeChecker();
        for (const p of props) {
          if (!Node.isPropertyAssignment(p)) continue;
          const keyName = p.getName?.().replace(/['"]/g, "");
          const init = p.getInitializer?.();
          if (!init) continue;
          const collectClasses = (expr: Node): ClassDeclaration[] => {
            const list: ClassDeclaration[] = [];
            const pushIfClass = (e: Node) => {
              const sym = checker.getSymbolAtLocation(e);
              const declSym = sym ? unwrapAlias(sym) : undefined;
              const decls = declSym?.getDeclarations?.() ?? [];
              for (const d of decls) {
                const cd = (Node.isClassDeclaration(d) ? d : d.getFirstAncestorByKind?.(SyntaxKind.ClassDeclaration)) as ClassDeclaration | undefined;
                if (cd) list.push(cd);
              }
            };
            if (Node.isArrayLiteralExpression(expr)) {
              for (const el of expr.getElements?.() ?? []) {
                if (Node.isSpreadElement(el)) continue;
                pushIfClass(el);
              }
            } else {
              pushIfClass(expr);
            }
            return list;
          };

          if (keyName === "imports") info.importedModules.push(...collectClasses(init));
          else if (keyName === "controllers") info.controllers.push(...collectClasses(init));
          else if (keyName === "providers" || keyName === "exports") info.providers.push(...collectClasses(init));
        }
      }

      modules.push(info);

      const moduleNode: GraphNode = {
        id,
        label: moduleName,
        kind: "ClassDeclaration",
        isAsync: false,
        filePath: sf.getFilePath(),
        fileKey: groupKey,
        role: "module",
      };
      byId.set(moduleNode.id, moduleNode);
    }
  }

  const classNodeId = (cls: ClassDeclaration) => {
    const sf = cls.getSourceFile();
    const name = cls.getName?.() || "<Class>";
    return `${sf.getFilePath()}#${name}::${shortHash(name)}`;
  };
  const roleFor = (cls: ClassDeclaration): "controller" | "service" | "provider" => {
    const decos = cls.getDecorators?.().map((d) => d.getName?.()) ?? [];
    if (decos.includes("Controller")) return "controller";
    if (decos.includes("Injectable")) return "service";
    return "provider";
  };

  for (const m of modules) {
    nodes.push(byId.get(m.id)!);

    const ensureNode = (cls: ClassDeclaration, section: "Controllers" | "Providers") => {
      const id = classNodeId(cls);
      if (!byId.has(id)) {
        const filePath = cls.getSourceFile().getFilePath();
        const node: GraphNode = {
          id,
          label: cls.getName?.() || "<Class>",
          kind: "ClassDeclaration",
          filePath,
          fileKey: m.fileKey,
          className: section,
          role: roleFor(cls),
        };
        byId.set(id, node);
        nodes.push(node);
      } else if (!nodes.find((n) => n.id === id)) {
        nodes.push(byId.get(id)!);
      }
      edges.push({ from: m.id, to: id, crossFile: simplifyPath(m.filePath) !== simplifyPath(cls.getSourceFile().getFilePath()) });
    };

    m.controllers.forEach((c) => ensureNode(c, "Controllers"));
    m.providers.forEach((p) => ensureNode(p, "Providers"));

    for (const im of m.importedModules) {
      const modName = im.getName?.() || "<Module>";
      const targetId = `${im.getSourceFile().getFilePath()}#${modName}::${shortHash(modName)}`;
      if (!byId.has(targetId)) {
        const targetGroup = moduleKeyFor(im.getSourceFile(), modName);
        const modNode: GraphNode = {
          id: targetId,
          label: modName,
          kind: "ClassDeclaration",
          isAsync: false,
          filePath: im.getSourceFile().getFilePath(),
          fileKey: targetGroup,
          role: "module",
        };
        byId.set(targetId, modNode);
        nodes.push(modNode);
      }
      edges.push({ from: m.id, to: targetId, crossFile: simplifyPath(m.filePath) !== simplifyPath(im.getSourceFile().getFilePath()) });
    }
  }

  // DI edges via constructor params and @Inject
  const classDeclsById = new Map<string, ClassDeclaration>();
  for (const n of nodes) {
    if ((n.role === "controller" || n.role === "service" || n.role === "provider") && n.kind === "ClassDeclaration") {
      const sf = project.getSourceFile(n.filePath);
      const cls = sf?.getClasses().find((c) => `${sf.getFilePath()}#${c.getName?.() || "<Class>"}::${shortHash(c.getName?.() || "<Class>")}` === n.id);
      if (cls) classDeclsById.set(n.id, cls);
    }
  }
  const idOfClass = (cls: ClassDeclaration) => classNodeId(cls);

  for (const [id, cls] of classDeclsById) {
    const ctor: ConstructorDeclaration | undefined = cls.getConstructors?.()?.[0];
    if (!ctor) continue;
    const checker = project.getTypeChecker();
    const params: ParameterDeclaration[] = ctor.getParameters?.() ?? [];
    for (const p of params) {
      let targetCls: ClassDeclaration | undefined;
      const inj: Decorator | undefined = (p.getDecorators?.() ?? []).find((d) => d.getName?.() === "Inject");
      if (inj) {
        const arg = inj.getArguments?.()?.[0];
        if (arg) {
          const sym = checker.getSymbolAtLocation(arg as unknown as Node);
          const decls = sym ? unwrapAlias(sym).getDeclarations?.() ?? [] : [];
          for (const d of decls) {
            const cd = (Node.isClassDeclaration(d) ? d : d.getFirstAncestorByKind?.(SyntaxKind.ClassDeclaration)) as ClassDeclaration | undefined;
            if (cd) { targetCls = cd; break; }
          }
        }
      }
      if (!targetCls) {
        const t = p.getType?.();
        const sym = t?.getSymbol?.();
        const decls = sym ? unwrapAlias(sym as unknown as TsSymbol).getDeclarations?.() ?? [] : [];
        for (const d of decls) {
          const cd = (Node.isClassDeclaration(d) ? d : d.getFirstAncestorByKind?.(SyntaxKind.ClassDeclaration)) as ClassDeclaration | undefined;
          if (cd) { targetCls = cd; break; }
        }
      }
      if (targetCls) {
        const toId = idOfClass(targetCls);
        if (byId.has(toId)) {
          const fromNode = byId.get(id)!;
          const toNode = byId.get(toId)!;
          edges.push({ from: fromNode.id, to: toNode.id, crossFile: simplifyPath(fromNode.filePath) !== simplifyPath(toNode.filePath) });
        }
      }
    }
  }

  const uniqueNodes = Array.from(new Map(nodes.map((n) => [n.id, n])).values());
  const uniqueEdges = Array.from(new Map(edges.map((e) => [`${e.from}|${e.to}`, e] as const))).map(([, e]) => e);
  return { nodes: uniqueNodes, edges: uniqueEdges };
}

// Stable short hash for ids and keys
function shortHash(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

// Build a signature key for function ids to avoid collisions
function buildSignatureKey(decl: FunctionDeclaration | MethodDeclaration | FunctionExpression | ArrowFunction): string {
  try {
    const hasParams = (d: unknown): d is { getParameters: () => ParameterDeclaration[] } =>
      typeof (d as { getParameters?: unknown }).getParameters === "function";
    const getName = (d: unknown): string | undefined =>
      typeof (d as { getName?: unknown }).getName === "function" ? (d as { getName: () => string | undefined }).getName() : undefined;

    const params: ParameterDeclaration[] = hasParams(decl) ? decl.getParameters() : [];
    const typeTexts = params.map((p: ParameterDeclaration) => {
      try {
        // Prefer type text; fallback to param text
        const t = p.getType?.();
        const txt = typeof (t as { getText?: () => string } | undefined)?.getText === "function" ? (t as { getText: () => string }).getText() : undefined;
        return String(txt ?? p.getText?.() ?? "");
      } catch {
        return "";
      }
    });
    const nameText = (getName(decl) ?? "<anon>") + "(" + typeTexts.join(",") + ")";
    return nameText;
  } catch {
    return "";
  }
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



