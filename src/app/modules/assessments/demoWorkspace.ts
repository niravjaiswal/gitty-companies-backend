import type { StoredAssessmentWorkspace } from './assessmentWorkspace.js';

const DEMO_TITLE = 'Pulseboard Launch Sprint';
const DEMO_SUMMARY =
  'A polished React + TypeScript assessment built as a real Vite app with a missing task composer feature for the candidate to finish.';

const DEMO_INSTRUCTIONS = `# Pulseboard Launch Sprint

## Overview

You are stepping into Pulseboard, a launch-readiness dashboard used by product, design, and engineering to coordinate a release window.

The repo is already scaffolded as a normal React + TypeScript + Vite app. Your job is to finish a real product feature, not to bootstrap a project from scratch.

## Core task

Build the missing "Add launch task" workflow into the dashboard.

Right now the UI has a task composer, but submitting it does not add anything into the checklist.

You should:

- make the composer create a real task in the launch list
- validate required fields before submission
- clear the form after a successful add
- make sure the new task is immediately searchable and filterable
- keep the current styling and layout intact

## Candidate workflow

- Explore the codebase and understand how state flows through the dashboard.
- Run the app locally in the sandbox.
- Run the tests to verify current behavior.
- Implement the missing feature and leave the tests passing.
- Submit the assessment from the top-right submit action when finished.

## Sandbox commands

\`\`\`bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
\`\`\`

## Product context

- The left rail summarizes launch momentum.
- The hero section tracks release confidence and launch score.
- The checklist is where teams drive the ship date forward.
- The composer is intentionally incomplete and is the main assessment task.
- The activity feed gives hiring teams something concrete to review on submission.

## Submission

- Keep the repo runnable.
- Keep the tests green.
- Use the in-product submit button when you are done.`;

function buildAppTsx(title: string): string {
  return `import { useMemo, useState } from 'react';
import './styles.css';
import { LaunchComposer } from './components/LaunchComposer';
import { LaunchTaskList } from './components/LaunchTaskList';
import { MetricGrid } from './components/MetricGrid';
import { SidebarSummary } from './components/SidebarSummary';
import { TimelineFeed } from './components/TimelineFeed';
import { activityFeed, initialLaunchTasks, releaseStats } from './data';

export type LaunchStatus = 'ready' | 'watch' | 'blocked';

export interface LaunchTask {
  id: number;
  title: string;
  owner: string;
  lane: string;
  status: LaunchStatus;
}

function statusLabel(status: LaunchStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'watch':
      return 'Watch';
    case 'blocked':
      return 'Blocked';
  }
}

export default function App() {
  const [tasks, setTasks] = useState(initialLaunchTasks);
  const [filter, setFilter] = useState<'all' | LaunchStatus>('all');
  const [query, setQuery] = useState('');
  const [composerError, setComposerError] = useState('');

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesFilter = filter === 'all' ? true : task.status === filter;
      const haystack = [task.title, task.owner, task.lane].join(' ').toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [tasks, filter, query]);

  const readyCount = tasks.filter((task) => task.status === 'ready').length;
  const launchPercent = Math.round((readyCount / tasks.length) * 100);

  function handleAddTask(input: { title: string; owner: string; lane: string; status: LaunchStatus }) {
    if (!input.title || !input.owner || !input.lane) {
      setComposerError('Title, owner, and lane are required.');
      return false;
    }

    setComposerError('');

    // TODO: replace this stub with real task creation.
    // The assessment expects new tasks to appear in the list and participate in search + filtering.
    console.info('Pending task creation', input);
    return true;
  }

  return (
    <div className="shell">
      <SidebarSummary
        title="${title}"
        launchPercent={launchPercent}
        readyCount={readyCount}
        totalCount={tasks.length}
      />

      <main className="workspace">
        <section className="hero">
          <div>
            <p className="eyebrow">Release Control</p>
            <h2>Keep the launch train on schedule.</h2>
            <p>
              The candidate lands in a realistic dashboard and implements a missing product feature inside a normal React codebase.
            </p>
          </div>
          <MetricGrid stats={releaseStats} />
        </section>

        <section className="panel-row">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Checklist</p>
                <h3>Launch workstream</h3>
              </div>
              <div className="toolbar">
                <input
                  aria-label="Search tasks"
                  className="search"
                  placeholder="Search owner, lane, or task"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  aria-label="Filter tasks"
                  className="select"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as 'all' | LaunchStatus)}
                >
                  <option value="all">All statuses</option>
                  <option value="ready">Ready</option>
                  <option value="watch">Watch</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
            </div>

            <LaunchComposer onAddTask={handleAddTask} errorMessage={composerError} />
            <LaunchTaskList tasks={filteredTasks} getStatusLabel={statusLabel} />
          </section>

          <section className="panel activity-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Activity</p>
                <h3>Recent shifts</h3>
              </div>
            </div>

            <TimelineFeed items={activityFeed} />
          </section>
        </section>
      </main>
    </div>
  );
}
`;
}

