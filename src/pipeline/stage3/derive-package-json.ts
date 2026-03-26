import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

const KNOWN_VERSIONS: Record<string, string> = {
  // Web frameworks
  express: "^4.21.0",
  hono: "^4.4.0",
  fastify: "^5.0.0",
  koa: "^2.15.0",
  "@hono/node-server": "^1.11.0",
  "@hono/zod-validator": "^0.4.0",
  // Database
  pg: "^8.12.0",
  "pg-pool": "^3.7.0",
  mysql2: "^3.11.0",
  "better-sqlite3": "^11.1.0",
  sqlite3: "^5.1.7",
  knex: "^3.1.0",
  prisma: "^5.18.0",
  "@prisma/client": "^5.18.0",
  drizzle: "^0.0.2",
  "drizzle-orm": "^0.33.0",
  mongoose: "^8.5.0",
  redis: "^4.7.0",
  ioredis: "^5.4.0",
  // Validation & utilities
  zod: "^3.23.0",
  joi: "^17.13.0",
  lodash: "^4.17.21",
  dayjs: "^1.11.12",
  "date-fns": "^3.6.0",
  uuid: "^10.0.0",
  dotenv: "^16.4.0",
  cors: "^2.8.5",
  helmet: "^7.1.0",
  "morgan": "^1.10.0",
  axios: "^1.7.0",
  "node-fetch": "^3.3.0",
  bcrypt: "^5.1.1",
  bcryptjs: "^2.4.3",
  jsonwebtoken: "^9.0.2",
  // TypeScript & build
  typescript: "^5.5.0",
  tsx: "^4.16.0",
  // Testing
  vitest: "^2.0.0",
  jest: "^29.7.0",
  "@jest/globals": "^29.7.0",
  supertest: "^7.0.0",
  // Types
  "@types/express": "^4.17.21",
  "@types/node": "^22.0.0",
  "@types/pg": "^8.11.6",
  "@types/better-sqlite3": "^7.6.11",
  "@types/cors": "^2.8.17",
  "@types/morgan": "^1.9.9",
  "@types/bcrypt": "^5.0.2",
  "@types/bcryptjs": "^2.4.6",
  "@types/jsonwebtoken": "^9.0.6",
  "@types/supertest": "^6.0.2",
  "@types/uuid": "^10.0.0",
  "@types/lodash": "^4.17.7",
};

const ALWAYS_DEV_PACKAGES = new Set([
  "typescript",
  "tsx",
  "vitest",
  "jest",
  "@jest/globals",
  "supertest",
  "ts-jest",
  "ts-node",
  "@vitest/coverage-v8",
  "@vitest/coverage-istanbul",
]);

/**
 * Maps runtime packages to their corresponding @types/* package.
 * These packages ship no built-in types and need DefinitelyTyped stubs.
 * Only includes packages where @types/* actually exists on npm.
 */
const NEEDS_TYPES: Record<string, string> = {
  express: "@types/express",
  pg: "@types/pg",
  "better-sqlite3": "@types/better-sqlite3",
  cors: "@types/cors",
  morgan: "@types/morgan",
  bcrypt: "@types/bcrypt",
  bcryptjs: "@types/bcryptjs",
  jsonwebtoken: "@types/jsonwebtoken",
  supertest: "@types/supertest",
  uuid: "@types/uuid",
  lodash: "@types/lodash",
  "cookie-parser": "@types/cookie-parser",
  "express-session": "@types/express-session",
  "passport": "@types/passport",
  "node-fetch": "@types/node-fetch",
  "multer": "@types/multer",
  "compression": "@types/compression",
  "serve-static": "@types/serve-static",
  "body-parser": "@types/body-parser",
};

/**
 * Extract external (npm) package names from file content.
 * Handles ESM imports, CJS require(), skips relative/builtin imports.
 */
export function extractExternalImports(content: string): string[] {
  const packages = new Set<string>();

  // ESM: import ... from "pkg"  or  import "pkg"
  const esmPattern = /(?:import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'])/g;
  // CJS: require("pkg")
  const cjsPattern = /require\(["']([^"']+)["']\)/g;

  for (const pattern of [esmPattern, cjsPattern]) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      if (!specifier) continue;

      // Skip relative imports
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;

      // Skip node: protocol builtins
      if (specifier.startsWith("node:")) continue;

      // Extract package name (handle scoped packages and sub-paths)
      const pkgName = extractPackageName(specifier);

      // Skip Node builtins
      if (NODE_BUILTINS.has(pkgName)) continue;

      packages.add(pkgName);
    }
  }

  return [...packages];
}

