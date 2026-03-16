import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityCollector } from '../activityCollector.js';
import { SubmissionService } from '../submissionService.js';
import { ActivityCollectorManager } from '../activityCollectorManager.js';
import type { SandboxService, Logger } from '../sandbox.js';

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

function createMockSandboxService() {
  return {
    runCommand: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDirectory: vi.fn(),
    startMonitor: vi.fn(),
    createSandbox: vi.fn(),
    destroySandbox: vi.fn(),
    destroyAll: vi.fn(),
    getSandbox: vi.fn(),
    setupCodeServer: vi.fn(),
    seedStarterCode: vi.fn(),
    getDomainForPort: vi.fn(),
  } as unknown as SandboxService & {
    runCommand: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    startMonitor: ReturnType<typeof vi.fn>;
  };
}

/**
 * Creates a mock Supabase client with chain-style query builder.
 * Each call to `from()` returns a fresh chain, but all chains share
 * the same mockChain reference for easy assertion setup.
 */
function createMockSupabase() {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const supabase = {
    from: vi.fn().mockReturnValue(mockChain),
    _chain: mockChain,
  };

  return supabase;
}

// ---------------------------------------------------------------------------
// ── ActivityCollector ─────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('ActivityCollector', () => {
  let supabase: ReturnType<typeof createMockSupabase>;
  let sandboxService: ReturnType<typeof createMockSandboxService>;
  let logger: Logger;
  let collector: ActivityCollector;

  const SESSION_ID = 'session-abc-123';
  const SANDBOX_ID = 'sandbox-xyz-789';

  beforeEach(() => {
    vi.useFakeTimers();
    supabase = createMockSupabase();
    sandboxService = createMockSandboxService();
    logger = createMockLogger();
    collector = new ActivityCollector(
      supabase as any,
      sandboxService,
      logger,
      SESSION_ID,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: configure the supabase mock to return a session row
  function mockSessionRow(overrides: Record<string, unknown> = {}) {
    supabase._chain.single.mockResolvedValue({
      data: { sandbox_id: SANDBOX_ID, status: 'running', ...overrides },
      error: null,
    });
  }

  // Helper: configure the monitor health check to report "running"
  function mockMonitorRunning() {
    (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: 'running',
      stderr: '',
      exitCode: 0,
    });
  }

  // ── parseFsEvents (tested indirectly via collectActivity) ────────────

  describe('filesystem event parsing (via collectActivity)', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    it('parses standard MODIFY events correctly', async () => {
      const fsLog =
        '2026-03-15T14:23:01 MODIFY /vercel/sandbox/src/index.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      expect(supabase.from).toHaveBeenCalledWith('session_activity');
      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0]).toMatchObject({
        session_id: SESSION_ID,
        event_type: 'file_modify',
        detail: 'src/index.ts',
        occurred_at: '2026-03-15T14:23:01Z',
      });
      expect(insertCall[0].metadata).toMatchObject({
        raw_event: 'MODIFY',
        absolute_path: '/vercel/sandbox/src/index.ts',
      });
    });

    it('parses CLOSE_WRITE as file_modify', async () => {
      const fsLog =
        '2026-03-15T14:23:01Z CLOSE_WRITE /vercel/sandbox/src/app.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].event_type).toBe('file_modify');
    });

    it('parses CREATE events correctly', async () => {
      const fsLog =
        '2026-03-15T14:23:02Z CREATE /vercel/sandbox/package.json\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0]).toMatchObject({
        event_type: 'file_create',
        detail: 'package.json',
        occurred_at: '2026-03-15T14:23:02Z',
      });
    });

    it('parses DELETE events correctly', async () => {
      const fsLog =
        '2026-03-15T14:23:03 DELETE /vercel/sandbox/tmp/old.txt\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0]).toMatchObject({
        event_type: 'file_delete',
        detail: 'tmp/old.txt',
      });
    });

    it('parses MOVED_FROM and MOVED_TO events as file_move', async () => {
      const fsLog = [
        '2026-03-15T14:23:04 MOVED_FROM /vercel/sandbox/old.ts',
        '2026-03-15T14:23:04 MOVED_TO /vercel/sandbox/new.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(2);
      expect(insertCall[0].event_type).toBe('file_move');
      expect(insertCall[0].detail).toBe('old.ts');
      expect(insertCall[1].event_type).toBe('file_move');
      expect(insertCall[1].detail).toBe('new.ts');
    });

    it('handles compound events like "CREATE,ISDIR" by using the first part', async () => {
      const fsLog =
        '2026-03-15T14:23:05 CREATE,ISDIR /vercel/sandbox/new-dir\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].event_type).toBe('file_create');
    });

    it('skips unrecognized inotifywait events (e.g. ATTRIB)', async () => {
      const fsLog = [
        '2026-03-15T14:23:10 ATTRIB /vercel/sandbox/file.ts',
        '2026-03-15T14:23:11 MODIFY /vercel/sandbox/other.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      // Only the MODIFY event should survive (ATTRIB returns null from mapFsEventType)
      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].event_type).toBe('file_modify');
      expect(insertCall[0].detail).toBe('other.ts');
    });

    it('produces no events when all lines are unrecognized types', async () => {
      const fsLog = [
        '2026-03-15T14:23:10 ATTRIB /vercel/sandbox/file.ts',
        '2026-03-15T14:23:11 ACCESS /vercel/sandbox/other.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      await collector.collectActivity();

      // No events should be inserted
      expect(supabase._chain.insert).not.toHaveBeenCalled();
    });

    it('skips malformed lines', async () => {
      const fsLog = [
        'this is not a valid log line',
        '',
        '2026-03-15T14:23:06 MODIFY /vercel/sandbox/valid.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('valid.ts');
    });

    it('makes paths relative to /vercel/sandbox', async () => {
      const fsLog =
        '2026-03-15T14:23:07 MODIFY /vercel/sandbox/deep/nested/file.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].detail).toBe('deep/nested/file.ts');
    });

    it('appends Z to timestamps that lack it', async () => {
      const fsLog =
        '2026-03-15T14:23:08 MODIFY /vercel/sandbox/file.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].occurred_at).toBe('2026-03-15T14:23:08Z');
    });

    it('does not double-append Z to timestamps that already have it', async () => {
      const fsLog =
        '2026-03-15T14:23:09Z MODIFY /vercel/sandbox/file.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].occurred_at).toBe('2026-03-15T14:23:09Z');
    });
  });

  // ── parseCmdEvents (tested indirectly via collectActivity) ───────────

  describe('command history parsing (via collectActivity)', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    it('parses standard command history lines', async () => {
      const cmdLog =
        '2026-03-15T14:23:10Z npm install express\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(cmdLog);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0]).toMatchObject({
        session_id: SESSION_ID,
        event_type: 'command_run',
        detail: 'npm install express',
        occurred_at: '2026-03-15T14:23:10Z',
      });
    });

    it('parses commands with multiple spaces and special characters', async () => {
      const cmdLog =
        '2026-03-15T14:24:00Z git commit -m "fix: handle edge case"\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(cmdLog);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall[0].detail).toBe('git commit -m "fix: handle edge case"');
    });

    it('skips malformed command lines', async () => {
      const cmdLog = [
        '',
        'justonetoken',
        '2026-03-15T14:25:00Z valid command here',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(cmdLog);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      // "justonetoken" matches regex ^(\S+)\s+(.+)$ ? No - it's a single
      // token with no whitespace + content. The regex requires \s+(.+).
      // So only the valid line should produce an event.
      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('valid command here');
    });
  });

  // ── deduplicateFsEvents (tested indirectly) ─────────────────────────

  describe('filesystem event deduplication', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    it('collapses multiple MODIFY events for same file within 1-second window', async () => {
      const fsLog = [
        '2026-03-15T14:23:01.000Z MODIFY /vercel/sandbox/app.ts',
        '2026-03-15T14:23:01.200Z MODIFY /vercel/sandbox/app.ts',
        '2026-03-15T14:23:01.500Z MODIFY /vercel/sandbox/app.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      const fsEvents = insertCall.filter(
        (e: any) => e.event_type !== 'command_run',
      );
      expect(fsEvents).toHaveLength(1);
      expect(fsEvents[0].occurred_at).toBe('2026-03-15T14:23:01.500Z');
    });

    it('keeps events more than 1 second apart', async () => {
      const fsLog = [
        '2026-03-15T14:23:01.000Z MODIFY /vercel/sandbox/app.ts',
        '2026-03-15T14:23:03.000Z MODIFY /vercel/sandbox/app.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      const fsEvents = insertCall.filter(
        (e: any) => e.event_type !== 'command_run',
      );
      expect(fsEvents).toHaveLength(2);
    });

    it('keeps events for different files within same 1-second window', async () => {
      const fsLog = [
        '2026-03-15T14:23:01.000Z MODIFY /vercel/sandbox/a.ts',
        '2026-03-15T14:23:01.100Z MODIFY /vercel/sandbox/b.ts',
        '2026-03-15T14:23:01.200Z MODIFY /vercel/sandbox/c.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      const fsEvents = insertCall.filter(
        (e: any) => e.event_type !== 'command_run',
      );
      expect(fsEvents).toHaveLength(3);
    });

    it('deduplicates by file+type: different types for same file are preserved', async () => {
      const fsLog = [
        '2026-03-15T14:23:01.000Z CREATE /vercel/sandbox/app.ts',
        '2026-03-15T14:23:01.100Z MODIFY /vercel/sandbox/app.ts',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      // CREATE and MODIFY for the same file should both be preserved
      // because deduplication groups by detail::event_type
      expect(insertCall).toHaveLength(2);
      const types = insertCall.map((e: any) => e.event_type).sort();
      expect(types).toEqual(['file_create', 'file_modify']);
    });

    it('passes through a single event unchanged', async () => {
      const fsLog =
        '2026-03-15T14:23:01.000Z MODIFY /vercel/sandbox/only.ts\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('only.ts');
    });

    it('does not insert anything when input is empty', async () => {
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      await collector.collectActivity();

      expect(supabase._chain.insert).not.toHaveBeenCalled();
    });

    it('does not deduplicate command_run events', async () => {
      const fsLog = '';
      const cmdLog = [
        '2026-03-15T14:23:01.000Z npm install',
        '2026-03-15T14:23:01.100Z npm install',
      ].join('\n') + '\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockResolvedValueOnce(cmdLog);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCall = supabase._chain.insert.mock.calls[0][0];
      const cmdEvents = insertCall.filter(
        (e: any) => e.event_type === 'command_run',
      );
      expect(cmdEvents).toHaveLength(2);
    });
  });

  // ── Offset tracking ──────────────────────────────────────────────────

  describe('offset tracking', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    it('processes only new content on subsequent calls', async () => {
      const fullLog1 =
        '2026-03-15T14:23:01 MODIFY /vercel/sandbox/first.ts\n';
      const fullLog2 =
        '2026-03-15T14:23:01 MODIFY /vercel/sandbox/first.ts\n' +
        '2026-03-15T14:23:05 MODIFY /vercel/sandbox/second.ts\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fullLog1)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      let insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('first.ts');

      // Reset mocks for second call
      supabase._chain.insert.mockClear();
      supabase.from.mockClear();
      supabase.from.mockReturnValue(supabase._chain);
      supabase._chain.select.mockReturnThis();
      supabase._chain.eq.mockReturnThis();
      supabase._chain.single.mockResolvedValue({
        data: { sandbox_id: SANDBOX_ID, status: 'running' },
        error: null,
      });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fullLog2)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('second.ts');
    });

    it('tracks command history offset separately from fs offset', async () => {
      const fsLog1 = '2026-03-15T14:23:01 MODIFY /vercel/sandbox/a.ts\n';
      const cmdLog1 = '2026-03-15T14:23:01Z ls -la\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog1)
        .mockResolvedValueOnce(cmdLog1);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      let insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(2);

      supabase._chain.insert.mockClear();
      supabase.from.mockClear();
      supabase.from.mockReturnValue(supabase._chain);
      supabase._chain.select.mockReturnThis();
      supabase._chain.eq.mockReturnThis();
      supabase._chain.single.mockResolvedValue({
        data: { sandbox_id: SANDBOX_ID, status: 'running' },
        error: null,
      });

      const fsLog2 = fsLog1 + '2026-03-15T14:24:00 CREATE /vercel/sandbox/b.ts\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog2)
        .mockResolvedValueOnce(cmdLog1);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].event_type).toBe('file_create');
      expect(insertCall[0].detail).toBe('b.ts');
    });

    it('resets offset when file is truncated (shorter than previous offset)', async () => {
      // First call: long log
      const longLog = '2026-03-15T14:23:01 MODIFY /vercel/sandbox/a.ts\n' +
        '2026-03-15T14:23:02 MODIFY /vercel/sandbox/b.ts\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(longLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      // Reset mocks
      supabase._chain.insert.mockClear();
      supabase.from.mockClear();
      supabase.from.mockReturnValue(supabase._chain);
      supabase._chain.select.mockReturnThis();
      supabase._chain.eq.mockReturnThis();
      supabase._chain.single.mockResolvedValue({
        data: { sandbox_id: SANDBOX_ID, status: 'running' },
        error: null,
      });

      // Second call: file was truncated (shorter than before) -- monitor agent restarted
      const shortLog = '2026-03-15T14:30:00 CREATE /vercel/sandbox/c.ts\n';

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(shortLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      // Since shortLog.length < previous fsOffset, offset should reset to 0
      // and the entire shortLog should be processed
      const insertCall = supabase._chain.insert.mock.calls[0][0];
      expect(insertCall).toHaveLength(1);
      expect(insertCall[0].detail).toBe('c.ts');
    });
  });

  // ── Snapshot capture (every 5th cycle) ───────────────────────────────

  describe('snapshot capture', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    it('captures a snapshot on the 5th cycle', async () => {
      for (let i = 0; i < 4; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      // 5th call
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      // Health check + ls for snapshot directories
      (sandboxService.runCommand as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '2026-03-15T14:23:00Z\n', stderr: '', exitCode: 0 });

      // Manifest and file reads
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('src/index.ts\npackage.json\n')
        .mockResolvedValueOnce('console.log("hello");')
        .mockResolvedValueOnce('{ "name": "test" }');

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const fromCalls = supabase.from.mock.calls;
      const snapshotFromCall = fromCalls.find((c: any) => c[0] === 'code_snapshots');
      expect(snapshotFromCall).toBeDefined();

      const insertCalls = supabase._chain.insert.mock.calls;
      const snapshotInsert = insertCalls.find((c: any) =>
        c[0] && typeof c[0] === 'object' && 'files' in c[0],
      );
      expect(snapshotInsert).toBeDefined();
      expect(snapshotInsert![0].session_id).toBe(SESSION_ID);
      expect(snapshotInsert![0].file_count).toBe(2);
      expect(snapshotInsert![0].files).toMatchObject({
        'src/index.ts': 'console.log("hello");',
        'package.json': '{ "name": "test" }',
      });
      // snapshot_at is derived from the directory name
      expect(snapshotInsert![0].snapshot_at).toBe('2026-03-15T14:23:00Z');
    });

    it('does not capture a snapshot on non-5th cycles', async () => {
      for (let i = 0; i < 3; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      const runCommandCalls = (sandboxService.runCommand as ReturnType<typeof vi.fn>).mock.calls;
      const lsCalls = runCommandCalls.filter(
        (c: any) => c[1] === 'ls',
      );
      expect(lsCalls).toHaveLength(0);
    });

    it('captures snapshot on 10th cycle (every multiple of 5)', async () => {
      for (let i = 0; i < 9; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.runCommand as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '20260315-150000\n', stderr: '', exitCode: 0 });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('index.ts\n')
        .mockResolvedValueOnce('export default {}');

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const fromCalls = supabase.from.mock.calls;
      const snapshotCall = fromCalls.find((c: any) => c[0] === 'code_snapshots');
      expect(snapshotCall).toBeDefined();
    });

    it('skips binary files in snapshots', async () => {
      for (let i = 0; i < 4; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.runCommand as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'snap1\n', stderr: '', exitCode: 0 });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('src/app.ts\nassets/logo.png\nstyles.css\n')
        .mockResolvedValueOnce('const x = 1;')
        .mockResolvedValueOnce('.body { color: red }');

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCalls = supabase._chain.insert.mock.calls;
      const snapshotInsert = insertCalls.find((c: any) =>
        c[0] && typeof c[0] === 'object' && 'files' in c[0],
      );
      expect(snapshotInsert).toBeDefined();
      expect(snapshotInsert![0].file_count).toBe(2);
      expect(snapshotInsert![0].files['src/app.ts']).toBe('const x = 1;');
      expect(snapshotInsert![0].files['styles.css']).toBe('.body { color: red }');
      expect(snapshotInsert![0].files['assets/logo.png']).toBeUndefined();
    });

    it('skips files over 1MB in snapshots', async () => {
      for (let i = 0; i < 4; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.runCommand as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'snap1\n', stderr: '', exitCode: 0 });

      const hugeContent = 'x'.repeat(1_048_577);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('small.ts\nhuge.ts\n')
        .mockResolvedValueOnce('small content')
        .mockResolvedValueOnce(hugeContent);

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      const insertCalls = supabase._chain.insert.mock.calls;
      const snapshotInsert = insertCalls.find((c: any) =>
        c[0] && typeof c[0] === 'object' && 'files' in c[0],
      );
      expect(snapshotInsert).toBeDefined();
      expect(snapshotInsert![0].file_count).toBe(1);
      expect(snapshotInsert![0].files['small.ts']).toBe('small content');
      expect(snapshotInsert![0].files['huge.ts']).toBeUndefined();
    });

    it('warns and returns when no snapshot directories are found', async () => {
      for (let i = 0; i < 4; i++) {
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');
        await collector.collectActivity();
      }

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.runCommand as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '\n', stderr: '', exitCode: 0 });

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      await collector.collectActivity();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no snapshots found'),
      );
    });
  });

  // ── shouldSkipFile (tested indirectly via snapshot behavior) ─────────

  describe('shouldSkipFile behavior', () => {
    beforeEach(() => {
      mockSessionRow();
      mockMonitorRunning();
    });

    const binaryExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.wasm', '.lock',
      '.woff', '.woff2', '.ttf', '.eot', '.map', '.min.js', '.min.css',
    ];

    for (const ext of binaryExtensions) {
      it(`skips files with ${ext} extension`, async () => {
        for (let i = 0; i < 4; i++) {
          (sandboxService.readFile as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('');
          await collector.collectActivity();
        }

        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');

        (sandboxService.runCommand as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
          .mockResolvedValueOnce({ stdout: 'snap1\n', stderr: '', exitCode: 0 });

        const binaryFile = `file${ext}`;
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(`${binaryFile}\nkeep.ts\n`)
          .mockResolvedValueOnce('kept content');

        supabase._chain.insert.mockResolvedValue({ data: null, error: null });

        await collector.collectActivity();

        const insertCalls = supabase._chain.insert.mock.calls;
        const snapshotInsert = insertCalls.find((c: any) =>
          c[0] && typeof c[0] === 'object' && 'files' in c[0],
        );
        if (snapshotInsert) {
          expect(snapshotInsert[0].files[binaryFile]).toBeUndefined();
        }

        // Reset collector for next iteration
        collector = new ActivityCollector(
          supabase as any,
          sandboxService,
          logger,
          SESSION_ID,
        );
      });
    }

    const allowedExtensions = ['.ts', '.js', '.json', '.css', '.html', '.md', '.tsx', '.jsx'];

    for (const ext of allowedExtensions) {
      it(`allows files with ${ext} extension`, async () => {
        for (let i = 0; i < 4; i++) {
          (sandboxService.readFile as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('');
          await collector.collectActivity();
        }

        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('');

        (sandboxService.runCommand as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce({ stdout: 'running', stderr: '', exitCode: 0 })
          .mockResolvedValueOnce({ stdout: 'snap1\n', stderr: '', exitCode: 0 });

        const allowedFile = `source${ext}`;
        (sandboxService.readFile as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(`${allowedFile}\n`)
          .mockResolvedValueOnce('file content here');

        supabase._chain.insert.mockResolvedValue({ data: null, error: null });

        await collector.collectActivity();

        const insertCalls = supabase._chain.insert.mock.calls;
        const snapshotInsert = insertCalls.find((c: any) =>
          c[0] && typeof c[0] === 'object' && 'files' in c[0],
        );
        expect(snapshotInsert).toBeDefined();
        expect(snapshotInsert![0].files[allowedFile]).toBe('file content here');

        collector = new ActivityCollector(
          supabase as any,
          sandboxService,
          logger,
          SESSION_ID,
        );
      });
    }
  });

  // ── Health check ─────────────────────────────────────────────────────

  describe('health check (ensureMonitorRunning)', () => {
    beforeEach(() => {
      mockSessionRow();
    });

    it('does not restart monitor when it is running', async () => {
      (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'running',
        stderr: '',
        exitCode: 0,
      });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      await collector.collectActivity();

      expect(sandboxService.startMonitor).not.toHaveBeenCalled();
    });

    it('restarts monitor when it reports stopped', async () => {
      (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'stopped',
        stderr: '',
        exitCode: 0,
      });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.startMonitor as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await collector.collectActivity();

      expect(sandboxService.startMonitor).toHaveBeenCalledWith(SANDBOX_ID);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not running'),
      );
    });

    it('attempts restart when health check command throws', async () => {
      (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection lost'),
      );

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      (sandboxService.startMonitor as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await collector.collectActivity();

      expect(sandboxService.startMonitor).toHaveBeenCalledWith(SANDBOX_ID);
    });

    it('logs error when both health check and restart fail', async () => {
      (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection lost'),
      );

      (sandboxService.startMonitor as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('restart failed'),
      );

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      await collector.collectActivity();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed to restart monitor'),
      );
    });
  });

  // ── Concurrency guard ────────────────────────────────────────────────

  describe('concurrency guard', () => {
    it('prevents concurrent collectActivity invocations', async () => {
      mockSessionRow();
      mockMonitorRunning();

      // Make readFile take a while (use a real promise that we control)
      let resolveReadFile!: (value: string) => void;
      const readFilePromise = new Promise<string>((resolve) => {
        resolveReadFile = resolve;
      });

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(readFilePromise) // first call hangs
        .mockResolvedValue(''); // subsequent calls resolve immediately

      supabase._chain.insert.mockResolvedValue({ data: null, error: null });

      // Start first collectActivity (will hang on readFile)
      const firstCall = collector.collectActivity();

      // Start second collectActivity (should return immediately due to guard)
      const secondCall = collector.collectActivity();

      // Second call should resolve immediately
      await secondCall;

      // Now resolve the first call
      resolveReadFile('');
      await firstCall;

      // from should only have been called once for 'sessions' (from the first call)
      // The second call should have been skipped
      const sessionCalls = supabase.from.mock.calls.filter(
        (c: any) => c[0] === 'sessions',
      );
      expect(sessionCalls).toHaveLength(1);
    });
  });

  // ── Session lookup failures ──────────────────────────────────────────

  describe('session lookup failures', () => {
    it('returns early when session has no sandbox_id', async () => {
      supabase._chain.single.mockResolvedValue({
        data: { sandbox_id: null, status: 'running' },
        error: null,
      });

      await collector.collectActivity();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cannot find sandbox'),
      );
      expect(sandboxService.readFile).not.toHaveBeenCalled();
    });

    it('returns early when session query errors', async () => {
      supabase._chain.single.mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      });

      await collector.collectActivity();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cannot find sandbox'),
      );
      expect(sandboxService.readFile).not.toHaveBeenCalled();
    });
  });

  // ── Insert error handling ────────────────────────────────────────────

  describe('insert error handling', () => {
    it('logs error when event insert fails', async () => {
      mockSessionRow();
      mockMonitorRunning();

      const fsLog = '2026-03-15T14:23:01 MODIFY /vercel/sandbox/file.ts\n';
      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fsLog)
        .mockRejectedValueOnce(new Error('not found'));

      supabase._chain.insert.mockResolvedValue({
        data: null,
        error: { message: 'insert failed' },
      });

      await collector.collectActivity();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed to insert events'),
      );
    });
  });

  // ── startCollecting / stopCollecting ─────────────────────────────────

  describe('startCollecting', () => {
    it('starts an interval that calls collectActivity', async () => {
      mockSessionRow();
      mockMonitorRunning();

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue('');

      collector.startCollecting();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('starting for session'),
      );

      await vi.advanceTimersByTimeAsync(30_000);

      expect(supabase.from).toHaveBeenCalledWith('sessions');

      await collector.stopCollecting();
    });

    it('is idempotent - calling twice does not create two intervals', async () => {
      mockSessionRow();
      mockMonitorRunning();

      (sandboxService.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');

      collector.startCollecting();
      collector.startCollecting();

      const startCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('starting for session'),
      );
      expect(startCalls).toHaveLength(1);

      await collector.stopCollecting();
    });
  });

  describe('stopCollecting', () => {
    it('clears the interval and performs a final collection', async () => {
      mockSessionRow();
      mockMonitorRunning();

      (sandboxService.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('');

      collector.startCollecting();

      await collector.stopCollecting();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopped for session'),
      );

      supabase.from.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      const sessionCalls = supabase.from.mock.calls.filter(
        (c: any) => c[0] === 'sessions',
      );
      expect(sessionCalls).toHaveLength(0);
    });

    it('logs error if final collection fails but does not throw', async () => {
      supabase._chain.single.mockRejectedValue(new Error('DB down'));

      collector.startCollecting();

      await expect(collector.stopCollecting()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('final collection failed'),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// ── SubmissionService ─────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('SubmissionService', () => {
  let supabase: ReturnType<typeof createMockSupabase>;
  let sandboxService: ReturnType<typeof createMockSandboxService>;
  let logger: Logger;
  let service: SubmissionService;

  const SESSION_ID = 'session-sub-001';
  const SANDBOX_ID = 'sandbox-sub-001';
  const USER_ID = 'user-001';

  beforeEach(() => {
    supabase = createMockSupabase();
    sandboxService = createMockSandboxService();
    logger = createMockLogger();
    service = new SubmissionService(
      supabase as any,
      sandboxService,
      logger,
    );
  });

  /**
   * Helper to set up the from() mock for SubmissionService tests.
   * Since the service calls multiple tables with different chain shapes,
   * we mock from() to return per-table chain stubs.
   */
  function setupSubmissionMocks(overrides: {
    sessionData?: Record<string, unknown>;
    commandCount?: number;
    fileChangeCount?: number;
    insertError?: { message: string } | null;
    captureInsert?: (data: any) => void;
  } = {}) {
    const sessionData = overrides.sessionData ?? {
      id: SESSION_ID,
      sandbox_id: SANDBOX_ID,
      user_id: USER_ID,
      created_at: new Date(Date.now() - 3600_000).toISOString(),
      total_disconnections: 0,
    };
    const commandCount = overrides.commandCount ?? 0;
    const fileChangeCount = overrides.fileChangeCount ?? 0;
    const insertError = overrides.insertError ?? null;

    supabase.from.mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: sessionData,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'session_activity') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: commandCount }),
              in: vi.fn().mockResolvedValue({ count: fileChangeCount }),
            }),
          }),
        };
      }
      if (table === 'final_submissions') {
        return {
          insert: vi.fn().mockImplementation((data: any) => {
            if (overrides.captureInsert) overrides.captureInsert(data);
            return Promise.resolve({ data: null, error: insertError });
          }),
        };
      }
      return supabase._chain;
    });
  }

  function mockFindCommand(files: string[] = []) {
    const stdout = files.join('\n') + (files.length > 0 ? '\n' : '');
    (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 0,
      stdout,
      stderr: '',
    });
  }

  // ── Happy path ─────────────────────────────────────────────────────

  describe('captureSubmission - happy path', () => {
    it('reads files, gets counts, and inserts submission', async () => {
      setupSubmissionMocks({ commandCount: 15, fileChangeCount: 42 });
      mockFindCommand([
        '/vercel/sandbox/src/index.ts',
        '/vercel/sandbox/package.json',
      ]);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('console.log("hello");')
        .mockResolvedValueOnce('{ "name": "test" }');

      await service.captureSubmission(SESSION_ID);

      const fromTables = supabase.from.mock.calls.map((c: any) => c[0]);
      expect(fromTables).toContain('sessions');
      expect(fromTables).toContain('session_activity');
      expect(fromTables).toContain('final_submissions');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Submission captured'),
      );
    });
  });

  // ── Binary file skipping ───────────────────────────────────────────

  describe('captureSubmission - binary file skipping', () => {
    it('skips files with binary extensions', async () => {
      setupSubmissionMocks();
      mockFindCommand([
        '/vercel/sandbox/src/app.ts',
        '/vercel/sandbox/assets/logo.png',
        '/vercel/sandbox/fonts/font.woff2',
        '/vercel/sandbox/lib/module.wasm',
      ]);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('const x = 1;');

      await service.captureSubmission(SESSION_ID);

      expect(sandboxService.readFile).toHaveBeenCalledTimes(1);
      expect(sandboxService.readFile).toHaveBeenCalledWith(
        SANDBOX_ID,
        '/vercel/sandbox/src/app.ts',
      );
    });

    it('skips files over 1MB', async () => {
      setupSubmissionMocks();
      mockFindCommand([
        '/vercel/sandbox/small.ts',
        '/vercel/sandbox/huge.ts',
      ]);

      const hugeContent = 'x'.repeat(1_048_577);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('small content')
        .mockResolvedValueOnce(hugeContent);

      await service.captureSubmission(SESSION_ID);

      expect(sandboxService.readFile).toHaveBeenCalledTimes(2);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping large file'),
      );
    });
  });

  // ── Find command failure ───────────────────────────────────────────

  describe('captureSubmission - find command failure', () => {
    it('handles find command failure gracefully with empty files', async () => {
      setupSubmissionMocks();

      (sandboxService.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'find: permission denied',
      });

      await service.captureSubmission(SESSION_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('find command failed'),
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Submission captured'),
      );
    });
  });

  // ── Individual file read failure ───────────────────────────────────

  describe('captureSubmission - individual file read failure', () => {
    it('continues with other files when one file read fails', async () => {
      setupSubmissionMocks();

      mockFindCommand([
        '/vercel/sandbox/good.ts',
        '/vercel/sandbox/bad.ts',
        '/vercel/sandbox/also-good.ts',
      ]);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('good content')
        .mockRejectedValueOnce(new Error('read fail'))
        .mockResolvedValueOnce('also good content');

      await service.captureSubmission(SESSION_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read file'),
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Submission captured'),
      );
    });
  });

  // ── Session duration calculation ───────────────────────────────────

  describe('captureSubmission - session duration', () => {
    it('calculates correct session duration in seconds', async () => {
      const twoHoursAgo = new Date(Date.now() - 7200_000).toISOString();
      let insertedData: Record<string, unknown> | null = null;

      setupSubmissionMocks({
        sessionData: {
          id: SESSION_ID,
          sandbox_id: SANDBOX_ID,
          user_id: USER_ID,
          created_at: twoHoursAgo,
          total_disconnections: 0,
        },
        captureInsert: (data) => { insertedData = data; },
      });

      mockFindCommand([]);

      await service.captureSubmission(SESSION_ID);

      expect(insertedData).not.toBeNull();
      const duration = (insertedData as any).session_duration_seconds;
      expect(duration).toBeGreaterThanOrEqual(7199);
      expect(duration).toBeLessThanOrEqual(7201);
    });
  });

  // ── Missing session ────────────────────────────────────────────────

  describe('captureSubmission - missing session', () => {
    it('throws when session is not found', async () => {
      supabase.from.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'not found' },
                }),
              }),
            }),
          };
        }
        return supabase._chain;
      });

      await expect(service.captureSubmission(SESSION_ID)).rejects.toThrow(
        `Session not found: ${SESSION_ID}`,
      );
    });

    it('throws when session query returns error', async () => {
      supabase.from.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'database error' },
                }),
              }),
            }),
          };
        }
        return supabase._chain;
      });

      await expect(service.captureSubmission(SESSION_ID)).rejects.toThrow(
        'Session not found',
      );
    });
  });

  // ── Insert failure ─────────────────────────────────────────────────

  describe('captureSubmission - insert failure', () => {
    it('throws when final_submissions insert fails', async () => {
      setupSubmissionMocks({
        insertError: { message: 'unique constraint violated' },
      });

      mockFindCommand([]);

      await expect(service.captureSubmission(SESSION_ID)).rejects.toThrow(
        'Failed to insert submission',
      );
    });
  });

  // ── Correct summary stats ─────────────────────────────────────────

  describe('captureSubmission - summary stats', () => {
    it('inserts correct file count, total bytes, and activity counts', async () => {
      let insertedData: Record<string, unknown> | null = null;

      setupSubmissionMocks({
        sessionData: {
          id: SESSION_ID,
          sandbox_id: SANDBOX_ID,
          user_id: USER_ID,
          created_at: new Date(Date.now() - 1800_000).toISOString(),
          total_disconnections: 3,
        },
        commandCount: 25,
        fileChangeCount: 100,
        captureInsert: (data) => { insertedData = data; },
      });

      mockFindCommand([
        '/vercel/sandbox/index.ts',
        '/vercel/sandbox/utils.ts',
      ]);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('export const a = 1;')
        .mockResolvedValueOnce('export const b = 2;');

      await service.captureSubmission(SESSION_ID);

      expect(insertedData).not.toBeNull();
      expect((insertedData as any).session_id).toBe(SESSION_ID);
      expect((insertedData as any).user_id).toBe(USER_ID);
      expect((insertedData as any).file_count).toBe(2);
      expect((insertedData as any).total_bytes).toBe(
        Buffer.byteLength('export const a = 1;', 'utf-8') +
        Buffer.byteLength('export const b = 2;', 'utf-8'),
      );
      expect((insertedData as any).total_commands_run).toBe(25);
      expect((insertedData as any).total_file_changes).toBe(100);
      expect((insertedData as any).total_disconnections).toBe(3);
      expect((insertedData as any).session_duration_seconds).toBeGreaterThanOrEqual(1799);
      expect((insertedData as any).session_duration_seconds).toBeLessThanOrEqual(1801);
    });
  });

  // ── Relative path stripping ────────────────────────────────────────

  describe('captureSubmission - relative paths', () => {
    it('stores files with paths relative to /vercel/sandbox', async () => {
      let insertedData: Record<string, unknown> | null = null;

      setupSubmissionMocks({
        captureInsert: (data) => { insertedData = data; },
      });

      mockFindCommand([
        '/vercel/sandbox/src/deep/nested/file.ts',
        '/vercel/sandbox/package.json',
      ]);

      (sandboxService.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('nested content')
        .mockResolvedValueOnce('pkg content');

      await service.captureSubmission(SESSION_ID);

      expect(insertedData).not.toBeNull();
      const files = (insertedData as any).files;
      expect(files['src/deep/nested/file.ts']).toBe('nested content');
      expect(files['package.json']).toBe('pkg content');
    });
  });
});

