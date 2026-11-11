// Integration tests for US4 (order confirmation) and US6 (pickup tracking): the real App,
// Menu, Checkout, OrderPage, MyOrders, cart rules, hash routing and browser storage working
// together. Only the outside services are faked: Supabase auth and the FastAPI endpoints
// (/api/menu, /api/checkout/review, /api/orders, /api/orders/{id}).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { pageFromHash } from './App.jsx';
import { CART_STORAGE_KEY } from './cart.js';
import { getSupabase } from './supabase.js';

vi.mock('./CrowdMeter.jsx', () => ({ CrowdMeter: () => null, CrowdMeterControls: () => null }));
vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));

const EMAIL = 'student@vanderbilt.edu';
const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const OTHER_ID = '9f8e7d6c-0000-4000-8000-000000000002';
const catalog = [
  { id: 'burger', name: 'Burger', category: 'Grill Main', swipeType: 'Entry', available: true, description: '', label: '' },
  { id: 'fries', name: 'Fries', category: 'Sides', swipeType: 'Side', available: true, description: '', label: '' },
  { id: 'tea', name: 'Tea', category: 'Drinks', swipeType: 'Drink', available: true, description: '', label: '' },
];
const meal = { swipes: 1, items: { burger: 1, fries: 1, tea: 1 }, reviewedTypes: { burger: 'Entry', fries: 'Side', tea: 'Drink' } };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A tiny stand-in for the backend: one stored order whose status a test can change, the way
// staff will (US5). Any other order id is "not found", like someone else's order.
let server;
function fakeBackend() {
  server = { order: null, failReads: false };
  return vi.fn(async (url, options = {}) => {
    if (url === '/api/menu') return json(catalog);
    if (url === '/api/me') return json({ id: 'student-1', email: EMAIL });
    if (url === '/api/checkout/review') {
      return json({ items: catalog.map((item) => ({ ...item, quantity: 1 })), counts: { Entry: 1, Side: 1, Drink: 1 }, swipes: 1, issues: [], canSubmit: true });
    }
    if (url === '/api/orders' && options.method === 'POST') {
      server.order = {
        id: ID, status: 'Received', swipes: 1, createdAt: new Date().toISOString(),
        items: catalog.map((item) => ({ id: item.id, name: item.name, swipeType: item.swipeType, quantity: 1 })),
      };
      return json(server.order, 201);
    }
    if (server.failReads) return json({ detail: 'Could not load this order.' }, 503);
    if (url === '/api/orders') return json(server.order ? [server.order] : []);
    if (url === `/api/orders/${ID}` && server.order) return json(server.order);
    if (url.startsWith('/api/orders/')) return json({ detail: 'Order not found.' }, 404);
    throw new Error(`Unexpected request to ${url}`);
  });
}

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  const session = { access_token: 'test-token', user: { email: EMAIL } };
  getSupabase.mockReturnValue({ auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session } }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  } });
  vi.stubGlobal('fetch', fakeBackend());
});

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function placeOrder() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal));
  window.location.hash = 'menu';
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole('button', { name: 'Add Burger to cart' });
  await user.click(screen.getByRole('button', { name: 'Review checkout' }));
  await user.click(screen.getByRole('button', { name: 'Validate checkout' }));
  await user.click(await screen.findByRole('button', { name: 'Place order' }));
  await screen.findByRole('heading', { name: 'Order received' });
  return { user, view };
}

// Simulates the browser reloading the page: everything in memory is gone; the URL and
// localStorage remain.
function reload(view) {
  view.unmount();
  return render(<App />);
}

const orderReads = () => fetch.mock.calls.filter(([url]) => url === `/api/orders/${ID}`);

