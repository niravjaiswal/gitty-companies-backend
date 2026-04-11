import type { LaunchTask } from '../App';

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
          <span className={`status-pill status-${task.status}`}>{getStatusLabel(task.status)}</span>
        </article>
      ))}
      {tasks.length === 0 ? (
        <div className="empty-state">No tasks match the current filters.</div>
      ) : null}
    </div>
  );
}
