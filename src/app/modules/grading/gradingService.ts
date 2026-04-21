import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

const MODEL = 'claude-sonnet-4-6';

// Max files / prompts to include in the grading context
const MAX_CODE_FILES = 8;
const MAX_FILE_BYTES = 3_000;
const MAX_PROMPTS = 12;
const MAX_PROMPT_CHARS = 600;

export interface GradeDimension {
  score: number;
  summary: string;
  flags: string[];
}

export interface CandidateGrade {
  sessionId: string;
  codeQuality: GradeDimension;
  agentUsage: GradeDimension;
  promptingQuality: GradeDimension;
  industryKnowledge: GradeDimension;
  compositeScore: number;
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
  gradedAt: string;
  modelId: string;
}

export interface StoredGradeRow {
  session_id: string;
  assignment_id: string | null;
  code_quality_score: number;
  agent_usage_score: number;
  prompting_quality_score: number;
  industry_knowledge_score: number;
  composite_score: number;
  recommendation: string;
  feedback: Record<string, unknown>;
  graded_at: string;
  model_id: string;
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

function recommendation(composite: number): CandidateGrade['recommendation'] {
  if (composite >= 90) return 'strong_yes';
  if (composite >= 80) return 'yes';
  if (composite >= 70) return 'maybe';
  if (composite >= 60) return 'no';
  return 'strong_no';
}

function rowToGrade(row: StoredGradeRow): CandidateGrade {
  const fb = row.feedback as {
    codeQuality: GradeDimension;
    agentUsage: GradeDimension;
    promptingQuality: GradeDimension;
    industryKnowledge: GradeDimension;
  };
  return {
    sessionId: row.session_id,
    codeQuality: fb.codeQuality,
    agentUsage: fb.agentUsage,
    promptingQuality: fb.promptingQuality,
    industryKnowledge: fb.industryKnowledge,
    compositeScore: row.composite_score,
    recommendation: row.recommendation as CandidateGrade['recommendation'],
    gradedAt: row.graded_at,
    modelId: row.model_id,
  };
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.c', '.cpp', '.cs', '.swift', '.kt',
  '.sh', '.bash',
]);

function sampleCodeFiles(files: Record<string, string>): string {
  const entries = Object.entries(files)
    .filter(([path]) => {
      const lower = path.toLowerCase();
      return CODE_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.')));
    })
    .slice(0, MAX_CODE_FILES);

  if (entries.length === 0) {
    const fallback = Object.entries(files).slice(0, 3);
    return fallback
      .map(([p, c]) => `### ${p}\n\`\`\`\n${c.slice(0, MAX_FILE_BYTES)}\n\`\`\``)
      .join('\n\n');
  }

  return entries
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, MAX_FILE_BYTES)}\n\`\`\``)
    .join('\n\n');
}

function sampleClaudePrompts(transcripts: Array<{ transcript_jsonl: string }>): string {
  const collected: string[] = [];

  for (const t of transcripts) {
    const lines = (t.transcript_jsonl ?? '').split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const isHuman =
          record.type === 'human' ||
          record.role === 'user' ||
          (Array.isArray(record.content) &&
            (record.content as { type?: string }[]).some((b) => b.type === 'text'));

        if (!isHuman) continue;

        let text = '';
        if (typeof record.content === 'string') {
          text = record.content;
        } else if (Array.isArray(record.content)) {
          text = (record.content as { type?: string; text?: string }[])
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join(' ');
        }

        if (text.trim().length > 10) {
          collected.push(text.slice(0, MAX_PROMPT_CHARS));
          if (collected.length >= MAX_PROMPTS) break;
        }
      } catch {
        // skip malformed lines
      }
    }
    if (collected.length >= MAX_PROMPTS) break;
  }

  if (collected.length === 0) return 'No Claude prompts were recorded for this session.';
  return collected.map((p, i) => `**Prompt ${i + 1}:** ${p}`).join('\n\n');
}

