import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PolicyFile {
  version: 1;
  suppressions: string[];
  metadata?: {
    owner?: string;
    description?: string;
  };
}

export type MergeStrategy = "union" | "config-wins" | "in-code-wins";

export interface PolicyMergeOptions {
  inCode: string[];
  fromFile: string[];
  strategy: MergeStrategy;
}

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parsePolicyFile(raw: string, source = "<inline>"): PolicyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PolicyValidationError(`Policy at ${source} is not valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PolicyValidationError(`Policy at ${source} must be a JSON object`);
  }

  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new PolicyValidationError(
      `Policy at ${source} has unsupported version (expected 1)`,
    );
  }

  if (!isStringArray(record.suppressions)) {
    throw new PolicyValidationError(
      `Policy at ${source} must include a suppressions array of strings`,
    );
  }

  const cleaned = record.suppressions
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    version: 1,
    suppressions: cleaned,
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as PolicyFile["metadata"])
        : undefined,
  };
}

export async function loadPolicyFile(path: string): Promise<PolicyFile> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  return parsePolicyFile(raw, absolute);
}

export function mergeSuppressions(options: PolicyMergeOptions): string[] {
  const inCodeClean = options.inCode.map((s) => s.trim()).filter(Boolean);
  const fromFileClean = options.fromFile.map((s) => s.trim()).filter(Boolean);

  switch (options.strategy) {
    case "union": {
      return [...new Set([...inCodeClean, ...fromFileClean])];
    }
    case "config-wins": {
      if (fromFileClean.length === 0) return [...new Set(inCodeClean)];
      return [...new Set(fromFileClean)];
    }
    case "in-code-wins": {
      if (inCodeClean.length === 0) return [...new Set(fromFileClean)];
      return [...new Set(inCodeClean)];
    }
  }
}
