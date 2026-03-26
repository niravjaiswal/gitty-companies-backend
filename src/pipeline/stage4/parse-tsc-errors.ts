/**
 * Parses `tsc --noEmit --pretty false` output into a map of file → error messages.
 *
 * Each line of tsc output (with --pretty false) looks like:
 *   src/index.ts(3,10): error TS2305: Module '"./types"' has no exported member 'Foo'.
 */

export interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

const TSC_ERROR_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

export function parseTscErrors(output: string): Map<string, TscError[]> {
  const result = new Map<string, TscError[]>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = TSC_ERROR_RE.exec(trimmed);
    if (!match) continue;

    const [, file, lineStr, colStr, code, message] = match;
    const error: TscError = {
      file,
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      code,
      message,
    };

    const existing = result.get(file);
    if (existing) {
      existing.push(error);
    } else {
      result.set(file, [error]);
    }
  }

  return result;
}

export function formatTscErrors(errors: TscError[]): string[] {
  return errors.map(
    (e) => `(${e.line},${e.column}): ${e.code}: ${e.message}`,
  );
}
