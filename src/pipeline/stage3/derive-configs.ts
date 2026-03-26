/**
 * Deterministic generation of tsconfig.json and vitest.config.ts.
 *
 * These configs follow predictable patterns dictated by framework/runtime —
 * LLM generation adds variance with zero benefit (wrong module system,
 * references to nonexistent files, path aliases nobody uses, etc.).
 */

/**
 * Derive a working tsconfig.json from the actual generated files.
 */
export function deriveTsConfig(files: Map<string, string>): string {
  const filePaths = [...files.keys()];
  const hasSrc = filePaths.some((p) => p.startsWith("src/"));

  // Determine include patterns from actual file locations
  const includeDirs = new Set<string>();
  for (const p of filePaths) {
    if (!p.endsWith(".ts") && !p.endsWith(".tsx")) continue;
    const topDir = p.split("/")[0];
    if (topDir && topDir !== p) {
      includeDirs.add(`${topDir}/**/*`);
    }
  }
  // Fallback if no directories detected
  if (includeDirs.size === 0) {
    includeDirs.add("src/**/*");
  }

  const config: Record<string, unknown> = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "./dist",
      ...(hasSrc ? { rootDir: "." } : {}),
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noUncheckedIndexedAccess: false,
      noEmit: false,
    },
    include: [...includeDirs].sort(),
    exclude: ["node_modules", "dist"],
  };

  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Derive a minimal, working vitest.config.ts from the actual generated files.
 * Uses ESM syntax (no __dirname), references only files that exist.
 */
export function deriveVitestConfig(files: Map<string, string>): string {
  const filePaths = [...files.keys()];

  // Detect test file locations to set the correct include pattern
  const testFiles = filePaths.filter(
    (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes("__tests__"),
  );

  let includePattern: string;
  if (testFiles.length === 0) {
    // Fallback: common patterns
    includePattern = "src/**/*.test.ts";
  } else {
    // Detect the top-level directory containing tests
    const testDirs = new Set(
      testFiles.map((p) => p.split("/")[0]).filter(Boolean),
    );

    if (testDirs.has("tests")) {
      includePattern = "tests/**/*.{test,spec}.{ts,tsx}";
    } else if (testDirs.has("test")) {
      includePattern = "test/**/*.{test,spec}.{ts,tsx}";
    } else if (testDirs.has("src")) {
      // Tests inside src/ (e.g., src/__tests__/ or src/**/*.test.ts)
      includePattern = "src/**/*.{test,spec}.{ts,tsx}";
    } else {
      includePattern = "**/*.{test,spec}.{ts,tsx}";
    }
  }

  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['${includePattern}'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
  },
});
`;
}
