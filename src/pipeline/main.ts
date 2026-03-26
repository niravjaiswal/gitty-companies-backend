import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { extractSpec } from "./stage1/extract-spec.js";
import { designScenario } from "./stage2/design-scenario.js";
import { generateRepo } from "./stage3/generate-repo.js";
import { validateRepo } from "./stage4/validate-repo.js";
import { generatePrd } from "./stage5/generate-prd.js";

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

  console.error("Stage 4: Validating & repairing repository...");
  const validated = await validateRepo(repo, design, spec);
  console.error("Stage 4 complete.");

  // Use validated files (repaired) for output and downstream stages
  const outputFiles = validated.files;

  console.error("Stage 5: Generating PRD...");
  const prd = await generatePrd(spec, design, { ...repo, files: outputFiles });
  console.error("Stage 5 complete.");

  const slug = design.scenario.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outputDir = join(".", "output", slug);

  for (const [filePath, content] of outputFiles) {
    const fullPath = join(outputDir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  await writeFile(join(outputDir, "PRD.md"), prd.markdown, "utf-8");

  // Stage 4 validation report
  for (const step of validated.validation) {
    const status = step.passed ? "PASS" : "FAIL";
    const repairs = step.repairsAttempted > 0
      ? ` (repairs: ${step.repairsSucceeded}/${step.repairsAttempted})`
      : "";
    console.error(`  [${status}] ${step.step} (${step.rounds} round(s))${repairs}`);
    if (!step.passed && step.errors.length > 0) {
      for (const e of step.errors.slice(0, 5)) console.error(`    ${e.slice(0, 200)}`);
    }
  }
  console.error(`  Overall: ${validated.overallPass ? "PASS" : "FAIL"}`);

  if (validated.warnings.length) {
    console.error(`\nStage 4 Warnings (${validated.warnings.length}):`);
    for (const w of validated.warnings) console.error(`  - ${w}`);
  }

  if (repo.warnings.length) {
    console.error(`\nStage 3 Warnings (${repo.warnings.length}):`);
    for (const w of repo.warnings) console.error(`  - ${w}`);
  }
  if (repo.failures.length) {
    console.error(`\nStage 3 Failures (${repo.failures.length}):`);
    for (const f of repo.failures) console.error(`  - ${f.path}: ${f.errors.join(", ")}`);
  }

  console.error(`\nFiles written to ${outputDir}/`);
} catch (error) {
  console.error("Pipeline failed:", error);
  process.exit(1);
}
