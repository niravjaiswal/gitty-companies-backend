import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config/index.js';

let _supabaseAdmin: SupabaseClient | null = null;

/**
 * Returns the service-role Supabase client (bypasses RLS).
 * Used for all backend operations.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const config = loadConfig();
    _supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _supabaseAdmin;
}

/**
 * Creates a Supabase client scoped to a user's JWT.
 * Used only for token verification — not for data queries (use supabaseAdmin for those).
 */
export function createSupabaseClient(token: string): SupabaseClient {
  const config = loadConfig();
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}
