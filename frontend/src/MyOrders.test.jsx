// Component tests for the My orders list (US6). The API module is faked.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyOrders from './MyOrders.jsx';
import { loadOrders } from './order-api.js';

vi.mock('./order-api.js', () => ({ loadOrders: vi.fn() }));

const orderWith = (n, status) => ({
  id: `0a1b2c3d-0000-4000-8000-00000000000${n}`, status, swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [{ id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 }],
});

let props;
function renderList() {
  props = { email: 'student@vanderbilt.edu', onOpenOrder: vi.fn(), onBackToMenu: vi.fn(), onSignIn: vi.fn() };
  return render(<MyOrders {...props} />);
}

beforeEach(() => {
  loadOrders.mockResolvedValue({ orders: [orderWith(1, 'Ready'), orderWith(2, 'Received'), orderWith(3, 'Collected')] });
});

afterEach(() => vi.clearAllMocks());

describe('My orders', () => {
  it('separates orders still in progress from ones already picked up', async () => {
    renderList();

    const current = await screen.findByRole('region', { name: 'In progress' });
    const past = screen.getByRole('region', { name: 'Past orders' });
    expect(within(current).getAllByRole('listitem').map((row) => within(row).getByText(/^Order #/).textContent))
      .toEqual(['Order #0A1B2C3D', 'Order #0A1B2C3D']);
    expect(within(current).getByText('Ready for pickup')).toBeInTheDocument();
    expect(within(past).getAllByRole('listitem')).toHaveLength(1);
  });

  it('never files a cancelled order under "Picked up"', async () => {
    loadOrders.mockResolvedValue({ orders: [orderWith(1, 'Received'), orderWith(2, 'Cancelled')] });
    renderList();

    const past = await screen.findByRole('region', { name: 'Past orders' });

    expect(within(past).getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Picked up' })).not.toBeInTheDocument();
  });

  it('opens an order from the list', async () => {
    renderList();
    const [first] = await screen.findAllByRole('button', { name: 'View order 0A1B2C3D' });

    await userEvent.click(first);

    expect(props.onOpenOrder).toHaveBeenCalledWith('0a1b2c3d-0000-4000-8000-000000000001');
  });

  it('points a student with no orders back to the menu', async () => {
    loadOrders.mockResolvedValueOnce({ orders: [] });
    renderList();

    expect(await screen.findByText('You haven’t placed any orders yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Browse the menu' }));
    expect(props.onBackToMenu).toHaveBeenCalled();
  });

  it('asks a signed-out student to sign in', async () => {
    loadOrders.mockResolvedValueOnce({ signInRequired: true });
    renderList();

    expect(await screen.findByRole('heading', { name: 'Sign in to see your orders' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(props.onSignIn).toHaveBeenCalled();
  });

  it('shows the error and loads again on retry or refresh', async () => {
    loadOrders.mockRejectedValueOnce(new Error('Could not load your orders. Please try again.'));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your orders');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'In progress' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(loadOrders).toHaveBeenCalledTimes(3);
  });
});
