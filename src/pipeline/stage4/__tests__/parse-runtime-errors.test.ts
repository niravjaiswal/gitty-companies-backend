import { describe, it, expect } from "vitest";
import {
  parseRuntimeErrors,
  runtimeErrorsToTscErrorMap,
} from "../parse-runtime-errors.js";

const BASE_DIR = "/tmp/stage4-abc123";

describe("parseRuntimeErrors", () => {
  it("parses CJS module not found with Require stack", () => {
    const output = [
      "node:internal/modules/cjs/loader:1148",
      "  throw err;",
      "  ^",
      "",
      "Error: Cannot find module './routes/alerts'",
      "Require stack:",
      `- ${BASE_DIR}/src/server.ts`,
      "- /tmp/stage4-abc123/node_modules/ts-node/dist/index.js",
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)",
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/server.ts",
      message: "imports non-existent module './routes/alerts'",
    });
  });

  it("parses ESM module not found (ERR_MODULE_NOT_FOUND)", () => {
    const output = [
      "node:internal/errors:496",
      "    ErrorCaptureStackTrace(err);",
      "    ^",
      "",
      `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${BASE_DIR}/src/routes/alerts' imported from ${BASE_DIR}/src/server.ts`,
      "    at finalizeResolution (node:internal/modules/esm/resolve:265:11)",
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/server.ts",
      message: "imports non-existent module './src/routes/alerts'",
    });
  });

  it("parses SyntaxError with file path", () => {
    const output = [
      `${BASE_DIR}/src/server.ts:15`,
      "    const x = {;",
      "              ^",
      `SyntaxError: ${BASE_DIR}/src/server.ts: Unexpected token (15:3)`,
      "    at Module._compile (node:internal/modules/cjs/loader:1241:14)",
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/server.ts",
      message: "SyntaxError: Unexpected token (15:3)",
    });
  });

  it("strips baseDir prefix from all extracted paths", () => {
    const output = [
      "Error: Cannot find module './utils'",
      "Require stack:",
      `- ${BASE_DIR}/src/app/index.ts`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors[0].file).toBe("src/app/index.ts");
    expect(errors[0].file).not.toContain(BASE_DIR);
  });

  it("returns empty array for output with no recognizable patterns", () => {
    const output = "Everything is fine.\nNo errors here.\n";
    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toEqual([]);
  });

  it("deduplicates: same file appears once even if multiple errors reference it", () => {
    const output = [
      "Error: Cannot find module './routes/alerts'",
      "Require stack:",
      `- ${BASE_DIR}/src/server.ts`,
      "",
      "Error: Cannot find module './routes/users'",
      "Require stack:",
      `- ${BASE_DIR}/src/server.ts`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/server.ts");
  });

  it("extracts both CJS and ESM errors from mixed output", () => {
    const output = [
      "Error: Cannot find module './routes/alerts'",
      "Require stack:",
      `- ${BASE_DIR}/src/server.ts`,
      "",
      `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${BASE_DIR}/src/lib/db' imported from ${BASE_DIR}/src/app.ts`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe("src/server.ts");
    expect(errors[1].file).toBe("src/app.ts");
  });

  it("handles multiline stack traces without false positives", () => {
    const output = [
      "Error: Cannot find module './missing'",
      "Require stack:",
      `- ${BASE_DIR}/src/index.ts`,
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)",
      "    at Module._load (node:internal/modules/cjs/loader:986:27)",
      "    at Module.require (node:internal/modules/cjs/loader:1233:19)",
      "    at require (node:internal/modules/helpers:179:18)",
      `    at Object.<anonymous> (${BASE_DIR}/src/index.ts:3:1)`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    // Only one error should be extracted (from CJS pattern), not duplicated by generic fallback
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/index.ts");
  });

  it("ignores file paths outside baseDir", () => {
    const output = [
      "Error: Cannot find module 'express'",
      "Require stack:",
      "- /usr/local/lib/node_modules/ts-node/src/index.ts",
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1145:15)",
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toEqual([]);
  });

  it("handles baseDir without trailing slash", () => {
    const output = [
      "Error: Cannot find module './config'",
      "Require stack:",
      `- ${BASE_DIR}/src/app.ts`,
    ].join("\n");

    // Pass without trailing slash
    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/app.ts");
  });

  it("handles baseDir with trailing slash", () => {
    const output = [
      "Error: Cannot find module './config'",
      "Require stack:",
      `- ${BASE_DIR}/src/app.ts`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR + "/");
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/app.ts");
  });

  it("uses generic fallback for unrecognized error patterns with file paths", () => {
    const output = [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      `    at processItems (${BASE_DIR}/src/utils/transform.ts:42:15)`,
      "    at Object.<anonymous> (node:internal/modules/run_main:122:12)",
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/utils/transform.ts");
    expect(errors[0].message).toBeTruthy();
  });

  it("generic fallback skips node_modules paths", () => {
    const output = [
      "Error: something broke",
      `    at ${BASE_DIR}/node_modules/some-lib/dist/index.js:10:5`,
    ].join("\n");

    const errors = parseRuntimeErrors(output, BASE_DIR);
    expect(errors).toEqual([]);
  });
});

describe("runtimeErrorsToTscErrorMap", () => {
  it("converts RuntimeError to TscError with synthetic line/column/code", () => {
    const errors = [
      { file: "src/server.ts", message: "imports non-existent module './routes/alerts'" },
    ];

    const map = runtimeErrorsToTscErrorMap(errors);
    expect(map.size).toBe(1);

    const tscErrors = map.get("src/server.ts")!;
    expect(tscErrors).toHaveLength(1);
    expect(tscErrors[0]).toEqual({
      file: "src/server.ts",
      line: 1,
      column: 1,
      code: "RUNTIME",
      message: "imports non-existent module './routes/alerts'",
    });
  });

  it("groups multiple errors for same file", () => {
    const errors = [
      { file: "src/server.ts", message: "error one" },
      { file: "src/server.ts", message: "error two" },
      { file: "src/app.ts", message: "error three" },
    ];

    const map = runtimeErrorsToTscErrorMap(errors);
    expect(map.size).toBe(2);
    expect(map.get("src/server.ts")).toHaveLength(2);
    expect(map.get("src/app.ts")).toHaveLength(1);
  });

  it("returns empty map for empty input", () => {
    const map = runtimeErrorsToTscErrorMap([]);
    expect(map.size).toBe(0);
  });
});