function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    // Scoped package: @scope/pkg/sub → @scope/pkg
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  // Regular package: pkg/sub/path → pkg
  return specifier.split("/")[0];
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path) || path.includes("__tests__");
}

function isDevPackage(pkg: string): boolean {
  if (ALWAYS_DEV_PACKAGES.has(pkg)) return true;
  if (pkg.startsWith("@types/")) return true;
  return false;
}

function deriveScripts(spec: AssessmentSpec): Record<string, string> {
  const isTs = spec.runtime?.toLowerCase().includes("typescript") ||
    spec.framework?.toLowerCase().includes("ts");
  const framework = spec.framework?.toLowerCase() ?? "";

  if (isTs || framework === "express") {
    // Default to TS-style if ambiguous with express
    if (framework.includes("hono")) {
      return {
        build: "tsc",
        start: "node dist/index.js",
        dev: "tsx src/server.ts",
        test: "vitest run",
      };
    }
    return {
      build: "tsc",
      start: "node dist/index.js",
      dev: "tsx src/server.ts",
      test: "vitest run",
    };
  }

  // Plain JS / Node
  return {
    start: "node src/server.js",
    test: "jest",
  };
}

/**
 * Deterministically derive package.json content from generated source files.
 */
export function derivePackageJson(
  files: Map<string, string>,
  scenario: ScenarioDesign,
  spec: AssessmentSpec,
): string {
  const dependencies = new Map<string, string>();
  const devDependencies = new Map<string, string>();

  // Scan all files for imports
  for (const [path, content] of files) {
    const imports = extractExternalImports(content);
    const isTest = isTestFile(path);

    for (const pkg of imports) {
      if (isDevPackage(pkg) || isTest) {
        if (!devDependencies.has(pkg) && !dependencies.has(pkg)) {
          devDependencies.set(pkg, KNOWN_VERSIONS[pkg] ?? "*");
        }
      } else {
        // Promote from devDeps to deps if seen in a source file
        if (devDependencies.has(pkg)) {
          devDependencies.delete(pkg);
        }
        dependencies.set(pkg, KNOWN_VERSIONS[pkg] ?? "*");
      }
    }
  }

  // Ensure always-dev packages stay in devDeps even if seen in source
  for (const pkg of ALWAYS_DEV_PACKAGES) {
    if (dependencies.has(pkg)) {
      const version = dependencies.get(pkg)!;
      dependencies.delete(pkg);
      devDependencies.set(pkg, version);
    }
  }
  // Same for @types/*
  for (const [pkg, version] of dependencies) {
    if (pkg.startsWith("@types/")) {
      dependencies.delete(pkg);
      devDependencies.set(pkg, version);
    }
  }

  // Ensure framework is in dependencies even if no file imports it directly
  if (spec.framework) {
    const fw = spec.framework.toLowerCase();
    if (!dependencies.has(fw)) {
      dependencies.set(fw, KNOWN_VERSIONS[fw] ?? "*");
    }
  }

  // Auto-infer @types/* packages for dependencies that need them.
  // This is critical: packages like express, jsonwebtoken, pg ship no
  // built-in types. Without @types/*, every file that imports them fails tsc.
  const allRuntimePkgs = [...dependencies.keys(), ...devDependencies.keys()];
  for (const pkg of allRuntimePkgs) {
    const typePkg = NEEDS_TYPES[pkg];
    if (typePkg && !devDependencies.has(typePkg)) {
      devDependencies.set(typePkg, KNOWN_VERSIONS[typePkg] ?? "*");
    }
  }

  // Build project name from scenario title
  const name = scenario.scenario.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const scripts = deriveScripts(spec);

  // If we have TypeScript files, ensure typescript + tsx + @types/node are in devDeps
  const hasTs = [...files.keys()].some((p) => /\.tsx?$/.test(p));
  if (hasTs) {
    if (!devDependencies.has("typescript")) {
      devDependencies.set("typescript", KNOWN_VERSIONS["typescript"] ?? "*");
    }
    if (!devDependencies.has("tsx")) {
      devDependencies.set("tsx", KNOWN_VERSIONS["tsx"] ?? "*");
    }
    if (!devDependencies.has("@types/node")) {
      devDependencies.set("@types/node", KNOWN_VERSIONS["@types/node"] ?? "*");
    }
  }

  const pkg: Record<string, unknown> = {
    name,
    version: "1.0.0",
    private: true,
    scripts,
  };

  // Sort keys for deterministic output
  if (dependencies.size > 0) {
    pkg.dependencies = Object.fromEntries(
      [...dependencies.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (devDependencies.size > 0) {
    pkg.devDependencies = Object.fromEntries(
      [...devDependencies.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  return JSON.stringify(pkg, null, 2) + "\n";
}
