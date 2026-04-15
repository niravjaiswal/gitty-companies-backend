import { useState } from 'react';

type ComposerStatus = 'ready' | 'watch' | 'blocked';

interface ComposerProps {
  onAddTask: (input: { title: string; owner: string; lane: string; status: string }) => boolean;
  errorMessage: string;
}

export function Composer({ onAddTask, errorMessage }: ComposerProps) {
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [lane, setLane] = useState('');
  const [status, setStatus] = useState<ComposerStatus>('watch');

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
          <input data-testid="composer-title" aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Task owner</span>
          <input data-testid="composer-owner" aria-label="Task owner" value={owner} onChange={(event) => setOwner(event.target.value)} />
        </label>
        <label className="field">
          <span>Task lane</span>
          <input data-testid="composer-lane" aria-label="Task lane" value={lane} onChange={(event) => setLane(event.target.value)} />
        </label>
        <label className="field">
          <span>Task status</span>
          <select data-testid="composer-status" aria-label="Task status" value={status} onChange={(event) => setStatus(event.target.value as ComposerStatus)}>
            <option value="ready">Ready</option>
            <option value="watch">Watch</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>
      <button data-testid="composer-submit" className="primary-button" type="submit">Add task</button>
      {errorMessage ? <p className="composer-error">{errorMessage}</p> : null}
    </form>
  );
}