const GRADING_TOOL: Anthropic.Tool = {
  name: 'grade_candidate',
  description: 'Return structured evaluation scores and qualitative feedback for the candidate across 4 dimensions.',
  input_schema: {
    type: 'object' as const,
    required: ['codeQuality', 'agentUsage', 'promptingQuality', 'industryKnowledge'],
    properties: {
      codeQuality: {
        type: 'object' as const,
        description: 'Code Quality & Style — correctness, readability, naming, modularity, anti-patterns.',
        required: ['score', 'summary', 'flags'],
        properties: {
          score: {
            type: 'number' as const,
            description: 'Integer 0–100. 70+ means worth interviewing on this dimension.',
          },
          summary: {
            type: 'string' as const,
            description: '2–3 sentence evaluation. Be specific — cite actual patterns or file names.',
          },
          flags: {
            type: 'array' as const,
            description: 'Up to 5 specific issues or standout behaviors (short phrases).',
            items: { type: 'string' as const },
          },
        },
      },
      agentUsage: {
        type: 'object' as const,
        description: 'Agent Usage — how effectively the candidate delegates to Claude, chains tools, and uses agentic workflows.',
        required: ['score', 'summary', 'flags'],
        properties: {
          score: {
            type: 'number' as const,
            description: 'Integer 0–100. Low if they never used AI or relied on it for trivial tasks only.',
          },
          summary: {
            type: 'string' as const,
            description: '2–3 sentence evaluation. Reference actual prompt count and tool call patterns.',
          },
          flags: {
            type: 'array' as const,
            description: 'Up to 5 specific observations about agent usage (over-reliance, smart delegation, etc.).',
            items: { type: 'string' as const },
          },
        },
      },
      promptingQuality: {
        type: 'object' as const,
        description: 'Prompting Quality — clarity, specificity, and prompt engineering sophistication.',
        required: ['score', 'summary', 'flags'],
        properties: {
          score: {
            type: 'number' as const,
            description: 'Integer 0–100. 0 if no prompts were recorded.',
          },
          summary: {
            type: 'string' as const,
            description: '2–3 sentence evaluation citing actual prompt examples.',
          },
          flags: {
            type: 'array' as const,
            description: 'Up to 5 specific prompt patterns (vague instructions, good decomposition, etc.).',
            items: { type: 'string' as const },
          },
        },
      },
      industryKnowledge: {
        type: 'object' as const,
        description: 'Industry Knowledge — domain understanding, real-world engineering judgment beyond passing tests.',
        required: ['score', 'summary', 'flags'],
        properties: {
          score: {
            type: 'number' as const,
            description: 'Integer 0–100. Look for production-aware patterns, error handling, observability, etc.',
          },
          summary: {
            type: 'string' as const,
            description: '2–3 sentence evaluation citing evidence from submitted code.',
          },
          flags: {
            type: 'array' as const,
            description: 'Up to 5 specific knowledge signals or gaps.',
            items: { type: 'string' as const },
          },
        },
      },
    },
  },
};

