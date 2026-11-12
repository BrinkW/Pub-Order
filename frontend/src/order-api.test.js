// Unit tests for reading saved orders from the API (US4, US6). Supabase and fetch are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelOrder, emailStudent, loadOrder, loadOrders, updateOrderStatus } from './order-api.js';
import { getSupabase } from './supabase.js';

vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const order = {
  id: ID, status: 'Preparing', swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [{ id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 }],
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  getSupabase.mockReturnValue({ auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
  } });
  vi.stubGlobal('fetch', vi.fn(async () => response(order)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadOrder', () => {
  it('reads one order with the login token and without the browser cache', async () => {
    await expect(loadOrder(ID)).resolves.toEqual({ order });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`/api/orders/${ID}`);
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.cache).toBe('no-store');
  });

  it('treats a malformed id as not found without calling the API', async () => {
    await expect(loadOrder('../orders')).resolves.toEqual({ notFound: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks a guest to sign in without calling the API', async () => {
    getSupabase.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } });
    await expect(loadOrder(ID)).resolves.toEqual({ signInRequired: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for sign-in when Supabase is not configured or the session read fails', async () => {
    getSupabase.mockReturnValue(null);
    await expect(loadOrder(ID)).resolves.toEqual({ signInRequired: true });
    getSupabase.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: null, error: new Error('x') }) } });
    await expect(loadOrder(ID)).resolves.toEqual({ signInRequired: true });
  });

  it('asks for sign-in again when the token expired', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'Sign in required.' }, 401));
    await expect(loadOrder(ID)).resolves.toEqual({ signInRequired: true });
  });

  it('reports another student’s order the same way as a missing one', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'Order not found.' }, 404));
    await expect(loadOrder(ID)).resolves.toEqual({ notFound: true });
  });

  it('throws a friendly error when the server fails', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'Could not load this order.' }, 503));
    await expect(loadOrder(ID)).rejects.toThrow('Could not load your order. Please try again.');
  });

  it('rejects a response that is not the requested order', async () => {
    fetch.mockResolvedValueOnce(response({ ...order, id: '0a1b2c3d-0000-4000-8000-000000000002' }));
    await expect(loadOrder(ID)).rejects.toThrow('Could not load your order');
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    await expect(loadOrder(ID)).rejects.toThrow('Could not load your order');
  });
});

describe('loadOrders', () => {
  it('asks for one page of history, then the page before the oldest order shown (US2)', async () => {
    fetch.mockResolvedValueOnce(response([order]));
    await loadOrders(undefined, { limit: 20 });
    expect(fetch.mock.calls[0][0]).toBe('/api/orders?limit=20');

    fetch.mockResolvedValueOnce(response([]));
    await expect(loadOrders(undefined, { limit: 20, before: order.createdAt, beforeId: ID })).resolves.toEqual({ orders: [] });
    expect(fetch.mock.calls[1][0]).toBe(`/api/orders?limit=20&before=2026-10-19T12%3A00%3A00%2B00%3A00&beforeId=${ID}`);
  });

  it('lists the student’s orders', async () => {
    fetch.mockResolvedValueOnce(response([order]));
    await expect(loadOrders()).resolves.toEqual({ orders: [order] });
    expect(fetch.mock.calls[0][0]).toBe('/api/orders');
  });

  it('asks a guest or an expired session to sign in', async () => {
    fetch.mockResolvedValueOnce(response({}, 401));
    await expect(loadOrders()).resolves.toEqual({ signInRequired: true });
    getSupabase.mockReturnValue(null);
    await expect(loadOrders()).resolves.toEqual({ signInRequired: true });
  });

  it('throws when the server fails or sends something that is not a list of orders', async () => {
    fetch.mockResolvedValueOnce(response({}, 500));
    await expect(loadOrders()).rejects.toThrow('Could not load your orders. Please try again.');
    fetch.mockResolvedValueOnce(response([{ id: 'nope' }]));
    await expect(loadOrders()).rejects.toThrow('Could not load your orders');
  });
});

describe('cancelOrder', () => {
  it('posts the cancel with the login token', async () => {
    fetch.mockResolvedValueOnce(response({ ...order, status: 'Cancelled' }));

    await expect(cancelOrder(ID)).resolves.toEqual({ order: { ...order, status: 'Cancelled' } });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`/api/orders/${ID}/cancel`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it.each([[401, { signInRequired: true }], [404, { notFound: true }]])(
    'reports a %i without throwing', async (status, expected) => {
      fetch.mockResolvedValueOnce(response({ detail: 'no' }, status));
      await expect(cancelOrder(ID)).resolves.toEqual(expected);
    },
  );

  it('passes on the server’s reason when it is too late to cancel', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'This order is ready for pickup, so it can’t be cancelled.' }, 409));
    await expect(cancelOrder(ID)).resolves.toEqual({
      tooLate: true, message: 'This order is ready for pickup, so it can’t be cancelled.',
    });
  });

  it('accepts a cancel confirmed with only the id and status', async () => {
    fetch.mockResolvedValueOnce(response({ id: ID, status: 'Cancelled' }));
    await expect(cancelOrder(ID)).resolves.toEqual({ order: { id: ID, status: 'Cancelled' } });
  });

  it('rejects a short reply that does not confirm the cancel', async () => {
    fetch.mockResolvedValueOnce(response({ id: ID, status: 'Received' }));
    await expect(cancelOrder(ID)).rejects.toThrow('Could not cancel this order. Please try again.');
  });

  it('throws a friendly error when the server fails', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'down' }, 503));
    await expect(cancelOrder(ID)).rejects.toThrow('Could not cancel this order. Please try again.');
  });
});

describe('updateOrderStatus', () => {
  it('sends the new status with the login token', async () => {
    fetch.mockResolvedValueOnce(response({ ...order, status: 'Ready' }));

    await expect(updateOrderStatus(ID, 'Ready')).resolves.toEqual({ order: { ...order, status: 'Ready' } });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`/api/orders/${ID}`);
    expect(options.method).toBe('PATCH');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(options.body)).toEqual({ status: 'Ready' });
  });

  it('reports a student account or a missing order without throwing', async () => {
    fetch.mockResolvedValueOnce(response({ detail: 'Kitchen access required.' }, 403));
    await expect(updateOrderStatus(ID, 'Ready')).resolves.toEqual({ forbidden: true });
    fetch.mockResolvedValueOnce(response({ detail: 'Order not found.' }, 404));
    await expect(updateOrderStatus(ID, 'Ready')).resolves.toEqual({ notFound: true });
  });
});

describe('emailStudent', () => {
  it('asks the backend to send an order notification', async () => {
    fetch.mockResolvedValueOnce(response({ delivered: true }));

    await expect(emailStudent(ID)).resolves.toEqual({ delivered: true });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`/api/orders/${ID}/notification`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('reports authorization, missing order, and old orders without email', async () => {
    fetch.mockResolvedValueOnce(response({}, 403));
    await expect(emailStudent(ID)).resolves.toEqual({ forbidden: true });
    fetch.mockResolvedValueOnce(response({}, 404));
    await expect(emailStudent(ID)).resolves.toEqual({ notFound: true });
    fetch.mockResolvedValueOnce(response({}, 409));
    await expect(emailStudent(ID)).resolves.toEqual({ noEmail: true });
  });
});
