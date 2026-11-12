// US3: placing an order from checkout. Supabase and fetch are faked; Menu, Checkout, the cart
// rules and browser storage are real. After a save, Menu hands the order to App, which opens
// the US4 confirmation page (covered in order-tracking.integration.test.jsx).
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY } from './cart.js';
import Menu from './Menu.jsx';
import { getSupabase } from './supabase.js';

vi.mock('./CrowdMeter.jsx', () => ({ CrowdMeter: () => null, CrowdMeterControls: () => null }));
vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));

const catalog = [
  { id: 'burger', name: 'Burger', category: 'Grill Main', swipeType: 'Entry', available: true, description: '', label: '' },
  { id: 'fries', name: 'Fries', category: 'Sides', swipeType: 'Side', available: true, description: '', label: '' },
  { id: 'tea', name: 'Tea', category: 'Drinks', swipeType: 'Drink', available: true, description: '', label: '' },
];
const meal = { swipes: 1, items: { burger: 1, fries: 1, tea: 1 }, reviewedTypes: { burger: 'Entry', fries: 'Side', tea: 'Drink' } };
const order = {
  id: '0a1b2c3d-0000-4000-8000-000000000001', status: 'Received', swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [
    { id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 },
    { id: 'fries', name: 'Fries', swipeType: 'Side', quantity: 1 },
    { id: 'tea', name: 'Tea', swipeType: 'Drink', quantity: 1 },
  ],
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const validReview = () => ({ items: catalog.map((item) => ({ ...item, quantity: 1 })), counts: { Entry: 1, Side: 1, Drink: 1 }, swipes: 1, issues: [], canSubmit: true });

let orderResponses;
let reviewResponses;
let onOrderPlaced;

beforeEach(() => {
  localStorage.clear();
  getSupabase.mockReturnValue({ auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
  } });
  orderResponses = [];
  reviewResponses = [];
  onOrderPlaced = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/menu') return response(catalog);
    if (url === '/api/checkout/review') return reviewResponses.shift() ?? response(validReview());
    if (url === '/api/orders') return orderResponses.shift() ?? response(order, 201);
    throw new Error(`Unexpected request to ${url}`);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function orderCalls() {
  return fetch.mock.calls.filter(([url]) => url === '/api/orders');
}

function savedCart() {
  return JSON.parse(localStorage.getItem(CART_STORAGE_KEY));
}

async function openValidatedReview() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal));
  const user = userEvent.setup();
  render(<Menu onOrderPlaced={onOrderPlaced} />);
  await screen.findByRole('button', { name: 'Add Burger' });
  await user.click(screen.getByRole('button', { name: 'Look over your order' }));
  await screen.findByRole('button', { name: 'Place order' });
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled());
  return user;
}

