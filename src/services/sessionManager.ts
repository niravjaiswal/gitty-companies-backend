import type { SupabaseClient } from '@supabase/supabase-js';
import { SandboxService, type Logger } from './sandbox.js';
import type { ActivityCollectorManager } from './activityCollectorManager.js';
import { SubmissionService } from './submissionService.js';
import { loadConfig } from '../config/index.js';

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'disconnected'
  | 'stopped'
  | 'error'
  | 'timed_out'
  | 'abandoned';

export interface Session {
  id: string;
  userId: string;
  sandboxId: string;
  status: SessionStatus;
  createdAt: Date;
  lastActivityAt: Date;
  disconnectedAt: Date | null;
  stoppedAt: Date | null;
  totalDisconnections: number;
  codeServerUrl: string | null;
}

/** Maps a Supabase row to our Session interface */
function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sandboxId: row.sandbox_id as string,
    status: row.status as SessionStatus,
    createdAt: new Date(row.created_at as string),
    lastActivityAt: new Date(row.last_activity_at as string),
    disconnectedAt: row.disconnected_at ? new Date(row.disconnected_at as string) : null,
    stoppedAt: row.stopped_at ? new Date(row.stopped_at as string) : null,
    totalDisconnections: (row.total_disconnections as number) ?? 0,
    codeServerUrl: (row.code_server_url as string) ?? null,
  };
}

/**
 * Manages the mapping between users and sandbox sessions.
 * Sessions are persisted in Supabase; live sandbox instances are tracked in-memory.
 */