export class GradingService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };

  constructor(
    supabase: SupabaseClient,
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
  ) {
    this.supabase = supabase;
    this.anthropic = new Anthropic();
    this.logger = logger;
  }

  /** Returns an existing grade for a session, or null if not yet graded. */
  async getGrade(sessionId: string): Promise<CandidateGrade | null> {
    const { data } = await this.supabase
      .from('candidate_grades')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!data) return null;
    return rowToGrade(data as StoredGradeRow);
  }

  /**
   * Returns an existing grade if one exists, otherwise runs the full evaluation
   * with Claude and persists the result.
   */
  async gradeSession(sessionId: string): Promise<CandidateGrade> {
    const existing = await this.getGrade(sessionId);
    if (existing) return existing;

    // Load submission
    const { data: submission, error: subError } = await this.supabase
      .from('final_submissions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (subError || !submission) {
      throw new Error(`No submission found for session ${sessionId} — cannot grade`);
    }

    // Load session to get assignment_id
    const { data: session } = await this.supabase
      .from('sessions')
      .select('assignment_id')
      .eq('id', sessionId)
      .maybeSingle();

    // Load claude transcripts
    const { data: transcripts } = await this.supabase
      .from('claude_transcripts')
      .select('transcript_jsonl, total_prompts, total_tool_calls')
      .eq('session_id', sessionId);

    // Build context
    const files = (submission.files ?? {}) as Record<string, string>;
    const filesSample = sampleCodeFiles(files);
    const promptSample = sampleClaudePrompts(transcripts ?? []);

    const stats = {
      durationMinutes: Math.round(((submission.session_duration_seconds as number) ?? 0) / 60),
      commandsRun: (submission.total_commands_run as number) ?? 0,
      fileChanges: (submission.total_file_changes as number) ?? 0,
      claudePrompts: (submission.total_claude_prompts as number) ?? 0,
      claudeToolCalls: (submission.total_claude_tool_calls as number) ?? 0,
      fileCount: (submission.file_count as number) ?? 0,
    };

    this.logger.info(`Grading session ${sessionId} (${stats.claudePrompts} prompts, ${stats.fileCount} files)`);

    const dimensions = await this.callGrader(filesSample, promptSample, stats);

    const compositeScore = clamp(
      dimensions.codeQuality.score * 0.4 +
      dimensions.agentUsage.score * 0.2 +
      dimensions.promptingQuality.score * 0.2 +
      dimensions.industryKnowledge.score * 0.2,
    );

    const rec = recommendation(compositeScore);
    const gradedAt = new Date().toISOString();

    const { error: insertError } = await this.supabase.from('candidate_grades').insert({
      session_id: sessionId,
      assignment_id: (session?.assignment_id as string | null) ?? null,
      code_quality_score: dimensions.codeQuality.score,
      agent_usage_score: dimensions.agentUsage.score,
      prompting_quality_score: dimensions.promptingQuality.score,
      industry_knowledge_score: dimensions.industryKnowledge.score,
      composite_score: compositeScore,
      recommendation: rec,
      feedback: dimensions,
      model_id: MODEL,
    });

    if (insertError) {
      throw new Error(`Failed to persist grade: ${insertError.message}`);
    }

    this.logger.info(`Grade persisted for session ${sessionId}: composite=${compositeScore}, rec=${rec}`);

    return {
      sessionId,
      ...dimensions,
      compositeScore,
      recommendation: rec,
      gradedAt,
      modelId: MODEL,
    };
  }

  private async callGrader(
    filesSample: string,
    promptSample: string,
    stats: {
      durationMinutes: number;
      commandsRun: number;
      fileChanges: number;
      claudePrompts: number;
      claudeToolCalls: number;
      fileCount: number;
    },
  ): Promise<{
    codeQuality: GradeDimension;
    agentUsage: GradeDimension;
    promptingQuality: GradeDimension;
    industryKnowledge: GradeDimension;
  }> {
    const userMessage = `## Candidate Submission for Technical Assessment

### Session Statistics
- Duration: ${stats.durationMinutes} minutes
- Terminal commands run: ${stats.commandsRun}
- File changes tracked: ${stats.fileChanges}
- Files submitted: ${stats.fileCount}
- Claude AI prompts sent: ${stats.claudePrompts}
- Claude tool calls made: ${stats.claudeToolCalls}

---

### Code Submitted (representative sample)
${filesSample || 'No code files were detected in the submission.'}

---

### Claude Prompts Used During Session
${promptSample}

---

Evaluate this candidate rigorously. Score each dimension 0–100 where 70+ means this candidate is worth advancing to an interview.
A score below 50 signals a clear reject on that dimension. Be honest and specific — cite actual code patterns or prompts you observed.`;

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: `You are a senior staff engineer and technical recruiter evaluating a candidate's coding assessment.
Your job is to score them across 4 dimensions based on their submitted code, Claude AI prompts, and session activity.
Be rigorous, honest, and evidence-based. A score of 70+ means interview-worthy on that dimension.
Do not be generous — mediocre work should score 50–65.`,
      messages: [{ role: 'user', content: userMessage }],
      tools: [GRADING_TOOL],
      tool_choice: { type: 'tool', name: 'grade_candidate' },
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Grader did not return structured evaluation via tool_use');
    }

    const raw = toolUse.input as {
      codeQuality: { score: number; summary: string; flags: string[] };
      agentUsage: { score: number; summary: string; flags: string[] };
      promptingQuality: { score: number; summary: string; flags: string[] };
      industryKnowledge: { score: number; summary: string; flags: string[] };
    };

    return {
      codeQuality: { ...raw.codeQuality, score: clamp(raw.codeQuality.score) },
      agentUsage: { ...raw.agentUsage, score: clamp(raw.agentUsage.score) },
      promptingQuality: { ...raw.promptingQuality, score: clamp(raw.promptingQuality.score) },
      industryKnowledge: { ...raw.industryKnowledge, score: clamp(raw.industryKnowledge.score) },
    };
  }
}
