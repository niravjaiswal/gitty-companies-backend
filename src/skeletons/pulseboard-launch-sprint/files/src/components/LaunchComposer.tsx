import { useState } from 'react';
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