describe('Placing an order', () => {
  it('only offers Place order after a valid review', async () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(meal));
    const user = userEvent.setup();
    render(<Menu />);
    await screen.findByRole('button', { name: 'Add Burger' });
    await user.click(screen.getByRole('button', { name: 'Look over your order' }));

    expect(screen.queryByRole('button', { name: 'Check my order' })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled());
    expect(screen.queryByText(/This order looks good/)).not.toBeInTheDocument();
  });

  it('sends the meal with the login token and a checkout key, then clears the cart', async () => {
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    await vi.waitFor(() => expect(onOrderPlaced).toHaveBeenCalledWith(order));
    const [[, request]] = orderCalls();
    const body = JSON.parse(request.body);
    expect(request.headers.Authorization).toBe('Bearer test-token');
    expect(body.swipes).toBe(1);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.items).toEqual([
      { id: 'burger', quantity: 1, expectedSwipeType: 'Entry' },
      { id: 'fries', quantity: 1, expectedSwipeType: 'Side' },
      { id: 'tea', quantity: 1, expectedSwipeType: 'Drink' },
    ]);
    expect(savedCart().items).toEqual({});
    expect(savedCart()).not.toHaveProperty('checkoutKey');
    expect(screen.getByRole('heading', { name: 'Your meal (0)' })).toBeInTheDocument();
  });

  it('retries a failed attempt with the same checkout key and keeps the cart meanwhile', async () => {
    orderResponses.push(response({ detail: 'Could not save your order.' }, 503));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByText(/Could not place your order/)).toBeInTheDocument();
    expect(savedCart().items).toEqual(meal.items);
    const firstKey = JSON.parse(orderCalls()[0][1].body).idempotencyKey;
    expect(savedCart().checkoutKey).toBe(firstKey);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    await vi.waitFor(() => expect(onOrderPlaced).toHaveBeenCalledWith(order));
    expect(JSON.parse(orderCalls()[1][1].body).idempotencyKey).toBe(firstKey);
  });

  it('explains an order limit and keeps the cart (SEC-03)', async () => {
    const limit = 'You already have 3 orders in progress. Pick one up or cancel one before ordering again.';
    orderResponses.push(response({ detail: limit }, 429));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(limit);
    expect(onOrderPlaced).not.toHaveBeenCalled();
    expect(savedCart().items).toEqual(meal.items);
  });

  it('falls back to a general limit message when the 429 has no reason', async () => {
    orderResponses.push(response({}, 429));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You have too many orders right now.');
  });

  it('shows the latest review when the menu changed before ordering, and keeps the cart', async () => {
    orderResponses.push(response({ detail: { message: 'Your meal needs review before ordering.', issues: [] } }, 409));
    reviewResponses.push(response(validReview()), response({
      ...validReview(), canSubmit: false,
      issues: [{ id: 'tea', code: 'unavailable', message: 'Tea is unavailable. Remove it before continuing.' }],
    }));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByText('Tea is unavailable. Remove it before continuing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    expect(onOrderPlaced).not.toHaveBeenCalled();
    expect(savedCart().items).toEqual(meal.items);
  });

  it('asks the student to sign in again when the session expired', async () => {
    orderResponses.push(response({ detail: 'Sign in required.' }, 401));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('button', { name: 'Sign in and keep cart' })).toBeInTheDocument();
    expect(savedCart().items).toEqual(meal.items);
  });

  it('disables Place order while the order is being saved', async () => {
    let finish;
    orderResponses.push(new Promise((resolve) => { finish = resolve; }));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByRole('button', { name: 'Placing order…' })).toBeDisabled();
    finish(response(order, 201));
    await vi.waitFor(() => expect(onOrderPlaced).toHaveBeenCalledWith(order));
  });

  it('opens no confirmation when the order was not saved', async () => {
    orderResponses.push(response({ detail: 'Could not save your order.' }, 503));
    const user = await openValidatedReview();

    await user.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByText(/Could not place your order/)).toBeInTheDocument();
    expect(onOrderPlaced).not.toHaveBeenCalled();
  });
});


it('acknowledges a saved order after Back to cart unmounts checkout', async () => {
  let finish;
  orderResponses.push(new Promise((resolve) => { finish = resolve; }));
  const user = await openValidatedReview();
  await user.click(screen.getByRole('button', { name: 'Place order' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await act(async () => { finish(response(order, 201)); });
  expect(savedCart().items).toEqual({});
  expect(onOrderPlaced).toHaveBeenCalledWith(order);
});

it('keeps a newly edited cart when an earlier order finishes saving', async () => {
  let finish;
  orderResponses.push(new Promise((resolve) => { finish = resolve; }));
  const user = await openValidatedReview();
  await user.click(screen.getByRole('button', { name: 'Place order' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Clear order' }));
  await user.click(screen.getByRole('button', { name: 'Add Burger' }));
  await act(async () => { finish(response(order, 201)); });
  expect(savedCart().items).toEqual({ burger: 1 });
  expect(onOrderPlaced).toHaveBeenCalledWith(order);
});
