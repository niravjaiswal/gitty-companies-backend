import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Sandbox } from '@vercel/sandbox';
import { loadConfig } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
}

/**
 * Wraps the @vercel/sandbox SDK, managing active sandbox instances
 * and routing operations to the correct sandbox by ID.
 */
export class SandboxService {
  private activeSandboxes = new Map<string, Sandbox>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Creates a new Vercel sandbox instance.
   * @param options.runtime - The sandbox runtime (default: 'node24')
   * @param options.ports - Ports to expose (default: [9090, 3000, 5173])
   * @returns The sandbox ID
   */
  async createSandbox(options?: {
    runtime?: string;
    ports?: number[];
  }): Promise<{ id: string }> {
    const config = loadConfig();
    const runtime = options?.runtime ?? 'node24';
    const ports = options?.ports ?? [9090, 3000, 5173];

    try {
      const sandbox = await Sandbox.create({
        runtime,
        ports,
        resources: { vcpus: 4 },
        token: config.vercelToken,
        teamId: config.vercelTeamId,
        projectId: config.vercelProjectId,
      });

      const id = sandbox.sandboxId;
      this.activeSandboxes.set(id, sandbox as Sandbox);
      this.logger.info(
        `Sandbox created: ${id} (runtime: ${runtime}, ports: ${ports.join(', ')})`,
      );
      return { id };
    } catch (error) {
      this.logger.error(`Failed to create sandbox: ${error}`);
      throw error;
    }
  }

  /**
   * Runs a command inside the specified sandbox.
   * @param sandboxId - The sandbox to run the command in
   * @param cmd - The command to execute
   * @param args - Optional command arguments
   * @returns The exit code, stdout, and stderr
   */
  async runCommand(
    sandboxId: string,
    cmd: string,
    args?: string[],
  ): Promise<ExecResult> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      const result = await sandbox.runCommand(cmd, args ?? []);
      const stdout = await result.stdout();
      const stderr = await result.stderr();

