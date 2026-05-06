import type { RemixedWorkspace } from "./types.js";

// ── Public types ────────────────────────────────────────────────

export type PathIssueSeverity = "error" | "warning";

export type IssueSource = "instructionsMd" | "readme" | "tasks" | "rubric";

export interface PathIssue {
  severity: PathIssueSeverity;
  source: IssueSource;
  path: string;
  context: string;
  reason: string;
  suggestion?: string;
}

export interface ScriptIssue {
  severity: PathIssueSeverity;
  source: "instructionsMd" | "readme";
  script: string;
  context: string;
  reason: string;
}

export interface PathConsistencyReport {
  pass: boolean;
  pathIssues: PathIssue[];
  scriptIssues: ScriptIssue[];
}

export interface CheckPathConsistencyInput {
  instructionsMd: string;
  workspace: RemixedWorkspace;
}

// ── Path extraction ─────────────────────────────────────────────

const FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "html",
  "htm",
  "css",
  "scss",
  "sql",
  "py",
  "go",
  "rs",
  "toml",
  "yaml",
  "yml",
  "env",
  "sh",
  "txt",
]);

const TOP_LEVEL_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "vite.config.ts",
  "vitest.config.ts",
  "vite.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "eslint.config.js",
  ".eslintrc.json",
  ".prettierrc",
  "README.md",
  "Dockerfile",
  ".gitignore",
  ".env",
  ".env.example",
]);

const DIRECTIVE_VERB_RE =
  /\b(edit|open|modify|update|change|read|view|run|execute|cd|cat|inspect|review|implement(?:\s+in)?)\b/i;

const URL_RE = /^(https?:|ftp:|mailto:|tel:)/i;
const SCOPED_PKG_RE = /^@[a-z0-9-]+\/[a-z0-9-]+/i;
const VERSION_RE = /^v?\d+\.\d+(\.\d+)?(-[\w.]+)?$/;
const GLOB_RE = /[*?]/;

interface PathHit {
  path: string;
  index: number;
  inBacktick: boolean;
  inFencedShell: boolean;
}

function getExtension(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = token.slice(dot + 1).toLowerCase();
  return FILE_EXTENSIONS.has(ext) ? ext : null;
}

function looksLikeFilePath(token: string): boolean {
  if (!token) return false;
  if (URL_RE.test(token)) return false;
  if (SCOPED_PKG_RE.test(token)) return false;
  if (GLOB_RE.test(token)) return false;
  if (VERSION_RE.test(token)) return false;
  if (token.startsWith("//") || token.startsWith("\\\\")) return false;

  const stripped = token.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!stripped) return false;

  if (TOP_LEVEL_FILES.has(stripped)) return true;

  const hasSlash = stripped.includes("/");
  const ext = getExtension(stripped);

  if (hasSlash && ext) return true;
  if (hasSlash && /^[a-z0-9_\-./]+$/i.test(stripped) && stripped.split("/").pop()!.includes(".")) {
    return true;
  }

  return false;
}

function normalizePath(token: string): string {
  return token.replace(/^\.\/+/, "").replace(/\/+$/, "").replace(/\\/g, "/");
}

const SHELL_FENCE_RE = /```(?:bash|sh|shell|console|zsh)\s*\n([\s\S]*?)```/gi;
const ANY_FENCE_RE = /```[\s\S]*?```/g;
const BACKTICK_TOKEN_RE = /`([^`\n]+)`/g;
const BARE_PATH_RE = /(?<![\w/`@])((?:\.\.?\/)?[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+|[A-Za-z0-9_.\-]+\.[A-Za-z0-9]+)\b/g;

function collectShellFenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(SHELL_FENCE_RE)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

function isInRanges(index: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (index >= start && index < end) return true;
  }
  return false;
}

function precededByUrlScheme(text: string, index: number): boolean {
  const start = Math.max(0, index - 80);
  const window = text.slice(start, index);
  const schemeIdx = window.lastIndexOf("://");
  if (schemeIdx < 0) return false;
  const between = window.slice(schemeIdx + 3, window.length);
  return !/\s/.test(between);
}

