import { getSupabaseAdmin } from '../db/supabase.js';
import type { AuthUser } from './auth.js';

export interface WsAuthResult {
  user: AuthUser;
  session: {
    id: string;
    user_id: string;
    sandbox_id: string;
    status: string;
  };
}

/**
 * Authenticates a WebSocket connection using a query-param JWT token.
 * Also validates the user owns the requested session.
 *
 * @param token - The JWT from ?token= query param
 * @param sessionId - The session ID from the URL path
 * @returns The authenticated user and session, or null on failure with an error message
 */
export async function authenticateWs(
  token: string | undefined,
  sessionId: string,
): Promise<{ result: WsAuthResult } | { error: string; code: number }> {
  if (!token) {
    return { error: 'Missing token query parameter', code: 4401 };
  }

  const supabase = getSupabaseAdmin();

  // Validate the JWT
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { error: 'Invalid or expired token', code: 4401 };
  }

  const user: AuthUser = {
    id: authData.user.id,
    email: authData.user.email ?? '',
  };

  // Validate user owns the session
  const { data: sessionData, error: sessionError } = await supabase
    .from('sessions')
    .select('id, user_id, sandbox_id, status')
    .eq('id', sessionId)
    .single();

  if (sessionError || !sessionData) {
    return { error: 'Session not found', code: 4404 };
  }

  if (sessionData.user_id !== user.id) {
    return { error: 'Not authorized for this session', code: 4403 };
  }

  return {
    result: {
      user,
      session: sessionData,
    },
  };
}
