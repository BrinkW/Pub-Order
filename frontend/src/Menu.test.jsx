import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Menu from './Menu.jsx';
import Checkout from './Checkout.jsx';
import App from './App.jsx';
import { CART_STORAGE_KEY } from './cart.js';
import { getSupabase } from './supabase.js';
vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));
const catalog = [
  { id: 'burger', name: 'Burger', category: 'Grill Main', swipeType: 'Entry', available: true, description: 'Grilled', label: '' },
  { id: 'fries', name: 'Fries', category: 'Sides', swipeType: 'Side', available: true, description: '', label: 'Vegan' },
  { id: 'tea', name: 'Tea', category: 'Drinks', swipeType: 'Drink', available: true, description: '', label: '' },
];
const meal = () => ({ swipes: 1, items: { burger: 1, fries: 1, tea: 1 }, reviewedTypes: { burger: 'Entry', fries: 'Side', tea: 'Drink' } });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const validReview = () => ({ items: catalog.map((i) => ({ ...i, quantity: 1 })), counts: { Entry: 1, Side: 1, Drink: 1 }, swipes: 1, issues: [], canSubmit: true });
let auth;
beforeEach(() => {
  localStorage.clear(); window.location.hash = '';
  auth = { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token', user: { email: 'student@example.com' } } } }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
  };
  getSupabase.mockReturnValue({ auth });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
    if (url === '/api/menu') return response(catalog);
    if (url === '/api/me') return response({ email: 'student@example.com' });
    return response(validReview());
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const openReview = async () => {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal())); render(<Menu />);
  await screen.findByRole('button', { name: 'Add Burger' });
  fireEvent.click(screen.getByRole('button', { name: 'Look over your order' }));
};
it('shows loading, then the entrée step, and search narrows that step', async () => {
  let resolve; fetch.mockReturnValueOnce(new Promise((r) => { resolve = r; })); render(<Menu />);
  expect(screen.getByText('Loading menu…')).toBeInTheDocument();
  await act(async () => resolve(response(catalog)));
  expect(screen.getByRole('button', { name: 'Add Burger' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Add Fries' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
  expect(screen.getByText('No matches this time.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: 'Add Burger' })).toBeInTheDocument();
});
it('shows empty catalog and disables empty checkout', async () => {
  fetch.mockResolvedValueOnce(response([])); render(<Menu />);
  expect(await screen.findByText(/No menu items are available yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Look over your order' })).toBeDisabled();
});
it('shows a failed menu request and retries successfully', async () => {
  fetch.mockRejectedValueOnce(new Error('Network unavailable')); render(<Menu />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry menu' }));
  expect(await screen.findByRole('button', { name: 'Add Burger' })).toBeEnabled();
});
it('shows a sold-out item after the menu refreshes in the background', async () => {
  render(<Menu />);
  const add = await screen.findByRole('button', { name: 'Add Burger' });
  expect(add).toBeEnabled();
  fetch.mockImplementation(async (url) => {
    if (url === '/api/menu') return response(catalog.map((item) => ({ ...item, available: item.id !== 'burger' })));
    return response(validReview());
  });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(await screen.findByRole('button', { name: 'Add Burger' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add Burger' })).toHaveTextContent('Sold out');
});
it('opens a nutrition card from a menu item', async () => {
  render(<Menu />);
  await screen.findByRole('button', { name: 'Add Burger' });
  fireEvent.click(screen.getByRole('button', { name: 'Nutrition facts for Burger' }));
  expect(screen.getByRole('dialog', { name: 'Burger' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: 'Calories' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('rejects malformed menu responses', async () => {
  fetch.mockResolvedValueOnce(response([{ id: 'invalid' }])); render(<Menu />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
});
it('cannot add unavailable items', async () => {
  fetch.mockResolvedValueOnce(response(catalog.map((i) => ({ ...i, available: false })))); render(<Menu />);
  expect(await screen.findByRole('button', { name: 'Add Burger' })).toBeDisabled();
});
it('shows quantities and total, checks server, and retains cart after success', async () => {
  await openReview();
  expect(screen.getByText('1 meal swipe')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Look over your order' })).getByText('Entrée')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled());
  expect(screen.queryByText(/This order looks good/)).not.toBeInTheDocument();
  const call = fetch.mock.calls.find(([url]) => url === '/api/checkout/review');
  expect(call[1].headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(call[1].body).items[0]).toEqual({ id: 'burger', quantity: 1, expectedSwipeType: 'Entry' });
  expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)).items).toEqual(meal().items);
});
it.each([{}, { burger: 1.5 }, { burger: -1 }, { burger: 11 }, { burger: '1' }, { burger: 1 }])('blocks empty, invalid, or incomplete checkout %j', (items) => {
  render(<Checkout cart={{ ...meal(), items }} catalog={catalog} />);
  expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
});
it('asks guest to sign in without discarding cart', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  const onSignIn = vi.fn(); render(<Checkout cart={meal()} catalog={catalog} onSignIn={onSignIn} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in and keep cart' }));
  expect(onSignIn).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});
it('expired server session requires sign-in', async () => {
  fetch.mockResolvedValueOnce(response({}, 401)); render(<Checkout cart={meal()} catalog={catalog} />);
  expect(await screen.findByRole('button', { name: 'Sign in and keep cart' })).toBeInTheDocument();
});
it('blocks changed types and unavailable items until reviewed', async () => {
  fetch.mockImplementation(async (url) => url === '/api/menu' ? response(catalog) : response({ canSubmit: false,
    items: catalog.map((i) => ({ ...i, swipeType: i.id === 'burger' ? 'Side' : i.swipeType, available: i.id !== 'tea' })),
    issues: [{ id: 'burger', code: 'changed', message: 'Burger now counts as Side.' }, { id: 'tea', code: 'unavailable', message: 'Tea is unavailable.' }] }));
  await openReview();
  expect(await screen.findByText('Burger now counts as Side.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Update my order' }));
  expect(screen.getByText('Sold out. Pick something else.')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)).reviewedTypes.burger).toBe('Side');
  expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)).items.tea).toBe(1);
});
it('handles a failed menu check and lets place order try again', async () => {
  fetch.mockRejectedValueOnce(new Error('Service offline')); render(<Checkout cart={meal()} catalog={catalog} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Service offline');
  fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled());
  expect(screen.queryByText(/This order looks good/)).not.toBeInTheDocument();
});
it('ignores stale validation response after cart changes', async () => {
  let resolve; fetch.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const { rerender } = render(<Checkout cart={meal()} catalog={catalog} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  rerender(<Checkout cart={{ ...meal(), items: {} }} catalog={catalog} />);
  await act(async () => resolve(response(validReview())));
  expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect(screen.getByText('Your order is empty.')).toBeInTheDocument();
});
it('preserves checkout through login navigation when storage is blocked', async () => {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal()));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  auth.getSession.mockResolvedValue({ data: { session: null } }); window.location.hash = '#menu'; render(<App />);
  await screen.findByRole('button', { name: 'Add Burger' });
  fireEvent.click(screen.getByRole('button', { name: 'Look over your order' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in and keep cart' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Look over your order' })).toBeVisible();
  expect(screen.getByText('1 meal swipe')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Look over your order' })).getByText('Entrée')).toBeVisible();
});
it('builds a meal through clicks and the header returns from checkout to the summary', async () => {
  render(<Menu />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Burger' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Fries' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Tea' }));
  expect(screen.getByRole('heading', { name: 'Look over your order' })).toBeInTheDocument();
  const review = screen.getByRole('region', { name: 'Look over your order' });
  expect(within(review).getByText('Entrée')).toBeInTheDocument();
  expect(within(review).getByText('Side')).toBeInTheDocument();
  expect(within(review).getByText('Drink')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Your meal 3' }));
  expect(screen.getByRole('heading', { name: 'Your meal (3)' })).toHaveFocus();
});
it('refreshes catalog without dropping a saved cart or its reviewed classifications', async () => {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal())); render(<Menu />);
  await screen.findByRole('button', { name: 'Add Burger' });
  fetch.mockResolvedValueOnce(response(catalog.map((i) => ({ ...i, available: i.id !== 'burger' }))));
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByText(/Sold out. Pick something else./);
  expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)).items.burger).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Look over your order' }));
  expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
});
