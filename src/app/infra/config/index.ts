import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface Config {
  vercelToken: string;
  vercelTeamId: string;
  vercelProjectId: string;
  vercelSandboxSnapshotId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  sessionTimeoutMs: number;
  maxSandboxDurationMs: number;
  disconnectGracePeriodMs: number;
  port: number;
  githubToken: string;
  resendApiKey: string;
  frontendUrl: string;
  emailFrom: string;
}

/**
 * Loads configuration from environment variables with sensible defaults.
 * Expects dotenv to have been loaded before calling this.
 */
export function loadConfig(): Config {
  const snapshotIdFile = resolve(process.cwd(), '.sandbox-snapshot-id');
  const snapshotIdFromFile = existsSync(snapshotIdFile)
    ? readFileSync(snapshotIdFile, 'utf-8').trim()
    : '';

  return {
    vercelToken: process.env.VERCEL_TOKEN ?? '',
    vercelTeamId: process.env.VERCEL_TEAM_ID ?? '',
    vercelProjectId: process.env.VERCEL_PROJECT_ID ?? '',
    vercelSandboxSnapshotId:
      process.env.VERCEL_SANDBOX_SNAPSHOT_ID?.trim() || snapshotIdFromFile,
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '1800000', 10),
    maxSandboxDurationMs: parseInt(process.env.MAX_SANDBOX_DURATION_MS ?? '18000000', 10),
    disconnectGracePeriodMs: parseInt(process.env.DISCONNECT_GRACE_PERIOD_MS ?? '60000', 10),
    port: parseInt(process.env.PORT ?? '4000', 10),
    githubToken: process.env.GITHUB_TOKEN ?? '',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:8080',
    emailFrom: process.env.EMAIL_FROM ?? 'gitty <noreply@gitty.ai>',
  };
}
