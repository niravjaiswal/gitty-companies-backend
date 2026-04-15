import type { SupabaseClient } from '@supabase/supabase-js';
import { SandboxService, type Logger } from '../../external/vercelSandbox/sandbox.js';
import type { ActivityCollectorManager } from '../activity/activityCollectorManager.js';
import { SubmissionService } from '../submissions/submissionService.js';
import { loadConfig } from '../../infra/config/index.js';
import { normalizeStoredWorkspace } from '../assessments/assessmentWorkspace.js';

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
  assessmentId: string | null;
  assignmentId: string | null;
}

export interface SessionStartResult {
  session: Session;
  assignmentId: string;
  assessmentId: string;
}

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
    assessmentId: (row.assessment_id as string) ?? null,
    assignmentId: (row.assignment_id as string) ?? null,
  };
}

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

  async createSessionForAssignment(userId: string, assignmentId: string): Promise<SessionStartResult> {
    const { data: assignment, error: assignmentError } = await this.supabase
      .from('assessment_assignments')
      .select('id, assessment_id, candidate_user_id, status')
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      throw new Error('Assignment not found');
    }

    if (assignment.candidate_user_id !== userId) {
      throw new Error('Assignment is not claimed by this user');
    }

    if (!['assigned', 'claimed'].includes(assignment.status as string)) {
      throw new Error(`Assignment cannot be started from status: ${assignment.status as string}`);
    }

    const existingUserSession = await this.getActiveSessionByUserId(userId);
    if (existingUserSession) {
      throw new Error(`User ${userId} already has an active session: ${existingUserSession.id}`);
    }

    const existingAssignmentSession = await this.getSessionByAssignmentId(assignmentId);
    if (existingAssignmentSession) {
      const activeStatuses: SessionStatus[] = ['starting', 'running', 'disconnected'];
      if (activeStatuses.includes(existingAssignmentSession.status)) {
        throw new Error(`Assignment ${assignmentId} already has an active session`);
      }
      throw new Error(`Assignment ${assignmentId} already has a completed session`);
    }

    const { data: sessionRow, error: insertError } = await this.supabase
      .from('sessions')
      .insert({
        user_id: userId,
        assessment_id: assignment.assessment_id,
        assignment_id: assignmentId,
        status: 'starting',
      })
      .select()
      .single();

    if (insertError || !sessionRow) {
      throw new Error(`Failed to create session: ${insertError?.message}`);
    }

    await this.supabase
      .from('assessment_assignments')
      .update({
        status: 'started',
        started_at: new Date().toISOString(),
      })
      .eq('id', assignmentId);

    await this.logEvent(sessionRow.id, 'created', {
      assessmentId: assignment.assessment_id,
      assignmentId,
    });
    this.logger.info(`Session starting: ${sessionRow.id} for user ${userId}, assignment ${assignmentId}`);

    const workspace = await this.ensureAssessmentWorkspaceGenerated(assignment.assessment_id as string);

    try {
      const config = loadConfig();
      const { id: sandboxId } = await this.sandboxService.createSandbox({
        snapshotId: config.vercelSandboxSnapshotId || undefined,
      });
      if (Object.keys(workspace.files).length > 0) {
        await this.sandboxService.seedAssessmentFiles(sandboxId, workspace.files);
      }

      const { url: codeServerUrl } = await this.sandboxService.setupCodeServer(sandboxId, {
        entryFilePath: workspace.entryFilePath || undefined,
      });
      await this.sandboxService.startMonitor(sandboxId);

      try {
        await this.sandboxService.deployClaudeHooks(sandboxId);
      } catch (error) {
        this.logger.warn(`Failed to deploy Claude Code hooks: ${error}`);
      }

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
      this.collectorManager.startForSession(sessionRow.id);

      return {
        session: rowToSession(updated),
        assignmentId,
        assessmentId: assignment.assessment_id as string,
      };
    } catch (error) {
      await this.supabase
        .from('sessions')
        .update({ status: 'error', stopped_at: new Date().toISOString() })
        .eq('id', sessionRow.id);

      await this.supabase
        .from('assessment_assignments')
        .update({ status: 'claimed' })
        .eq('id', assignmentId);

      await this.logEvent(sessionRow.id, 'error', { reason: String(error) });
      this.logger.error(`Failed to create sandbox for session ${sessionRow.id}: ${error}`);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) return null;
    return rowToSession(data);
  }

  async getSessionByAssignmentId(assignmentId: string): Promise<Session | null> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .maybeSingle();

    if (error || !data) return null;
    return rowToSession(data);
  }

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

  async updateActivity(sessionId: string): Promise<void> {
    await this.supabase
      .from('sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

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

  private async ensureAssessmentWorkspaceGenerated(assessmentId: string) {
    const { data: assessmentRow, error } = await this.supabase
      .from('assessments')
      .select(
        [
          'id',
          'workspace_files',
          'workspace_entry_file',
          'workspace_generated_at',
          'generation_status',
          'generation_error',
        ].join(', '),
      )
      .eq('id', assessmentId)
      .single();

    if (error || !assessmentRow) {
      throw new Error(`Assessment ${assessmentId} not found while preparing workspace`);
    }

    const assessment = assessmentRow as unknown as Record<string, unknown>;

    const existingWorkspace = normalizeStoredWorkspace(
      assessment.workspace_files,
      assessment.workspace_entry_file,
      assessment.workspace_generated_at,
    );

    if (Object.keys(existingWorkspace.files).length > 0) {
      return existingWorkspace;
    }

    // Workspace is empty — check generation status
    const generationStatus = assessment.generation_status as string | null;

    if (generationStatus === 'pending' || generationStatus === 'processing') {
      throw new Error('Workspace is still being generated. Please try again shortly.');
    }

    if (generationStatus === 'failed') {
      const generationError = (assessment.generation_error as string) ?? 'Unknown error';
      throw new Error(`Workspace generation failed: ${generationError}`);
    }

    throw new Error('No workspace available for this assessment');
  }

  async reconnectSession(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session || session.status !== 'disconnected') return null;

    const config = loadConfig();
    const now = Date.now();
    const disconnectedAt = session.disconnectedAt?.getTime() ?? 0;
    const elapsed = now - disconnectedAt;

    if (elapsed > config.disconnectGracePeriodMs) {
      await this.abandonSession(sessionId);
      return null;
    }

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
    return rowToSession(data);
  }

  async abandonSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    await this.collectorManager.stopForSession(sessionId);

    if (session.sandboxId) {
      try {
        await this.submissionService.captureSubmission(sessionId);
      } catch (error) {
        this.logger.error(`Error capturing submission for abandoned session ${sessionId}: ${error}`);
      }
    }

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

    if (session.assignmentId) {
      await this.supabase
        .from('assessment_assignments')
        .update({ status: 'expired' })
        .eq('id', session.assignmentId);
    }

    await this.supabase
      .from('profiles')
      .update({ session_ended_reason: 'connection_lost' })
      .eq('id', session.userId);

    await this.logEvent(sessionId, 'abandoned');
  }

  async stopSession(sessionId: string, reason?: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const terminalStatuses: SessionStatus[] = ['stopped', 'error', 'timed_out', 'abandoned'];
    if (terminalStatuses.includes(session.status)) {
      return;
    }

    await this.collectorManager.stopForSession(sessionId);

    if (session.sandboxId) {
      try {
        await this.submissionService.captureSubmission(sessionId);
      } catch (error) {
        this.logger.error(`Error capturing submission for session ${sessionId}: ${error}`);
      }
    }

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

    if (session.assignmentId) {
      await this.supabase
        .from('assessment_assignments')
        .update({
          status: reason === 'timed_out' ? 'expired' : 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', session.assignmentId);
    }

    await this.supabase
      .from('profiles')
      .update({ session_ended_reason: endedReason })
      .eq('id', session.userId);

    await this.logEvent(sessionId, status, { reason });
  }

  async cleanupStaleSessions(): Promise<void> {
    const config = loadConfig();
    const now = Date.now();

    const { data: disconnected } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('status', 'disconnected');

    if (disconnected) {
      for (const row of disconnected) {
        const disconnectedAt = new Date(row.disconnected_at).getTime();
        if (now - disconnectedAt > config.disconnectGracePeriodMs) {
          await this.abandonSession(row.id);
        }
      }
    }

    const { data: staleRunning } = await this.supabase
      .from('sessions')
      .select('*')
      .eq('status', 'running');

    if (staleRunning) {
      for (const row of staleRunning) {
        const lastActivity = new Date(row.last_activity_at).getTime();
        if (now - lastActivity > 60_000) {
          await this.abandonSession(row.id);
        }
      }
    }

    const { data: longRunning } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['running', 'disconnected']);

    if (longRunning) {
      for (const row of longRunning) {
        const createdAt = new Date(row.created_at).getTime();
        if (now - createdAt > config.maxSandboxDurationMs) {
          await this.stopSession(row.id, 'timed_out');
        }
      }
    }
  }

  startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions().catch((error) => {
        this.logger.error(`Stale session cleanup error: ${error}`);
      });
    }, 10_000);
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async stopAllSessions(): Promise<void> {
    const { data: activeSessions } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['starting', 'running', 'disconnected']);

    if (!activeSessions || activeSessions.length === 0) return;

    await Promise.allSettled(activeSessions.map((row) => this.stopSession(row.id)));
  }

  async cleanupOrphanedSessions(): Promise<void> {
    const { data: orphans } = await this.supabase
      .from('sessions')
      .select('*')
      .in('status', ['running', 'disconnected']);

    if (!orphans || orphans.length === 0) return;

    for (const row of orphans) {
      try {
        this.sandboxService.getSandbox(row.sandbox_id);
      } catch {
        await this.supabase
          .from('sessions')
          .update({
            status: 'abandoned',
            stopped_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        if (row.assignment_id) {
          await this.supabase
            .from('assessment_assignments')
            .update({ status: 'expired' })
            .eq('id', row.assignment_id);
        }

        await this.supabase
          .from('profiles')
          .update({ session_ended_reason: 'error' })
          .eq('id', row.user_id);

        await this.logEvent(row.id, 'abandoned', { reason: 'server_restart' });
      }
    }
  }

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
