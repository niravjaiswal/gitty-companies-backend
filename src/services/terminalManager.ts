import { randomUUID } from 'node:crypto';
import type { Command } from '@vercel/sandbox';

export interface TerminalSession {
  id: string;
  /** Links to the sandbox session */
  sessionId: string;
  /** Current working directory inside the sandbox */
  cwd: string;
  /** Whether a command is currently executing */
  isRunning: boolean;
  /** The currently running Vercel SDK Command object */
  activeCommand: Command | null;
  /** Command history for up-arrow support */
  history: string[];
}

/**
 * Manages multiple terminal sessions, tracking all active terminals.
 * In-memory Map storage, same pattern as the session manager.
 */
export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();

  /**
   * Creates a new terminal session linked to a sandbox session.
   * @param sessionId - The sandbox session to link to
   * @returns The created terminal session
   */
  createTerminal(sessionId: string): TerminalSession {
    const terminal: TerminalSession = {
      id: randomUUID(),
      sessionId,
      cwd: '/vercel/sandbox',
      isRunning: false,
      activeCommand: null,
      history: [],
    };

    this.terminals.set(terminal.id, terminal);
    return terminal;
  }

  /**
   * Returns the terminal session if it exists, or null.
   */
  getTerminal(terminalId: string): TerminalSession | null {
    return this.terminals.get(terminalId) ?? null;
  }

  /**
   * Returns all terminal sessions for a given sandbox session.
   */
  getTerminalsBySession(sessionId: string): TerminalSession[] {
    const result: TerminalSession[] = [];
    for (const terminal of this.terminals.values()) {
      if (terminal.sessionId === sessionId) {
        result.push(terminal);
      }
    }
    return result;
  }

  /**
   * Removes a terminal session from tracking.
   */
  destroyTerminal(terminalId: string): void {
    this.terminals.delete(terminalId);
  }

  /**
   * Removes all terminal sessions for a given sandbox session.
   */
  /**
   * Returns all terminal sessions.
   */
  getAllTerminals(): TerminalSession[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Removes all terminal sessions for a given sandbox session.
   */
  destroyAllForSession(sessionId: string): void {
    const toDelete: string[] = [];
    for (const terminal of this.terminals.values()) {
      if (terminal.sessionId === sessionId) {
        toDelete.push(terminal.id);
      }
    }
    for (const id of toDelete) {
      this.terminals.delete(id);
    }
  }
}
