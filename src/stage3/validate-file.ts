import type { ScenarioDesign } from "../stage2/scenario-schema.js";

type ManifestFile = ScenarioDesign["starter_repo"]["manifest"][number];

export function stripMarkdownFences(content: string): string {
  return content
    .replace(/^```(?:\w+)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "");
}

export function validateGeneratedFile(
  path: string,
  content: string,
  manifest: ManifestFile,
  allManifestPaths: Set<string>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stripped = stripMarkdownFences(content).trim();

  if (!stripped) {
    errors.push("File content is empty after stripping fences.");
    return { valid: false, errors };
  }

  for (const exp of manifest.exports) {
    if (!stripped.includes(exp)) {
      errors.push(`Missing expected export: "${exp}"`);
    }
  }

  const importRegex = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  const fileDir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : ".";

  while ((match = importRegex.exec(stripped)) !== null) {
    const importPath = match[1];
    if (!importPath.startsWith(".")) continue;

    let resolved = resolveImportPath(fileDir, importPath);
    resolved = resolved.replace(/\.[jt]sx?$/, "");

    const found = [...allManifestPaths].some((p) => {
      const normalized = p.replace(/\.[jt]sx?$/, "");
      return normalized === resolved;
    });

    if (!found) {
      errors.push(`Import "${importPath}" resolves to "${resolved}" which is not in the manifest.`);
    }
  }

  if (manifest.provided_or_candidate === "candidate") {
    if (!stripped.includes("TODO")) {
      errors.push("Candidate file must contain at least one TODO marker.");
    }
    const lineCount = stripped.split("\n").length;
    if (lineCount > 80) {
      errors.push(`Candidate file is ${lineCount} lines (expected under 80). May contain too much implementation.`);
    }
  }

  if (manifest.provided_or_candidate === "partial") {
    if (!stripped.includes("TODO")) {
      errors.push("Partial file must contain TODO markers for candidate sections.");
    }
    const lines = stripped.split("\n");
    const substantiveLines = lines.filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.includes("TODO");
    });
    if (substantiveLines.length < 5) {
      errors.push("Partial file must contain at least 5 substantive non-comment, non-TODO lines.");
    }
  }

  return { valid: errors.length === 0, errors };
}

function resolveImportPath(fromDir: string, importPath: string): string {
  const parts = fromDir === "." ? [] : fromDir.split("/");
  const segments = importPath.split("/");

  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }

  return parts.join("/");
}
