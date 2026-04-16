import type { BoardFilter } from '../state/orders';
import { statusMeta } from '../data';

export interface ToolbarProps {
  query: string;
  filter: BoardFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: BoardFilter) => void;
}

export function Toolbar({
  query,
  filter,
  onQueryChange,
  onFilterChange,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <label className="field">
        <span className="field__label">Search</span>
        <input
          data-testid="board-search"
          className="field__input"
          placeholder="Customer, route, owner, or note"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Filter status</span>
        <select
          data-testid="board-filter"
          className="field__input"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as BoardFilter)}
        >
          <option value="all">All statuses</option>
          {statusMeta.map((entry) => (
            <option key={entry.status} value={entry.status}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
