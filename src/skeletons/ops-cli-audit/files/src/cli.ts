import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sampleSnapshot } from "./data.js";
import { evaluateSnapshot, parseAuditSnapshot } from "./audit.js";
import { formatJsonReport, formatTextReport } from "./report.js";
import { loadPolicyFile, mergeSuppressions, type MergeStrategy } from "./lib/policy.js";
import type { AuditSnapshot } from "./types.js";

export interface CliOptions {
  inputPath: string | null;
  format: "text" | "json";
  suppressions: string[];
  policyPath: string | null;
  mergeStrategy: MergeStrategy;
}

export interface CliIO {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

const DEFAULT_IO: CliIO = {
  stdout: process.stdout,
  stderr: process.stderr,
};

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: null,
    format: "text",
    suppressions: [],
    policyPath: null,
    mergeStrategy: "union",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input" || arg === "-i") {
      const value = argv[++index];
      if (!value) {
        throw new Error("Missing value for --input");
      }
      options.inputPath = value;
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      const value = argv[++index];
      if (value !== "text" && value !== "json") {
        throw new Error("Format must be either text or json");
      }
      options.format = value;
      continue;
    }

    if (arg === "--ignore") {
      const value = argv[++index];
      if (!value) {
        throw new Error("Missing value for --ignore");
      }
      options.suppressions = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === "--policy") {
      const value = argv[++index];
      if (!value) {
        throw new Error("Missing value for --policy");
      }
      options.policyPath = value;
      continue;
    }

    if (arg === "--strategy") {
      const value = argv[++index];
      if (value !== "union" && value !== "config-wins" && value !== "in-code-wins") {
        throw new Error("Strategy must be one of: union, config-wins, in-code-wins");
      }
      options.mergeStrategy = value;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return options;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.inputPath === null) {
      options.inputPath = arg;
      continue;
    }

    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

async function loadSnapshot(inputPath: string | null): Promise<AuditSnapshot> {
  if (!inputPath) {
    return sampleSnapshot;
  }

  const contents = await readFile(resolve(inputPath), "utf8");
  return parseAuditSnapshot(contents);
}

function usage(): string {
  return [
    "Usage: ops-audit [options] [input-file]",
    "",
    "Options:",
    "  -i, --input <path>      Path to a snapshot JSON file",
    "  -f, --format <fmt>      text or json",
    "      --ignore <list>     Comma-separated service:code suppressions (in-code source)",
    "      --policy <path>     Path to a JSON policy file (file source)",
    "      --strategy <kind>   union | config-wins | in-code-wins (default: union)",
    "  -h, --help              Show help",
    "",
  ].join("\n");
}

export async function runCli(
  argv: string[],
  io: CliIO = DEFAULT_IO,
): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      io.stdout.write(usage());
      return 0;
    }

    const options = parseArgs(argv);
    const snapshot = await loadSnapshot(options.inputPath);

    let suppressions = options.suppressions;
    if (options.policyPath) {
      const policy = await loadPolicyFile(options.policyPath);
      suppressions = mergeSuppressions({
        inCode: options.suppressions,
        fromFile: policy.suppressions,
        strategy: options.mergeStrategy,
      });
    }

    const report = evaluateSnapshot(snapshot, { suppressions });

    const output =
      options.format === "json"
        ? formatJsonReport(report)
        : formatTextReport(report);

    io.stdout.write(output);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    io.stderr.write(`${usage()}`);
    return 1;
  }
}
