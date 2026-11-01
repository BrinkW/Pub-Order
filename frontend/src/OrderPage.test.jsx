// Component tests for the order page: confirmation (US4) and pickup tracking (US6).
// The API module is faked so each test controls exactly what the server "returns".
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderPage from './OrderPage.jsx';
import { cancelOrder, loadOrder } from './order-api.js';
import { STATUS_POLL_MS } from './order-status.js';

vi.mock('./order-api.js', () => ({ loadOrder: vi.fn(), cancelOrder: vi.fn() }));

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const saved = (status = 'Received') => ({
  id: ID, status, swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [
    { id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 },
    { id: 'fries', name: 'Fries', swipeType: 'Side', quantity: 1 },
    { id: 'tea', name: 'Tea', swipeType: 'Drink', quantity: 1 },
  ],
});

let props;
function renderPage(overrides = {}) {
  props = {
    orderId: ID, email: 'student@vanderbilt.edu',
    onBackToMenu: vi.fn(), onViewOrders: vi.fn(), onSignIn: vi.fn(), ...overrides,
  };
  return render(<OrderPage {...props} />);
}

const currentStep = () => screen.getByRole('list', { name: 'Order progress' }).querySelector('[aria-current="step"]');

beforeEach(() => {
  loadOrder.mockResolvedValue({ order: saved() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.title = '';
});

describe('US4 order confirmation', () => {
  it('shows the just-saved order at once, then re-reads it from the server', async () => {
    renderPage({ initialOrder: saved(), justPlaced: true });

    expect(screen.getByRole('heading', { level: 1, name: 'Order received' })).toBeInTheDocument();
    expect(screen.getByText('#0A1B2C3D')).toBeInTheDocument();
    expect(screen.getByText('1 meal swipe')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Order summary' });
    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'BurgerEntry× 1', 'FriesSide× 1', 'TeaDrink× 1',
    ]);
    expect(currentStep()).toHaveTextContent('Received');
    await vi.waitFor(() => expect(loadOrder).toHaveBeenCalledWith(ID, expect.any(AbortSignal)));
  });

  it('loads the saved order after a refresh, when nothing was passed in', async () => {
    renderPage();

    expect(screen.getByText('Loading your order…')).toHaveAttribute('role', 'status');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your order' })).toBeInTheDocument();
    expect(screen.getByText('#0A1B2C3D')).toBeInTheDocument();
    expect(screen.getByText('Burger')).toBeInTheDocument();
  });

  it('ignores a passed-in order that is not the one in the URL', async () => {
    let finish;
    loadOrder.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    renderPage({ initialOrder: { ...saved(), id: '0a1b2c3d-0000-4000-8000-000000000009' }, justPlaced: false });

    expect(screen.getByText('Loading your order…')).toBeInTheDocument();
    await act(async () => finish({ order: saved() }));
    expect(screen.getByText('#0A1B2C3D')).toBeInTheDocument();
  });

  it('says an order is missing, including another student’s order, without showing it', async () => {
    loadOrder.mockResolvedValueOnce({ notFound: true });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'We couldn’t find that order' })).toBeInTheDocument();
    expect(screen.queryByText('Burger')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See my orders' }));
    expect(props.onViewOrders).toHaveBeenCalled();
  });

  it('asks a signed-out student to sign in', async () => {
    loadOrder.mockResolvedValueOnce({ signInRequired: true });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Sign in to see this order' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(props.onSignIn).toHaveBeenCalled();
  });

  it('shows a retry when the order cannot be loaded, then recovers', async () => {
    loadOrder.mockRejectedValueOnce(new Error('Could not load your order. Please try again.'));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Your order didn’t load' })).toBeInTheDocument();
    expect(screen.getByText('Could not load your order. Please try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
  });

  it('sends the student back to the menu or to all orders', async () => {
    renderPage();
    await screen.findByText('Burger');

    await userEvent.click(screen.getByRole('button', { name: 'Order something else' }));
    await userEvent.click(screen.getByRole('button', { name: 'View all my orders' }));

    expect(props.onBackToMenu).toHaveBeenCalled();
    expect(props.onViewOrders).toHaveBeenCalled();
  });
});

describe('US6 pickup tracking', () => {
  it('shows the latest stored status when the student refreshes it', async () => {
    renderPage();
    await screen.findByText('Burger');
    loadOrder.mockResolvedValueOnce({ order: saved('Preparing') });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByRole('heading', { name: 'Being prepared' })).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Preparing');
    expect(screen.getByText('Your order is now preparing.')).toBeInTheDocument();
  });

  it('makes Ready for pickup unmissable, including in the browser tab title', async () => {
    loadOrder.mockResolvedValue({ order: saved('Ready') });
    renderPage();

    const heading = await screen.findByRole('heading', { level: 2, name: 'Ready for pickup' });
    expect(heading.closest('section')).toHaveClass('order-status-ready');
    expect(screen.getByText(/give them your order number/)).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Ready for pickup');
    expect(document.title).toBe('Ready for pickup · Pub-Order');
  });

  it('restores the tab title when the student leaves the page', async () => {
    document.title = 'Pub-Order';
    loadOrder.mockResolvedValue({ order: saved('Ready') });
    const { unmount } = renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Ready for pickup' });

    unmount();

    expect(document.title).toBe('Pub-Order');
  });

  it('checks for a new status on its own while the order is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('Burger');
    loadOrder.mockResolvedValue({ order: saved('Ready') });

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });

    expect(screen.getByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeInTheDocument();
    expect(screen.getByText('Your order is now ready for pickup.')).toBeInTheDocument();
  });

  it('stops checking once the order has been picked up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    loadOrder.mockResolvedValue({ order: saved('Collected') });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Picked up' });
    const calls = loadOrder.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3); });

    expect(loadOrder).toHaveBeenCalledTimes(calls);
    expect(screen.queryByText(/updates automatically/)).not.toBeInTheDocument();
  });

  it('does not check while the tab is hidden, and checks again when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('Burger');
    const calls = loadOrder.mock.calls.length;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });
    expect(loadOrder).toHaveBeenCalledTimes(calls);

    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadOrder).toHaveBeenCalledTimes(calls + 1);
  });

  it('keeps the last status on screen when a refresh fails', async () => {
    loadOrder.mockResolvedValueOnce({ order: saved('Preparing') });
    renderPage();
    await screen.findByRole('heading', { name: 'Being prepared' });
    loadOrder.mockRejectedValueOnce(new Error('Could not load your order. Please try again.'));

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('this is the last status we loaded');
    expect(screen.getByRole('heading', { name: 'Being prepared' })).toBeInTheDocument();
  });

  it('shows the not-found page if the order disappears while open', async () => {
    renderPage();
    await screen.findByText('Burger');
    loadOrder.mockResolvedValueOnce({ notFound: true });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByRole('heading', { name: 'We couldn’t find that order' })).toBeInTheDocument();
  });

  it('ignores an older response that arrives after a newer one', async () => {
    renderPage();
    await screen.findByText('Burger');
    let finishSlow;
    loadOrder.mockReturnValueOnce(new Promise((resolve) => { finishSlow = resolve; }));
    loadOrder.mockResolvedValueOnce({ order: saved('Ready') });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await screen.findByRole('heading', { level: 2, name: 'Ready for pickup' });
    await act(async () => finishSlow({ order: saved('Received') }));

    expect(screen.getByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeInTheDocument();
  });
});

describe('US23 cancelling an order', () => {
  beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });

  it('cancels a Received order after the student confirms', async () => {
    cancelOrder.mockResolvedValue({ order: saved('Cancelled') });
    renderPage({ initialOrder: saved() });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

    expect(cancelOrder).toHaveBeenCalledWith(ID);
    expect(await screen.findByRole('heading', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Order progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('does nothing when the student changes their mind', async () => {
    window.confirm.mockReturnValue(false);
    renderPage({ initialOrder: saved() });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('explains when the kitchen started first and shows the new status', async () => {
    cancelOrder.mockResolvedValue({ tooLate: true });
    renderPage({ initialOrder: saved() });
    await vi.waitFor(() => expect(loadOrder).toHaveBeenCalledTimes(1));
    loadOrder.mockResolvedValue({ order: saved('Preparing') });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

    expect(await screen.findByText(/already started this order/)).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Preparing');
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('offers no cancel once the kitchen has started', async () => {
    loadOrder.mockResolvedValue({ order: saved('Preparing') });
    renderPage({ initialOrder: saved('Preparing') });

    await vi.waitFor(() => expect(loadOrder).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });
});
