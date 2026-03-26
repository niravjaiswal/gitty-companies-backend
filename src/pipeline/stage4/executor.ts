import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class RepoExecutor {
  readonly dir: string;
  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(): Promise<RepoExecutor> {
    const dir = await mkdtemp(join(tmpdir(), "stage4-"));
    return new RepoExecutor(dir);
  }

  async writeFiles(files: Map<string, string>): Promise<void> {
    for (const [filePath, content] of files) {
      const fullPath = join(this.dir, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }
  }

  async readFile(filePath: string): Promise<string> {
    return readFile(join(this.dir, filePath), "utf-8");
  }

  async readAllFiles(paths: Iterable<string>): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const p of paths) {
      try {
        const content = await readFile(join(this.dir, p), "utf-8");
        result.set(p, content);
      } catch {
        // File may have been removed or never written — skip
      }
    }
    return result;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = join(this.dir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async npmInstall(timeoutMs = 120_000): Promise<ExecResult> {
    return this.exec("npm", ["install", "--ignore-scripts"], timeoutMs);
  }

  async tscCheck(timeoutMs = 60_000): Promise<ExecResult> {
    const tscPath = join(this.dir, "node_modules", ".bin", "tsc");
    return this.exec(tscPath, ["--noEmit", "--pretty", "false"], timeoutMs);
  }

  async vitestRun(timeoutMs = 60_000): Promise<ExecResult> {
    const vitestPath = join(this.dir, "node_modules", ".bin", "vitest");
    return this.exec(vitestPath, ["run", "--reporter=json"], timeoutMs);
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private async exec(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: this.dir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: { ...process.env, NODE_ENV: "development" },
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      const exitCode =
        typeof err.code === "number" ? err.code : 1;
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode,
      };
    }
  }
}
