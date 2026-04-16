import { describe, expect, it } from 'vitest';
import { boardReducer, createInitialBoardState, selectVisibleOrders } from './orders';

describe('orders reducer', () => {
  it('pins urgent orders before standard orders', () => {
    const state = createInitialBoardState();
    const ordered = selectVisibleOrders(state);

    expect(ordered[0].priority).toBe('urgent');
    expect(ordered[0].customer).toBe('Aster Home');
  });

  it('advances the selected order through the status flow', () => {
    const state = createInitialBoardState();
    const next = boardReducer(state, { type: 'status_advanced' });

    expect(next.orders.find((order) => order.id === state.selectedOrderId)?.status).toBe('picking');
  });

  it('creates a queued order and clears the form draft', () => {
    const state = createInitialBoardState();
    const withCustomer = boardReducer(state, {
      type: 'draft_updated',
      field: 'customer',
      value: 'Aurora Studio',
    });
    const withRoute = boardReducer(withCustomer, {
      type: 'draft_updated',
      field: 'route',
      value: 'Chelsea lane',
    });
    const withOwner = boardReducer(withRoute, {
      type: 'draft_updated',
      field: 'owner',
      value: 'Mina',
    });
    const withTotal = boardReducer(withOwner, {
      type: 'draft_updated',
      field: 'total',
      value: '1420',
    });
    const submitted = boardReducer(withTotal, { type: 'draft_submitted' });

    expect(submitted.draft.customer).toBe('');
    expect(submitted.orders[0].customer).toBe('Aurora Studio');
    expect(submitted.orders[0].status).toBe('queued');
  });
});
