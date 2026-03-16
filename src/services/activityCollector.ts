import type { SupabaseClient } from '@supabase/supabase-js';
import type { SandboxService, Logger } from './sandbox.js';

// ── Data structures ────────────────────────────────────────

interface ActivityEvent {
  session_id: string;
  event_type: string;
  detail: string;
  metadata: Record<string, unknown>;
  occurred_at: string; // ISO timestamp
}

interface CollectorState {
  fsOffset: number;
  cmdOffset: number;
  cycleCount: number;
}

// Binary / generated file extensions to skip when snapshotting
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.wasm', '.lock',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.min.js', '.min.css',
]);

const MAX_SNAPSHOT_FILE_SIZE = 1_048_576; // 1 MB

// ── Helpers ────────────────────────────────────────────────

/** Map inotifywait event names to our normalised event types */
function mapFsEventType(raw: string): string | null {
  const primary = raw.split(',')[0];
  switch (primary) {
    case 'MODIFY':
    case 'CLOSE_WRITE':
      return 'file_modify';
    case 'CREATE':
      return 'file_create';
    case 'DELETE':
      return 'file_delete';
    case 'MOVED_FROM':
    case 'MOVED_TO':
      return 'file_move';
    default:
      // Skip events that don't match our schema CHECK constraint
      return null;
  }
}

/** Strip the sandbox root prefix from an absolute path */
function relativePath(absPath: string): string {
  return absPath.replace(/^\/vercel\/sandbox\/?/, '');
}

/**
 * Deduplicate filesystem events: if multiple events of the SAME TYPE
 * for the same file fall within a 1-second window, keep only the last one.
 * Events of different types (e.g., CREATE then MODIFY) are always preserved.
 */
function deduplicateFsEvents(events: ActivityEvent[]): ActivityEvent[] {
  // Group by file path + event type (so CREATE and MODIFY are separate groups)
  const groups = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    const key = `${ev.detail}::${ev.event_type}`;
    const arr = groups.get(key) ?? [];
    arr.push(ev);
    groups.set(key, arr);
  }

  const result: ActivityEvent[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Sort ascending by timestamp, then collapse within 1-second windows
    group.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    let windowStart = group[0];
    for (let i = 1; i < group.length; i++) {
      const cur = group[i];
      const diff =
        new Date(cur.occurred_at).getTime() -
        new Date(windowStart.occurred_at).getTime();
      if (diff > 1000) {
        // Previous window is done — keep last event of that window
        result.push(windowStart);
        windowStart = cur;
      } else {
        // Same window, same type — replace with this (later) event
        windowStart = cur;
      }
    }
    // Push the last event of the final window
    result.push(windowStart);
  }

  return result;
}

function shouldSkipFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

// ── ActivityCollector ──────────────────────────────────────

export class ActivityCollector {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: Logger;
  private sessionId: string;

  private state: CollectorState = { fsOffset: 0, cmdOffset: 0, cycleCount: 0 };
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private collecting = false; // guard against concurrent collectActivity calls

  constructor(
    supabase: SupabaseClient,
    sandboxService: SandboxService,
    logger: Logger,
    sessionId: string,
  ) {
    this.supabase = supabase;
    this.sandboxService = sandboxService;
    this.logger = logger;
    this.sessionId = sessionId;
  }

  // ── Public API ──────────────────────────────────────────

  startCollecting(): void {
    if (this.intervalHandle) return; // already running

    this.logger.info(`ActivityCollector: starting for session ${this.sessionId}`);
    this.intervalHandle = setInterval(() => {
      this.collectActivity().catch((err) => {
        this.logger.error(
          `ActivityCollector: collection failed for session ${this.sessionId}: ${err}`,
        );
      });
    }, 30_000);
  }

  async stopCollecting(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    // Final collection run
    try {
      await this.collectActivity();
    } catch (err) {
      this.logger.error(
        `ActivityCollector: final collection failed for session ${this.sessionId}: ${err}`,
      );
    }

    this.logger.info(`ActivityCollector: stopped for session ${this.sessionId}`);
  }

  // ── Core collection logic ───────────────────────────────