// ---------------------------------------------------------------------------
// ── ActivityCollectorManager ──────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('ActivityCollectorManager', () => {
  let supabase: ReturnType<typeof createMockSupabase>;
  let sandboxService: ReturnType<typeof createMockSandboxService>;
  let logger: Logger;
  let manager: ActivityCollectorManager;

  beforeEach(() => {
    vi.useFakeTimers();
    supabase = createMockSupabase();
    sandboxService = createMockSandboxService();
    logger = createMockLogger();
    manager = new ActivityCollectorManager(
      supabase as any,
      sandboxService,
      logger,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startForSession', () => {
    it('creates and starts a collector for the session', () => {
      manager.startForSession('session-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('started collector for session session-1'),
      );
    });

    it('is idempotent - warns on duplicate start', () => {
      manager.startForSession('session-1');
      manager.startForSession('session-1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('collector already exists for session session-1'),
      );

      const startedCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('started collector for session session-1'),
      );
      expect(startedCalls).toHaveLength(1);
    });

    it('can start collectors for different sessions', () => {
      manager.startForSession('session-1');
      manager.startForSession('session-2');

      const startedCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('started collector'),
      );
      expect(startedCalls).toHaveLength(2);
    });
  });

  describe('stopForSession', () => {
    it('stops and removes the collector for the session', async () => {
      supabase._chain.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      manager.startForSession('session-1');

      await manager.stopForSession('session-1');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopped collector for session session-1'),
      );
    });

    it('is safe when no collector exists for the session', async () => {
      await manager.stopForSession('nonexistent-session');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no collector found for session nonexistent-session'),
      );
    });

    it('allows restarting a collector after stopping', async () => {
      supabase._chain.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      manager.startForSession('session-1');
      await manager.stopForSession('session-1');

      manager.startForSession('session-1');

      const alreadyExistsWarns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('already exists'),
      );
      expect(alreadyExistsWarns).toHaveLength(0);
    });
  });

  describe('stopAll', () => {
    it('stops all active collectors', async () => {
      supabase._chain.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      manager.startForSession('session-1');
      manager.startForSession('session-2');
      manager.startForSession('session-3');

      await manager.stopAll();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('stopping all collectors (3 active)'),
      );

      const stoppedCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('stopped collector for session'),
      );
      expect(stoppedCalls).toHaveLength(3);
    });

    it('is a no-op when no collectors are active', async () => {
      await manager.stopAll();

      const stopAllCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any) => typeof c[0] === 'string' && c[0].includes('stopping all collectors'),
      );
      expect(stopAllCalls).toHaveLength(0);
    });

    it('handles errors from individual collector stops gracefully', async () => {
      supabase._chain.single.mockRejectedValue(new Error('DB exploded'));

      manager.startForSession('session-1');
      manager.startForSession('session-2');

      await expect(manager.stopAll()).resolves.toBeUndefined();
    });
  });
});
