import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
