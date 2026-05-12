import './styles.css';
import { Composer } from './components/Composer';
import { ItemList } from './components/ItemList';
import { MetricGrid } from './components/MetricGrid';
import { SidebarSummary } from './components/SidebarSummary';
import { TimelineFeed } from './components/TimelineFeed';
import { activityFeed, initialLaunchTasks, releaseStats } from './data';
import { useLaunchTasks } from './hooks/useLaunchTasks';
import { statusLabel } from './lib/launchTasks';

export type LaunchStatus = 'ready' | 'watch' | 'blocked';

export interface LaunchTask {
  id: number;
  title: string;
  owner: string;
  lane: string;
  status: LaunchStatus;
}

export default function App() {
  const {
    filter,
    query,
    filteredTasks,
    composerError,
    readyCount,
    totalCount,
    launchPercent,
    setFilter,
    setQuery,
    addTask,
  } = useLaunchTasks(initialLaunchTasks);

  return (
    <div className="shell">
      <SidebarSummary
        title="Pulseboard Launch Sprint"
        launchPercent={launchPercent}
        readyCount={readyCount}
        totalCount={totalCount}
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

            <Composer onAddTask={addTask} errorMessage={composerError} />
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