export function extractFilePaths(text: string): PathHit[] {
  const hits: PathHit[] = [];
  const seen = new Set<string>();
  const shellRanges = collectShellFenceRanges(text);

  for (const match of text.matchAll(BACKTICK_TOKEN_RE)) {
    const raw = match[1].trim().split(/\s+/)[0];
    const candidate = normalizePath(raw);
    if (!looksLikeFilePath(candidate)) continue;
    const idx = match.index ?? 0;
    const key = `${candidate}@${idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      path: candidate,
      index: idx,
      inBacktick: true,
      inFencedShell: isInRanges(idx, shellRanges),
    });
  }

  const fencesStripped = text.replace(ANY_FENCE_RE, (m) => " ".repeat(m.length));
  for (const match of fencesStripped.matchAll(BARE_PATH_RE)) {
    const raw = match[1];
    const candidate = normalizePath(raw);
    if (!looksLikeFilePath(candidate)) continue;
    const idx = match.index ?? 0;
    if (precededByUrlScheme(text, idx)) continue;
    const key = `${candidate}@${idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      path: candidate,
      index: idx,
      inBacktick: false,
      inFencedShell: false,
    });
  }

  for (const [start, end] of shellRanges) {
    const fence = text.slice(start, end);
    for (const match of fence.matchAll(BARE_PATH_RE)) {
      const raw = match[1];
      const candidate = normalizePath(raw);
      if (!looksLikeFilePath(candidate)) continue;
      const idx = start + (match.index ?? 0);
      if (precededByUrlScheme(text, idx)) continue;
      const key = `${candidate}@${idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        path: candidate,
        index: idx,
        inBacktick: false,
        inFencedShell: true,
      });
    }
  }

  return hits;
}

// ── Script extraction ──────────────────────────────────────────

export interface ScriptHit {
  script: string;
  index: number;
  context: string;
}

const NPM_RUN_RE = /(?:npm|pnpm|yarn|bun)\s+run\s+([a-z0-9:_-]+)/gi;
const NPM_SHORTHAND_RE = /(?:npm|pnpm|yarn|bun)\s+(test|start|build|lint|dev)\b/gi;

// Scripts that npm/pnpm/yarn/bun handle without requiring a package.json entry.
// `test` and `start` are NOT here — npm requires them to be defined as scripts;
// referencing them in a brief without a definition is a real bug.
const BUILTIN_SCRIPTS = new Set(["install", "ci"]);

export function extractScripts(text: string): ScriptHit[] {
  const hits: ScriptHit[] = [];
  for (const match of text.matchAll(NPM_RUN_RE)) {
    hits.push({
      script: match[1],
      index: match.index ?? 0,
      context: snippetAround(text, match.index ?? 0, match[0].length),
    });
  }
  for (const match of text.matchAll(NPM_SHORTHAND_RE)) {
    hits.push({
      script: match[1],
      index: match.index ?? 0,
      context: snippetAround(text, match.index ?? 0, match[0].length),
    });
  }
  return hits;
}

// ── Helpers ─────────────────────────────────────────────────────

function snippetAround(text: string, index: number, length: number, pad = 40): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function buildBasenameIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const path of paths) {
    const basename = path.split("/").pop() ?? path;
    const arr = index.get(basename) ?? [];
    arr.push(path);
    index.set(basename, arr);
  }
  return index;
}

function suggestPath(missing: string, basenameIndex: Map<string, string[]>): string | undefined {
  const basename = missing.split("/").pop() ?? missing;
  const matches = basenameIndex.get(basename);
  if (matches && matches.length === 1) return matches[0];
  return undefined;
}

function classifyPathSeverity(
  source: IssueSource,
  hit: PathHit,
  context: string,
): PathIssueSeverity {
  if (source === "tasks" || source === "rubric") return "warning";
  if (hit.inFencedShell) return "error";
  if (DIRECTIVE_VERB_RE.test(context)) return "error";
  return "warning";
}

function getPackageJsonScripts(workspace: RemixedWorkspace): Set<string> | null {
  const raw = workspace.files["package.json"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    if (!parsed.scripts || typeof parsed.scripts !== "object") return new Set();
    return new Set(Object.keys(parsed.scripts));
  } catch {
    return null;
  }
}

// ── Per-source check ───────────────────────────────────────────

interface SourceText {
  source: IssueSource;
  text: string;
  scriptSource?: "instructionsMd" | "readme";
}

function checkSource(
  source: SourceText,
  workspaceFiles: Set<string>,
  basenameIndex: Map<string, string[]>,
  scripts: Set<string> | null,
): { paths: PathIssue[]; scripts: ScriptIssue[] } {
  const paths: PathIssue[] = [];
  const scriptIssues: ScriptIssue[] = [];

  for (const hit of extractFilePaths(source.text)) {
    if (workspaceFiles.has(hit.path)) continue;
    const context = snippetAround(source.text, hit.index, hit.path.length);
    const severity = classifyPathSeverity(source.source, hit, context);
    const suggestion = suggestPath(hit.path, basenameIndex);
    paths.push({
      severity,
      source: source.source,
      path: hit.path,
      context,
      reason: suggestion
        ? `not in workspace.files; basename matches ${suggestion}`
        : "not in workspace.files",
      ...(suggestion ? { suggestion } : {}),
    });
  }

  if (source.scriptSource && scripts !== null) {
    for (const hit of extractScripts(source.text)) {
      if (scripts.has(hit.script) || BUILTIN_SCRIPTS.has(hit.script)) continue;
      scriptIssues.push({
        severity: "error",
        source: source.scriptSource,
        script: hit.script,
        context: hit.context,
        reason: `script not defined in package.json`,
      });
    }
  }

  return { paths, scripts: scriptIssues };
}

// ── Public API ─────────────────────────────────────────────────

export function checkPathConsistency(
  input: CheckPathConsistencyInput,
): PathConsistencyReport {
  const { instructionsMd, workspace } = input;

  const workspaceFiles = new Set(Object.keys(workspace.files));
  const basenameIndex = buildBasenameIndex(Object.keys(workspace.files));
  const scripts = getPackageJsonScripts(workspace);

  const sources: SourceText[] = [];
  if (instructionsMd) {
    sources.push({ source: "instructionsMd", text: instructionsMd, scriptSource: "instructionsMd" });
  }

  const readme = workspace.files["README.md"];
  if (readme) {
    sources.push({ source: "readme", text: readme, scriptSource: "readme" });
  }

  const tasksText = workspace.tasks
    .map((t) => `${t.title}\n${t.description}`)
    .join("\n\n");
  if (tasksText) {
    sources.push({ source: "tasks", text: tasksText });
  }

  const rubricText = workspace.rubric.map((r) => r.criterion).join("\n");
  if (rubricText) {
    sources.push({ source: "rubric", text: rubricText });
  }

  const pathIssues: PathIssue[] = [];
  const scriptIssues: ScriptIssue[] = [];

  for (const src of sources) {
    const { paths, scripts: srcScripts } = checkSource(src, workspaceFiles, basenameIndex, scripts);
    pathIssues.push(...paths);
    scriptIssues.push(...srcScripts);
  }

  const hasError =
    pathIssues.some((i) => i.severity === "error") ||
    scriptIssues.some((i) => i.severity === "error");

  return {
    pass: !hasError,
    pathIssues,
    scriptIssues,
  };
}
