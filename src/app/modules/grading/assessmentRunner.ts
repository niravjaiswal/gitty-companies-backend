import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExecResult, Logger, SandboxService } from '../../external/vercelSandbox/sandbox.js';

export const RUNNER_VERSION = 'runner-v1.0.0';

/** Sandbox layout — kept in sync with SandboxService internals. */
const SANDBOX_ROOT = '/vercel/sandbox';
const STEP_LOG_BYTES = 2_000;

export type BuildStatus = 'pass' | 'fail' | 'error' | 'skipped';

export interface RunnerResult {
  buildStatus: BuildStatus;
  testsPassed: number | null;
  testsTotal: number | null;
  durationMs: number;
  exitCodes: {
    npmCi: number | null;
    tsc: number | null;
    vitest: number | null;
  };
  logsHead: {
    npmCi: string;
    tsc: string;
    vitest: string;
  };
  errorMessage: string | null;
  runnerVersion: string;
  submissionHash: string;
}

/** Persisted row in grading_runner_runs. */
export interface RunnerRunRow {
  id: string;
  session_id: string;
  submission_hash: string;
  runner_version: string;
  build_status: BuildStatus;
  tests_passed: number | null;
  tests_total: number | null;
  duration_ms: number;
  exit_codes: Record<string, unknown>;
  logs_head: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
}

/**
 * Stable, order-independent hash of submission files.
 * Two submissions with identical file content + paths produce the same hash
 * regardless of insertion order.
 */
/**
 * Length-prefixed concatenation guarantees that no pair of (path, content)
 * tuples is ambiguous (e.g. "ab"/"c" vs "a"/"bc"). Stays ASCII so git treats
 * the file as text rather than binary.
 */
export function hashSubmission(files: Record<string, string>): string {
  const hasher = createHash('sha256');
  for (const path of Object.keys(files).sort()) {
    const content = files[path];
    hasher.update(`${path.length}:${path}|${content.length}:${content}|`);
  }
  return hasher.digest('hex');
}

/**
 * Parses vitest JSON reporter output. Returns null counts if the output
 * cannot be parsed — caller treats that as no-test-signal.
 */
export function parseVitestJson(stdout: string): { passed: number; total: number } | null {
  // Vitest writes JSON to stdout; sometimes preceded by a header line or
  // followed by trailing whitespace. Find the first { and parse from there.
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  let raw = stdout.slice(start);

  // Strip trailing non-JSON noise after the last closing brace
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace < 0) return null;
  raw = raw.slice(0, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const total = typeof obj.numTotalTests === 'number' ? obj.numTotalTests : null;
  const passed = typeof obj.numPassedTests === 'number' ? obj.numPassedTests : null;

  if (total === null || passed === null) return null;
  return { passed, total };
}

