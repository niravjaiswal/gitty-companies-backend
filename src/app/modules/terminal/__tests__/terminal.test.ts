import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TerminalService } from '../terminal.js';
import { TerminalManager, type TerminalSession } from '../terminalManager.js';
import type { SandboxService, Logger } from '../../../external/vercelSandbox/sandbox.js';
import type { SessionManager, Session } from '../../sessions/sessionManager.js';

// ---------------------------------------------------------------------------
// Sentinel constants (mirrored from the source for building expected output)
// ---------------------------------------------------------------------------
const SENTINEL_PREFIX = '\x1b]999;';
const SENTINEL_SUFFIX = '\x07';
const CWD_MARKER = `${SENTINEL_PREFIX}CWD:`;
const EXIT_MARKER = `${SENTINEL_PREFIX}EXIT:`;

/**
 * Builds a sentinel string for CWD, exactly as the real command would emit.
 */
function cwdSentinel(cwd: string): string {
  return `${CWD_MARKER}${cwd}${SENTINEL_SUFFIX}`;
}

/**
 * Builds a sentinel string for EXIT code, exactly as the real command would emit.
 */
function exitSentinel(code: number): string {
  return `${EXIT_MARKER}${code}${SENTINEL_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Mock log entry type matching Command.logs() output
// ---------------------------------------------------------------------------
type LogEntry =
  | { data: string; stream: 'stdout' }
  | { data: string; stream: 'stderr' };

/**
 * Creates a mock Command object with a controllable async log generator.
 * @param logEntries - The log entries to yield from logs()
 * @param exitCode - The exit code to report on the command object
 */
function createMockCommand(logEntries: LogEntry[], exitCode: number | null = 0) {
  const killFn = vi.fn<(signal?: string) => Promise<void>>().mockResolvedValue(undefined);

  const command = {
    exitCode,
    kill: killFn,
    logs: vi.fn(() => {
      let index = 0;
      const generator = {
        async next() {
          if (index < logEntries.length) {
            return { value: logEntries[index++], done: false as const };
          }
          return { value: undefined, done: true as const };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
        [Symbol.dispose]() {},
        close() {},
      };
      return generator;
    }),
  };
  return command;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    sandboxId: 'sandbox-1',
    status: 'running',
    createdAt: new Date(),
    lastActivityAt: new Date(),
    disconnectedAt: null,
    stoppedAt: null,
    totalDisconnections: 0,
    codeServerUrl: null,
    assessmentId: null,
    assignmentId: null,
    ...overrides,
  };
}

function createMockSandboxService(
  mockRunCommand: ReturnType<typeof createMockCommand>,
) {
  const runCommandFn = vi.fn().mockResolvedValue(mockRunCommand);
  const mockSandbox = { runCommand: runCommandFn };
  const sandboxService = {
    getSandbox: vi.fn().mockReturnValue(mockSandbox),
    createSandbox: vi.fn(),
    runCommand: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDirectory: vi.fn(),
    destroySandbox: vi.fn(),
    destroyAll: vi.fn(),
  } as unknown as SandboxService;

  return { sandboxService, mockSandbox, runCommandFn };
}

function createMockSessionManager(session: Session | null) {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    updateActivity: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn(),
    createSessionForAssignment: vi.fn(),
    getActiveSessionByUserId: vi.fn(),
    stopSession: vi.fn(),
    cleanupStaleSessions: vi.fn(),
    startCleanupInterval: vi.fn(),
    stopCleanupInterval: vi.fn(),
    stopAllSessions: vi.fn(),
  } as unknown as SessionManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TerminalService', () => {
  let terminalManager: TerminalManager;
  let logger: Logger;
  let terminal: TerminalSession;

  // Default wired-up service — individual tests may override pieces
  let service: TerminalService;
  let mockCommand: ReturnType<typeof createMockCommand>;
  let mockSession: Session;
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let sandboxParts: ReturnType<typeof createMockSandboxService>;

  beforeEach(() => {
    logger = createMockLogger();
    terminalManager = new TerminalManager();
    terminal = terminalManager.createTerminal('session-1');
    mockSession = createMockSession();

    // By default create a command that emits sentinels for cwd=/vercel/sandbox/assessment, exit=0
    mockCommand = createMockCommand([
      { data: 'hello world\n', stream: 'stdout' },
      { data: cwdSentinel('/vercel/sandbox/assessment'), stream: 'stdout' },
      { data: exitSentinel(0), stream: 'stdout' },
    ]);

    sandboxParts = createMockSandboxService(mockCommand);
    sessionManager = createMockSessionManager(mockSession);

    service = new TerminalService(
      sandboxParts.sandboxService,
      sessionManager,
      terminalManager,
      logger,
    );
  });

  // ---------------------------------------------------------------------------
  // executeCommand
  // ---------------------------------------------------------------------------
  describe('executeCommand', () => {
    it('runs the command with bash -c wrapping and correct cwd', async () => {
      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'echo hello', onOutput);

      // Sandbox.runCommand should have been called with the wrapped command
      expect(sandboxParts.runCommandFn).toHaveBeenCalledOnce();
      const callArgs = sandboxParts.runCommandFn.mock.calls[0][0];
      expect(callArgs.cmd).toBe('bash');
      expect(callArgs.args[0]).toBe('-c');
      // The wrapped command should contain the original user input
      expect(callArgs.args[1]).toContain('echo hello');
      // It should contain the eval-based wrapper and sentinel printf statements
      expect(callArgs.args[1]).toContain('eval');
      expect(callArgs.args[1]).toContain('__tc_ec');
      // CWD should match the terminal's default
      expect(callArgs.cwd).toBe('/vercel/sandbox/assessment');
      expect(callArgs.detached).toBe(true);
    });

    it('streams stdout output to the callback, stripping sentinels', async () => {
      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'echo hello', onOutput);

      // The "hello world\n" part should reach the callback; sentinels should not
      const stdoutCalls = onOutput.mock.calls.filter(
        ([, stream]) => stream === 'stdout',
      );
      const combinedStdout = stdoutCalls.map(([data]) => data).join('');
      expect(combinedStdout).toContain('hello world');
      // Sentinels should be stripped
      expect(combinedStdout).not.toContain(SENTINEL_PREFIX);

      expect(result.exitCode).toBe(0);
      expect(result.cwd).toBe('/vercel/sandbox/assessment');
    });

    it('streams stderr output directly without sentinel processing', async () => {
      mockCommand = createMockCommand([
        { data: 'some error\n', stream: 'stderr' },
        { data: cwdSentinel('/vercel/sandbox/assessment'), stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'bad-cmd', onOutput);

      expect(onOutput).toHaveBeenCalledWith('some error\n', 'stderr');
    });

    it('updates the terminal cwd when a cd command changes the directory', async () => {
      mockCommand = createMockCommand([
        { data: cwdSentinel('/tmp'), stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'cd /tmp', onOutput);

      expect(result.cwd).toBe('/tmp');
      expect(terminal.cwd).toBe('/tmp');
    });

    it('handles command failure with non-zero exit code', async () => {
      mockCommand = createMockCommand([
        { data: 'error output\n', stream: 'stdout' },
        { data: cwdSentinel('/vercel/sandbox/assessment'), stream: 'stdout' },
        { data: exitSentinel(127), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'nonexistent', onOutput);

      expect(result.exitCode).toBe(127);
    });

    it('rejects when the terminal is not found', async () => {
      const onOutput = vi.fn();
      await expect(
        service.executeCommand('nonexistent-terminal', 'ls', onOutput),
      ).rejects.toThrow('Terminal not found: nonexistent-terminal');
    });

    it('rejects when a command is already running', async () => {
      terminal.isRunning = true;

      const onOutput = vi.fn();
      await expect(
        service.executeCommand(terminal.id, 'ls', onOutput),
      ).rejects.toThrow('A command is already running in this terminal');
    });

    it('rejects when the session is not found', async () => {
      sessionManager = createMockSessionManager(null);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      await expect(
        service.executeCommand(terminal.id, 'ls', onOutput),
      ).rejects.toThrow('Session is not running');
    });

    it('rejects when the session status is not running', async () => {
      const stoppedSession = createMockSession({ status: 'stopped' });
      sessionManager = createMockSessionManager(stoppedSession);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      await expect(
        service.executeCommand(terminal.id, 'ls', onOutput),
      ).rejects.toThrow('Session is not running');
    });

    it('rejects when session status is "starting"', async () => {
      const startingSession = createMockSession({ status: 'starting' });
      sessionManager = createMockSessionManager(startingSession);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      await expect(
        service.executeCommand(terminal.id, 'ls', onOutput),
      ).rejects.toThrow('Session is not running');
    });

    it('pushes the command to terminal history', async () => {
      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'echo hello', onOutput);

      expect(terminal.history).toContain('echo hello');
    });

    it('calls sessionManager.updateActivity with the session ID', async () => {
      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'echo hello', onOutput);

      expect(sessionManager.updateActivity).toHaveBeenCalledWith('session-1');
    });

    it('resets isRunning and activeCommand after successful execution', async () => {
      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'echo hello', onOutput);

      expect(terminal.isRunning).toBe(false);
      expect(terminal.activeCommand).toBeNull();
    });

    it('resets isRunning and activeCommand when sandbox.runCommand throws', async () => {
      sandboxParts.runCommandFn.mockRejectedValueOnce(new Error('sandbox error'));

      const onOutput = vi.fn();
      await expect(
        service.executeCommand(terminal.id, 'echo hello', onOutput),
      ).rejects.toThrow('sandbox error');

      expect(terminal.isRunning).toBe(false);
      expect(terminal.activeCommand).toBeNull();
    });

    it('resets isRunning when log streaming throws an error', async () => {
      // Create a command whose logs() generator throws mid-iteration
      const command = {
        exitCode: 1,
        kill: vi.fn(),
        logs: vi.fn(() => {
          let yielded = false;
          return {
            async next() {
              if (!yielded) {
                yielded = true;
                return {
                  value: { data: 'partial\n', stream: 'stdout' as const },
                  done: false as const,
                };
              }
              throw new Error('stream failure');
            },
            [Symbol.asyncIterator]() {
              return this;
            },
            [Symbol.dispose]() {},
            close() {},
          };
        }),
      };

      sandboxParts = createMockSandboxService(command as ReturnType<typeof createMockCommand>);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'echo hello', onOutput);

      // Should recover gracefully — exit code from command object
      expect(result.exitCode).toBe(1);
      expect(terminal.isRunning).toBe(false);
      expect(terminal.activeCommand).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Sentinel parsing (tested through executeCommand)
  // ---------------------------------------------------------------------------
  describe('sentinel parsing', () => {
    it('correctly extracts CWD from the sentinel', async () => {
      mockCommand = createMockCommand([
        { data: cwdSentinel('/home/user/project'), stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'cd /home/user/project', onOutput);

      expect(result.cwd).toBe('/home/user/project');
      expect(terminal.cwd).toBe('/home/user/project');
    });

    it('correctly extracts exit code from the sentinel', async () => {
      mockCommand = createMockCommand([
        { data: cwdSentinel('/vercel/sandbox/assessment'), stream: 'stdout' },
        { data: exitSentinel(42), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'exit 42', onOutput);

      expect(result.exitCode).toBe(42);
    });

    it('strips sentinels from output delivered to the callback', async () => {
      mockCommand = createMockCommand([
        { data: 'before' + cwdSentinel('/tmp') + 'after', stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      await service.executeCommand(terminal.id, 'ls', onOutput);

      const stdoutCalls = onOutput.mock.calls.filter(
        ([, stream]) => stream === 'stdout',
      );
      const combined = stdoutCalls.map(([data]) => data).join('');
      expect(combined).toContain('before');
      expect(combined).toContain('after');
      expect(combined).not.toContain(SENTINEL_PREFIX);
      expect(combined).not.toContain('CWD:');
      expect(combined).not.toContain('EXIT:');
    });

    it('handles sentinels embedded in the same chunk as regular output', async () => {
      const chunk =
        'line1\nline2\n' +
        cwdSentinel('/vercel/sandbox/assessment') +
        exitSentinel(0);

      mockCommand = createMockCommand([
        { data: chunk, stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'echo line1; echo line2', onOutput);

      expect(result.exitCode).toBe(0);
      expect(result.cwd).toBe('/vercel/sandbox/assessment');

      const stdoutCalls = onOutput.mock.calls.filter(
        ([, stream]) => stream === 'stdout',
      );
      const combined = stdoutCalls.map(([data]) => data).join('');
      expect(combined).toContain('line1');
      expect(combined).toContain('line2');
      expect(combined).not.toContain(SENTINEL_PREFIX);
    });

    it('handles sentinels split across multiple chunks', async () => {
      // Split the CWD sentinel right in the middle of the prefix
      const cwdFull = cwdSentinel('/vercel/sandbox/assessment');
      const splitPoint = Math.floor(cwdFull.length / 2);
      const cwdPart1 = cwdFull.substring(0, splitPoint);
      const cwdPart2 = cwdFull.substring(splitPoint);

      mockCommand = createMockCommand([
        { data: cwdPart1, stream: 'stdout' },
        { data: cwdPart2, stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'pwd', onOutput);

      expect(result.exitCode).toBe(0);
      expect(result.cwd).toBe('/vercel/sandbox/assessment');
    });

    it('falls back to command.exitCode when sentinels are missing', async () => {
      const command = createMockCommand(
        [{ data: 'output without sentinels\n', stream: 'stdout' }],
        5,
      );
      sandboxParts = createMockSandboxService(command);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'some-cmd', onOutput);

      // Should use command.exitCode as fallback
      expect(result.exitCode).toBe(5);
    });

    it('defaults exit code to 0 when both sentinel and command.exitCode are null', async () => {
      const command = createMockCommand(
        [{ data: 'just output\n', stream: 'stdout' }],
        null,
      );
      sandboxParts = createMockSandboxService(command);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'some-cmd', onOutput);

      expect(result.exitCode).toBe(0);
    });

    it('flushes buffered stdout when it exceeds the reserve size', async () => {
      // Generate a large chunk of output (> 100 chars) before sentinels arrive
      const largeOutput = 'x'.repeat(200);
      mockCommand = createMockCommand([
        { data: largeOutput, stream: 'stdout' },
        { data: cwdSentinel('/vercel/sandbox/assessment'), stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'cat bigfile', onOutput);

      const stdoutCalls = onOutput.mock.calls.filter(
        ([, stream]) => stream === 'stdout',
      );
      const combined = stdoutCalls.map(([data]) => data).join('');
      // All 200 'x' characters should have made it through
      expect(combined).toContain(largeOutput);
      expect(result.exitCode).toBe(0);
    });

    it('preserves cwd when sentinel reports same directory', async () => {
      // First set cwd to /tmp
      terminal.cwd = '/tmp';

      mockCommand = createMockCommand([
        { data: cwdSentinel('/tmp'), stream: 'stdout' },
        { data: exitSentinel(0), stream: 'stdout' },
      ]);
      sandboxParts = createMockSandboxService(mockCommand);
      service = new TerminalService(
        sandboxParts.sandboxService,
        sessionManager,
        terminalManager,
        logger,
      );

      const onOutput = vi.fn();
      const result = await service.executeCommand(terminal.id, 'ls', onOutput);

      expect(result.cwd).toBe('/tmp');
      expect(terminal.cwd).toBe('/tmp');
    });
  });

  // ---------------------------------------------------------------------------
  // killCommand
  // ---------------------------------------------------------------------------
  describe('killCommand', () => {
    it('calls command.kill with SIGTERM', async () => {
      const killFn = vi.fn<(signal?: string) => Promise<void>>().mockResolvedValue(undefined);
      const activeCommand = { kill: killFn, exitCode: null, logs: vi.fn() };
      terminal.activeCommand = activeCommand as unknown as TerminalSession['activeCommand'];
      terminal.isRunning = true;

      await service.killCommand(terminal.id);

      expect(killFn).toHaveBeenCalledWith('SIGTERM');
    });

    it('is a no-op when no command is running', async () => {
      // terminal.activeCommand is null and isRunning is false by default
      await expect(service.killCommand(terminal.id)).resolves.toBeUndefined();
    });

    it('is a no-op when activeCommand is null even if isRunning is true', async () => {
      terminal.isRunning = true;
      terminal.activeCommand = null;

      await expect(service.killCommand(terminal.id)).resolves.toBeUndefined();
    });

    it('falls back to SIGKILL when SIGTERM fails', async () => {
      const killFn = vi.fn<(signal?: string) => Promise<void>>();
      killFn
        .mockRejectedValueOnce(new Error('SIGTERM failed'))
        .mockResolvedValueOnce(undefined);

      const activeCommand = { kill: killFn, exitCode: null, logs: vi.fn() };
      terminal.activeCommand = activeCommand as unknown as TerminalSession['activeCommand'];
      terminal.isRunning = true;

      await service.killCommand(terminal.id);

      expect(killFn).toHaveBeenCalledTimes(2);
      expect(killFn).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(killFn).toHaveBeenNthCalledWith(2, 'SIGKILL');
      expect(logger.error).toHaveBeenCalled();
    });

    it('does not throw when both SIGTERM and SIGKILL fail', async () => {
      const killFn = vi.fn<(signal?: string) => Promise<void>>();
      killFn
        .mockRejectedValueOnce(new Error('SIGTERM failed'))
        .mockRejectedValueOnce(new Error('SIGKILL also failed'));

      const activeCommand = { kill: killFn, exitCode: null, logs: vi.fn() };
      terminal.activeCommand = activeCommand as unknown as TerminalSession['activeCommand'];
      terminal.isRunning = true;

      // Should not throw — best effort
      await expect(service.killCommand(terminal.id)).resolves.toBeUndefined();
      expect(killFn).toHaveBeenCalledTimes(2);
    });

    it('throws when the terminal is not found', async () => {
      await expect(
        service.killCommand('nonexistent-terminal'),
      ).rejects.toThrow('Terminal not found: nonexistent-terminal');
    });
  });

  // ---------------------------------------------------------------------------
  // destroyTerminal
  // ---------------------------------------------------------------------------
  describe('destroyTerminal', () => {
    it('kills any active command and removes the terminal', async () => {
      const killFn = vi.fn<(signal?: string) => Promise<void>>().mockResolvedValue(undefined);
      const activeCommand = { kill: killFn, exitCode: null, logs: vi.fn() };
      terminal.activeCommand = activeCommand as unknown as TerminalSession['activeCommand'];
      terminal.isRunning = true;

      await service.destroyTerminal(terminal.id);

      expect(killFn).toHaveBeenCalledWith('SIGTERM');
      expect(terminalManager.getTerminal(terminal.id)).toBeNull();
    });

    it('removes the terminal even when there is no active command', async () => {
      await service.destroyTerminal(terminal.id);

      expect(terminalManager.getTerminal(terminal.id)).toBeNull();
    });

    it('does not throw when the terminal does not exist', async () => {
      // killCommand will throw for unknown terminal, but destroyTerminal catches it
      await expect(
        service.destroyTerminal('nonexistent'),
      ).resolves.toBeUndefined();
    });

    it('still removes the terminal even if killCommand throws', async () => {
      // Create a second terminal we can track
      const t2 = terminalManager.createTerminal('session-1');
      const killFn = vi.fn<(signal?: string) => Promise<void>>().mockRejectedValue(
        new Error('kill failed'),
      );
      const activeCommand = { kill: killFn, exitCode: null, logs: vi.fn() };
      t2.activeCommand = activeCommand as unknown as TerminalSession['activeCommand'];
      t2.isRunning = true;

      // destroyTerminal catches killCommand errors and still deletes
      await service.destroyTerminal(t2.id);

      expect(terminalManager.getTerminal(t2.id)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // destroyAllForSession
  // ---------------------------------------------------------------------------
  describe('destroyAllForSession', () => {
    it('destroys all terminals for the given session', async () => {
      const t2 = terminalManager.createTerminal('session-1');

      await service.destroyAllForSession('session-1');

      expect(terminalManager.getTerminal(terminal.id)).toBeNull();
      expect(terminalManager.getTerminal(t2.id)).toBeNull();
    });

    it('does not affect terminals from other sessions', async () => {
      const otherTerminal = terminalManager.createTerminal('session-2');

      await service.destroyAllForSession('session-1');

      expect(terminalManager.getTerminal(terminal.id)).toBeNull();
      expect(terminalManager.getTerminal(otherTerminal.id)).toBe(otherTerminal);
    });

    it('is a no-op for a session with no terminals', async () => {
      await expect(
        service.destroyAllForSession('nonexistent-session'),
      ).resolves.toBeUndefined();

      // Original terminal should still exist
      expect(terminalManager.getTerminal(terminal.id)).toBe(terminal);
    });
  });
});
