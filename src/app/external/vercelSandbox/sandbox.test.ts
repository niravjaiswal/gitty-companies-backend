import { describe, expect, it, vi } from 'vitest';
import { SandboxService, type Logger } from './sandbox.js';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('SandboxService.collectClaudeTranscripts', () => {
  it('discovers direct Claude Code project JSONL files and subagent JSONL files', async () => {
    const service = new SandboxService(createLogger());
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: vi.fn().mockResolvedValue('/home/vc\n'),
      })
      .mockResolvedValueOnce({
        stdout: vi.fn().mockResolvedValue([
          '/home/vc/.claude/projects/-vercel-sandbox-assessment/session-1.jsonl',
          '/home/vc/.claude/projects/-vercel-sandbox-assessment/session-1/subagents/agent-a.jsonl',
        ].join('\n')),
      });
    const readFileToBuffer = vi.fn()
      .mockResolvedValueOnce(Buffer.from('{"type":"user"}\n'))
      .mockResolvedValueOnce(Buffer.from('{"type":"assistant"}\n'));

    (service as unknown as { activeSandboxes: Map<string, unknown> })
      .activeSandboxes
      .set('sandbox-1', { runCommand, readFileToBuffer });

    const transcripts = await service.collectClaudeTranscripts('sandbox-1');

    expect(runCommand).toHaveBeenNthCalledWith(2, 'bash', [
      '-c',
      'find "/home/vc/.claude/projects" -type f -name \'*.jsonl\' 2>/dev/null || true',
    ]);
    expect(transcripts).toEqual([
      { claudeSessionId: 'session-1', content: '{"type":"user"}\n' },
      { claudeSessionId: 'agent-a', content: '{"type":"assistant"}\n' },
    ]);
  });
});

describe('SandboxService.deployClaudeHooks', () => {
  it('clears stale Claude project transcripts before a new session starts', async () => {
    const service = new SandboxService(createLogger());
    const runCommand = vi.fn().mockResolvedValue({
      stdout: vi.fn().mockResolvedValue('/home/vc\n'),
    });
    const writeFiles = vi.fn().mockResolvedValue(undefined);

    (service as unknown as { activeSandboxes: Map<string, unknown> })
      .activeSandboxes
      .set('sandbox-1', { runCommand, writeFiles });

    await service.deployClaudeHooks('sandbox-1');

    expect(runCommand).toHaveBeenCalledWith('rm', [
      '-rf',
      '/home/vc/.claude/projects',
    ]);
  });
});
