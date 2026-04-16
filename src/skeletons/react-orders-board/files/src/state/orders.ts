import {
  initialDraft,
  initialOrders,
  statusFlow,
  type Order,
  type OrderDraft,
  type OrderPriority,
  type OrderStatus,
} from '../data';

export type BoardFilter = 'all' | OrderStatus;

export interface OrdersBoardState {
  orders: Order[];
  filter: BoardFilter;
  query: string;
  selectedOrderId: string | null;
  draft: OrderDraft;
  formError: string | null;
}

export type OrdersBoardAction =
  | { type: 'filter_changed'; filter: BoardFilter }
  | { type: 'query_changed'; query: string }
  | { type: 'order_selected'; orderId: string }
  | { type: 'draft_updated'; field: keyof OrderDraft; value: string }
  | { type: 'priority_toggled' }
  | { type: 'status_advanced' }
  | { type: 'draft_submitted' };

const statusIndex = new Map(statusFlow.map((status, index) => [status, index]));

function isVisible(order: Order, filter: BoardFilter, query: string): boolean {
  if (filter !== 'all' && order.status !== filter) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    order.id,
    order.customer,
    order.route,
    order.owner,
    order.priority,
    order.status,
    ...order.notes,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function compareOrders(left: Order, right: Order): number {
  if (left.priority !== right.priority) {
    return left.priority === 'urgent' ? -1 : 1;
  }

  const statusDelta =
    (statusIndex.get(left.status) ?? 0) - (statusIndex.get(right.status) ?? 0);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  return right.id.localeCompare(left.id);
}

function nextOrderId(orders: Order[]): string {
  const numericId = orders
    .map((order) => Number(order.id.replace(/^[^0-9]*/, '')))
    .filter((value) => Number.isFinite(value));

  const next = numericId.length > 0 ? Math.max(...numericId) + 1 : orders.length + 1;
  return `ord-${next}`;
}

function makeInitialState(): OrdersBoardState {
  return {
    orders: initialOrders.map((order) => ({ ...order, notes: [...order.notes] })),
    filter: 'all',
    query: '',
    selectedOrderId: initialOrders[0]?.id ?? null,
    draft: { ...initialDraft },
    formError: null,
  };
}

function togglePriority(priority: OrderPriority): OrderPriority {
  return priority === 'urgent' ? 'standard' : 'urgent';
}

function advanceStatus(status: OrderStatus): OrderStatus {
  const index = statusFlow.indexOf(status);
  return statusFlow[Math.min(statusFlow.length - 1, index + 1)];
}

function validateDraft(draft: OrderDraft): string | null {
  if (!draft.customer.trim()) return 'Customer name is required.';
  if (!draft.route.trim()) return 'Route is required.';
  if (!draft.owner.trim()) return 'Owner is required.';
  const total = Number(draft.total);
  if (!Number.isFinite(total) || total <= 0) return 'Order total must be greater than zero.';
  return null;
}

export function createInitialBoardState(): OrdersBoardState {
  return makeInitialState();
}

export function selectVisibleOrders(state: OrdersBoardState): Order[] {
  return state.orders
    .filter((order) => isVisible(order, state.filter, state.query))
    .sort(compareOrders);
}

export function selectSelectedOrder(state: OrdersBoardState): Order | null {
  return state.orders.find((order) => order.id === state.selectedOrderId) ?? null;
}

export function selectBoardCounts(state: OrdersBoardState) {
  return {
    total: state.orders.length,
    urgent: state.orders.filter((order) => order.priority === 'urgent').length,
    queued: state.orders.filter((order) => order.status === 'queued').length,
    shipped: state.orders.filter((order) => order.status === 'shipped').length,
  };
}

export function boardReducer(
  state: OrdersBoardState,
  action: OrdersBoardAction,
): OrdersBoardState {
  switch (action.type) {
    case 'filter_changed':
      return { ...state, filter: action.filter };
    case 'query_changed':
      return { ...state, query: action.query };
    case 'order_selected':
      return { ...state, selectedOrderId: action.orderId };
    case 'draft_updated':
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
        formError: null,
      };
    case 'priority_toggled': {
      const selected = selectSelectedOrder(state);
      if (!selected) return state;
      const updatedOrders = state.orders.map((order) =>
        order.id === selected.id
          ? { ...order, priority: togglePriority(order.priority), updatedAt: new Date().toISOString() }
          : order,
      );
      return { ...state, orders: updatedOrders };
    }
    case 'status_advanced': {
      const selected = selectSelectedOrder(state);
      if (!selected) return state;
      const updatedOrders = state.orders.map((order) =>
        order.id === selected.id
          ? { ...order, status: advanceStatus(order.status), updatedAt: new Date().toISOString() }
          : order,
      );
      return { ...state, orders: updatedOrders };
    }
    case 'draft_submitted': {
      const validationError = validateDraft(state.draft);
      if (validationError) {
        return { ...state, formError: validationError };
      }

      const id = nextOrderId(state.orders);
      const now = new Date().toISOString();
      const notes = state.draft.notes.trim() ? [state.draft.notes.trim()] : [];
      const newOrder: Order = {
        id,
        customer: state.draft.customer.trim(),
        route: state.draft.route.trim(),
        owner: state.draft.owner.trim(),
        total: Number(state.draft.total),
        status: 'queued',
        priority: state.draft.priority,
        notes,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...state,
        orders: [newOrder, ...state.orders],
        selectedOrderId: newOrder.id,
        draft: { ...initialDraft },
        formError: null,
      };
    }
    default:
      return state;
  }
}
