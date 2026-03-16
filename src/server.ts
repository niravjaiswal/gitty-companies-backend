import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config/index.js';
import { getSupabaseAdmin } from './db/supabase.js';
import { SandboxService } from './services/sandbox.js';
import { SessionManager } from './services/sessionManager.js';
import { ActivityCollectorManager } from './services/activityCollectorManager.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { activityRoutes } from './routes/activity.js';

const config = loadConfig();

const fastify = Fastify({
  logger: true,
});

const supabaseAdmin = getSupabaseAdmin();
const sandboxService = new SandboxService(fastify.log);
const collectorManager = new ActivityCollectorManager(supabaseAdmin, sandboxService, fastify.log);
const sessionManager = new SessionManager(supabaseAdmin, sandboxService, fastify.log, collectorManager);

// Register CORS (needed for frontend on port 8080 → backend on port 4000)
fastify.register(cors, { origin: true });

// Register sandbox/session routes
fastify.register(sandboxRoutes, { sessionManager, sandboxService });

// Register activity monitoring routes
fastify.register(activityRoutes, { sessionManager });

// Health check
fastify.get('/', async () => {
  return { status: 'ok' };
});

// Start stale session cleanup interval (every 10 seconds)
sessionManager.startCleanupInterval();

// Graceful shutdown: destroy sandboxes and stop collectors
fastify.addHook('onClose', async () => {
  sessionManager.stopCleanupInterval();
  await collectorManager.stopAll();
  await sessionManager.stopAllSessions();
});

const shutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down gracefully...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const start = async () => {
  try {
    // Clean up orphaned sessions from previous server instance
    await sessionManager.cleanupOrphanedSessions();

    await fastify.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