const DEMO_STYLES = `:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #f5f7fb;
  background:
    radial-gradient(circle at top left, rgba(30, 144, 255, 0.24), transparent 26%),
    radial-gradient(circle at top right, rgba(247, 147, 30, 0.28), transparent 22%),
    linear-gradient(180deg, #07111f 0%, #091725 48%, #050b14 100%);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
select {
  font: inherit;
}

#root {
  min-height: 100vh;
}

.shell {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 2rem;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(5, 8, 16, 0.74), rgba(5, 8, 16, 0.4));
  backdrop-filter: blur(28px);
}

.sidebar h1,
.hero h2,
.panel h3 {
  margin: 0;
  font-family: "Sora", Inter, sans-serif;
  letter-spacing: -0.04em;
}

.sidebar h1 {
  margin-top: 0.5rem;
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 0.95;
}

.eyebrow {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgba(165, 199, 255, 0.74);
}

.lede {
  margin-top: 1rem;
  color: rgba(237, 242, 255, 0.74);
  line-height: 1.7;
}

.sidebar-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1.35rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.2);
}

.sidebar-card span,
.metric-card span {
  display: block;
  color: rgba(220, 228, 247, 0.66);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.sidebar-card strong,
.metric-card strong {
  display: block;
  margin-top: 0.55rem;
  font-size: 2rem;
  font-weight: 700;
}

.sidebar-card p,
.metric-card p,
.hero p,
.task-meta,
.timeline-detail,
.empty-state,
.field span,
.composer-error {
  color: rgba(228, 235, 248, 0.7);
  line-height: 1.6;
}

.sidebar-card code {
  display: block;
  margin-top: 0.65rem;
  padding: 0.7rem 0.85rem;
  border-radius: 0.9rem;
  background: rgba(7, 12, 22, 0.7);
  font-size: 0.82rem;
  color: #dff1ff;
}

.sidebar-card.muted {
  background: rgba(12, 22, 35, 0.56);
}

.workspace {
  padding: 2rem;
}

.hero,
.panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1.6rem;
  background: rgba(8, 13, 24, 0.62);
  backdrop-filter: blur(24px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 1.5rem;
  padding: 1.6rem;
}

.hero h2 {
  margin-top: 0.55rem;
  font-size: clamp(2rem, 4vw, 3.25rem);
}

.hero p {
  max-width: 46rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.metric-card {
  border-radius: 1.2rem;
  padding: 1rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03));
}

.panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.8fr);
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.panel {
  padding: 1.35rem;
}

.panel-header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.toolbar {
  display: flex;
  gap: 0.75rem;
}

.search,
.select,
.field input,
.field select {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 0.75rem 1rem;
}

.search {
  min-width: 260px;
}

.composer {
  margin-top: 1.2rem;
  padding: 1rem;
  border-radius: 1.2rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.composer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field span {
  font-size: 0.8rem;
}

.primary-button {
  margin-top: 1rem;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff8b3d, #ff5f1f);
  color: white;
  padding: 0.8rem 1.2rem;
  font-weight: 700;
  cursor: pointer;
}

.composer-error {
  margin: 0.75rem 0 0;
  color: #ffb7b7;
}

.task-list,
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-top: 1.25rem;
}

.task-card,
.timeline-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1.1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.task-title,
.timeline-title {
  margin: 0;
  font-weight: 600;
}

.task-meta,
.timeline-detail {
  margin: 0.25rem 0 0;
  font-size: 0.94rem;
}

.timeline-item {
  align-items: flex-start;
}

.timeline-time {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 4rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(96, 160, 255, 0.14);
  color: #bfd8ff;
  font-weight: 600;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.48rem 0.78rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.status-ready {
  background: rgba(31, 192, 125, 0.16);
  color: #7df0bd;
}

.status-watch {
  background: rgba(255, 186, 73, 0.16);
  color: #ffd48b;
}

.status-blocked {
  background: rgba(255, 97, 97, 0.16);
  color: #ffacac;
}

.empty-state {
  padding: 1.4rem;
  text-align: center;
  border-radius: 1rem;
  border: 1px dashed rgba(255, 255, 255, 0.12);
}

@media (max-width: 1080px) {
  .shell,
  .hero,
  .panel-row {
    grid-template-columns: 1fr;
  }

  .hero-grid,
  .composer-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .workspace,
  .sidebar {
    padding: 1rem;
  }

  .toolbar {
    width: 100%;
    flex-direction: column;
  }

  .search {
    min-width: 0;
    width: 100%;
  }
}
`;

