import { useMemo, useState } from 'react';
import './styles.css';
import { Composer } from './components/Composer';
import { ItemList } from './components/ItemList';
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

  function handleAddTask(input: { title: string; owner: string; lane: string; status: string }) {
    if (!input.title || !input.owner || !input.lane) {
      setComposerError('Title, owner, and lane are required.');
      return false;
    }

    setComposerError('');

    setTasks((prev) => [
      ...prev,
      { id: Math.max(0, ...prev.map((t) => t.id)) + 1, ...input, status: input.status as LaunchStatus },
    ]);
    return true;
  }

  return (
    <div className="shell">
      <SidebarSummary
        title="Pulseboard Launch Sprint"
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
                  data-testid="search-input"
                  aria-label="Search tasks"
                  className="search"
                  placeholder="Search owner, lane, or task"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  data-testid="filter-select"
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

            <Composer onAddTask={handleAddTask} errorMessage={composerError} />
            <ItemList tasks={filteredTasks} getStatusLabel={statusLabel} />
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