      this.logger.info(
        `Command executed in ${sandboxId}: ${cmd} ${(args ?? []).join(' ')}`,
      );
      return {
        exitCode: result.exitCode,
        stdout,
        stderr,
      };
    } catch (error) {
      this.logger.error(
        `Command failed in ${sandboxId}: ${cmd} — ${error}`,
      );
      throw error;
    }
  }

  /**
   * Reads a file from the sandbox filesystem.
   * @param sandboxId - The sandbox to read from
   * @param path - Absolute path inside the sandbox
   * @returns The file content as a string
   */
  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      const buffer = await sandbox.readFileToBuffer({ path });
      if (!buffer) {
        throw new Error(`File not found or empty: ${path}`);
      }
      this.logger.info(`File read from ${sandboxId}: ${path}`);
      return buffer.toString('utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to read file ${path} in ${sandboxId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Writes content to a file in the sandbox.
   * @param sandboxId - The sandbox to write to
   * @param path - Absolute path inside the sandbox
   * @param content - The file content to write
   */
  async writeFile(
    sandboxId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      await sandbox.writeFiles([
        { path, content: Buffer.from(content, 'utf-8') },
      ]);
      this.logger.info(`File written in ${sandboxId}: ${path}`);
    } catch (error) {
      this.logger.error(
        `Failed to write file ${path} in ${sandboxId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Lists the contents of a directory in the sandbox.
   * Uses `ls -1Ap` to get a structured listing (no built-in readdir in the SDK).
   * @param sandboxId - The sandbox to list from
   * @param path - Absolute directory path inside the sandbox
   * @returns Array of directory entries with name and type
   */
  async listDirectory(
    sandboxId: string,
    path: string,
  ): Promise<DirectoryEntry[]> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      const result = await sandbox.runCommand('ls', ['-1Ap', path]);
      const stdout = await result.stdout();

      this.logger.info(`Directory listed in ${sandboxId}: ${path}`);

      return stdout
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          if (line.endsWith('/')) {
            return { name: line.slice(0, -1), type: 'directory' as const };
          }
          return { name: line, type: 'file' as const };
        });
    } catch (error) {
      this.logger.error(
        `Failed to list directory ${path} in ${sandboxId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Downloads, configures, and starts code-server inside the sandbox.
   * Polls until code-server is ready, then returns its public URL.
   */
  async setupCodeServer(sandboxId: string): Promise<{ url: string }> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    const CODE_SERVER_VERSION = '4.101.2';
    const TARBALL_NAME = `code-server-${CODE_SERVER_VERSION}-linux-amd64`;
    const TARBALL_URL = `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/${TARBALL_NAME}.tar.gz`;

    // Step 1: Download & extract code-server
    this.logger.info(`Downloading code-server ${CODE_SERVER_VERSION} in sandbox ${sandboxId}...`);
    const download = await sandbox.runCommand('bash', [
      '-c',
      `curl -fL ${TARBALL_URL} | tar -xz -C /tmp`,
    ]);
    const dlStdout = await download.stdout();
    const dlStderr = await download.stderr();
    if (download.exitCode !== 0) {
      throw new Error(`Failed to download code-server: ${dlStderr || dlStdout}`);
    }

    // Step 2: Start code-server detached (pass all config via CLI args)
    this.logger.info(`Starting code-server in sandbox ${sandboxId}...`);
    await sandbox.runCommand({
      cmd: `/tmp/${TARBALL_NAME}/bin/code-server`,
      args: [
        '--bind-addr', '0.0.0.0:9090',
        '--auth', 'none',
        '--cert', 'false',
        '/vercel/sandbox',
      ],
      detached: true,
    });

    // Step 3: Poll readiness (every 2s, timeout 60s)
    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const check = await sandbox.runCommand('bash', [
          '-c',
          'curl -s -o /dev/null -w "%{http_code}" http://localhost:9090',
        ]);
        const httpCode = (await check.stdout()).trim();
        this.logger.info(
          `code-server poll attempt ${attempt}/${maxAttempts} in ${sandboxId}: HTTP ${httpCode}`,
        );
        if (httpCode === '200' || httpCode === '302') {
          this.logger.info(
            `code-server ready in sandbox ${sandboxId} after ${attempt * 2}s`,
          );
          break;
        }
      } catch (err) {
        this.logger.warn(
          `code-server poll attempt ${attempt}/${maxAttempts} in ${sandboxId} failed: ${err}`,
        );
      }
      if (attempt === maxAttempts) {
        // Grab code-server logs before throwing
        try {
          const ps = await sandbox.runCommand('bash', ['-c', 'ps aux | grep code-server']);
          this.logger.error(`code-server processes: ${await ps.stdout()}`);
        } catch { /* ignore */ }
        throw new Error(
          `code-server failed to become ready after ${maxAttempts * 2}s in sandbox ${sandboxId}`,
        );
      }
    }

    // Step 5: Return public URL
    const url = sandbox.domain(9090);
    this.logger.info(`code-server URL for sandbox ${sandboxId}: ${url}`);
    return { url };
  }

  /**
   * Deploys and starts the monitor agent inside the sandbox.
   * The agent watches filesystem changes, logs shell commands, and
   * takes periodic file-content snapshots.
   */
  async startMonitor(sandboxId: string): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    // Read the monitor-agent.sh script from the assets directory
    const scriptPath = join(__dirname, '..', 'assets', 'monitor-agent.sh');
    const scriptContent = readFileSync(scriptPath, 'utf-8');

    // Write the script into the sandbox
    await sandbox.writeFiles([
      { path: '/tmp/monitor-agent.sh', content: Buffer.from(scriptContent, 'utf-8') },
    ]);

    // Make it executable
    await sandbox.runCommand('chmod', ['+x', '/tmp/monitor-agent.sh']);

    // Run it detached
    await sandbox.runCommand({
      cmd: 'bash',
      args: ['/tmp/monitor-agent.sh'],
      detached: true,
    });

    this.logger.info(`Monitor agent started in sandbox ${sandboxId}`);
  }

  /**
   * Deploys Claude Code hooks configuration into the sandbox.
   * Writes ~/.claude/settings.json and /tmp/monitor/claude-hook.sh.
   */
  async deployClaudeHooks(sandboxId: string): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    // Detect home directory
    const homeResult = await sandbox.runCommand('bash', ['-c', 'echo $HOME']);
    const homeDir = (await homeResult.stdout()).trim() || '/root';

    // Create ~/.claude directory
    await sandbox.runCommand('mkdir', ['-p', `${homeDir}/.claude`]);

    // Read and write claude-hooks-settings.json
    const settingsPath = join(__dirname, '..', 'assets', 'claude-hooks-settings.json');
    const settingsContent = readFileSync(settingsPath, 'utf-8');
    await sandbox.writeFiles([
      { path: `${homeDir}/.claude/settings.json`, content: Buffer.from(settingsContent, 'utf-8') },
    ]);

    // Read and write claude-hook.sh
    const hookScriptPath = join(__dirname, '..', 'assets', 'claude-hook.sh');
    const hookScriptContent = readFileSync(hookScriptPath, 'utf-8');
    await sandbox.writeFiles([
      { path: '/tmp/monitor/claude-hook.sh', content: Buffer.from(hookScriptContent, 'utf-8') },
    ]);

    // Make it executable
    await sandbox.runCommand('chmod', ['+x', '/tmp/monitor/claude-hook.sh']);

    this.logger.info(`Claude Code hooks deployed in sandbox ${sandboxId}`);
  }

  /**
   * Collects Claude Code session transcripts from the sandbox.
   * Returns an array of { claudeSessionId, content } for each transcript file found.
   */
  async collectClaudeTranscripts(
    sandboxId: string,
  ): Promise<Array<{ claudeSessionId: string; content: string }>> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      // Detect home directory
      const homeResult = await sandbox.runCommand('bash', ['-c', 'echo $HOME']);
      const homeDir = (await homeResult.stdout()).trim() || '/root';

      // Find all session transcript JSONL files
      const findResult = await sandbox.runCommand('bash', [
        '-c',
        `find ${homeDir}/.claude/projects -name '*.jsonl' -path '*/sessions/*' 2>/dev/null || true`,
      ]);
      const findStdout = await findResult.stdout();

      const filePaths = findStdout
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (filePaths.length === 0) {
        return [];
      }

      const transcripts: Array<{ claudeSessionId: string; content: string }> = [];

      for (const filePath of filePaths) {
        try {
          // Extract session ID from filename (e.g., "abc-def-123.jsonl" -> "abc-def-123")
          const fileName = filePath.split('/').pop() ?? '';
          const claudeSessionId = fileName.replace('.jsonl', '');

          const buffer = await sandbox.readFileToBuffer({ path: filePath });
          if (!buffer) continue;

          transcripts.push({
            claudeSessionId,
            content: buffer.toString('utf-8'),
          });
        } catch {
          // Skip individual files that can't be read
        }
      }

      this.logger.info(
        `Collected ${transcripts.length} Claude transcript(s) from sandbox ${sandboxId}`,
      );
      return transcripts;
    } catch {
      this.logger.warn(`Failed to collect Claude transcripts from sandbox ${sandboxId}`);
      return [];
    }
  }

  /**
   * Clones starter code into the sandbox working directory.
   * Call before setupCodeServer so files are visible on IDE open.
   */
  async seedStarterCode(
    sandboxId: string,
    repoUrl: string,
  ): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    this.logger.info(`Seeding starter code in sandbox ${sandboxId} from ${repoUrl}`);
    const result = await sandbox.runCommand('git', ['clone', repoUrl, '.'], {});
    const stderr = await result.stderr();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to clone starter code: ${stderr}`);
    }
  }

  /**
   * Returns the public domain URL for a given port on the sandbox.
   */
  getDomainForPort(sandboxId: string, port: number): string {
    const sandbox = this.getSandboxOrThrow(sandboxId);
    return sandbox.domain(port);
  }

  /**
   * Shuts down and cleans up the sandbox.
   * @param sandboxId - The sandbox to destroy
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.getSandboxOrThrow(sandboxId);

    try {
      await sandbox.stop();
      this.activeSandboxes.delete(sandboxId);
      this.logger.info(`Sandbox destroyed: ${sandboxId}`);
    } catch (error) {
      this.logger.error(`Failed to destroy sandbox ${sandboxId}: ${error}`);
      this.activeSandboxes.delete(sandboxId);
      throw error;
    }
  }

  /**
   * Destroys all active sandboxes. Used during graceful shutdown.
   */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.activeSandboxes.keys());
    this.logger.info(`Destroying all sandboxes (${ids.length} active)...`);
    await Promise.allSettled(ids.map((id) => this.destroySandbox(id)));
  }

  /**
   * Returns the raw Sandbox instance for advanced operations (e.g. streaming commands).
   * @param sandboxId - The sandbox to retrieve
   */
  getSandbox(sandboxId: string): Sandbox {
    return this.getSandboxOrThrow(sandboxId);
  }

  private getSandboxOrThrow(sandboxId: string): Sandbox {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }
    return sandbox;
  }
}