  async collectActivity(): Promise<void> {
    // Guard against concurrent invocations (interval + stopCollecting race)
    if (this.collecting) return;
    this.collecting = true;

    try {
      await this._collectActivityInner();
    } finally {
      this.collecting = false;
    }
  }

  private async _collectActivityInner(): Promise<void> {
    // Resolve sandboxId from DB
    const { data: sessionRow, error: sessionErr } = await this.supabase
      .from('sessions')
      .select('sandbox_id, status')
      .eq('id', this.sessionId)
      .single();

    if (sessionErr || !sessionRow?.sandbox_id) {
      this.logger.warn(
        `ActivityCollector: cannot find sandbox for session ${this.sessionId}`,
      );
      return;
    }

    const sandboxId: string = sessionRow.sandbox_id;

    // Health-check: is the monitor agent still running?
    await this.ensureMonitorRunning(sandboxId);

    // Increment cycle count
    this.state.cycleCount += 1;

    const allEvents: ActivityEvent[] = [];

    // ── Filesystem events ──────────────────────────────
    try {
      const fsRaw = await this.sandboxService.readFile(sandboxId, '/tmp/monitor/fs-events.log');
      // Reset offset if file was truncated (e.g., monitor agent restarted)
      if (fsRaw.length < this.state.fsOffset) {
        this.state.fsOffset = 0;
      }
      const newContent = fsRaw.slice(this.state.fsOffset);
      this.state.fsOffset = fsRaw.length;

      if (newContent.trim().length > 0) {
        const parsed = this.parseFsEvents(newContent);
        allEvents.push(...parsed);
      }
    } catch {
      // File may not exist yet — that's fine
    }

    // ── Command history ────────────────────────────────
    try {
      const cmdRaw = await this.sandboxService.readFile(sandboxId, '/tmp/monitor/command-history.log');
      // Reset offset if file was truncated (e.g., monitor agent restarted)
      if (cmdRaw.length < this.state.cmdOffset) {
        this.state.cmdOffset = 0;
      }
      const newContent = cmdRaw.slice(this.state.cmdOffset);
      this.state.cmdOffset = cmdRaw.length;

      if (newContent.trim().length > 0) {
        const parsed = this.parseCmdEvents(newContent);
        allEvents.push(...parsed);
      }
    } catch {
      // File may not exist yet
    }

    // Deduplicate fs events
    const fsEvents = allEvents.filter(
      (e) => e.event_type !== 'command_run',
    );
    const cmdEvents = allEvents.filter(
      (e) => e.event_type === 'command_run',
    );
    const dedupedFs = deduplicateFsEvents(fsEvents);
    const finalEvents = [...dedupedFs, ...cmdEvents];

    // Batch insert into session_activity
    if (finalEvents.length > 0) {
      const { error: insertErr } = await this.supabase
        .from('session_activity')
        .insert(finalEvents);

      if (insertErr) {
        this.logger.error(
          `ActivityCollector: failed to insert events for session ${this.sessionId}: ${insertErr.message}`,
        );
      } else {
        this.logger.info(
          `ActivityCollector: inserted ${finalEvents.length} events for session ${this.sessionId}`,
        );
      }
    }

    // ── Snapshot (every 5th cycle) ─────────────────────
    if (this.state.cycleCount % 5 === 0) {
      await this.captureSnapshot(sandboxId);
    }
  }

  // ── Parsers ─────────────────────────────────────────────

  private parseFsEvents(raw: string): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      // Expected format: "2026-03-15T14:23:01 MODIFY /vercel/sandbox/src/index.ts"
      const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
      if (!match) continue;

      const [, timestamp, rawEvent, absPath] = match;
      const eventType = mapFsEventType(rawEvent);
      if (!eventType) continue; // skip unrecognized inotifywait events
      const relPath = relativePath(absPath);

