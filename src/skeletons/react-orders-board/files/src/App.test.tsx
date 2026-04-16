import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('Northstar orders board', () => {
  it('filters orders by status and search term', async () => {
    const user = userEvent.setup();
    render(<App />);
    const board = within(screen.getByTestId('order-list'));

    await user.selectOptions(screen.getByTestId('board-filter'), 'queued');
    expect(board.getByText(/aster home/i)).toBeInTheDocument();
    expect(board.getByText(/beacon retail/i)).toBeInTheDocument();
    expect(board.queryByText(/northcut labs/i)).not.toBeInTheDocument();

    await user.type(screen.getByTestId('board-search'), 'beacon');
    expect(board.getByText(/beacon retail/i)).toBeInTheDocument();
    expect(board.queryByText(/aster home/i)).not.toBeInTheDocument();
  });

  it('advances the selected order through the workflow', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByTestId('selected-order-status')).toHaveTextContent(/queued/i);

    await user.click(screen.getByRole('button', { name: /advance status/i }));

    expect(screen.getByTestId('selected-order-status')).toHaveTextContent(/picking/i);
  });

  it('creates a new urgent order and clears the composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByTestId('composer-customer'), 'Freshline Warehouse');
    await user.type(screen.getByTestId('composer-route'), 'Hudson terminal');
    await user.type(screen.getByTestId('composer-owner'), 'Tariq');
    await user.type(screen.getByTestId('composer-total'), '2750');
    await user.selectOptions(screen.getByTestId('composer-priority'), 'urgent');
    await user.type(screen.getByTestId('composer-notes'), 'Load dock 4 first');
    await user.click(screen.getByTestId('composer-submit'));

    const board = within(screen.getByTestId('order-list'));
    expect(board.getAllByRole('button')[0]).toHaveTextContent(/freshline warehouse/i);
    expect(screen.getByTestId('composer-customer')).toHaveValue('');
    expect(screen.getByTestId('composer-route')).toHaveValue('');
    expect(screen.getByTestId('composer-owner')).toHaveValue('');
    expect(screen.getByTestId('composer-total')).toHaveValue('');
  });
});
