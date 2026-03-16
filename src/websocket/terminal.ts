import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { SessionManager } from '../services/sessionManager.js';
import type { TerminalManager } from '../services/terminalManager.js';
import type { TerminalService } from '../services/terminal.js';
import { authenticateWs } from '../middleware/wsAuth.js';

// ── Client → Server messages ───────────────────────────────────────────

interface TerminalCreateMsg {
  type: 'terminal:create';
}

interface TerminalInputMsg {
  type: 'terminal:input';
  terminalId: string;
  data: string;
}

interface TerminalKillMsg {
  type: 'terminal:kill';
  terminalId: string;
}

interface TerminalResizeMsg {
  type: 'terminal:resize';
  terminalId: string;
  cols: number;
  rows: number;
}

type ClientMessage =
  | TerminalCreateMsg
  | TerminalInputMsg
  | TerminalKillMsg
  | TerminalResizeMsg;

// ── Server → Client messages ───────────────────────────────────────────

interface TerminalCreatedMsg {
  type: 'terminal:created';
  terminalId: string;
  cwd: string;
}

interface TerminalOutputMsg {
  type: 'terminal:output';
  terminalId: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

interface TerminalExitMsg {
  type: 'terminal:exit';
  terminalId: string;
  exitCode: number;
  cwd: string;
}

interface TerminalErrorMsg {
  type: 'terminal:error';
  terminalId: string;
  message: string;
}

interface TerminalPromptMsg {
  type: 'terminal:prompt';
  terminalId: string;
  cwd: string;
}

type ServerMessage =
  | TerminalCreatedMsg
  | TerminalOutputMsg
  | TerminalExitMsg
  | TerminalErrorMsg
  | TerminalPromptMsg;

// ── Plugin options ─────────────────────────────────────────────────────

interface TerminalWsOptions extends FastifyPluginOptions {
  sessionManager: SessionManager;
  terminalManager: TerminalManager;
  terminalService: TerminalService;
}

/** In-memory tracking of WebSocket connections per session */
const sessionConnections = new Map<string, Set<WebSocket>>();

/**
 * Sends a JSON message over the WebSocket if it's still open.
 */
function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

/**
 * Fastify plugin that registers the terminal WebSocket endpoint.
 *
 * WebSocket endpoint: GET /api/sessions/:sessionId/terminal?token=<jwt>
 *
 * Authenticates via query param token, validates session ownership,
 * handles reconnection within grace period.
 */
export async function terminalWsRoutes(
  fastify: FastifyInstance,
  opts: TerminalWsOptions,
): Promise<void> {
  const { sessionManager, terminalManager, terminalService } = opts;

  fastify.get<{
    Params: { sessionId: string };
    Querystring: { token?: string };
  }>(
    '/api/sessions/:sessionId/terminal',
    { websocket: true },
    async (socket, request) => {
      const { sessionId } = request.params;
      const token = request.query.token;
      const log = fastify.log;

      // Authenticate WebSocket connection
      const authResult = await authenticateWs(token, sessionId);

      if ('error' in authResult) {
        send(socket, {
          type: 'terminal:error',
          terminalId: '',
          message: authResult.error,
        });
        socket.close(authResult.code, authResult.error);
        return;
      }

      const { session: dbSession } = authResult.result;

      // Handle reconnection if session is disconnected
      if (dbSession.status === 'disconnected') {
        const reconnected = await sessionManager.reconnectSession(sessionId);
        if (!reconnected) {
          send(socket, {
            type: 'terminal:error',
            terminalId: '',
            message: 'Session grace period expired',
          });
          socket.close(4001, 'Session grace period expired');
          return;
        }
        log.info(`WebSocket reconnected session ${sessionId}`);
      } else if (dbSession.status !== 'running') {
        send(socket, {
          type: 'terminal:error',
          terminalId: '',
          message: `Session is not running (status: ${dbSession.status})`,
        });
        socket.close(1008, 'Session not running');
        return;
      }

      // Track this WebSocket connection
      if (!sessionConnections.has(sessionId)) {
        sessionConnections.set(sessionId, new Set());
      }
      sessionConnections.get(sessionId)!.add(socket);

      // Track terminal IDs created on this WebSocket so we can clean up on close
      const connectionTerminals = new Set<string>();

      socket.on('message', async (raw: RawData) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          log.warn('Invalid JSON from terminal WebSocket');
          return;
        }

        // Update activity on every message
        await sessionManager.updateActivity(sessionId);

        try {
          switch (msg.type) {
            case 'terminal:create': {
              const terminal = terminalManager.createTerminal(sessionId);
              connectionTerminals.add(terminal.id);
              log.info(`Terminal created: ${terminal.id} for session ${sessionId}`);

              send(socket, {
                type: 'terminal:created',
                terminalId: terminal.id,
                cwd: terminal.cwd,
              });
              send(socket, {
                type: 'terminal:prompt',
                terminalId: terminal.id,
                cwd: terminal.cwd,
              });
              break;
            }

            case 'terminal:input': {
              const { terminalId, data } = msg;
              const terminal = terminalManager.getTerminal(terminalId);

              if (!terminal) {
                send(socket, {
                  type: 'terminal:error',
                  terminalId,
                  message: 'Terminal not found',
                });
                break;
              }

              if (terminal.sessionId !== sessionId) {
                send(socket, {
                  type: 'terminal:error',
                  terminalId,
                  message: 'Terminal not found',
                });
                break;
              }

              if (terminal.isRunning) {
                send(socket, {
                  type: 'terminal:error',
                  terminalId,
                  message: 'A command is already running',
                });
                break;
              }

              if (!data.trim()) {
                send(socket, {
                  type: 'terminal:prompt',
                  terminalId,
                  cwd: terminal.cwd,
                });
                break;
              }

              terminalService
                .executeCommand(terminalId, data, (chunk, stream) => {
                  send(socket, {
                    type: 'terminal:output',
                    terminalId,
                    data: chunk,
                    stream,
                  });
                })
                .then((result) => {
                  send(socket, {
                    type: 'terminal:exit',
                    terminalId,
                    exitCode: result.exitCode,
                    cwd: result.cwd,
                  });
                  send(socket, {
                    type: 'terminal:prompt',
                    terminalId,
                    cwd: result.cwd,
                  });
                })
                .catch((error) => {
                  log.error(`Command execution error: ${error}`);
                  send(socket, {
                    type: 'terminal:error',
                    terminalId,
                    message: error instanceof Error ? error.message : String(error),
                  });
                  const t = terminalManager.getTerminal(terminalId);
                  if (t) {
                    send(socket, {
                      type: 'terminal:prompt',
                      terminalId,
                      cwd: t.cwd,
                    });
                  }
                });
              break;
            }

            case 'terminal:kill': {
              const { terminalId } = msg;
              if (!connectionTerminals.has(terminalId)) {
                send(socket, {
                  type: 'terminal:error',
                  terminalId,
                  message: 'Terminal not found',
                });
                break;
              }
              try {
                await terminalService.killCommand(terminalId);
              } catch (error) {
                log.error(`Kill error: ${error}`);
                send(socket, {
                  type: 'terminal:error',
                  terminalId,
                  message: 'Failed to kill command',
                });
              }
              break;
            }

            case 'terminal:resize': {
              // Resize is a no-op for our command-per-line model
              break;
            }

            default:
              log.warn(`Unknown terminal message type: ${(msg as { type: string }).type}`);
          }
        } catch (error) {
          log.error(`Error handling terminal message: ${error}`);
        }
      });

      socket.on('close', async () => {
        log.info(`Terminal WebSocket closed for session ${sessionId}`);

        // Remove this socket from session tracking
        const connections = sessionConnections.get(sessionId);
        if (connections) {
          connections.delete(socket);

          // If this was the last WebSocket for this session, start disconnect grace period
          if (connections.size === 0) {
            sessionConnections.delete(sessionId);
            log.info(`Last WebSocket closed for session ${sessionId}, starting disconnect grace period`);
            await sessionManager.disconnectSession(sessionId);
          }
        }

        // Clean up terminals created on this specific connection
        await Promise.allSettled(
          Array.from(connectionTerminals).map((terminalId) =>
            terminalService.destroyTerminal(terminalId).catch((err) => {
              log.error(`Error destroying terminal ${terminalId} on close: ${err}`);
            }),
          ),
        );
      });

      socket.on('error', (error: Error) => {
        log.error(`Terminal WebSocket error for session ${sessionId}: ${error}`);
      });
    },
  );
}
