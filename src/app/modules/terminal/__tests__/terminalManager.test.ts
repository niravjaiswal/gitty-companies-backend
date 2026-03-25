import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalManager } from '../terminalManager.js';

describe('TerminalManager', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  // ---------------------------------------------------------------------------
  // createTerminal
  // ---------------------------------------------------------------------------
  describe('createTerminal', () => {
    it('creates a terminal with correct default values', () => {
      const terminal = manager.createTerminal('session-1');

      expect(terminal.id).toBeDefined();
      expect(typeof terminal.id).toBe('string');
      expect(terminal.sessionId).toBe('session-1');
      expect(terminal.cwd).toBe('/vercel/sandbox/assessment');
      expect(terminal.isRunning).toBe(false);
      expect(terminal.activeCommand).toBeNull();
      expect(terminal.history).toEqual([]);
    });

    it('generates unique IDs for each terminal', () => {
      const t1 = manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-1');
      const t3 = manager.createTerminal('session-2');

      expect(t1.id).not.toBe(t2.id);
      expect(t1.id).not.toBe(t3.id);
      expect(t2.id).not.toBe(t3.id);
    });

    it('stores the terminal so it can be retrieved later', () => {
      const terminal = manager.createTerminal('session-1');
      const retrieved = manager.getTerminal(terminal.id);

      expect(retrieved).toBe(terminal);
    });

    it('allows multiple terminals for the same session', () => {
      const t1 = manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-1');

      expect(manager.getTerminal(t1.id)).toBe(t1);
      expect(manager.getTerminal(t2.id)).toBe(t2);
    });
  });

  // ---------------------------------------------------------------------------
  // getTerminal
  // ---------------------------------------------------------------------------
  describe('getTerminal', () => {
    it('returns the terminal when it exists', () => {
      const terminal = manager.createTerminal('session-1');
      const result = manager.getTerminal(terminal.id);

      expect(result).toBe(terminal);
    });

    it('returns null for an unknown terminal ID', () => {
      expect(manager.getTerminal('nonexistent-id')).toBeNull();
    });

    it('returns null after a terminal has been destroyed', () => {
      const terminal = manager.createTerminal('session-1');
      manager.destroyTerminal(terminal.id);

      expect(manager.getTerminal(terminal.id)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getTerminalsBySession
  // ---------------------------------------------------------------------------
  describe('getTerminalsBySession', () => {
    it('returns all terminals for a given session', () => {
      const t1 = manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-1');
      manager.createTerminal('session-2'); // different session

      const result = manager.getTerminalsBySession('session-1');

      expect(result).toHaveLength(2);
      expect(result).toContain(t1);
      expect(result).toContain(t2);
    });

    it('returns an empty array for an unknown session', () => {
      manager.createTerminal('session-1');
      const result = manager.getTerminalsBySession('unknown-session');

      expect(result).toEqual([]);
    });

    it('returns an empty array when no terminals exist', () => {
      const result = manager.getTerminalsBySession('session-1');

      expect(result).toEqual([]);
    });

    it('does not include terminals from other sessions', () => {
      manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-2');

      const result = manager.getTerminalsBySession('session-2');

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(t2);
    });
  });

  // ---------------------------------------------------------------------------
  // destroyTerminal
  // ---------------------------------------------------------------------------
  describe('destroyTerminal', () => {
    it('removes the terminal so it can no longer be retrieved', () => {
      const terminal = manager.createTerminal('session-1');
      manager.destroyTerminal(terminal.id);

      expect(manager.getTerminal(terminal.id)).toBeNull();
    });

    it('is idempotent for an unknown terminal ID', () => {
      // Should not throw
      expect(() => manager.destroyTerminal('nonexistent')).not.toThrow();
    });

    it('does not affect other terminals', () => {
      const t1 = manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-1');

      manager.destroyTerminal(t1.id);

      expect(manager.getTerminal(t1.id)).toBeNull();
      expect(manager.getTerminal(t2.id)).toBe(t2);
    });
  });

  // ---------------------------------------------------------------------------
  // destroyAllForSession
  // ---------------------------------------------------------------------------
  describe('destroyAllForSession', () => {
    it('removes all terminals for the specified session', () => {
      const t1 = manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-1');

      manager.destroyAllForSession('session-1');

      expect(manager.getTerminal(t1.id)).toBeNull();
      expect(manager.getTerminal(t2.id)).toBeNull();
    });

    it('does not affect terminals belonging to other sessions', () => {
      manager.createTerminal('session-1');
      const t2 = manager.createTerminal('session-2');

      manager.destroyAllForSession('session-1');

      expect(manager.getTerminal(t2.id)).toBe(t2);
    });

    it('is a no-op when no terminals exist for the session', () => {
      const t1 = manager.createTerminal('session-1');

      // Destroy for a session that has no terminals
      expect(() => manager.destroyAllForSession('unknown-session')).not.toThrow();

      // Original terminal is untouched
      expect(manager.getTerminal(t1.id)).toBe(t1);
    });

    it('leaves getTerminalsBySession returning empty after destroy', () => {
      manager.createTerminal('session-1');
      manager.createTerminal('session-1');

      manager.destroyAllForSession('session-1');

      expect(manager.getTerminalsBySession('session-1')).toEqual([]);
    });
  });
});
