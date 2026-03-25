import 'dotenv/config';
import { SandboxService, type Logger } from '../app/external/vercelSandbox/sandbox.js';

const logger: Logger = {
  info: (msg: string) => console.log(`[INFO]  ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN]  ${msg}`),
};

async function main() {
  const sandboxService = new SandboxService(logger);

  console.log('=== Create Assessment Snapshot ===\n');
  console.log('Bootstrapping sandbox with:');
  console.log('  - /vercel/sandbox/assessment workspace');
  console.log('  - code-server configured to open that workspace');
  console.log('  - official Codex and Claude Code VSIX extensions installed');
  console.log('');

  const { snapshotId } = await sandboxService.createAssessmentSnapshot();

  console.log(`Snapshot created: ${snapshotId}`);
  console.log('Saved to: .sandbox-snapshot-id');
  console.log('');
  console.log('New sessions will use this snapshot automatically when the backend');
  console.log('starts from the backend directory, or when VERCEL_SANDBOX_SNAPSHOT_ID is set.');
}

main().catch((error) => {
  console.error('\nFailed to create assessment snapshot.');
  console.error(error);
  process.exit(1);
});
