import type { SupabaseClient } from '@supabase/supabase-js';
import type { SandboxService, Logger } from './sandbox.js';
import { ActivityCollector } from './activityCollector.js';

/**
 * Manages ActivityCollector instances across all active sessions.
 * One collector per session; created when a session starts,
 * torn down when it stops / is abandoned.
 */
export class ActivityCollectorManager {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: Logger;
  private collectors = new Map<string, ActivityCollector>();

  constructor(
    supabase: SupabaseClient,
    sandboxService: SandboxService,
    logger: Logger,
  ) {
    this.supabase = supabase;
    this.sandboxService = sandboxService;
    this.logger = logger;
  }

  /**
   * Creates and starts a new ActivityCollector for the given session.
   */
  startForSession(sessionId: string): void {
    if (this.collectors.has(sessionId)) {
      this.logger.warn(
        `ActivityCollectorManager: collector already exists for session ${sessionId}`,
      );
      return;
    }

    const collector = new ActivityCollector(
      this.supabase,
      this.sandboxService,
      this.logger,
      sessionId,
    );
    collector.startCollecting();
    this.collectors.set(sessionId, collector);

    this.logger.info(
      `ActivityCollectorManager: started collector for session ${sessionId}`,
    );
  }

  /**
   * Stops and removes the collector for the given session.
   * Performs one final collection run before stopping.
   */
  async stopForSession(sessionId: string): Promise<void> {
    const collector = this.collectors.get(sessionId);
    if (!collector) {
      this.logger.warn(
        `ActivityCollectorManager: no collector found for session ${sessionId}`,
      );
      return;
    }

    await collector.stopCollecting();
    this.collectors.delete(sessionId);

    this.logger.info(
      `ActivityCollectorManager: stopped collector for session ${sessionId}`,
    );
  }

  /**
   * Stops all active collectors. Used during graceful shutdown.
   */
  async stopAll(): Promise<void> {
    const sessionIds = Array.from(this.collectors.keys());
    if (sessionIds.length === 0) return;

    this.logger.info(
      `ActivityCollectorManager: stopping all collectors (${sessionIds.length} active)...`,
    );

    await Promise.allSettled(
      sessionIds.map((id) => this.stopForSession(id)),
    );
  }
}
