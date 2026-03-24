import type { SupabaseClient } from '@supabase/supabase-js';
import type { SandboxService, Logger } from './sandbox.js';

const SANDBOX_ROOT = '/vercel/sandbox';

/** File extensions to skip (binary / generated) */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.wasm', '.lock',
  '.woff', '.woff2', '.ttf', '.eot', '.map', '.min.js', '.min.css',
  '.so', '.dylib', '.exe', '.bin', '.zip', '.tar', '.gz', '.pdf',
]);

/** Max file size in bytes (1 MB) */
const MAX_FILE_SIZE = 1_048_576;

/**
 * Captures the final submission for a session by reading all sandbox files
 * and aggregating activity stats from the database.
 */
export class SubmissionService {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: Logger;

  constructor(supabase: SupabaseClient, sandboxService: SandboxService, logger: Logger) {
    this.supabase = supabase;
    this.sandboxService = sandboxService;
    this.logger = logger;
  }

  /**
   * Captures the final submission for a session.
   * Reads all sandbox files, gathers activity stats, and inserts into final_submissions.
   */
  async captureSubmission(sessionId: string): Promise<void> {
    // 1. Get session from DB
    const { data: session, error: sessionError } = await this.supabase
      .from('sessions')
      .select('id, sandbox_id, user_id, created_at, total_disconnections')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const sandboxId = session.sandbox_id as string;
    const userId = session.user_id as string;
    const createdAt = new Date(session.created_at as string);
    const totalDisconnections = (session.total_disconnections as number) ?? 0;

    // 2. Collect Claude transcripts (non-blocking)
    let claudeTranscripts: Array<{ claudeSessionId: string; content: string }> = [];
    try {
      claudeTranscripts = await this.sandboxService.collectClaudeTranscripts(sandboxId);
    } catch (error) {
      this.logger.warn(`Failed to collect Claude transcripts for session ${sessionId}: ${error}`);
    }

    // 3. Read all files from the sandbox
    const files = await this.collectFiles(sandboxId);

    // Calculate summary stats
    let totalBytes = 0;
    const fileCount = Object.keys(files).length;
    for (const content of Object.values(files)) {
      totalBytes += Buffer.byteLength(content as string, 'utf-8');
    }

    // 4. Query session_activity for counts
    const { count: commandCount } = await this.supabase
      .from('session_activity')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('event_type', 'command_run');

    const { count: fileChangeCount } = await this.supabase
      .from('session_activity')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .in('event_type', ['file_create', 'file_modify', 'file_delete', 'file_move']);

    // 5. Parse Claude transcript stats & insert transcripts
    let transcriptPrompts = 0;
    let transcriptToolCalls = 0;

    for (const transcript of claudeTranscripts) {
      let prompts = 0;
      let toolCalls = 0;
      let tokensIn = 0;
      let tokensOut = 0;

      const lines = transcript.content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record.type === 'human' || record.role === 'user') prompts++;
          if (record.type === 'tool_result' || record.type === 'tool_use') toolCalls++;
          if (record.usage) {
            tokensIn += record.usage.input_tokens ?? 0;
            tokensOut += record.usage.output_tokens ?? 0;
          }
        } catch {
          // Skip malformed lines
        }
      }

      transcriptPrompts += prompts;
      transcriptToolCalls += toolCalls;

      try {
        await this.supabase.from('claude_transcripts').insert({
          session_id: sessionId,
          claude_session_id: transcript.claudeSessionId,
          transcript_jsonl: transcript.content,
          total_prompts: prompts,
          total_tool_calls: toolCalls,
          total_tokens_in: tokensIn,
          total_tokens_out: tokensOut,
        });
      } catch (err) {
        this.logger.warn(`Failed to insert Claude transcript ${transcript.claudeSessionId}: ${err}`);
      }
    }

    // 6. Query activity-based Claude counts for comparison
    const { count: activityClaudePrompts } = await this.supabase
      .from('session_activity')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('event_type', 'claude_prompt');

    const { count: activityClaudeToolCalls } = await this.supabase
      .from('session_activity')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('event_type', 'claude_tool_use');

    const totalClaudePrompts = Math.max(transcriptPrompts, activityClaudePrompts ?? 0);
    const totalClaudeToolCalls = Math.max(transcriptToolCalls, activityClaudeToolCalls ?? 0);

    // 7. Calculate session duration
    const durationSeconds = Math.round((Date.now() - createdAt.getTime()) / 1000);

    // 8. Insert into final_submissions
    const { error: insertError } = await this.supabase
      .from('final_submissions')
      .insert({
        session_id: sessionId,
        user_id: userId,
        files,
        file_count: fileCount,
        total_bytes: totalBytes,
        total_commands_run: commandCount ?? 0,
        total_file_changes: fileChangeCount ?? 0,
        session_duration_seconds: durationSeconds,
        total_disconnections: totalDisconnections,
        total_claude_prompts: totalClaudePrompts,
        total_claude_tool_calls: totalClaudeToolCalls,
      });

    if (insertError) {
      throw new Error(`Failed to insert submission for session ${sessionId}: ${insertError.message}`);
    }

    this.logger.info(
      `Submission captured for session ${sessionId}: ${fileCount} files, ${totalBytes} bytes, ${commandCount ?? 0} commands, ${fileChangeCount ?? 0} file changes, ${totalClaudePrompts} claude prompts, ${totalClaudeToolCalls} claude tool calls`,
    );
  }

  /**
   * Collects all files from the sandbox, excluding directories and binary files.
   * Returns a record mapping relative paths to file contents.
   */
  private async collectFiles(sandboxId: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    // Use find to list all files, excluding common non-source directories
    const findResult = await this.sandboxService.runCommand(sandboxId, 'find', [
      SANDBOX_ROOT,
      '-type', 'f',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.cache/*',
      '-not', '-path', '*/__pycache__/*',
      '-not', '-path', '*/.next/*',
      '-not', '-path', '*/dist/*',
      '-not', '-path', '*/build/*',
    ]);

    if (findResult.exitCode !== 0) {
      this.logger.warn(`find command failed in sandbox ${sandboxId}: ${findResult.stderr}`);
      return files;
    }

    const filePaths = findResult.stdout
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const absolutePath of filePaths) {
      // Check binary extension
      if (this.isBinaryFile(absolutePath)) {
        continue;
      }

      // Read file content
      try {
        const content = await this.sandboxService.readFile(sandboxId, absolutePath);

        // Skip files over 1MB
        if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
          this.logger.info(`Skipping large file (>1MB): ${absolutePath}`);
          continue;
        }

        // Store with relative path
        const relativePath = absolutePath.startsWith(SANDBOX_ROOT + '/')
          ? absolutePath.slice(SANDBOX_ROOT.length + 1)
          : absolutePath;

        files[relativePath] = content;
      } catch (err) {
        this.logger.warn(`Failed to read file ${absolutePath} in sandbox ${sandboxId}: ${err}`);
      }
    }

    return files;
  }

  /**
   * Checks if a file path has a binary extension that should be skipped.
   */
  private isBinaryFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    for (const ext of BINARY_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        return true;
      }
    }
    return false;
  }
}
