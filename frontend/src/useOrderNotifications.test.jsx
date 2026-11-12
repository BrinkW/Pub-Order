// Tests for the US4 watcher: Supabase Realtime pushes, the polling fallback, and that each
// change reaches the student once. Supabase and the orders API are faked.
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrders } from './order-api.js';
import { STATUS_POLL_MS } from './order-status.js';
import { getSupabase } from './supabase.js';
import { useOrderNotifications } from './useOrderNotifications.js';

vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));
vi.mock('./order-api.js', () => ({ HISTORY_PAGE_SIZE: 20, loadOrders: vi.fn() }));

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const order = (status) => ({ id: ID, status, swipes: 1, items: [] });

// A stand-in for supabase.channel(): records the subscription and lets a test push an event
// or report the connection status.
let channel;
function fakeRealtime() {
  channel = {
    listeners: [],
    on: vi.fn((type, filter, callback) => { channel.listeners.push({ type, filter, callback }); return channel; }),
    subscribe: vi.fn((callback) => { channel.status = callback; return channel; }),
    push: (row) => act(() => channel.listeners.forEach((listener) => listener.callback({ new: row }))),
    connect: (status) => act(() => channel.status(status)),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
  getSupabase.mockReturnValue(client);
  return client;
}

let hook;
function Watcher(props) {
  hook = useOrderNotifications(props);
  return null;
}

async function watch(props = {}) {
  const onNotice = vi.fn();
  const onOpenOrder = vi.fn();
  const view = render(<Watcher userId="student-1" enabled onNotice={onNotice} onOpenOrder={onOpenOrder} {...props} />);
  await act(async () => {});
  return { onNotice, onOpenOrder, view };
}

beforeEach(() => {
  loadOrders.mockResolvedValue({ orders: [order('Preparing')] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Realtime order updates', () => {
  it('subscribes only to the signed-in student’s order updates', async () => {
    const client = fakeRealtime();
    const { view } = await watch();

    expect(client.channel).toHaveBeenCalledWith('order-updates:student-1');
    expect(channel.listeners[0].type).toBe('postgres_changes');
    expect(channel.listeners[0].filter).toEqual({ event: 'UPDATE', schema: 'public', table: 'orders', filter: 'user_id=eq.student-1' });

    view.unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('tells the student once when the kitchen marks their order Ready', async () => {
    fakeRealtime();
    const { onNotice } = await watch();
    channel.connect('SUBSCRIBED');

    channel.push({ id: ID, status: 'Ready', user_id: 'student-1' });
    channel.push({ id: ID, status: 'Ready', user_id: 'student-1' });

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0]).toMatchObject({ orderId: ID, status: 'Ready', title: 'Order #0A1B2C3D is ready for pickup' });
  });

  it('ignores an update for someone else’s order', async () => {
    fakeRealtime();
    const { onNotice } = await watch();

    channel.push({ id: ID, status: 'Ready', user_id: 'student-2' });

    expect(onNotice).not.toHaveBeenCalled();
  });

  it('also shows a browser notification when the student allowed them', async () => {
    const shown = [];
    function FakeNotification(title) { this.title = title; shown.push(this); }
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
    fakeRealtime();
    const { onOpenOrder } = await watch();

    channel.push({ id: ID, status: 'Ready', user_id: 'student-1' });
    shown[0].onclick();

    expect(shown.map((item) => item.title)).toEqual(['Order #0A1B2C3D is ready for pickup']);
    expect(onOpenOrder).toHaveBeenCalledWith(ID);
  });

  it('does nothing for kitchen staff or signed-out visitors', async () => {
    const client = fakeRealtime();
    await watch({ enabled: false });
    await watch({ userId: '' });

    expect(client.channel).not.toHaveBeenCalled();
    expect(loadOrders).not.toHaveBeenCalled();
  });
});

describe('polling fallback', () => {
  it('polls while Realtime is down and an order is in progress, and notifies once', async () => {
    vi.useFakeTimers();
    fakeRealtime();
    const { onNotice } = await watch();
    channel.connect('CHANNEL_ERROR');
    loadOrders.mockResolvedValue({ orders: [order('Ready')] });

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });

    expect(loadOrders).toHaveBeenCalledWith(expect.anything(), { limit: 20 });
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0].status).toBe('Ready');
  });

  it('polls when the Supabase client has no Realtime at all', async () => {
    vi.useFakeTimers();
    getSupabase.mockReturnValue(null);
    const { onNotice } = await watch();
    loadOrders.mockResolvedValue({ orders: [order('Ready')] });

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });

    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('does not poll while Realtime is connected', async () => {
    vi.useFakeTimers();
    fakeRealtime();
    await watch();
    channel.connect('SUBSCRIBED');
    const loadsBefore = loadOrders.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3); });

    expect(loadOrders.mock.calls.length).toBe(loadsBefore);
  });

  it('does not poll when every order is finished, until a new one is placed', async () => {
    vi.useFakeTimers();
    getSupabase.mockReturnValue(null);
    loadOrders.mockResolvedValue({ orders: [order('Collected')] });
    const { onNotice } = await watch();
    const loadsBefore = loadOrders.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 2); });
    expect(loadOrders.mock.calls.length).toBe(loadsBefore);

    const placed = { ...order('Received'), id: '9f8e7d6c-0000-4000-8000-000000000002' };
    act(() => hook.track(placed));
    loadOrders.mockResolvedValue({ orders: [{ ...placed, status: 'Preparing' }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0].status).toBe('Preparing');
  });

  it('keeps going after a failed poll', async () => {
    vi.useFakeTimers();
    getSupabase.mockReturnValue(null);
    const { onNotice } = await watch();
    loadOrders.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ orders: [order('Ready')] });

    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });
    expect(onNotice).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_POLL_MS); });

    expect(onNotice).toHaveBeenCalledTimes(1);
  });
});
