import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('Pulseboard launch dashboard', () => {
  it('filters the checklist by status', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByTestId('filter-select'), 'blocked');

    expect(screen.getByText(/close mobile layout regressions/i)).toBeInTheDocument();
    expect(screen.queryByText(/ship launch hero copy/i)).not.toBeInTheDocument();
  });

  it('supports task search', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByTestId('search-input'), 'analytics');

    expect(screen.getByText(/re-run analytics smoke tests/i)).toBeInTheDocument();
    expect(screen.queryByText(/finalize status page wording/i)).not.toBeInTheDocument();
  });

  it('adds a new task from the composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByTestId('composer-title'), 'Draft launch retro summary');
    await user.type(screen.getByTestId('composer-owner'), 'Dana');
    await user.type(screen.getByTestId('composer-lane'), 'Operations');
    await user.click(screen.getByTestId('composer-submit'));

    expect(screen.getByText(/draft launch retro summary/i)).toBeInTheDocument();
    expect(screen.getByText(/dana · operations/i)).toBeInTheDocument();
  });

  it('clears the composer after a successful add', async () => {
    const user = userEvent.setup();
    render(<App />);

    const title = screen.getByTestId('composer-title');
    const owner = screen.getByTestId('composer-owner');
    const lane = screen.getByTestId('composer-lane');

    await user.type(title, 'Coordinate CS follow-up');
    await user.type(owner, 'Lena');
    await user.type(lane, 'Support');
    await user.click(screen.getByTestId('composer-submit'));

    expect(title).toHaveValue('');
    expect(owner).toHaveValue('');
    expect(lane).toHaveValue('');
  });
});
