import { pathToFileURL } from "node:url";
import { sampleEvents } from "./data.js";
import { buildPipelineReport, renderPipelineReport } from "./report.js";

export async function main(): Promise<string> {
  const report = await buildPipelineReport(sampleEvents);
  return renderPipelineReport(report);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .then((output) => {
      console.log(output);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
