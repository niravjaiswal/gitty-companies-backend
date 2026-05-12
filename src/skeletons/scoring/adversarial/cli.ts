import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSkeletons } from "../../loader.js";
import { runAdversarialForSkeleton } from "./runner.js";
import type { AdversarialReport } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, "..", "reports");

type ParsedArgs = {
  target: string | "--all";
  runs: number;
  maxTurns: number;
  model?: string;
  workDir?: string;
  out?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { target: "--all", runs: 1, maxTurns: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.target = "--all";
    else if (a === "--runs") args.runs = Number(argv[++i] ?? 1);
    else if (a === "--max-turns") args.maxTurns = Number(argv[++i] ?? 25);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--work-dir") args.workDir = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else args.target = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets =
    args.target === "--all"
      ? (await listSkeletons()).map((s) => s.id)
      : [args.target];

  const reports: AdversarialReport[] = [];

  for (const id of targets) {
    process.stderr.write(`[adversarial] ${id} (${args.runs} runs)\n`);
    const report = await runAdversarialForSkeleton(id, {
      runs: args.runs,
      maxTurns: args.maxTurns,
      model: args.model,
      workDir: args.workDir,
    });
    reports.push(report);
    const a = report.aggregate;
    process.stderr.write(
      `  verdict=${report.qualityVerdict} solved=${(a.solvedRate * 100).toFixed(0)}% medianTurns=${a.medianTurns} medianEdits=${a.medianEdits} avgCost=$${a.avgCostUsd.toFixed(2)}\n`,
    );
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  const outPath =
    args.out ??
    join(REPORTS_DIR, `adversarial-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(reports, null, 2));
  process.stderr.write(`\nwrote ${reports.length} reports to ${outPath}\n`);

  console.log("\n=== adversarial summary ===");
  for (const r of reports) {
    const a = r.aggregate;
    console.log(
      `${r.skeleton.padEnd(30)} ${r.qualityVerdict.padEnd(14)} solved=${(a.solvedRate * 100).toFixed(0)}% edits=${a.medianEdits} turns=${a.medianTurns} cost=$${a.avgCostUsd.toFixed(2)} hardcode=${a.hardcodingObserved ? "Y" : "N"} judgment=${a.judgmentCallsObserved ? "Y" : "N"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