function truncate(value: string, max = STEP_LOG_BYTES): string {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

function combineExec(result: ExecResult): string {
  const parts: string[] = [];
  if (result.stdout?.trim()) parts.push(result.stdout);
  if (result.stderr?.trim()) parts.push(result.stderr);
  return truncate(parts.join('\n'));
}

/** Whether a file path looks like a valid Node project root marker. */
function hasPackageJson(files: Record<string, string>): boolean {
  return Object.prototype.hasOwnProperty.call(files, 'package.json');
}

function hasTsConfig(files: Record<string, string>): boolean {
  return Object.keys(files).some((p) => p === 'tsconfig.json' || p.endsWith('/tsconfig.json'));
}

function hasTestScript(files: Record<string, string>): boolean {
  const pkg = files['package.json'];
  if (!pkg) return false;
  try {
    const parsed = JSON.parse(pkg) as { scripts?: Record<string, string> };
    return Boolean(parsed.scripts?.test);
  } catch {
    return false;
  }
}

/**
 * Normalizes a submission file path into a safe absolute sandbox path.
 * Returns null for any path that would escape the project root.
 */
function safeSandboxPath(relativePath: string): string | null {
  const normalized = posix.normalize(relativePath).replace(/^(\.\/)+/, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized.startsWith('../')
  ) {
    return null;
  }
  return posix.join(SANDBOX_ROOT, normalized);
}

export interface AssessmentRunnerDeps {
  supabase: SupabaseClient;
  sandboxService: SandboxService;
  logger: Logger;
  /** Optional pre-built snapshot for faster sandbox bootstrap (skips code-server install). */
  runnerSnapshotId?: string;
}

/**
 * Runs deterministic correctness checks on a candidate's submitted files.
 *
 * Spins up an isolated sandbox, seeds the files, runs npm ci / tsc / vitest,
 * captures structured results, and persists an audit row. Cached by submission
 * hash so re-grading the same submission does not re-execute.
 */
export class AssessmentRunner {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: Logger;
  private runnerSnapshotId: string | undefined;

  constructor(deps: AssessmentRunnerDeps) {
    this.supabase = deps.supabase;
    this.sandboxService = deps.sandboxService;
    this.logger = deps.logger;
    this.runnerSnapshotId = deps.runnerSnapshotId;
  }

  /**
   * Returns the cached RunnerRunRow for a given submission hash, if any.
   * Used to short-circuit a re-grade when the candidate hasn't changed code.
   */
  async findCachedRun(sessionId: string, submissionHash: string): Promise<RunnerRunRow | null> {
    const { data } = await this.supabase
      .from('grading_runner_runs')
      .select('*')
      .eq('session_id', sessionId)
      .eq('submission_hash', submissionHash)
      .eq('runner_version', RUNNER_VERSION)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as RunnerRunRow | null) ?? null;
  }

  /** Run the full pipeline. Persists a grading_runner_runs row and returns the result. */
  async run(sessionId: string, files: Record<string, string>): Promise<{ result: RunnerResult; runId: string }> {
    const submissionHash = hashSubmission(files);

    const cached = await this.findCachedRun(sessionId, submissionHash);
    if (cached) {
      this.logger.info(
        `[runner] Cache hit for session ${sessionId} (hash ${submissionHash.slice(0, 8)}…)`,
      );
      return { result: this.rowToResult(cached), runId: cached.id };
    }

    if (!hasPackageJson(files)) {
      this.logger.info(`[runner] Submission has no package.json — marking skipped (session ${sessionId})`);
      return this.persist(sessionId, submissionHash, {
        buildStatus: 'skipped',
        testsPassed: null,
        testsTotal: null,
        durationMs: 0,
        exitCodes: { npmCi: null, tsc: null, vitest: null },
        logsHead: { npmCi: '', tsc: '', vitest: '' },
        errorMessage: 'submission has no package.json',
        runnerVersion: RUNNER_VERSION,
        submissionHash,
      });
    }

    const startedAt = Date.now();
    const result = await this.executeInSandbox(sessionId, files, submissionHash, startedAt).catch(
      (err): RunnerResult => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[runner] Sandbox execution failed for session ${sessionId}: ${message}`);
        return {
          buildStatus: 'error',
          testsPassed: null,
          testsTotal: null,
          durationMs: Date.now() - startedAt,
          exitCodes: { npmCi: null, tsc: null, vitest: null },
          logsHead: { npmCi: '', tsc: '', vitest: '' },
          errorMessage: message.slice(0, 1000),
          runnerVersion: RUNNER_VERSION,
          submissionHash,
        };
      },
    );

    return this.persist(sessionId, submissionHash, result);
  }

  /** Spin up sandbox, seed files, run the three steps, tear down. */
  private async executeInSandbox(
    sessionId: string,
    files: Record<string, string>,
    submissionHash: string,
    startedAt: number,
  ): Promise<RunnerResult> {
    const { id: sandboxId } = await this.sandboxService.createSandbox({
      ports: [9090],
      snapshotId: this.runnerSnapshotId,
    });

    this.logger.info(`[runner] Created sandbox ${sandboxId} for session ${sessionId}`);

    try {
      await this.seedFiles(sandboxId, files);

      // Prefer `npm ci` when a lockfile is present; otherwise fall back to
      // `npm install`. `ci` requires package-lock.json and would fail
      // unfairly against candidates who never ran install during the session.
      const installArgs = files['package-lock.json']
        ? ['ci', '--no-audit', '--no-fund']
        : ['install', '--no-audit', '--no-fund'];
      const npmCi = await this.runCommand(sandboxId, 'npm', installArgs).catch(
        (err): ExecResult => ({ exitCode: 1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }),
      );

      if (npmCi.exitCode !== 0) {
        // npm install / npm ci failed — build status is 'fail'.
        return {
          buildStatus: 'fail',
          testsPassed: null,
          testsTotal: null,
          durationMs: Date.now() - startedAt,
          exitCodes: { npmCi: npmCi.exitCode, tsc: null, vitest: null },
          logsHead: { npmCi: combineExec(npmCi), tsc: '', vitest: '' },
          errorMessage: null,
          runnerVersion: RUNNER_VERSION,
          submissionHash,
        };
      }

      // Only run tsc if there's a tsconfig.json — JS-only projects shouldn't be penalized.
      let tsc: ExecResult | null = null;
      if (hasTsConfig(files)) {
        // Invoke the locally-installed tsc binary directly — `npx` adds resolution
        // overhead and can fail in offline sandboxes.
        tsc = await this.runCommand(
          sandboxId,
          './node_modules/.bin/tsc',
          ['--noEmit', '--pretty', 'false'],
        ).catch((err): ExecResult => ({ exitCode: 1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }));

        if (tsc.exitCode !== 0) {
          return {
            buildStatus: 'fail',
            testsPassed: null,
            testsTotal: null,
            durationMs: Date.now() - startedAt,
            exitCodes: { npmCi: 0, tsc: tsc.exitCode, vitest: null },
            logsHead: { npmCi: combineExec(npmCi), tsc: combineExec(tsc), vitest: '' },
            errorMessage: null,
            runnerVersion: RUNNER_VERSION,
            submissionHash,
          };
        }
      }

      // Run tests only if a test script is configured. Empty test script = no signal.
      let vitest: ExecResult | null = null;
      let testCounts: { passed: number; total: number } | null = null;
      if (hasTestScript(files)) {
        vitest = await this.runCommand(
          sandboxId,
          'npm',
          ['test', '--silent', '--', '--reporter=json'],
        ).catch((err): ExecResult => ({ exitCode: 1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }));
        testCounts = parseVitestJson(vitest.stdout);
      }

      return {
        buildStatus: 'pass',
        testsPassed: testCounts?.passed ?? null,
        testsTotal: testCounts?.total ?? null,
        durationMs: Date.now() - startedAt,
        exitCodes: {
          npmCi: 0,
          tsc: tsc ? tsc.exitCode : null,
          vitest: vitest ? vitest.exitCode : null,
        },
        logsHead: {
          npmCi: combineExec(npmCi),
          tsc: tsc ? combineExec(tsc) : '',
          vitest: vitest ? combineExec(vitest) : '',
        },
        errorMessage: null,
        runnerVersion: RUNNER_VERSION,
        submissionHash,
      };
    } finally {
      await this.sandboxService.destroySandbox(sandboxId).catch((err) => {
        this.logger.warn(`[runner] Failed to destroy sandbox ${sandboxId}: ${err}`);
      });
    }
  }

  /**
   * Writes submission files into the sandbox root via the SDK's batch writeFiles.
   * Filters paths that would escape the root.
   */
  private async seedFiles(sandboxId: string, files: Record<string, string>): Promise<void> {
    const sandbox = this.sandboxService.getSandbox(sandboxId);
    const entries: Array<{ path: string; content: Buffer<ArrayBufferLike> }> = [];

    for (const [relativePath, content] of Object.entries(files)) {
      const target = safeSandboxPath(relativePath);
      if (!target) continue;
      entries.push({ path: target, content: Buffer.from(content, 'utf-8') });
    }

    if (entries.length === 0) {
      throw new Error('no valid files to seed in sandbox');
    }

    const parentDirs = Array.from(
      new Set(entries.map((e) => posix.dirname(e.path)).filter((d) => d !== SANDBOX_ROOT)),
    );
    if (parentDirs.length > 0) {
      await this.sandboxService.runCommand(sandboxId, 'mkdir', ['-p', ...parentDirs]);
    }
    await sandbox.writeFiles(entries);
    this.logger.info(`[runner] Seeded ${entries.length} files into sandbox ${sandboxId}`);
  }

  private async runCommand(sandboxId: string, cmd: string, args: string[]): Promise<ExecResult> {
    return this.sandboxService.runCommand(sandboxId, cmd, args);
  }

  /** Inserts a grading_runner_runs row and returns the result + new id. */
  private async persist(
    sessionId: string,
    submissionHash: string,
    result: RunnerResult,
  ): Promise<{ result: RunnerResult; runId: string }> {
    const { data, error } = await this.supabase
      .from('grading_runner_runs')
      .insert({
        session_id: sessionId,
        submission_hash: submissionHash,
        runner_version: result.runnerVersion,
        build_status: result.buildStatus,
        tests_passed: result.testsPassed,
        tests_total: result.testsTotal,
        duration_ms: result.durationMs,
        exit_codes: result.exitCodes,
        logs_head: result.logsHead,
        error_message: result.errorMessage,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to persist runner run: ${error?.message ?? 'no row returned'}`);
    }

    return { result, runId: data.id as string };
  }

  private rowToResult(row: RunnerRunRow): RunnerResult {
    const exit = row.exit_codes as { npmCi?: number | null; tsc?: number | null; vitest?: number | null };
    const logs = row.logs_head as { npmCi?: string; tsc?: string; vitest?: string };
    return {
      buildStatus: row.build_status,
      testsPassed: row.tests_passed,
      testsTotal: row.tests_total,
      durationMs: row.duration_ms,
      exitCodes: {
        npmCi: exit?.npmCi ?? null,
        tsc: exit?.tsc ?? null,
        vitest: exit?.vitest ?? null,
      },
      logsHead: {
        npmCi: logs?.npmCi ?? '',
        tsc: logs?.tsc ?? '',
        vitest: logs?.vitest ?? '',
      },
      errorMessage: row.error_message,
      runnerVersion: row.runner_version,
      submissionHash: row.submission_hash,
    };
  }
}
