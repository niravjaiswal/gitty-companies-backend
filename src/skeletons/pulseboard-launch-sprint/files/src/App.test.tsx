import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('Pulseboard launch dashboard', () => {
  it('filters the checklist by status', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/filter tasks/i), 'blocked');

    expect(screen.getByText(/close mobile layout regressions/i)).toBeInTheDocument();
    expect(screen.queryByText(/ship launch hero copy/i)).not.toBeInTheDocument();
  });

  it('supports task search', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/search tasks/i), 'analytics');

    expect(screen.getByText(/re-run analytics smoke tests/i)).toBeInTheDocument();
    expect(screen.queryByText(/finalize status page wording/i)).not.toBeInTheDocument();
  });

  it('adds a new task from the composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/task title/i), 'Draft launch retro summary');
    await user.type(screen.getByLabelText(/task owner/i), 'Dana');
    await user.type(screen.getByLabelText(/task lane/i), 'Operations');
    await user.selectOptions(screen.getByLabelText(/task status/i), 'watch');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(screen.getByText(/draft launch retro summary/i)).toBeInTheDocument();
    expect(screen.getByText(/dana · operations/i)).toBeInTheDocument();
  });

  it('clears the composer after a successful add', async () => {
    const user = userEvent.setup();
    render(<App />);

    const title = screen.getByLabelText(/task title/i);
    const owner = screen.getByLabelText(/task owner/i);
    const lane = screen.getByLabelText(/task lane/i);

    await user.type(title, 'Coordinate CS follow-up');
    await user.type(owner, 'Lena');
    await user.type(lane, 'Support');
    await user.click(screen.getByRole('button', { name: /add task/i }));

    expect(title).toHaveValue('');
    expect(owner).toHaveValue('');
    expect(lane).toHaveValue('');
  });
});
