import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { terminalWsRoutes } from '../terminal.js';
import type { SessionManager } from '../../services/sessionManager.js';
import type { TerminalManager } from '../../services/terminalManager.js';
import type { TerminalService } from '../../services/terminal.js';
import type { TerminalSession } from '../../services/terminalManager.js';

// ── Mock wsAuth module ────────────────────────────────────────────────
// Must be before any imports that use it

vi.mock('../../middleware/wsAuth.js', () => ({
  authenticateWs: vi.fn(),
}));

import { authenticateWs } from '../../middleware/wsAuth.js';
const mockAuthenticateWs = vi.mocked(authenticateWs);

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Waits for the next WebSocket message and parses it as JSON.
 */
function nextMessage<T = Record<string, unknown>>(
  ws: WebSocket,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket message')),
      timeoutMs,
    );
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()) as T);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Collects WebSocket messages for `durationMs` and returns them all.
 */
function collectMessages<T = Record<string, unknown>>(
  ws: WebSocket,
  durationMs = 500,
): Promise<T[]> {
  return new Promise<T[]>((resolve) => {
    const messages: T[] = [];
    const handler = (data: WebSocket.RawData) => {
      try {
        messages.push(JSON.parse(data.toString()) as T);
      } catch {
        // skip non-JSON
      }
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, durationMs);
  });
}

/**
 * Opens a WebSocket and immediately starts collecting messages.
 */
function openAndCollect<T = Record<string, unknown>>(
  url: string,
  durationMs = 1000,
): Promise<{ ws: WebSocket; messages: T[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: T[] = [];

    const handler = (data: WebSocket.RawData) => {
      try {
        messages.push(JSON.parse(data.toString()) as T);
      } catch {
        // skip non-JSON
      }
    };

    ws.on('message', handler);

    ws.once('error', (err) => {
      ws.off('message', handler);
      reject(err);
    });

    ws.once('open', () => {
      setTimeout(() => {
        ws.off('message', handler);
        resolve({ ws, messages });
      }, durationMs);
    });
  });
}

/**
 * Opens a WebSocket to the given URL and resolves once the connection is open.
 */
function openWs(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/**
 * Waits for the WebSocket to reach the CLOSED state.
 */
function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket close')),
      timeoutMs,
    );
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ── Mocks ─────────────────────────────────────────────────────────────

function createMockSessionManager(): SessionManager {
  return {
    getSession: vi.fn(),
    createSession: vi.fn(),
    getActiveSessionByUserId: vi.fn(),
    getSessionHistory: vi.fn(),
    updateActivity: vi.fn().mockResolvedValue(undefined),
    disconnectSession: vi.fn().mockResolvedValue(undefined),
    reconnectSession: vi.fn(),
    abandonSession: vi.fn(),
    stopSession: vi.fn(),
    cleanupStaleSessions: vi.fn(),
    startCleanupInterval: vi.fn(),
    stopCleanupInterval: vi.fn(),
    stopAllSessions: vi.fn(),
    cleanupOrphanedSessions: vi.fn(),
  } as unknown as SessionManager;
}

function createMockTerminalManager(): TerminalManager {
  return {
    createTerminal: vi.fn(),
    getTerminal: vi.fn(),
    getTerminalsBySession: vi.fn(),
    destroyTerminal: vi.fn(),
    destroyAllForSession: vi.fn(),
  } as unknown as TerminalManager;
}

function createMockTerminalService(): TerminalService {
  return {
    executeCommand: vi.fn(),
    killCommand: vi.fn(),
    destroyTerminal: vi.fn().mockResolvedValue(undefined),
    destroyAllForSession: vi.fn(),
  } as unknown as TerminalService;
}

function makeTerminalSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-1',
    sessionId: 'session-1',
    cwd: '/home/user',
    isRunning: false,
    activeCommand: null,
    history: [],
    ...overrides,
  };
}

/** Sets up authenticateWs to return a successful auth result for a running session */
function mockAuthSuccess(sessionStatus = 'running') {
  mockAuthenticateWs.mockResolvedValue({
    result: {
      user: { id: 'user-1', email: 'test@test.com' },
      session: {
        id: 'session-1',
        user_id: 'user-1',
        sandbox_id: 'sandbox-1',
        status: sessionStatus,
      },
    },
  });
}

/** Sets up authenticateWs to return an auth error */
function mockAuthError(error: string, code: number) {
  mockAuthenticateWs.mockResolvedValue({ error, code });
}

// ── Test suite ────────────────────────────────────────────────────────

