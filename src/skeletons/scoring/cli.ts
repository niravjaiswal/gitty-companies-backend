import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listSkeletons } from "../loader.js";
import { scoreSkeleton } from "./scoreSkeleton.js";
import type { SkeletonScoreReport } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, "reports");

type ParsedArgs = {
  target: string | "--all";
  skipLlm: boolean;
  llmSamples: number;
  model?: string;
  out?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { target: "--all", skipLlm: false, llmSamples: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.target = "--all";
    else if (a === "--skip-llm") args.skipLlm = true;
    else if (a === "--samples") args.llmSamples = Number(argv[++i] ?? 3);
    else if (a === "--model") args.model = argv[++i];
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

  const reports: SkeletonScoreReport[] = [];
  for (const id of targets) {
    process.stderr.write(`scoring ${id}...\n`);
    const report = await scoreSkeleton(id, {
      llmSamples: args.llmSamples,
      skipLlm: args.skipLlm,
      model: args.model,
    });
    reports.push(report);
    process.stderr.write(
      `  median=${report.median} tier=${report.tier} verdict=${report.verdict}\n`,
    );
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const outPath =
    args.out ??
    join(REPORTS_DIR, `${new Date().toISOString().slice(0, 10)}-baseline.json`);
  await writeFile(outPath, JSON.stringify(reports, null, 2));
  process.stderr.write(`\nwrote ${reports.length} reports to ${outPath}\n`);

  // Also dump compact summary table to stdout
  console.log("\n=== summary ===");
  for (const r of reports) {
    const rowDims = Object.values(r.scores)
      .map((s) => `${s.dim.split("_")[0]}=${s.score}`)
      .join(" ");
    console.log(`${r.skeleton.padEnd(30)} ${r.tier.padEnd(7)} ${r.verdict.padEnd(11)} ${rowDims}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
