import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../../infra/auth/auth.js';
import { getCompanyMembership } from '../../infra/auth/companyAuth.js';
import { getSupabaseAdmin } from '../../infra/db/supabase.js';
import { normalizeEmail } from '../../shared/utils/email.js';

interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  bio: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  location: string | null;
  company: string | null;
  topLanguages: string[];
}

async function buildGitHubQuery(description: string): Promise<string> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: `You convert natural-language engineer descriptions into a single GitHub user search query string.
Output ONLY the query — no explanation, no quotes, no extra text.
Rules:
- Use "language:X" for programming languages (e.g. language:typescript)
- Use "followers:>N" to filter by follower count when seniority is implied (e.g. senior → followers:>50)
- Use "repos:>N" to filter active contributors (default repos:>5)
- Add up to 3 space-separated keyword terms from the description (e.g. react nextjs)
- Never include "type:user" — it is implied
Example: "senior React/TypeScript engineer" → language:typescript react followers:>50 repos:>5`,
    messages: [{ role: 'user', content: description }],
  });

  const text = response.content.find((b) => b.type === 'text');
  return text?.type === 'text' ? text.text.trim() : 'language:typescript repos:>5';
}

async function fetchGitHubUser(login: string, token?: string): Promise<GitHubUser | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const userRes = await fetch(`https://api.github.com/users/${login}`, { headers });
  if (!userRes.ok) return null;

  const user = await userRes.json() as {
    login: string;
    name: string | null;
    email: string | null;
    bio: string | null;
    avatar_url: string;
    html_url: string;
    public_repos: number;
    followers: number;
    location: string | null;
    company: string | null;
  };

  const reposRes = await fetch(
    `https://api.github.com/users/${login}/repos?sort=pushed&per_page=10`,
    { headers },
  );
  const repos = reposRes.ok
    ? (await reposRes.json()) as Array<{ language: string | null }>
    : [];

  const langCounts: Record<string, number> = {};
  for (const repo of repos) {
    if (repo.language) langCounts[repo.language] = (langCounts[repo.language] ?? 0) + 1;
  }
  const topLanguages = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([lang]) => lang);

  return {
    login: user.login,
    name: user.name,
    email: user.email,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    publicRepos: user.public_repos,
    followers: user.followers,
    location: user.location,
    company: user.company,
    topLanguages,
  };
}

export async function talentRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /api/talent/search
   * Converts a natural-language engineer description into a GitHub user search
   * and returns enriched candidate profiles.
   */
  fastify.post<{
    Body: { description: string };
  }>(
    '/api/talent/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description'],
          properties: {
            description: { type: 'string', minLength: 5, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const githubToken = process.env.GITHUB_TOKEN ?? '';

      let searchQuery: string;
      try {
        searchQuery = await buildGitHubQuery(request.body.description);
      } catch {
        return reply.status(502).send({ error: 'Failed to build search query' });
      }

      fastify.log.info(`Talent search query: "${searchQuery}"`);

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

      const searchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(searchQuery)}&per_page=12`;
      const searchRes = await fetch(searchUrl, { headers });

      if (!searchRes.ok) {
        const body = await searchRes.json().catch(() => ({})) as { message?: string };
        return reply.status(502).send({
          error: body.message ?? 'GitHub search failed',
        });
      }

      const searchData = await searchRes.json() as { items: Array<{ login: string }> };
      const logins = (searchData.items ?? []).slice(0, 10).map((u) => u.login);

      const profiles = await Promise.all(
        logins.map((login) => fetchGitHubUser(login, githubToken || undefined)),
      );

      return {
        query: searchQuery,
        candidates: profiles.filter(Boolean) as GitHubUser[],
      };
    },
  );

  /**
   * POST /api/talent/invite
   * Creates assessment assignments for a list of candidates found via GitHub search.
   * Skips addresses already assigned to the given assessment.
   */
  fastify.post<{
    Body: { assessmentId: string; candidates: Array<{ email: string; githubLogin?: string }> };
  }>(
    '/api/talent/invite',
    {
      schema: {
        body: {
          type: 'object',
          required: ['assessmentId', 'candidates'],
          properties: {
            assessmentId: { type: 'string', minLength: 1 },
            candidates: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', minLength: 3 },
                  githubLogin: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();

      const { data: assessment, error: assessmentError } = await supabase
        .from('assessments')
        .select('id, status')
        .eq('id', request.body.assessmentId)
        .eq('company_id', membership.companyId)
        .single();

      if (assessmentError || !assessment) {
        return reply.status(404).send({ error: 'Assessment not found' });
      }

      const normalizedMap = new Map<string, { raw: string; githubLogin?: string }>();
      for (const candidate of request.body.candidates) {
        const trimmed = candidate.email.trim();
        const normalized = normalizeEmail(trimmed);
        if (!normalized.includes('@')) continue;
        if (!normalizedMap.has(normalized)) {
          normalizedMap.set(normalized, { raw: trimmed, githubLogin: candidate.githubLogin });
        }
      }

      const normalizedEmails = Array.from(normalizedMap.keys());
      if (normalizedEmails.length === 0) {
        return reply.status(400).send({ error: 'No valid email addresses provided' });
      }

      const { data: existing } = await supabase
        .from('assessment_assignments')
        .select('candidate_email_normalized')
        .eq('assessment_id', assessment.id)
        .in('candidate_email_normalized', normalizedEmails);

      const existingSet = new Set(
        (existing ?? []).map((row) => row.candidate_email_normalized as string),
      );

      const rows = normalizedEmails
        .filter((email) => !existingSet.has(email))
        .map((email) => {
          const entry = normalizedMap.get(email)!;
          return {
            assessment_id: assessment.id,
            company_id: membership.companyId,
            candidate_email: entry.raw,
            candidate_email_normalized: email,
          };
        });

      if (rows.length > 0) {
        const { error } = await supabase.from('assessment_assignments').insert(rows);
        if (error) {
          return reply.status(500).send({ error: 'Failed to create assignments' });
        }
      }

      return reply.status(201).send({
        created: rows.length,
        skipped: normalizedEmails.filter((email) => existingSet.has(email)),
      });
    },
  );
}
