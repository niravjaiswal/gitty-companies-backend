import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { extractSpec } from "./stage1/extract-spec.js";
import { designScenario } from "./stage2/design-scenario.js";
import { generateRepo } from "./stage3/generate-repo.js";

const input = process.argv[2];


if (!input) {
  console.error("Usage: npx tsx src/index.ts \"<assessment description>\"");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

try {
  console.error("Stage 1: Extracting spec...");
  const spec = await extractSpec(input);
  console.error("Stage 1 complete.");

  console.error("Stage 2: Designing scenario...");
  const design = await designScenario(spec);
  console.error("Stage 2 complete.");

  console.error("Stage 3: Generating repository...");
  const repo = await generateRepo(design, spec);
  console.error("Stage 3 complete.");

  const slug = design.scenario.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outputDir = join(".", "output", slug);

  for (const [filePath, content] of repo.files) {
    const fullPath = join(outputDir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  if (repo.warnings.length) {
    console.error(`\nWarnings (${repo.warnings.length}):`);
    for (const w of repo.warnings) console.error(`  - ${w}`);
  }
  if (repo.failures.length) {
    console.error(`\nFailures (${repo.failures.length}):`);
    for (const f of repo.failures) console.error(`  - ${f.path}: ${f.errors.join(", ")}`);
  }

  console.error(`\nFiles written to ${outputDir}/`);
} catch (error) {
  console.error("Pipeline failed:", error);
  process.exit(1);
}
