import dotenv from 'dotenv';
dotenv.config({ override: true });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from '../infra/config/index.js';
import { getSupabaseAdmin } from '../infra/db/supabase.js';
import { SandboxService } from '../external/vercelSandbox/sandbox.js';
import { SessionManager } from '../modules/sessions/sessionManager.js';
import { ActivityCollectorManager } from '../modules/activity/activityCollectorManager.js';
import { sandboxRoutes } from '../modules/sessions/sessionRoutes.js';
import { activityRoutes } from '../modules/activity/activityRoutes.js';
import { assessmentRoutes } from '../modules/assessments/assessmentRoutes.js';
import { GenerationQueue } from '../modules/generation/generationQueue.js';
import { gradingRoutes } from '../modules/grading/gradingRoutes.js';
import { talentRoutes } from '../modules/talent/talentRoutes.js';

const config = loadConfig();
const fastify = Fastify({
  logger: true,
});

const supabaseAdmin = getSupabaseAdmin();
const sandboxService = new SandboxService(fastify.log);
const collectorManager = new ActivityCollectorManager(supabaseAdmin, sandboxService, fastify.log);
const sessionManager = new SessionManager(
  supabaseAdmin,
  sandboxService,
  fastify.log,
  collectorManager,
);
const generationQueue = new GenerationQueue(supabaseAdmin, fastify.log);

// Register CORS (needed for frontend on port 8080 → backend on port 4000)
fastify.register(cors, {
  origin: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
});

// Register sandbox/session routes
fastify.register(sandboxRoutes, { sessionManager, sandboxService });

// Register activity monitoring routes
fastify.register(activityRoutes, { sessionManager });

// Register company/candidate assessment routes
fastify.register(assessmentRoutes, { sessionManager });

// Register AI grading routes
fastify.register(gradingRoutes);

// Register talent discovery routes
fastify.register(talentRoutes);

// Health check
fastify.get('/', async () => {
  return { status: 'ok' };
});

// Start stale session cleanup interval (every 10 seconds)
sessionManager.startCleanupInterval();

// Graceful shutdown: destroy sandboxes and stop collectors
fastify.addHook('onClose', async () => {
  await generationQueue.stop();
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
    generationQueue.start();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