export class SessionManager {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: Logger;
  private collectorManager: ActivityCollectorManager;
  private submissionService: SubmissionService;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    supabase: SupabaseClient,
    sandboxService: SandboxService,
    logger: Logger,
    collectorManager: ActivityCollectorManager,
  ) {
    this.supabase = supabase;
    this.sandboxService = sandboxService;
    this.logger = logger;
    this.collectorManager = collectorManager;
    this.submissionService = new SubmissionService(supabase, sandboxService, logger);
  }

  /**
   * Creates a new session for the given user.
   * Enforces: has_used_session flag (one session ever per user) and no active sessions.
   */
  async createSession(userId: string): Promise<Session> {
    // Verify profile exists
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new Error('Profile not found');
    }

    // Check no active session exists
    const existing = await this.getActiveSessionByUserId(userId);
    if (existing) {
      throw new Error(`User ${userId} already has an active session: ${existing.id}`);
    }

    // Mark profile as having used a session
    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ has_used_session: true, session_ended_reason: null })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Failed to update profile: ${updateError.message}`);
    }

    // Insert session row
    const { data: sessionRow, error: insertError } = await this.supabase
      .from('sessions')
      .insert({
        user_id: userId,
        status: 'starting',
      })
      .select()
      .single();

    if (insertError || !sessionRow) {
      throw new Error(`Failed to create session: ${insertError?.message}`);
    }

    await this.logEvent(sessionRow.id, 'created');
    this.logger.info(`Session starting: ${sessionRow.id} for user ${userId}`);

    // Create the sandbox and set up code-server
    try {
      const { id: sandboxId } = await this.sandboxService.createSandbox();

      // Set up code-server inside the sandbox
      const { url: codeServerUrl } = await this.sandboxService.setupCodeServer(sandboxId);

      // Start the activity monitor agent
      await this.sandboxService.startMonitor(sandboxId);

      const { data: updated, error: sandboxUpdateError } = await this.supabase
        .from('sessions')
        .update({
          sandbox_id: sandboxId,
          status: 'running',
          code_server_url: codeServerUrl,
        })
        .eq('id', sessionRow.id)
        .select()
        .single();

      if (sandboxUpdateError || !updated) {
        throw new Error(`Failed to update session with sandbox: ${sandboxUpdateError?.message}`);
      }

      await this.logEvent(sessionRow.id, 'running');
      this.logger.info(`Session running: ${sessionRow.id} (sandbox: ${sandboxId}, code-server: ${codeServerUrl})`);

      // Start activity collection for this session
      this.collectorManager.startForSession(sessionRow.id);

      return rowToSession(updated);
    } catch (error) {
      // Mark session as error if sandbox creation fails
      await this.supabase
        .from('sessions')
        .update({ status: 'error', stopped_at: new Date().toISOString() })
        .eq('id', sessionRow.id);

      await this.logEvent(sessionRow.id, 'error', { reason: String(error) });
      this.logger.error(`Failed to create sandbox for session ${sessionRow.id}: ${error}`);
      throw error;
    }
  }

  /**
   * Returns the session if it exists, or null.
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) return null;
    return rowToSession(data);
  }

  /**
   * Returns the active (non-terminal) session for a user, or null.
   */
  async getActiveSessionByUserId(userId: string): Promise<Session | null> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['starting', 'running', 'disconnected'])
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return rowToSession(data);
  }

  /**
   * Returns the user's past sessions (last 10), ordered by creation date descending.
   */
  async getSessionHistory(userId: string): Promise<Session[]> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data.map(rowToSession);
  }

  /**
   * Updates lastActivityAt to the current time.
   */
  async updateActivity(sessionId: string): Promise<void> {
    await this.supabase
      .from('sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  /**
   * Marks a session as disconnected. Starts the grace period.
   * Does NOT destroy the sandbox.
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session || session.status !== 'running') return;

    await this.supabase
      .from('sessions')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
        total_disconnections: session.totalDisconnections + 1,
      })
      .eq('id', sessionId);

    await this.logEvent(sessionId, 'disconnected');
    this.logger.info(`Session disconnected: ${sessionId} (grace period started)`);
  }

  /**
   * Reconnects a disconnected session if within the grace period.
   * Returns the reconnected session, or null if grace period expired (session abandoned).
   */
  async reconnectSession(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session || session.status !== 'disconnected') return null;

    const config = loadConfig();
    const now = Date.now();
    const disconnectedAt = session.disconnectedAt?.getTime() ?? 0;
    const elapsed = now - disconnectedAt;

    if (elapsed > config.disconnectGracePeriodMs) {
      // Grace period expired — abandon
      await this.abandonSession(sessionId);
      return null;
    }

    // Reconnect
    const { data, error } = await this.supabase
      .from('sessions')
      .update({
        status: 'running',
        disconnected_at: null,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error || !data) return null;

    await this.logEvent(sessionId, 'reconnected');
    this.logger.info(`Session reconnected: ${sessionId}`);
    return rowToSession(data);
  }

  /**
   * Permanently destroys a session due to grace period expiry.
   * Destroys the sandbox and marks the session as abandoned.
   */
  async abandonSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    // Stop activity collection (final collection run before sandbox teardown)
    await this.collectorManager.stopForSession(sessionId);

    // Capture final submission before sandbox destruction
    if (session.sandboxId) {
      try {
        await this.submissionService.captureSubmission(sessionId);
      } catch (error) {
        this.logger.error(`Error capturing submission for abandoned session ${sessionId}: ${error}`);
      }
    }

    // Destroy sandbox if it exists
    if (session.sandboxId) {
      try {
        await this.sandboxService.destroySandbox(session.sandboxId);
      } catch (error) {
        this.logger.error(`Error destroying sandbox for abandoned session ${sessionId}: ${error}`);
      }
    }

    await this.supabase
      .from('sessions')
      .update({
        status: 'abandoned',
        stopped_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    // Update profile with reason
    await this.supabase
      .from('profiles')
      .update({ session_ended_reason: 'connection_lost' })
      .eq('id', session.userId);

    await this.logEvent(sessionId, 'abandoned');
    this.logger.info(`Session abandoned: ${sessionId}`);
  }

  /**
   * Stops a session cleanly (user-initiated or system).
   * Destroys sandbox and marks as stopped/timed_out.
   */
  async stopSession(sessionId: string, reason?: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const terminalStatuses: SessionStatus[] = ['stopped', 'error', 'timed_out', 'abandoned'];
    if (terminalStatuses.includes(session.status)) {
      return;
    }

    // Stop activity collection (final collection run before sandbox teardown)
    await this.collectorManager.stopForSession(sessionId);

    // Capture final submission before sandbox destruction
    if (session.sandboxId) {
      try {
        await this.submissionService.captureSubmission(sessionId);
      } catch (error) {
        this.logger.error(`Error capturing submission for session ${sessionId}: ${error}`);
      }
    }

    // Destroy sandbox
    if (session.sandboxId) {
      try {
        await this.sandboxService.destroySandbox(session.sandboxId);
      } catch (error) {
        this.logger.error(`Error destroying sandbox for session ${sessionId}: ${error}`);
      }
    }

    const status: SessionStatus = reason === 'timed_out' ? 'timed_out' : 'stopped';
    const endedReason = reason === 'timed_out' ? 'timed_out' : 'completed';

    await this.supabase
      .from('sessions')
      .update({
        status,
        stopped_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    await this.supabase
      .from('profiles')
      .update({ session_ended_reason: endedReason })
      .eq('id', session.userId);

    await this.logEvent(sessionId, status, { reason });
    this.logger.info(`Session stopped: ${sessionId} (reason: ${reason ?? 'user'})`);
  }

  /**
   * Finds and handles stale sessions. Runs every 10s.
   * 1. Expired disconnected sessions → abandon
   * 2. Sessions exceeding max duration → timeout
   */
  async cleanupStaleSessions(): Promise<void> {
    const config = loadConfig();
    const now = Date.now();

    // 1. Find expired disconnected sessions
    const { data: disconnected } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('status', 'disconnected');

    if (disconnected) {
      for (const row of disconnected) {
        const disconnectedAt = new Date(row.disconnected_at).getTime();
        if (now - disconnectedAt > config.disconnectGracePeriodMs) {
          this.logger.info(`Session ${row.id} grace period expired, abandoning`);
          await this.abandonSession(row.id);
        }
      }
    }

    // 2. Find running sessions with stale heartbeats (no activity for 60s)
    const { data: staleRunning } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('status', 'running');

    if (staleRunning) {
      for (const row of staleRunning) {
        const lastActivity = new Date(row.last_activity_at).getTime();
        if (now - lastActivity > 60_000) {
          this.logger.info(
            `Session ${row.id} has no heartbeat for ${Math.round((now - lastActivity) / 1000)}s, abandoning`,
          );
          await this.abandonSession(row.id);
        }
      }
    }

    // 3. Find sessions exceeding max duration
    const { data: longRunning } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['running', 'disconnected']);

    if (longRunning) {
      for (const row of longRunning) {
        const createdAt = new Date(row.created_at).getTime();
        if (now - createdAt > config.maxSandboxDurationMs) {
          this.logger.info(
            `Session ${row.id} exceeded max duration (${Math.round((now - createdAt) / 1000)}s), timing out`,
          );
          await this.stopSession(row.id, 'timed_out');
        }
      }
    }
  }

  /**
   * Starts the periodic stale session cleanup (every 10 seconds).
   */
  startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions().catch((error) => {
        this.logger.error(`Stale session cleanup error: ${error}`);
      });
    }, 10_000);
  }

  /**
   * Stops the periodic cleanup interval.
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Stops all active sessions. Used during graceful shutdown.
   */
  async stopAllSessions(): Promise<void> {
    const { data: activeSessions } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['starting', 'running', 'disconnected']);

    if (!activeSessions || activeSessions.length === 0) return;

    this.logger.info(`Stopping all sessions (${activeSessions.length} active)...`);
    await Promise.allSettled(
      activeSessions.map((row) => this.stopSession(row.id)),
    );
  }

  /**
   * Cleans up orphaned sessions on server restart.
   * Sessions with status 'running' or 'disconnected' that don't have
   * a live sandbox instance are marked as abandoned.
   */
  async cleanupOrphanedSessions(): Promise<void> {
    const { data: orphans } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['running', 'disconnected']);

    if (!orphans || orphans.length === 0) return;

    this.logger.info(`Found ${orphans.length} potentially orphaned sessions`);

    for (const row of orphans) {
      // Check if we have a live sandbox for this session
      try {
        this.sandboxService.getSandbox(row.sandbox_id);
        // Sandbox exists in memory — session is still alive
      } catch {
        // Sandbox not in memory — this is an orphan from a previous server instance
        this.logger.info(`Orphaned session ${row.id} (no live sandbox), marking abandoned`);
        await this.supabase
          .from('sessions')
          .update({
            status: 'abandoned',
            stopped_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        await this.supabase
          .from('profiles')
          .update({ session_ended_reason: 'error' })
          .eq('id', row.user_id);

        await this.logEvent(row.id, 'abandoned', { reason: 'server_restart' });
      }
    }
  }

  /** Logs a session event to the session_events table */
  private async logEvent(
    sessionId: string,
    eventType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.supabase.from('session_events').insert({
      session_id: sessionId,
      event_type: eventType,
      metadata: metadata ?? {},
    });
  }
}
