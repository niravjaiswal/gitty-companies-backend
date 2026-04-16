import { useReducer } from 'react';
import { Composer } from './components/Composer';
import { MetricChip } from './components/MetricChip';
import { OrderDetails } from './components/OrderDetails';
import { OrderList } from './components/OrderList';
import { Toolbar } from './components/Toolbar';
import {
  boardReducer,
  createInitialBoardState,
  selectBoardCounts,
  selectSelectedOrder,
  selectVisibleOrders,
} from './state/orders';
import { statusMeta } from './data';

export default function App() {
  const [state, dispatch] = useReducer(boardReducer, undefined, createInitialBoardState);

  const visibleOrders = selectVisibleOrders(state);
  const selectedOrder = selectSelectedOrder(state);
  const counts = selectBoardCounts(state);

  return (
    <div className="page-shell">
      <div className="page-shell__glow" aria-hidden="true" />

      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Northstar Commerce</p>
          <h1>Orders board with reducer-driven state and live workflow actions.</h1>
          <p className="hero__lede">
            A polished React workspace for tracking urgent fulfillment, inspecting selected orders,
            and keeping queue state aligned with the board.
          </p>
        </div>

        <div className="hero__stats">
          <MetricChip label="Open orders" value={counts.total} hint="All tracked orders" />
          <MetricChip label="Urgent" value={counts.urgent} hint="Needs fast handling" />
          <MetricChip label="Shipped" value={counts.shipped} hint="Closed out today" />
        </div>
      </header>

      <main className="workspace">
        <section className="workspace__rail">
          <Toolbar
            query={state.query}
            filter={state.filter}
            onQueryChange={(query) => dispatch({ type: 'query_changed', query })}
            onFilterChange={(filter) => dispatch({ type: 'filter_changed', filter })}
          />

          <div className="status-strip" aria-label="Status overview">
            {statusMeta.map((entry) => (
              <div key={entry.status} className="status-strip__item">
                <span>{entry.label}</span>
                <small>{entry.hint}</small>
              </div>
            ))}
          </div>

          <OrderList
            orders={visibleOrders}
            selectedOrderId={selectedOrder?.id ?? null}
            onSelect={(orderId) => dispatch({ type: 'order_selected', orderId })}
          />
        </section>

        <section className="workspace__sidebar">
          <Composer
            draft={state.draft}
            formError={state.formError}
            onFieldChange={(field, value) =>
              dispatch({ type: 'draft_updated', field, value })
            }
            onSubmit={() => dispatch({ type: 'draft_submitted' })}
          />

          <OrderDetails
            order={selectedOrder}
            onAdvance={() => dispatch({ type: 'status_advanced' })}
            onTogglePriority={() => dispatch({ type: 'priority_toggled' })}
          />
        </section>
      </main>
    </div>
  );
}