const DEMO_TEST = `import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('Pulseboard launch dashboard', () => {
  it('filters the checklist by status', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/filter tasks/i), 'blocked');

    expect(screen.getByText(/close mobile layout regressions/i)).toBeInTheDocument();
    expect(screen.queryByText(/ship launch hero copy/i)).not.toBeInTheDocument();
  });

  it('supports task search', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/search tasks/i), 'analytics');

    expect(screen.getByText(/re-run analytics smoke tests/i)).toBeInTheDocument();
    expect(screen.queryByText(/finalize status page wording/i)).not.toBeInTheDocument();
  });

  it('adds a new task from the composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/task title/i), 'Draft launch retro summary');
    await user.type(screen.getByLabelText(/task owner/i), 'Dana');
    await user.type(screen.getByLabelText(/task lane/i), 'Operations');
    await user.selectOptions(screen.getByLabelText(/task status/i), 'watch');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(screen.getByText(/draft launch retro summary/i)).toBeInTheDocument();
    expect(screen.getByText(/dana · operations/i)).toBeInTheDocument();
  });

  it('clears the composer after a successful add', async () => {
    const user = userEvent.setup();
    render(<App />);

    const title = screen.getByLabelText(/task title/i);
    const owner = screen.getByLabelText(/task owner/i);
    const lane = screen.getByLabelText(/task lane/i);

    await user.type(title, 'Coordinate CS follow-up');
    await user.type(owner, 'Lena');
    await user.type(lane, 'Support');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(title).toHaveValue('');
    expect(owner).toHaveValue('');
    expect(lane).toHaveValue('');
  });
});
`;

export function buildDemoWorkspace(input: {
  title: string;
  instructionsMd: string;
}): StoredAssessmentWorkspace {
  const title = input.title.trim() || DEMO_TITLE;
  const generatedAt = new Date().toISOString();

  return {
    files: {
      'README.md': `# ${title}

${DEMO_SUMMARY}

## Feature to build

Implement the missing task composer so candidates can add a launch task into the real dashboard.

## Candidate commands

\`\`\`bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
\`\`\`

## Candidate brief

${input.instructionsMd.trim() || DEMO_INSTRUCTIONS}
`,
      'package.json': JSON.stringify(
        {
          name: 'pulseboard-launch-sprint',
          private: true,
          version: '0.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'tsc -b && vite build',
            test: 'vitest run',
          },
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
          },
          devDependencies: {
            '@testing-library/react': '^16.0.0',
            '@testing-library/user-event': '^14.5.2',
            '@types/react': '^18.3.23',
            '@types/react-dom': '^18.3.7',
            '@vitejs/plugin-react': '^4.4.1',
            jsdom: '^24.1.0',
            typescript: '^5.8.3',
            vite: '^5.4.19',
            vitest: '^3.2.4',
          },
        },
        null,
        2,
      ),
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
`,
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            allowJs: false,
            skipLibCheck: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            strict: true,
            forceConsistentCasingInFileNames: true,
            module: 'ESNext',
            moduleResolution: 'Node',
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
          },
          include: ['src'],
        },
        null,
        2,
      ),
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
      'src/data.ts': `import type { LaunchTask } from './App';

export const initialLaunchTasks: LaunchTask[] = [
  { id: 1, title: 'Ship launch hero copy', owner: 'Mina', lane: 'Brand', status: 'ready' },
  { id: 2, title: 'Validate billing edge cases', owner: 'Ilya', lane: 'Platform', status: 'watch' },
  { id: 3, title: 'Close mobile layout regressions', owner: 'Jules', lane: 'Frontend', status: 'blocked' },
  { id: 4, title: 'Approve onboarding screenshots', owner: 'Rae', lane: 'Product', status: 'ready' },
  { id: 5, title: 'Re-run analytics smoke tests', owner: 'Niko', lane: 'Data', status: 'watch' },
  { id: 6, title: 'Finalize status page wording', owner: 'Ava', lane: 'Ops', status: 'ready' },
];

export const activityFeed = [
  { time: '09:40', title: 'Launch brief approved', detail: 'Design and GTM both signed off on the rollout narrative.' },
  { time: '10:05', title: 'Regression found', detail: 'A mobile spacing issue surfaced in the onboarding stepper.' },
  { time: '11:15', title: 'Recovery plan posted', detail: 'Frontend documented a narrow fix and re-test path for QA.' },
];

export const releaseStats = [
  { label: 'Launch score', value: '92', note: '+6 this morning' },
  { label: 'Critical blockers', value: '01', note: 'One issue still owned' },
  { label: 'Teams aligned', value: '06', note: 'Design, web, ops, data' },
];
`,
      'src/components/SidebarSummary.tsx': `interface SidebarSummaryProps {
  title: string;
  launchPercent: number;
  readyCount: number;
  totalCount: number;
}

export function SidebarSummary({
  title,
  launchPercent,
  readyCount,
  totalCount,
}: SidebarSummaryProps) {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Launch workspace</p>
        <h1>{title}</h1>
        <p className="lede">
          A product-style dashboard with a real feature task inside a normal React codebase.
        </p>
      </div>

      <div className="sidebar-card">
        <span>Launch confidence</span>
        <strong>{launchPercent}%</strong>
        <p>{readyCount} of {totalCount} checklist items are launch-ready.</p>
      </div>

      <div className="sidebar-card muted">
        <span>Suggested commands</span>
        <code>npm install</code>
        <code>npm run dev -- --host 0.0.0.0 --port 3000</code>
        <code>npm run test</code>
      </div>
    </aside>
  );
}
`,
      'src/components/MetricGrid.tsx': `interface Metric {
  label: string;
  value: string;
  note: string;
}

