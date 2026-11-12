// Student notifications (US4): decide when a status change deserves a notification, make sure
// each change notifies only once, and show the optional browser notification.
// The React side (Supabase Realtime plus a polling fallback) lives in useOrderNotifications.js.
import { isOrderId, shortOrderId } from './order-status.js';

// The kitchen moves an order to these. Received is where every order starts, Collected happens
// at the counter with the student standing there, and Cancelled is the student's own action,
// so none of those needs a notification.
export const NOTIFY_STATUSES = ['Preparing', 'Ready'];

export function noticeFor(orderId, status) {
  const number = shortOrderId(orderId);
  const base = { id: `${orderId}:${status}`, orderId, status, number };
  if (status === 'Ready') {
    return { ...base, title: `Order #${number} is ready for pickup`, body: 'Head to the Pub counter and give them your order number.' };
  }
  return { ...base, title: `Order #${number} is being prepared`, body: 'The kitchen has started on it. We’ll tell you when it’s ready.' };
}

// Remembers the last status seen for each of the student's orders, from any source (the first
// load, a Realtime event, a poll, or an order just placed in this tab). A notice comes back only
// the first time an order is seen moving to a status in NOTIFY_STATUSES, so the same change
// arriving over Realtime and then again from a poll notifies once.
export function createStatusTracker() {
  const known = new Map();
  const notified = new Set();

  function record(orderId, status) {
    known.set(orderId, status);
  }

  return {
    // Orders the student already had when the page opened. These never notify, so refreshing
    // the page while an order is Ready doesn't announce it again.
    seed(orders) {
      for (const order of orders) {
        record(order.id, order.status);
        notified.add(`${order.id}:${order.status}`);
      }
    },
    track(order) {
      if (!known.has(order.id)) record(order.id, order.status);
    },
    // `unknownIsNew`: a Realtime UPDATE is always a real change, so an order this tab hasn't
    // seen (placed in another tab) still notifies. A poll can't tell, so it records quietly.
    change(orderId, status, { unknownIsNew = false } = {}) {
      const previous = known.get(orderId);
      record(orderId, status);
      if (previous === status) return null;
      if (previous === undefined && !unknownIsNew) return null;
      if (!NOTIFY_STATUSES.includes(status)) return null;
      const key = `${orderId}:${status}`;
      if (notified.has(key)) return null;
      notified.add(key);
      return noticeFor(orderId, status);
    },
    hasOpenOrders() {
      return [...known.values()].some((status) => status !== 'Collected' && status !== 'Cancelled');
    },
  };
}

// A Realtime payload or API row, reduced to what the tracker needs. Anything else is ignored,
// including a row that names a different owner (Realtime already filters by row-level security
// and user_id; this is a last check in the browser).
export function statusChangeFrom(row, userId) {
  if (!row || !isOrderId(row.id) || typeof row.status !== 'string') return null;
  if (row.user_id !== undefined && row.user_id !== userId) return null;
  return { orderId: row.id, status: row.status };
}

function browserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window ? window.Notification : null;
}

// 'unsupported', 'default' (not asked yet), 'granted' or 'denied'.
export function browserNotificationPermission() {
  return browserNotifications()?.permission ?? 'unsupported';
}

export async function requestBrowserNotifications() {
  const api = browserNotifications();
  if (!api) return 'unsupported';
  try {
    return await api.requestPermission();
  } catch {
    return api.permission;
  }
}

// Shows the browser notification if the student allowed it. The tag makes the browser replace
// a duplicate (two open tabs) instead of stacking it. Clicking it opens that order.
export function showBrowserNotification(notice, onOpen) {
  const api = browserNotifications();
  if (!api || api.permission !== 'granted') return null;
  try {
    const shown = new api(notice.title, { body: notice.body, tag: `pub-order-${notice.id}` });
    shown.onclick = () => {
      window.focus?.();
      onOpen?.(notice.orderId);
      shown.close?.();
    };
    return shown;
  } catch {
    // Some mobile browsers only allow notifications from a service worker. The in-app notice
    // still shows, so there is nothing else to do.
    return null;
  }
}
