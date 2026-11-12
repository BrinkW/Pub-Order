// Unit tests for US4 notification rules: when a status change notifies, that it notifies once,
// that only the owner's orders count, and the optional browser notification.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserNotificationPermission, createStatusTracker, noticeFor, requestBrowserNotifications,
  showBrowserNotification, statusChangeFrom,
} from './order-notifications.js';

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const OTHER = '9f8e7d6c-0000-4000-8000-000000000002';

afterEach(() => vi.unstubAllGlobals());

describe('noticeFor', () => {
  it('tells the student to head to the counter when the order is ready', () => {
    expect(noticeFor(ID, 'Ready')).toEqual({
      id: `${ID}:Ready`, orderId: ID, status: 'Ready', number: '0A1B2C3D',
      title: 'Order #0A1B2C3D is ready for pickup', body: 'Head to the Pub counter and give them your order number.',
    });
    expect(noticeFor(ID, 'Preparing').title).toBe('Order #0A1B2C3D is being prepared');
  });
});

describe('createStatusTracker', () => {
  it('notifies when a known order moves to Preparing and then Ready', () => {
    const tracker = createStatusTracker();
    tracker.seed([{ id: ID, status: 'Received' }]);

    expect(tracker.change(ID, 'Preparing')?.status).toBe('Preparing');
    expect(tracker.change(ID, 'Ready')?.status).toBe('Ready');
  });

  it('notifies each change once, even when Realtime and a poll both report it', () => {
    const tracker = createStatusTracker();
    tracker.seed([{ id: ID, status: 'Preparing' }]);

    expect(tracker.change(ID, 'Ready', { unknownIsNew: true })).not.toBeNull();
    expect(tracker.change(ID, 'Ready')).toBeNull();
    expect(tracker.change(ID, 'Ready', { unknownIsNew: true })).toBeNull();
  });

  it('does not announce Ready again after a stale read briefly showed an older status', () => {
    // Realtime reports Ready, then a slow poll that started earlier lands with Preparing,
    // then the next poll sees Ready again. The student hears about Ready once.
    const tracker = createStatusTracker();
    tracker.seed([{ id: ID, status: 'Preparing' }]);

    expect(tracker.change(ID, 'Ready', { unknownIsNew: true })).not.toBeNull();
    expect(tracker.change(ID, 'Preparing')).toBeNull();
    expect(tracker.change(ID, 'Ready')).toBeNull();
  });

  it('does not announce statuses the student already had when the page opened', () => {
    const tracker = createStatusTracker();
    tracker.seed([{ id: ID, status: 'Ready' }]);

    expect(tracker.change(ID, 'Ready', { unknownIsNew: true })).toBeNull();
  });

  it('stays quiet for Received, Collected and Cancelled', () => {
    const tracker = createStatusTracker();
    tracker.seed([{ id: ID, status: 'Ready' }, { id: OTHER, status: 'Received' }]);

    expect(tracker.change(ID, 'Collected')).toBeNull();
    expect(tracker.change(OTHER, 'Cancelled')).toBeNull();
  });

  it('only a Realtime event can announce an order this tab has not seen yet', () => {
    const tracker = createStatusTracker();

    expect(tracker.change(ID, 'Ready')).toBeNull();
    expect(tracker.change(OTHER, 'Ready', { unknownIsNew: true })?.orderId).toBe(OTHER);
  });

  it('starts watching an order placed in this tab without announcing it', () => {
    const tracker = createStatusTracker();
    expect(tracker.hasOpenOrders()).toBe(false);

    tracker.track({ id: ID, status: 'Received' });

    expect(tracker.hasOpenOrders()).toBe(true);
    expect(tracker.change(ID, 'Ready')?.status).toBe('Ready');
    tracker.change(ID, 'Collected');
    expect(tracker.hasOpenOrders()).toBe(false);
  });
});

describe('statusChangeFrom', () => {
  it('reads an order id and status from a Realtime row or an API order', () => {
    expect(statusChangeFrom({ id: ID, status: 'Ready', user_id: 'student-1' }, 'student-1')).toEqual({ orderId: ID, status: 'Ready' });
    expect(statusChangeFrom({ id: ID, status: 'Ready' }, 'student-1')).toEqual({ orderId: ID, status: 'Ready' });
  });

  it('ignores rows owned by someone else and rows that are not orders', () => {
    expect(statusChangeFrom({ id: ID, status: 'Ready', user_id: 'student-2' }, 'student-1')).toBeNull();
    expect(statusChangeFrom({ id: 'not-an-id', status: 'Ready' }, 'student-1')).toBeNull();
    expect(statusChangeFrom({ id: ID }, 'student-1')).toBeNull();
    expect(statusChangeFrom(undefined, 'student-1')).toBeNull();
  });
});

function fakeNotificationApi(permission) {
  const shown = [];
  function FakeNotification(title, options) {
    this.title = title;
    this.options = options;
    this.close = vi.fn();
    shown.push(this);
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = vi.fn(async () => 'granted');
  vi.stubGlobal('Notification', FakeNotification);
  return shown;
}

describe('browser notifications', () => {
  it('shows one when the student allowed it, and opening it opens the order', () => {
    const shown = fakeNotificationApi('granted');
    const onOpen = vi.fn();

    showBrowserNotification(noticeFor(ID, 'Ready'), onOpen);

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Order #0A1B2C3D is ready for pickup');
    expect(shown[0].options.tag).toBe(`pub-order-${ID}:Ready`);
    shown[0].onclick();
    expect(onOpen).toHaveBeenCalledWith(ID);
    expect(shown[0].close).toHaveBeenCalled();
  });

  it.each(['default', 'denied'])('shows nothing when permission is %s', (permission) => {
    const shown = fakeNotificationApi(permission);

    expect(showBrowserNotification(noticeFor(ID, 'Ready'))).toBeNull();
    expect(shown).toHaveLength(0);
  });

  it('reports and requests permission', async () => {
    fakeNotificationApi('default');
    expect(browserNotificationPermission()).toBe('default');
    await expect(requestBrowserNotifications()).resolves.toBe('granted');
  });

  it('copes with browsers without the Notification API', async () => {
    vi.stubGlobal('Notification', undefined);
    delete window.Notification;

    expect(browserNotificationPermission()).toBe('unsupported');
    await expect(requestBrowserNotifications()).resolves.toBe('unsupported');
    expect(showBrowserNotification(noticeFor(ID, 'Ready'))).toBeNull();
  });
});