export function MetricGrid({ stats }: { stats: Metric[] }) {
  return (
    <div className="hero-grid">
      {stats.map((stat) => (
        <article key={stat.label} className="metric-card">
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          <p>{stat.note}</p>
        </article>
      ))}
    </div>
  );
}
`,
      'src/components/LaunchComposer.tsx': `import { useState } from 'react';
import type { LaunchStatus } from '../App';

interface LaunchComposerProps {
  onAddTask: (input: { title: string; owner: string; lane: string; status: LaunchStatus }) => boolean;
  errorMessage: string;
}

export function LaunchComposer({ onAddTask, errorMessage }: LaunchComposerProps) {
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [lane, setLane] = useState('');
  const [status, setStatus] = useState<LaunchStatus>('watch');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = onAddTask({
      title: title.trim(),
      owner: owner.trim(),
      lane: lane.trim(),
      status,
    });

    if (ok) {
      setTitle('');
      setOwner('');
      setLane('');
      setStatus('watch');
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-grid">
        <label className="field">
          <span>Task title</span>
          <input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Task owner</span>
          <input aria-label="Task owner" value={owner} onChange={(event) => setOwner(event.target.value)} />
        </label>
        <label className="field">
          <span>Task lane</span>
          <input aria-label="Task lane" value={lane} onChange={(event) => setLane(event.target.value)} />
        </label>
        <label className="field">
          <span>Task status</span>
          <select aria-label="Task status" value={status} onChange={(event) => setStatus(event.target.value as LaunchStatus)}>
            <option value="ready">Ready</option>
            <option value="watch">Watch</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>
      <button className="primary-button" type="submit">Add task</button>
      {errorMessage ? <p className="composer-error">{errorMessage}</p> : null}
    </form>
  );
}
`,
      'src/components/LaunchTaskList.tsx': `import type { LaunchTask } from '../App';

interface LaunchTaskListProps {
  tasks: LaunchTask[];
  getStatusLabel: (status: LaunchTask['status']) => string;
}

export function LaunchTaskList({ tasks, getStatusLabel }: LaunchTaskListProps) {
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <article key={task.id} className="task-card">
          <div>
            <p className="task-title">{task.title}</p>
            <p className="task-meta">{task.owner} · {task.lane}</p>
          </div>
          <span className={\`status-pill status-\${task.status}\`}>{getStatusLabel(task.status)}</span>
        </article>
      ))}
      {tasks.length === 0 ? (
        <div className="empty-state">No tasks match the current filters.</div>
      ) : null}
    </div>
  );
}
`,
      'src/components/TimelineFeed.tsx': `interface TimelineItem {
  time: string;
  title: string;
  detail: string;
}

export function TimelineFeed({ items }: { items: TimelineItem[] }) {
  return (
    <div className="timeline">
      {items.map((item) => (
        <article key={item.time} className="timeline-item">
          <span className="timeline-time">{item.time}</span>
          <div>
            <p className="timeline-title">{item.title}</p>
            <p className="timeline-detail">{item.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
`,
      'src/App.tsx': buildAppTsx(title),
      'src/styles.css': DEMO_STYLES,
      'src/App.test.tsx': DEMO_TEST,
    },
    entryFilePath: 'README.md',
    generatedAt,
  };
}

export function buildDemoAssessmentCopy(input?: {
  title?: string;
  summary?: string;
  instructionsMd?: string;
}) {
  return {
    title: input?.title?.trim() || DEMO_TITLE,
    summary: input?.summary?.trim() || DEMO_SUMMARY,
    instructionsMd: input?.instructionsMd?.trim() || DEMO_INSTRUCTIONS,
  };
}
