import type { Command } from '@vercel/sandbox';
import type { SandboxService, Logger } from './sandbox.js';
import type { SessionManager } from './sessionManager.js';
import type { TerminalManager, TerminalSession } from './terminalManager.js';

/**
 * Unique sentinel markers embedded in command output to extract
 * the exit code and final working directory. Uses OSC escape sequences
 * that won't collide with normal terminal output.
 */
const SENTINEL_PREFIX = '\x1b]999;';
const SENTINEL_SUFFIX = '\x07';
const CWD_MARKER = `${SENTINEL_PREFIX}CWD:`;
const EXIT_MARKER = `${SENTINEL_PREFIX}EXIT:`;

/** Minimum buffer size to retain when checking for partial sentinels */
const SENTINEL_BUFFER_RESERVE = 100;

/** Maximum number of commands to keep in history per terminal */
const MAX_HISTORY_SIZE = 1000;

export interface ExecuteResult {
  exitCode: number;
  cwd: string;
}

/**
 * Wraps a user command with sentinel markers that report the exit code
 * and final working directory after execution.
 *
 * Uses `eval` to isolate the user's command from the sentinel logic,
 * so unterminated quotes, `exit`, or syntax errors in user input
 * don't prevent sentinel emission.
 */
function wrapCommand(userInput: string): string {
  // Escape single quotes in user input for embedding in a single-quoted string.
  // Replace each ' with '\'' (end quote, escaped quote, start quote).
  const escaped = userInput.replace(/'/g, "'\\''");

  // Use eval inside a subshell so syntax errors are contained.
  // The trap-like pattern: run user command via eval in a subshell,
  // capture its exit code, then always emit sentinels.
  return [
    `__tc_ec=0; eval '${escaped}' || __tc_ec=$?`,
    `printf '${SENTINEL_PREFIX}CWD:%s${SENTINEL_SUFFIX}' "$(pwd)"`,
    `printf '${SENTINEL_PREFIX}EXIT:%d${SENTINEL_SUFFIX}' "$__tc_ec"`,
  ].join('; ');
}

/**
 * Parses sentinel markers from the buffered tail of command output.
 * Returns the extracted values and any remaining non-sentinel text.
 */
function parseSentinels(buffer: string): {
  cwd: string | null;
  exitCode: number | null;
  remainingText: string;
} {
  let cwd: string | null = null;
  let exitCode: number | null = null;
  let remaining = buffer;

  // Extract CWD sentinel
  const cwdStart = remaining.indexOf(CWD_MARKER);
  if (cwdStart !== -1) {
    const cwdEnd = remaining.indexOf(SENTINEL_SUFFIX, cwdStart + CWD_MARKER.length);
    if (cwdEnd !== -1) {
      cwd = remaining.substring(cwdStart + CWD_MARKER.length, cwdEnd);
      remaining = remaining.substring(0, cwdStart) + remaining.substring(cwdEnd + SENTINEL_SUFFIX.length);
    }
  }

  // Extract EXIT sentinel
  const exitStart = remaining.indexOf(EXIT_MARKER);
  if (exitStart !== -1) {
    const exitEnd = remaining.indexOf(SENTINEL_SUFFIX, exitStart + EXIT_MARKER.length);
    if (exitEnd !== -1) {
      const exitStr = remaining.substring(exitStart + EXIT_MARKER.length, exitEnd);
      exitCode = parseInt(exitStr, 10);
      if (Number.isNaN(exitCode)) exitCode = 1;
      remaining = remaining.substring(0, exitStart) + remaining.substring(exitEnd + SENTINEL_SUFFIX.length);
    }
  }

  return { cwd, exitCode, remainingText: remaining };
}

/**
 * Service that manages terminal command execution within sandbox sessions.
 * Handles command wrapping, output streaming with sentinel parsing,
 * and process lifecycle management.
 */
export class TerminalService {
  private sandboxService: SandboxService;
  private sessionManager: SessionManager;
  private terminalManager: TerminalManager;
  private logger: Logger;

  constructor(
    sandboxService: SandboxService,
    sessionManager: SessionManager,
    terminalManager: TerminalManager,
    logger: Logger,
  ) {
    this.sandboxService = sandboxService;
    this.sessionManager = sessionManager;
    this.terminalManager = terminalManager;
    this.logger = logger;
  }

  /**
   * Executes a command in the terminal's sandbox, streaming output via the callback.
   * Tracks cwd changes across commands using sentinel markers.
   *
   * @param terminalId - The terminal session to run in
   * @param input - The raw command string from the user
   * @param onOutput - Callback for each output chunk
   * @returns The exit code and new working directory
   */
  async executeCommand(
    terminalId: string,
    input: string,
    onOutput: (data: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<ExecuteResult> {
    const terminal = this.terminalManager.getTerminal(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    if (terminal.isRunning) {
      throw new Error('A command is already running in this terminal');
    }

    const session = await this.sessionManager.getSession(terminal.sessionId);
    if (!session || session.status !== 'running') {
      throw new Error('Session is not running');
    }

    const sandbox = this.sandboxService.getSandbox(session.sandboxId);
    const wrappedCmd = wrapCommand(input);

    terminal.isRunning = true;
    terminal.history.push(input);
    if (terminal.history.length > MAX_HISTORY_SIZE) {
      terminal.history.shift();
    }

    await this.sessionManager.updateActivity(session.id);

    let command: Command;
    try {
      command = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-c', wrappedCmd],
        cwd: terminal.cwd,
        detached: true,
      });
      terminal.activeCommand = command;
    } catch (error) {
      terminal.isRunning = false;
      terminal.activeCommand = null;
      throw error;
    }

    // Stream output, buffering stdout to detect and strip sentinels
    let stdoutBuffer = '';
    let exitCode = 0;
    let newCwd = terminal.cwd;

    try {
      for await (const log of command.logs()) {
        if (log.stream === 'stderr') {
          onOutput(log.data, 'stderr');
          continue;
        }

        // Accumulate stdout in buffer for sentinel detection
        stdoutBuffer += log.data;

        // Check if the buffer contains sentinel markers
        const firstSentinel = stdoutBuffer.indexOf(SENTINEL_PREFIX);

        if (firstSentinel !== -1) {
          // Forward everything before the sentinel
          if (firstSentinel > 0) {
            onOutput(stdoutBuffer.substring(0, firstSentinel), 'stdout');
          }
          // Keep sentinel data in the buffer for final parsing
          stdoutBuffer = stdoutBuffer.substring(firstSentinel);
        } else if (stdoutBuffer.length > SENTINEL_BUFFER_RESERVE) {
          // No sentinel found yet — flush everything except the tail
          // (which might contain a partial sentinel)
          const flushEnd = stdoutBuffer.length - SENTINEL_BUFFER_RESERVE;
          onOutput(stdoutBuffer.substring(0, flushEnd), 'stdout');
          stdoutBuffer = stdoutBuffer.substring(flushEnd);
        }
        // Otherwise, keep accumulating (buffer is small enough)
      }

      // Parse any remaining sentinel data
      const parsed = parseSentinels(stdoutBuffer);
      if (parsed.remainingText) {
        onOutput(parsed.remainingText, 'stdout');
      }
      if (parsed.cwd) {
        newCwd = parsed.cwd;
      }
      exitCode = parsed.exitCode ?? command.exitCode ?? 0;
    } catch (error) {
      this.logger.error(`Error streaming command output: ${error}`);
      // Try to get exit code from command
      exitCode = command.exitCode ?? 1;
    } finally {
      terminal.isRunning = false;
      terminal.activeCommand = null;
      terminal.cwd = newCwd;
    }

    return { exitCode, cwd: newCwd };
  }

  /**
   * Kills the currently running command in a terminal by sending SIGTERM.
   * Falls back to SIGKILL if the SIGTERM call fails.
   */
  async killCommand(terminalId: string): Promise<void> {
    const terminal = this.terminalManager.getTerminal(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    if (!terminal.activeCommand || !terminal.isRunning) {
      return; // Nothing to kill
    }

    try {
      await terminal.activeCommand.kill('SIGTERM');
    } catch (error) {
      this.logger.error(`Error killing command in terminal ${terminalId}: ${error}`);
      // Try SIGKILL as fallback
      try {
        await terminal.activeCommand.kill('SIGKILL');
      } catch {
        // Best effort — command may have already exited
      }
    }
  }

  /**
   * Destroys a terminal session and kills any active command.
   */
  async destroyTerminal(terminalId: string): Promise<void> {
    await this.killCommand(terminalId).catch(() => {});
    this.terminalManager.destroyTerminal(terminalId);
  }

  /**
   * Destroys all terminals for a session.
   */
  async destroyAllForSession(sessionId: string): Promise<void> {
    const terminals = this.terminalManager.getTerminalsBySession(sessionId);
    await Promise.allSettled(
      terminals.map((t) => this.destroyTerminal(t.id)),
    );
  }

  /**
   * Destroys all terminals across all sessions. Used during graceful shutdown.
   */
  async destroyAll(): Promise<void> {
    const terminals = this.terminalManager.getAllTerminals();
    await Promise.allSettled(
      terminals.map((t) => this.destroyTerminal(t.id)),
    );
  }
}
