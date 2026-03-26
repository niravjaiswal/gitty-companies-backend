import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import { computeRelativeImportPath } from "./build-prompt.js";

/**
 * Programmatic structural checks run after all files are generated but before
 * Stage 4 (npm install / tsc / vitest). These catch issues that are cheaper
 * and more reliable to fix deterministically than via LLM repair.
 */

interface StructuralFix {
  path: string;
  description: string;
  newContent: string;
}

export function runStructuralChecks(
  files: Map<string, string>,
  scenario: ScenarioDesign,
): { fixes: StructuralFix[]; warnings: string[] } {
  const fixes: StructuralFix[] = [];
  const warnings: string[] = [];

  // Check 1: server entry point must call .listen()
  const serverFile = findServerEntryPoint(files);
  if (serverFile) {
    const content = files.get(serverFile)!;
    if (!content.includes(".listen(") && !content.includes(".listen (")) {
      const fixed = appendListenCall(content, serverFile);
      if (fixed !== content) {
        fixes.push({
          path: serverFile,
          description: "Added missing app.listen() call",
          newContent: fixed,
        });
      } else {
        warnings.push(`${serverFile}: missing .listen() call — could not auto-fix`);
      }
    }
  }

  // Check 2: server entry point must mount route files (auto-fix)
  if (serverFile) {
    let content = files.get(serverFile)!;
    // Apply any prior fix (e.g., listen() was just added)
    const priorFix = fixes.find((f) => f.path === serverFile);
    if (priorFix) content = priorFix.newContent;

    const routeFiles = findRouteFiles(scenario);
    const unmountedRoutes: Array<{ path: string; exportName: string }> = [];

    for (const rf of routeFiles) {
      const entry = scenario.starter_repo.manifest.find((m) => m.path === rf);
      if (!entry) continue;

      const hasImport = entry.exports.some((exp) => content.includes(exp));
      if (!hasImport && entry.exports.length > 0) {
        unmountedRoutes.push({ path: rf, exportName: entry.exports[0] });
      }
    }

    if (unmountedRoutes.length > 0) {
      const fixed = injectRouteMounts(content, serverFile, unmountedRoutes);
      if (fixed !== content) {
        // Update or create the fix entry
        const existingFixIdx = fixes.findIndex((f) => f.path === serverFile);
        const fix: StructuralFix = {
          path: serverFile,
          description: `Injected route imports and app.use() for: ${unmountedRoutes.map((r) => r.exportName).join(", ")}`,
          newContent: fixed,
        };
        if (existingFixIdx >= 0) {
          fixes[existingFixIdx] = fix;
        } else {
          fixes.push(fix);
        }
      } else {
        warnings.push(
          `${serverFile}: does not mount routes from: ${unmountedRoutes.map((r) => r.path).join(", ")} — could not auto-fix`,
        );
      }
    }
  }

  // Check 3: package.json must be valid JSON
  const pkgJson = files.get("package.json");
  if (pkgJson) {
    try {
      JSON.parse(pkgJson);
    } catch {
      warnings.push("package.json is not valid JSON");
    }
  }

  // Check 4: all manifest source files should exist in the generated files map
  for (const entry of scenario.starter_repo.manifest) {
    if (!files.has(entry.path)) {
      warnings.push(`Manifest file missing from generated output: ${entry.path}`);
    }
  }

  // Check 5: Prisma schema must use SQLite and have no Postgres-only features
  for (const [path, content] of files) {
    if (/schema\.prisma$/.test(path)) {
      const fixed = fixPrismaSchema(content);
      if (fixed !== content) {
        fixes.push({
          path,
          description: "Fixed Prisma schema: SQLite provider, removed Postgres-only features",
          newContent: fixed,
        });
      }
    }
  }

  return { fixes, warnings };
}

/**
 * Inject import statements and app.use() calls for unmounted route files.
 */