describe('terminal WebSocket handler', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let mockTerminalManager: ReturnType<typeof createMockTerminalManager>;
  let mockTerminalService: ReturnType<typeof createMockTerminalService>;

  beforeEach(async () => {
    mockSessionManager = createMockSessionManager();
    mockTerminalManager = createMockTerminalManager();
    mockTerminalService = createMockTerminalService();

    app = Fastify({ logger: false });
    await app.register(websocket);
    await app.register(terminalWsRoutes, {
      sessionManager: mockSessionManager,
      terminalManager: mockTerminalManager,
      terminalService: mockTerminalService,
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address.replace('http', 'ws');

    // Reset mock between tests
    mockAuthenticateWs.mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Connection tests ──────────────────────────────────────────────

  it('connects successfully to a valid running session', async () => {
    mockAuthSuccess();

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await waitForClose(ws);
  });

  it('receives error and closes when auth fails', async () => {
    mockAuthError('Session not found', 4404);

    const { ws, messages } = await openAndCollect(
      `${baseUrl}/api/sessions/nonexistent/terminal?token=valid-token`,
      500,
    );

    expect(messages).toContainEqual({
      type: 'terminal:error',
      terminalId: '',
      message: 'Session not found',
    });

    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('receives error and closes when session is not running', async () => {
    mockAuthSuccess('stopped');

    const { ws, messages } = await openAndCollect(
      `${baseUrl}/api/sessions/session-1/terminal?token=valid-token`,
      500,
    );

    expect(messages).toContainEqual({
      type: 'terminal:error',
      terminalId: '',
      message: 'Session is not running (status: stopped)',
    });

    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  // ── terminal:create ───────────────────────────────────────────────

  it('responds with terminal:created and terminal:prompt on terminal:create', async () => {
    const terminal = makeTerminalSession();
    mockAuthSuccess();
    (mockTerminalManager.createTerminal as ReturnType<typeof vi.fn>).mockReturnValue(terminal);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      type: 'terminal:created',
      terminalId: 'term-1',
      cwd: '/home/user',
    });
    expect(messages[1]).toEqual({
      type: 'terminal:prompt',
      terminalId: 'term-1',
      cwd: '/home/user',
    });

    ws.close();
    await waitForClose(ws);
  });

  // ── terminal:input ────────────────────────────────────────────────

  it('receives terminal:output, terminal:exit, and terminal:prompt for a valid command', async () => {
    const terminal = makeTerminalSession();
    mockAuthSuccess();
    (mockTerminalManager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(terminal);

    (mockTerminalService.executeCommand as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _terminalId: string,
        _input: string,
        onOutput: (data: string, stream: 'stdout' | 'stderr') => void,
      ) => {
        onOutput('hello world\n', 'stdout');
        return { exitCode: 0, cwd: '/home/user' };
      },
    );

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 1000);
    ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'term-1', data: 'echo hello' }));
    const messages = await messagesPromise;

    const types = messages.map((m: Record<string, unknown>) => m.type);
    expect(types).toContain('terminal:output');
    expect(types).toContain('terminal:exit');
    expect(types).toContain('terminal:prompt');

    const output = messages.find((m: Record<string, unknown>) => m.type === 'terminal:output');
    expect(output).toMatchObject({
      type: 'terminal:output',
      terminalId: 'term-1',
      data: 'hello world\n',
      stream: 'stdout',
    });

    const exit = messages.find((m: Record<string, unknown>) => m.type === 'terminal:exit');
    expect(exit).toMatchObject({
      type: 'terminal:exit',
      terminalId: 'term-1',
      exitCode: 0,
      cwd: '/home/user',
    });

    const prompt = messages.find((m: Record<string, unknown>) => m.type === 'terminal:prompt');
    expect(prompt).toMatchObject({
      type: 'terminal:prompt',
      terminalId: 'term-1',
      cwd: '/home/user',
    });

    ws.close();
    await waitForClose(ws);
  });

  it('receives only terminal:prompt for empty input', async () => {
    const terminal = makeTerminalSession();
    mockAuthSuccess();
    (mockTerminalManager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(terminal);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'term-1', data: '   ' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'terminal:prompt',
      terminalId: 'term-1',
      cwd: '/home/user',
    });

    expect(mockTerminalService.executeCommand).not.toHaveBeenCalled();

    ws.close();
    await waitForClose(ws);
  });

  it('receives terminal:error when a command is already running', async () => {
    const terminal = makeTerminalSession({ isRunning: true });
    mockAuthSuccess();
    (mockTerminalManager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(terminal);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'term-1', data: 'ls' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'terminal:error',
      terminalId: 'term-1',
      message: 'A command is already running',
    });

    expect(mockTerminalService.executeCommand).not.toHaveBeenCalled();

    ws.close();
    await waitForClose(ws);
  });

  it('receives terminal:error for unknown terminalId', async () => {
    mockAuthSuccess();
    (mockTerminalManager.getTerminal as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:input', terminalId: 'no-such-term', data: 'ls' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'terminal:error',
      terminalId: 'no-such-term',
      message: 'Terminal not found',
    });

    ws.close();
    await waitForClose(ws);
  });

  // ── terminal:kill ─────────────────────────────────────────────────

  it('calls terminalService.killCommand on terminal:kill', async () => {
    mockAuthSuccess();
    (mockTerminalManager.createTerminal as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'term-1',
      sessionId: 'session-1',
      cwd: '/vercel/sandbox',
      isRunning: false,
      activeCommand: null,
      history: [],
    });
    (mockTerminalService.killCommand as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const createPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    await createPromise;

    ws.send(JSON.stringify({ type: 'terminal:kill', terminalId: 'term-1' }));

    await new Promise((r) => setTimeout(r, 200));

    expect(mockTerminalService.killCommand).toHaveBeenCalledWith('term-1');

    ws.close();
    await waitForClose(ws);
  });

  it('sends terminal:error when killCommand throws', async () => {
    mockAuthSuccess();
    (mockTerminalManager.createTerminal as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'term-1',
      sessionId: 'session-1',
      cwd: '/vercel/sandbox',
      isRunning: false,
      activeCommand: null,
      history: [],
    });
    (mockTerminalService.killCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('kill failed'),
    );

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const createPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    await createPromise;

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:kill', terminalId: 'term-1' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'terminal:error',
      terminalId: 'term-1',
      message: 'Failed to kill command',
    });

    ws.close();
    await waitForClose(ws);
  });

  // ── terminal:resize ───────────────────────────────────────────────

  it('accepts terminal:resize silently (no response)', async () => {
    mockAuthSuccess();

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 300);
    ws.send(
      JSON.stringify({ type: 'terminal:resize', terminalId: 'term-1', cols: 120, rows: 40 }),
    );
    const messages = await messagesPromise;

    expect(messages).toHaveLength(0);

    ws.close();
    await waitForClose(ws);
  });

  // ── Invalid and unknown messages ──────────────────────────────────

  it('does not crash on invalid JSON', async () => {
    mockAuthSuccess();

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 300);
    ws.send('this is not json {{{');
    const messages = await messagesPromise;

    expect(messages).toHaveLength(0);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await waitForClose(ws);
  });

  it('silently ignores unknown message types', async () => {
    mockAuthSuccess();

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 300);
    ws.send(JSON.stringify({ type: 'terminal:nonexistent', data: 'foo' }));
    const messages = await messagesPromise;

    expect(messages).toHaveLength(0);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await waitForClose(ws);
  });

  // ── WebSocket close / cleanup ─────────────────────────────────────

  it('cleans up terminals via terminalService.destroyTerminal on WebSocket close', async () => {
    const terminal = makeTerminalSession();
    mockAuthSuccess();
    (mockTerminalManager.createTerminal as ReturnType<typeof vi.fn>).mockReturnValue(terminal);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const messagesPromise = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    const messages = await messagesPromise;

    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'terminal:created', terminalId: 'term-1' }),
    );

    ws.close();
    await waitForClose(ws);

    await new Promise((r) => setTimeout(r, 200));

    expect(mockTerminalService.destroyTerminal).toHaveBeenCalledWith('term-1');
  });

  it('cleans up multiple terminals created on the same connection', async () => {
    const term1 = makeTerminalSession({ id: 'term-1' });
    const term2 = makeTerminalSession({ id: 'term-2' });

    mockAuthSuccess();
    (mockTerminalManager.createTerminal as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(term1)
      .mockReturnValueOnce(term2);

    const ws = await openWs(`${baseUrl}/api/sessions/session-1/terminal?token=valid-token`);

    const msgs1 = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    await msgs1;

    const msgs2 = collectMessages(ws, 500);
    ws.send(JSON.stringify({ type: 'terminal:create' }));
    await msgs2;

    ws.close();
    await waitForClose(ws);

    await new Promise((r) => setTimeout(r, 200));

    expect(mockTerminalService.destroyTerminal).toHaveBeenCalledTimes(2);
    expect(mockTerminalService.destroyTerminal).toHaveBeenCalledWith('term-1');
    expect(mockTerminalService.destroyTerminal).toHaveBeenCalledWith('term-2');
  });
});