describe('US4: placing an order opens its confirmation', () => {
  it('opens a confirmation page with the saved order and clears the cart', async () => {
    await placeOrder();

    expect(window.location.hash).toBe(`#order/${ID}`);
    expect(screen.getByText('#0A1B2C3D')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Order summary' });
    expect(within(summary).getByText('Burger')).toBeInTheDocument();
    expect(within(summary).getByText('1 meal swipe')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting for the kitchen' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)).items).toEqual({});
  });

  it('reads the saved order back from the server after a refresh', async () => {
    const { view } = await placeOrder();
    const readsBefore = orderReads().length;

    reload(view);

    expect(await screen.findByRole('heading', { level: 1, name: 'Your order' })).toBeInTheDocument();
    expect(screen.getByText('#0A1B2C3D')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Order summary' })).getByText('Burger')).toBeInTheDocument();
    expect(orderReads().length).toBeGreaterThan(readsBefore);
    expect(orderReads().at(-1)[1].headers.Authorization).toBe('Bearer test-token');
  });

  it('does not show another student’s order when the id in the URL is changed', async () => {
    await placeOrder();

    window.location.hash = `order/${OTHER_ID}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(await screen.findByRole('heading', { name: 'We couldn’t find that order' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Order summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('#0A1B2C3D')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url === `/api/orders/${OTHER_ID}`)).toBe(true);
  });

  it('returns to an empty cart on the menu', async () => {
    const { user } = await placeOrder();

    await user.click(screen.getByRole('button', { name: 'Order something else' }));

    expect(window.location.hash).toBe('#menu');
    expect(screen.getByRole('heading', { name: 'A little hungry?' })).toBeInTheDocument();
  });
});

describe('US6: tracking an order until pickup', () => {
  it('shows each new stored status when the student refreshes', async () => {
    const { user } = await placeOrder();

    server.order.status = 'Preparing';
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('heading', { name: 'Being prepared' })).toBeInTheDocument();

    server.order.status = 'Ready';
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeInTheDocument();
    expect(screen.getByText('Your order is now ready for pickup.')).toBeInTheDocument();
  });

  it('shows the latest status when the order page is opened fresh', async () => {
    const { view } = await placeOrder();
    server.order.status = 'Ready';

    reload(view);

    expect(await screen.findByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeInTheDocument();
  });

  it('keeps the last status visible when the server cannot be reached', async () => {
    const { user } = await placeOrder();

    server.failReads = true;
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your order');
    expect(screen.getByRole('heading', { name: 'Waiting for the kitchen' })).toBeInTheDocument();
  });

  it('lists the order under My orders and opens it from there', async () => {
    const { user } = await placeOrder();
    server.order.status = 'Ready';

    await user.click(screen.getByRole('button', { name: 'View all my orders' }));
    expect(window.location.hash).toBe('#orders');
    const current = await screen.findByRole('region', { name: 'In progress' });
    expect(within(current).getByText('Ready for pickup')).toBeInTheDocument();

    await user.click(within(current).getByRole('button', { name: 'View order 0A1B2C3D' }));
    expect(window.location.hash).toBe(`#order/${ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your order' })).toBeInTheDocument();
  });

  it('reaches My orders from the menu header', async () => {
    window.location.hash = 'menu';
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(`Signed in as ${EMAIL}`);

    await user.click(screen.getByRole('button', { name: 'My orders' }));

    expect(await screen.findByText('You haven’t placed any orders yet.')).toBeInTheDocument();
  });

  it('sends a signed-out student to sign in, then back to the same order', async () => {
    getSupabase.mockReturnValue({ auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { email: EMAIL }, session: {} }, error: null }),
    } });
    window.location.hash = `order/${ID}`;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(window.location.hash).toBe('#login');
    await user.type(screen.getByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password', { exact: true }), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));

    await vi.waitFor(() => expect(window.location.hash).toBe(`#order/${ID}`));
  });
});

describe('pageFromHash', () => {
  it.each([
    ['', { name: 'login' }],
    ['#menu', { name: 'menu' }],
    ['#orders', { name: 'orders' }],
    ['#kitchen', { name: 'kitchen' }],
    [`#order/${ID}`, { name: 'order', orderId: ID }],
    ['#order/', { name: 'login' }],
    ['#somewhere', { name: 'login' }],
  ])('maps %j to the right page', (hash, page) => {
    expect(pageFromHash(hash)).toEqual(page);
  });
});
