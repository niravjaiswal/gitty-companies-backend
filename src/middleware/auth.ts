import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase.js';

/** Shape attached to request.user after authentication */
export interface AuthUser {
  id: string;
  email: string;
}

/** Augment FastifyRequest with the authenticated user */
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

/**
 * Fastify preHandler hook that validates a Bearer token via Supabase Auth.
 * Attaches `request.user = { id, email }` on success, returns 401 on failure.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? '',
  };
}
