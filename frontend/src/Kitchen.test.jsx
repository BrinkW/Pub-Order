import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Kitchen from './Kitchen.jsx';
import { loadMenu, setItemAvailability } from './menu-api.js';
import { loadOrders, updateOrderStatus } from './order-api.js';

vi.mock('./order-api.js', () => ({
  loadOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock('./menu-api.js', () => ({
  loadMenu: vi.fn(),
  setItemAvailability: vi.fn(),
}));

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const order = {
  id: ID, status: 'Received', swipes: 1, createdAt: '2026-10-20T16:00:00+00:00',
  items: [{ id: 'burger', name: 'Pub Burger', swipeType: 'Entry', quantity: 1 }],
};

const burger = { id: 'pub-burger', name: 'Pub Burger', category: 'Grill Main', swipeType: 'Entry', available: true };

beforeEach(() => {
  loadOrders.mockReset();
  updateOrderStatus.mockReset();
  loadMenu.mockReset();
  setItemAvailability.mockReset();
  loadMenu.mockResolvedValue([]);
});

describe('Kitchen orders', () => {
  it('lists every order and saves a new status', async () => {
    loadOrders.mockResolvedValue({ orders: [order] });
    updateOrderStatus.mockResolvedValue({ order: { ...order, status: 'Preparing' } });
    const user = userEvent.setup();
    render(<Kitchen email="kitchen@puborder.test" onSignOut={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('Pub Burger × 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Received' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Preparing' }));

    expect(updateOrderStatus).toHaveBeenCalledWith(ID, 'Preparing');
    expect(await screen.findByRole('button', { name: 'Preparing' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves a cancelled order out of the open queue with no status buttons (US23)', async () => {
    loadOrders.mockResolvedValue({ orders: [{ ...order, status: 'Cancelled' }] });
    render(<Kitchen email="kitchen@puborder.test" onSignOut={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Closed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparing' })).not.toBeInTheDocument();
  });

  it('tells a student account it cannot change status', async () => {
    loadOrders.mockResolvedValue({ orders: [order] });
    updateOrderStatus.mockResolvedValue({ forbidden: true });
    const user = userEvent.setup();
    render(<Kitchen email="student@vanderbilt.edu" onSignOut={vi.fn()} />);

    await screen.findByText('Pub Burger × 1');
    await user.click(screen.getByRole('button', { name: 'Ready for pickup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This account cannot change order status.');
  });

  it('marks a menu item sold out', async () => {
    loadOrders.mockResolvedValue({ orders: [] });
    loadMenu.mockResolvedValue([burger]);
    setItemAvailability.mockResolvedValue({ item: { id: 'pub-burger', available: false } });
    const user = userEvent.setup();
    render(<Kitchen email="kitchen@puborder.test" onSignOut={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Mark sold out' }));

    expect(setItemAvailability).toHaveBeenCalledWith('pub-burger', false);
    expect(await screen.findByRole('button', { name: 'Sold out' })).toHaveAttribute('aria-pressed', 'true');
  });
});
