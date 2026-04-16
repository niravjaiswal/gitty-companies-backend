import type { Order } from '../data';
import { statusLabels } from '../data';

export interface OrderListProps {
  orders: Order[];
  selectedOrderId: string | null;
  onSelect: (orderId: string) => void;
}

function formatCurrency(total: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(total);
}

export function OrderList({ orders, selectedOrderId, onSelect }: OrderListProps) {
  return (
    <section className="order-list-panel">
      <div className="section-heading">
        <p className="eyebrow">Active board</p>
        <h2>Orders in motion</h2>
      </div>

      <div className="order-list" data-testid="order-list">
        {orders.length === 0 ? (
          <div className="empty-state">
            <h3>No matching orders</h3>
            <p>Search or filter again to bring an order back into view.</p>
          </div>
        ) : (
          orders.map((order) => {
            const isSelected = order.id === selectedOrderId;

            return (
              <button
                key={order.id}
                type="button"
                className={`order-card${isSelected ? ' order-card--selected' : ''}`}
                onClick={() => onSelect(order.id)}
                aria-pressed={isSelected}
              >
                <div className="order-card__top">
                  <div>
                    <span className="order-card__customer">{order.customer}</span>
                    <span className="order-card__route">{order.route}</span>
                  </div>
                  <span className={`pill pill--${order.priority}`}>
                    {order.priority === 'urgent' ? 'Urgent' : 'Standard'}
                  </span>
                </div>

                <div className="order-card__body">
                  <span>{statusLabels[order.status]}</span>
                  <span>{order.owner}</span>
                </div>

                <div className="order-card__footer">
                  <span>{formatCurrency(order.total)}</span>
                  <span>{order.notes.length} note{order.notes.length === 1 ? '' : 's'}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
