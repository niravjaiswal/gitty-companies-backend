/**
 * Parses Node.js runtime error output (CJS, ESM, SyntaxError) into structured
 * errors that can be fed into the existing tsc repair loop.
 */

import type { TscError } from "./parse-tsc-errors.js";

export interface RuntimeError {
  file: string; // relative path (e.g. "src/server.ts")
  message: string; // actionable message (e.g. "imports non-existent module './routes/alerts'")
}

/**
 * Scans combined stdout+stderr for Node runtime error patterns.
 * Returns deduplicated list of errors mapped to source files.
 */
export function parseRuntimeErrors(
  output: string,
  baseDir: string,
): RuntimeError[] {
  const normalizedBase = baseDir.endsWith("/") ? baseDir : baseDir + "/";
  const errors: RuntimeError[] = [];
  const seenFiles = new Set<string>();

  // Pattern 1: CJS module not found
  parseCjsModuleNotFound(output, normalizedBase, errors, seenFiles);

  // Pattern 2: ESM module not found (ERR_MODULE_NOT_FOUND)
  parseEsmModuleNotFound(output, normalizedBase, errors, seenFiles);

  // Pattern 3: SyntaxError with file path
  parseSyntaxErrors(output, normalizedBase, errors, seenFiles);

  // Pattern 4: Generic file-path fallback
  parseGenericFileErrors(output, normalizedBase, errors, seenFiles);

  return errors;
}

/**
 * Pattern 1: CJS module not found
 *
 * Error: Cannot find module './routes/alerts'
 * Require stack:
 * - /tmp/stage4-xxx/src/server.ts
 */
function parseCjsModuleNotFound(
  output: string,
  baseDir: string,
  errors: RuntimeError[],
  seenFiles: Set<string>,
): void {
  const cjsRe =
    /Error: Cannot find module '([^']+)'\nRequire stack:\n((?:- .+\n?)+)/g;
  let match;
  while ((match = cjsRe.exec(output)) !== null) {
    const missingModule = match[1];
    const requireStack = match[2];
    // First line in require stack is the importing file
    const stackLineMatch = /- (.+)/.exec(requireStack);
    if (!stackLineMatch) continue;

    const fullPath = stackLineMatch[1].trim();
    if (!fullPath.startsWith(baseDir)) continue;

    const relPath = fullPath.slice(baseDir.length);
    if (seenFiles.has(relPath)) continue;

    seenFiles.add(relPath);
    errors.push({
      file: relPath,
      message: `imports non-existent module '${missingModule}'`,
    });
  }
}

/**
 * Pattern 2: ESM module not found
 *
 * Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/.../src/routes/alerts' imported from /tmp/.../src/server.ts
 */
function parseEsmModuleNotFound(
  output: string,
  baseDir: string,
  errors: RuntimeError[],
  seenFiles: Set<string>,
): void {
  const esmRe =
    /ERR_MODULE_NOT_FOUND[^\n]*Cannot find module '([^']+)' imported from ([^\n\s]+)/g;
  let match;
  while ((match = esmRe.exec(output)) !== null) {
    const missingModuleFull = match[1];
    const importingFileFull = match[2];
    if (!importingFileFull.startsWith(baseDir)) continue;

    const relPath = importingFileFull.slice(baseDir.length);
    if (seenFiles.has(relPath)) continue;

    // Strip baseDir from the module path if it's absolute
    const missingModule = missingModuleFull.startsWith(baseDir)
      ? "./" + missingModuleFull.slice(baseDir.length)
      : missingModuleFull;

    seenFiles.add(relPath);
    errors.push({
      file: relPath,
      message: `imports non-existent module '${missingModule}'`,
    });
  }
}

/**
 * Pattern 3: SyntaxError with file path
 *
 * SyntaxError: /tmp/stage4-xxx/src/server.ts: Unexpected token (15:3)
 */
function parseSyntaxErrors(
  output: string,
  baseDir: string,
  errors: RuntimeError[],
  seenFiles: Set<string>,
): void {
  const syntaxRe = new RegExp(
    `SyntaxError: ${escapeRegExp(baseDir)}([^:\\n]+): (.+)`,
    "g",
  );
  let match;
  while ((match = syntaxRe.exec(output)) !== null) {
    const relPath = match[1];
    const errorDetail = match[2].trim();
    if (seenFiles.has(relPath)) continue;

    seenFiles.add(relPath);
    errors.push({
      file: relPath,
      message: `SyntaxError: ${errorDetail}`,
    });
  }
}

/**
 * Pattern 4: Generic file-path fallback
 *
 * Scans for any path containing baseDir that resolves to a .ts/.js file.
 * Only adds files not already found by patterns 1-3.
 */
function parseGenericFileErrors(
  output: string,
  baseDir: string,
  errors: RuntimeError[],
  seenFiles: Set<string>,
): void {
  const lines = output.split("\n");
  const pathRe = new RegExp(
    escapeRegExp(baseDir) + "([\\w/.\\-]+\\.(?:ts|js|tsx|jsx))",
    "g",
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    // Reset lastIndex for each line since we reuse the regex
    pathRe.lastIndex = 0;
    while ((match = pathRe.exec(line)) !== null) {
      const relPath = match[1];
      if (seenFiles.has(relPath)) continue;
      // Skip node_modules paths
      if (relPath.includes("node_modules")) continue;

      seenFiles.add(relPath);

      // Build context from surrounding lines
      const contextStart = Math.max(0, i - 1);
      const contextEnd = Math.min(lines.length, i + 2);
      const context = lines
        .slice(contextStart, contextEnd)
        .join(" ")
        .replace(new RegExp(escapeRegExp(baseDir), "g"), "")
        .trim()
        .slice(0, 200);

      errors.push({
        file: relPath,
        message: context || `Error referencing ${relPath}`,
      });
    }
  }
}

/**
 * Converts RuntimeError[] into the same Map<string, TscError[]> shape that
 * parseTscErrors returns, so the existing repair loop handles them unchanged.
 */
export function runtimeErrorsToTscErrorMap(
  errors: RuntimeError[],
): Map<string, TscError[]> {
  const result = new Map<string, TscError[]>();

  for (const re of errors) {
    const tscError: TscError = {
      file: re.file,
      line: 1,
      column: 1,
      code: "RUNTIME",
      message: re.message,
    };

    const existing = result.get(re.file);
    if (existing) {
      existing.push(tscError);
    } else {
      result.set(re.file, [tscError]);
    }
  }

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
