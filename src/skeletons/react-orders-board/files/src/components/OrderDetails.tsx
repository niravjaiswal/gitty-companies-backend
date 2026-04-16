import type { Order } from '../data';
import { statusHints, statusLabels } from '../data';

export interface OrderDetailsProps {
  order: Order | null;
  onAdvance: () => void;
  onTogglePriority: () => void;
}

function formatCurrency(total: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(total);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

export function OrderDetails({ order, onAdvance, onTogglePriority }: OrderDetailsProps) {
  return (
    <section className="detail-panel" data-testid="order-details">
      <div className="section-heading">
        <p className="eyebrow">Selection</p>
        <h2>Order details</h2>
      </div>

      {!order ? (
        <div className="empty-state">
          <h3>No order selected</h3>
          <p>Choose a card from the board to inspect its workflow.</p>
        </div>
      ) : (
        <div className="detail-card">
          <div className="detail-card__header">
            <div>
              <p className="detail-card__customer" data-testid="selected-order-name">
                {order.customer}
              </p>
              <p className="detail-card__meta">
                {order.route} · {order.owner}
              </p>
            </div>
            <span className={`pill pill--${order.priority}`}>
              {order.priority === 'urgent' ? 'Urgent' : 'Standard'}
            </span>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Status</dt>
              <dd data-testid="selected-order-status">{statusLabels[order.status]}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatCurrency(order.total)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(order.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(order.updatedAt)}</dd>
            </div>
          </dl>

          <p className="detail-card__hint">{statusHints[order.status]}</p>

          {order.notes.length > 0 ? (
            <div className="note-stack">
              <h3>Notes</h3>
              <ul>
                {order.notes.map((note, idx) => (
                  <li key={`${order.id}-note-${idx}`}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="detail-actions">
            <button type="button" className="button button--primary" onClick={onAdvance}>
              Advance status
            </button>
            <button type="button" className="button" onClick={onTogglePriority}>
              {order.priority === 'urgent' ? 'Normalize priority' : 'Promote to urgent'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
