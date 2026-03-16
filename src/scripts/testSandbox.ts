import 'dotenv/config';
import { SandboxService, type Logger } from '../services/sandbox.js';

const logger: Logger = {
  info: (msg: string) => console.log(`[INFO]  ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN]  ${msg}`),
};

async function main() {
  const sandboxService = new SandboxService(logger);
  let sandboxId: string | undefined;

  console.log('=== Sandbox Integration Test ===\n');

  try {
    // Step 1: Create sandbox
    console.log('1. Creating sandbox...');
    const result = await sandboxService.createSandbox();
    sandboxId = result.id;
    console.log(`   ✓ Sandbox created: ${sandboxId}\n`);

    // Step 2: Run echo command
    console.log('2. Running: echo "hello world"');
    const echoResult = await sandboxService.runCommand(sandboxId, 'echo', [
      'hello world',
    ]);
    console.log(`   Exit code: ${echoResult.exitCode}`);
    console.log(`   stdout: ${echoResult.stdout}`);
    if (echoResult.stderr) console.log(`   stderr: ${echoResult.stderr}`);
    console.log('   ✓ Command succeeded\n');

    // Step 3: Write a file
    console.log('3. Writing /home/sandbox/test.js...');
    await sandboxService.writeFile(
      sandboxId,
      '/home/sandbox/test.js',
      'console.log("it works")',
    );
    console.log('   ✓ File written\n');

    // Step 4: Read the file back
    console.log('4. Reading /home/sandbox/test.js...');
    const content = await sandboxService.readFile(
      sandboxId,
      '/home/sandbox/test.js',
    );
    console.log(`   Content: ${content}`);
    console.log('   ✓ File read\n');

    // Step 5: Run node on the file
    console.log('5. Running: node /home/sandbox/test.js');
    const nodeResult = await sandboxService.runCommand(sandboxId, 'node', [
      '/home/sandbox/test.js',
    ]);
    console.log(`   Exit code: ${nodeResult.exitCode}`);
    console.log(`   stdout: ${nodeResult.stdout}`);
    if (nodeResult.stderr) console.log(`   stderr: ${nodeResult.stderr}`);
    console.log('   ✓ Script executed\n');

    // Step 6: List directory
    console.log('6. Listing /home/sandbox/...');
    const entries = await sandboxService.listDirectory(
      sandboxId,
      '/home/sandbox/',
    );
    console.log('   Contents:');
    for (const entry of entries) {
      console.log(`     ${entry.type === 'directory' ? '📁' : '📄'} ${entry.name}`);
    }
    console.log('   ✓ Directory listed\n');

    // Step 7: Destroy sandbox
    console.log('7. Destroying sandbox...');
    await sandboxService.destroySandbox(sandboxId);
    sandboxId = undefined;
    console.log('   ✓ Sandbox destroyed\n');

    console.log('=== All tests passed! ===');
  } catch (error) {
    console.error('\n✗ Test failed:', error);

    // Clean up on failure
    if (sandboxId) {
      console.log('\nCleaning up sandbox...');
      try {
        await sandboxService.destroySandbox(sandboxId);
        console.log('Sandbox cleaned up.');
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
      }
    }

    process.exit(1);
  }
}

main();