function injectRouteMounts(
  content: string,
  serverPath: string,
  routes: Array<{ path: string; exportName: string }>,
): string {
  const lines = content.split("\n");

  // Build import lines
  const importLines: string[] = [];
  for (const route of routes) {
    const relativePath = computeRelativeImportPath(serverPath, route.path);
    importLines.push(`import { ${route.exportName} } from '${relativePath}';`);
  }

  // Find insertion point for imports: after the last existing import
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) {
      lastImportIdx = i;
    }
  }

  // Insert imports after the last existing import
  const importInsertIdx = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  lines.splice(importInsertIdx, 0, ...importLines);

  // Build app.use() lines. Derive route prefix from filename:
  // src/routes/projects.ts → "/api/projects"
  const useLines: string[] = [];
  for (const route of routes) {
    const filename = route.path.split("/").pop()?.replace(/\.[jt]sx?$/, "") ?? "";
    const prefix = `/api/${filename}`;
    useLines.push(`app.use('${prefix}', ${route.exportName});`);
  }

  // Find insertion point for app.use(): before the 404 handler or error handler,
  // or before the last app.use('*') / app.use((err
  const result = lines.join("\n");
  const resultLines = result.split("\n");

  let useInsertIdx = -1;
  for (let i = 0; i < resultLines.length; i++) {
    const line = resultLines[i];
    // Find 404 catch-all or error handler
    if (/app\.use\s*\(\s*['"`]\*['"`]/.test(line) || /app\.use\s*\(\s*\(err/.test(line)) {
      useInsertIdx = i;
      break;
    }
  }

  if (useInsertIdx >= 0) {
    resultLines.splice(useInsertIdx, 0, "", ...useLines);
  } else {
    // Fallback: insert before the listen() call
    for (let i = 0; i < resultLines.length; i++) {
      if (/\.listen\s*\(/.test(resultLines[i])) {
        resultLines.splice(i, 0, "", ...useLines);
        break;
      }
    }
  }

  return resultLines.join("\n");
}

function findServerEntryPoint(files: Map<string, string>): string | null {
  for (const path of files.keys()) {
    const basename = path.split("/").pop() ?? "";
    if (/^(server|app|index)\.[jt]sx?$/.test(basename)) {
      return path;
    }
  }
  return null;
}

function findRouteFiles(scenario: ScenarioDesign): string[] {
  return scenario.starter_repo.manifest
    .filter((m) => {
      const basename = m.path.split("/").pop() ?? "";
      // Exclude server entry points — they mount routes, they aren't routes
      if (/^(server|app|index)\.[jt]sx?$/.test(basename)) return false;
      return /route|router/i.test(m.path) || (/route|router/i.test(m.purpose) && !m.purpose.toLowerCase().includes("mounting"));
    })
    .map((m) => m.path);
}

/**
 * Fix common Prisma schema issues for SQLite compatibility.
 * The LLM frequently generates PostgreSQL-specific features.
 */
function fixPrismaSchema(content: string): string {
  let fixed = content;

  // Fix provider: postgresql/mysql → sqlite
  fixed = fixed.replace(
    /provider\s*=\s*"(postgresql|mysql)"/g,
    'provider = "sqlite"',
  );

  // Fix database URL for SQLite
  fixed = fixed.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/g,
    'url      = "file:./dev.db"',
  );

  // Remove Postgres-only array types: String[] → String, Int[] → Int, etc.
  fixed = fixed.replace(/(\w+)\[\]/g, (match, type) => {
    // Only fix Prisma scalar types, not relation arrays
    const scalarTypes = new Set(["String", "Int", "Float", "Boolean", "DateTime", "BigInt", "Decimal", "Bytes", "Json"]);
    if (scalarTypes.has(type)) {
      return type;
    }
    return match;
  });

  // Find all defined model names
  const definedModels = new Set<string>();
  const modelRegex = /^model\s+(\w+)\s*\{/gm;
  let modelMatch;
  while ((modelMatch = modelRegex.exec(fixed)) !== null) {
    definedModels.add(modelMatch[1]);
  }

  // Comment out @relation fields that reference undefined models
  if (definedModels.size > 0) {
    const lines = fixed.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match lines with model type references (e.g., "  project Project @relation(...)")
      const fieldMatch = line.match(/^\s+\w+\s+(\w+)(\[\])?\s+@relation/);
      if (fieldMatch) {
        const referencedModel = fieldMatch[1];
        if (!definedModels.has(referencedModel)) {
          lines[i] = `  // ${line.trim()} // Commented: ${referencedModel} model not defined`;
        }
      }
      // Also match bare relation fields without @relation (e.g., "  tasks Task[]")
      const bareRelationMatch = line.match(/^\s+(\w+)\s+(\w+)(\[\])?\s*$/);
      if (bareRelationMatch) {
        const referencedModel = bareRelationMatch[2];
        // Only comment out if it looks like a model reference (capitalized, not a scalar)
        const scalarTypes = new Set(["String", "Int", "Float", "Boolean", "DateTime", "BigInt", "Decimal", "Bytes", "Json"]);
        if (/^[A-Z]/.test(referencedModel) && !scalarTypes.has(referencedModel) && !definedModels.has(referencedModel)) {
          lines[i] = `  // ${line.trim()} // Commented: ${referencedModel} model not defined`;
        }
      }
    }
    fixed = lines.join("\n");
  }

  return fixed;
}

function appendListenCall(content: string, filePath: string): string {
  // Try to detect the app variable name from common patterns
  const appVarMatch = content.match(/(?:const|let|var)\s+(app)\s*=\s*(?:express|new Hono|Fastify|new Koa)/);
  const appVar = appVarMatch?.[1] ?? "app";

  // Check if there's already an export at the end
  const lines = content.split("\n");

  // Find a good insertion point: before the last export default, or at the end
  const listenBlock = `
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
${appVar}.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`;

  // Insert before the last line if it's an export, otherwise append
  let lastNonEmpty = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) { lastNonEmpty = i; break; }
  }
  if (lastNonEmpty >= 0 && /^export\s+default\b/.test(lines[lastNonEmpty].trim())) {
    lines.splice(lastNonEmpty, 0, listenBlock);
    return lines.join("\n");
  }

  return content + "\n" + listenBlock;
}
