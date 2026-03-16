export interface Config {
  vercelToken: string;
  vercelTeamId: string;
  vercelProjectId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  sessionTimeoutMs: number;
  maxSandboxDurationMs: number;
  disconnectGracePeriodMs: number;
  port: number;
}

/**
 * Loads configuration from environment variables with sensible defaults.
 * Expects dotenv to have been loaded before calling this.
 */
export function loadConfig(): Config {
  return {
    vercelToken: process.env.VERCEL_TOKEN ?? '',
    vercelTeamId: process.env.VERCEL_TEAM_ID ?? '',
    vercelProjectId: process.env.VERCEL_PROJECT_ID ?? '',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '1800000', 10),
    maxSandboxDurationMs: parseInt(process.env.MAX_SANDBOX_DURATION_MS ?? '18000000', 10),
    disconnectGracePeriodMs: parseInt(process.env.DISCONNECT_GRACE_PERIOD_MS ?? '60000', 10),
    port: parseInt(process.env.PORT ?? '4000', 10),
  };
}
