// Component tests for the My orders list (US6) and order history (US2). The API module is
// faked, with a page size of 2 so paging is easy to see.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyOrders from './MyOrders.jsx';
import { loadOrders } from './order-api.js';

vi.mock('./order-api.js', () => ({ HISTORY_PAGE_SIZE: 2, loadOrders: vi.fn() }));

const orderWith = (n, status) => ({
  id: `0a1b2c3d-0000-4000-8000-00000000000${n}`, status, swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [{ id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 }],
});

let props;
function renderList() {
  props = { email: 'student@vanderbilt.edu', onOpenOrder: vi.fn(), onReorder: vi.fn(), onBackToMenu: vi.fn(), onSignIn: vi.fn() };
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

  it('shows when each order was placed and its total (US2)', async () => {
    loadOrders.mockResolvedValueOnce({ orders: [{ ...orderWith(1, 'Collected'), swipes: 2 }] });
    renderList();

    const row = (await screen.findByRole('region', { name: 'Past orders' })).querySelector('li');
    expect(within(row).getByText(/Total: 2 meal swipes/)).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('dateTime', '2026-10-19T12:00:00+00:00');
    expect(within(row).getByText(/^Placed /)).toBeInTheDocument();
    expect(within(row).getByText('Picked up')).toBeInTheDocument();
  });

  it('asks for one page and offers older orders only when the page was full (US2)', async () => {
    loadOrders.mockResolvedValueOnce({ orders: [orderWith(1, 'Collected')] });
    renderList();

    await screen.findByRole('region', { name: 'Past orders' });
    expect(loadOrders).toHaveBeenCalledWith(expect.anything(), { limit: 2 });
    expect(screen.queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument();
  });

  it('loads the page before the oldest order shown and adds it below (US2)', async () => {
    const older = { ...orderWith(4, 'Collected'), createdAt: '2026-10-01T12:00:00+00:00' };
    loadOrders
      .mockResolvedValueOnce({ orders: [orderWith(1, 'Ready'), { ...orderWith(3, 'Collected'), createdAt: '2026-10-05T12:00:00+00:00' }] })
      .mockResolvedValueOnce({ orders: [older] });
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Load older orders' }));

    expect(loadOrders).toHaveBeenLastCalledWith(expect.anything(), {
      limit: 2, before: '2026-10-05T12:00:00+00:00', beforeId: '0a1b2c3d-0000-4000-8000-000000000003',
    });
    const past = screen.getByRole('region', { name: 'Past orders' });
    await waitFor(() => expect(within(past).getAllByRole('listitem')).toHaveLength(2));
    // Fewer than a full page came back, so that was the oldest page.
    expect(screen.queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument();
  });

  it('keeps the orders it has when an older page fails, and lets the student retry (US2)', async () => {
    loadOrders
      .mockResolvedValueOnce({ orders: [orderWith(1, 'Collected'), orderWith(2, 'Collected')] })
      .mockRejectedValueOnce(new Error('Could not load your orders. Please try again.'))
      .mockResolvedValueOnce({ orders: [] });
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Load older orders' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your orders');
    expect(within(screen.getByRole('region', { name: 'Past orders' })).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Load older orders' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older orders' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers Order again on past orders only, and hands that order back (US-29)', async () => {
    renderList();

    const current = await screen.findByRole('region', { name: 'In progress' });
    expect(within(current).queryByRole('button', { name: /again$/ })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('region', { name: 'Past orders' })).getByRole('button', { name: /again$/ }));

    expect(props.onReorder).toHaveBeenCalledTimes(1);
    expect(props.onReorder.mock.calls[0][0]).toMatchObject({ status: 'Collected' });
  });
});