      events.push({
        session_id: this.sessionId,
        event_type: eventType,
        detail: relPath,
        metadata: { raw_event: rawEvent, absolute_path: absPath },
        occurred_at: timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`,
      });
    }

    return events;
  }

  private parseCmdEvents(raw: string): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      // Expected format: "2026-03-15T14:23:10Z npm install express"
      const match = line.match(/^(\S+)\s+(.+)$/);
      if (!match) continue;

      const [, timestamp, command] = match;

      events.push({
        session_id: this.sessionId,
        event_type: 'command_run',
        detail: command,
        metadata: {},
        occurred_at: timestamp,
      });
    }

    return events;
  }

  // ── Snapshot capture ────────────────────────────────────

  private async captureSnapshot(sandboxId: string): Promise<void> {
    try {
      // Find the latest snapshot directory
      const lsResult = await this.sandboxService.runCommand(sandboxId, 'ls', [
        '-t',
        '/tmp/monitor/snapshots/',
      ]);
      const dirs = lsResult.stdout
        .split('\n')
        .filter((d) => d.trim().length > 0);

      if (dirs.length === 0) {
        this.logger.warn(
          `ActivityCollector: no snapshots found for session ${this.sessionId}`,
        );
        return;
      }

      const latestDirName = dirs[0].trim();
      const latestDir = `/tmp/monitor/snapshots/${latestDirName}`;
      // Use the directory name (ISO timestamp from sandbox clock) as snapshot_at
      const snapshotAt = latestDirName.endsWith('Z') ? latestDirName : `${latestDirName}Z`;

      // Read the manifest
      let manifest: string;
      try {
        manifest = await this.sandboxService.readFile(sandboxId, `${latestDir}/.manifest`);
      } catch {
        this.logger.warn(
          `ActivityCollector: no manifest in ${latestDir} for session ${this.sessionId}`,
        );
        return;
      }

      const filePaths = manifest
        .split('\n')
        .filter((f) => f.trim().length > 0);

      const files: Record<string, string> = {};
      let totalBytes = 0;

      for (const filePath of filePaths) {
        if (shouldSkipFile(filePath)) continue;

        try {
          const content = await this.sandboxService.readFile(
            sandboxId,
            `${latestDir}/${filePath}`,
          );

          // Skip files over 1 MB
          const byteLen = Buffer.byteLength(content, 'utf-8');
          if (byteLen > MAX_SNAPSHOT_FILE_SIZE) continue;

          files[filePath] = content;
          totalBytes += byteLen;
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }

      const fileCount = Object.keys(files).length;
      if (fileCount === 0) return;

      const { error: snapErr } = await this.supabase
        .from('code_snapshots')
        .insert({
          session_id: this.sessionId,
          files,
          file_count: fileCount,
          total_bytes: totalBytes,
          snapshot_at: snapshotAt,
        });

      if (snapErr) {
        this.logger.error(
          `ActivityCollector: failed to insert snapshot for session ${this.sessionId}: ${snapErr.message}`,
        );
      } else {
        this.logger.info(
          `ActivityCollector: captured snapshot for session ${this.sessionId} (${fileCount} files, ${totalBytes} bytes)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `ActivityCollector: snapshot capture failed for session ${this.sessionId}: ${err}`,
      );
    }
  }

  // ── Monitor health check ────────────────────────────────

  private async ensureMonitorRunning(sandboxId: string): Promise<void> {
    try {
      const result = await this.sandboxService.runCommand(sandboxId, 'bash', [
        '-c',
        'kill -0 $(cat /tmp/monitor/agent.pid 2>/dev/null) 2>/dev/null && echo "running" || echo "stopped"',
      ]);

      if (result.stdout.trim() !== 'running') {
        this.logger.warn(
          `ActivityCollector: monitor agent not running for session ${this.sessionId}, restarting`,
        );
        await this.sandboxService.startMonitor(sandboxId);
        // Reset offsets since restarted agent creates fresh log files
        this.state.fsOffset = 0;
        this.state.cmdOffset = 0;
      }
    } catch {
      // If we can't even check, try to restart
      try {
        await this.sandboxService.startMonitor(sandboxId);
        this.state.fsOffset = 0;
        this.state.cmdOffset = 0;
      } catch (restartErr) {
        this.logger.error(
          `ActivityCollector: failed to restart monitor for session ${this.sessionId}: ${restartErr}`,
        );
      }
    }
  }
}
