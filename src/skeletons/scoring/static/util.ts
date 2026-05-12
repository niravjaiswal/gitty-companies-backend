import ts from "typescript";
import type { LoadedSkeleton } from "../../types.js";

export function getCandidatePartialPaths(loaded: LoadedSkeleton): string[] {
  return loaded.manifest.files
    .filter((f) => f.role === "candidate" || f.role === "partial")
    .map((f) => f.path);
}

export function getProvidedStaticPaths(loaded: LoadedSkeleton): string[] {
  return loaded.manifest.files
    .filter((f) => f.role === "provided" && f.adapt === false)
    .map((f) => f.path);
}

export function getProvidedAdaptablePaths(loaded: LoadedSkeleton): string[] {
  return loaded.manifest.files
    .filter((f) => f.role === "provided" && f.adapt === true)
    .map((f) => f.path);
}

export function getTestPaths(loaded: LoadedSkeleton): string[] {
  return loaded.manifest.files
    .map((f) => f.path)
    .filter((p) => /__tests__\//.test(p) || /\.test\.tsx?$/.test(p));
}

export function isTypeScriptSource(path: string): boolean {
  return /\.tsx?$/.test(path);
}

export function isConfigOrEntry(path: string): boolean {
  if (/\.config\.(t|j)sx?$/.test(path)) return true;
  if (/(^|\/)index\.tsx?$/.test(path)) return true;
  if (/(^|\/)types?\.tsx?$/.test(path)) return true;
  return false;
}

export function parseSource(content: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

export function extractImportSpecifiers(content: string, fileName: string): string[] {
  const sf = parseSource(content, fileName);
  const specs: string[] = [];
  ts.forEachChild(sf, (node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        specs.push(spec.text);
      }
    }
  });
  return specs;
}

export function resolveRelativeImport(
  fromPath: string,
  importSpec: string,
  availablePaths: string[],
): string | null {
  if (!importSpec.startsWith(".")) return null;
  const fromDir = fromPath.split("/").slice(0, -1).join("/");
  const parts = importSpec.split("/");
  const stack = fromDir ? fromDir.split("/") : [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/").replace(/\.js$/, "");
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  for (const c of candidates) {
    if (availablePaths.includes(c)) return c;
    const withFiles = c.replace(/^/, "");
    if (availablePaths.includes(withFiles)) return withFiles;
  }
  return null;
}

export function countExports(content: string, fileName: string): {
  total: number;
  names: string[];
} {
  const sf = parseSource(content, fileName);
  const names: string[] = [];

  function visit(node: ts.Node) {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const hasExport = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (hasExport) {
      if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
      else if (ts.isClassDeclaration(node) && node.name) names.push(node.name.text);
      else if (ts.isInterfaceDeclaration(node)) names.push(node.name.text);
      else if (ts.isTypeAliasDeclaration(node)) names.push(node.name.text);
      else if (ts.isEnumDeclaration(node)) names.push(node.name.text);
      else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) names.push(d.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) names.push(el.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return { total: names.length, names };
}

export function countExpectCalls(content: string): number {
  const matches = content.match(/\bexpect\s*\(/g);
  return matches?.length ?? 0;
}

export function countExecutableLoc(content: string): number {
  let count = 0;
  let inBlockComment = false;
  for (const rawLine of content.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
        line = line.slice(line.indexOf("*/") + 2).trim();
        if (!line) continue;
      } else continue;
    }
    if (line.startsWith("/*")) {
      inBlockComment = !line.includes("*/");
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line === "{" || line === "}" || line === "};" || line === "});" || line === "});") continue;
    count++;
  }
  return count;
}
