// Order status rules shared by the confirmation page (US4), pickup tracking (US6) and the
// order list. An order moves through these four steps in order, unless the student cancels
// it while it is still Received (US23).
export const ORDER_STATUSES = ['Received', 'Preparing', 'Ready', 'Collected'];
export const CANCELLED = 'Cancelled';

// How often an open order page checks for a newer status. Collected orders stop checking.
export const STATUS_POLL_MS = 15000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEP_LABELS = {
  Received: 'Received',
  Preparing: 'Preparing',
  Ready: 'Ready for pickup',
  Collected: 'Picked up',
  Cancelled: 'Cancelled',
};

const MESSAGES = {
  Received: { title: 'Waiting for the kitchen', detail: 'The Pub has your order. It will move to Preparing once the kitchen starts on it.' },
  Preparing: { title: 'Being prepared', detail: 'The kitchen is making your order now. We will show it here as soon as it is ready.' },
  Ready: { title: 'Ready for pickup', detail: 'Head to the Pub counter and give them your order number.' },
  Collected: { title: 'Picked up', detail: 'This order has been collected. Enjoy your meal!' },
  Cancelled: { title: 'Cancelled', detail: 'You cancelled this order, so the kitchen will not make it.' },
};

export function isOrderId(value) {
  return typeof value === 'string' && UUID.test(value);
}

// The first 8 characters are enough for staff to find the order at the counter.
export function shortOrderId(id) {
  return String(id).slice(0, 8).toUpperCase();
}

export function stepLabel(status) {
  return STEP_LABELS[status] ?? status;
}

export function statusMessage(status) {
  return MESSAGES[status] ?? { title: status, detail: '' };
}

// Each step is done, current or upcoming relative to the order's status.
export function statusSteps(status) {
  const current = ORDER_STATUSES.indexOf(status);
  return ORDER_STATUSES.map((step, index) => ({
    status: step,
    label: stepLabel(step),
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
  }));
}

// An order still needs live updates until it has been picked up or cancelled.
export function isOpenOrder(order) {
  return Boolean(order) && order.status !== 'Collected' && order.status !== CANCELLED;
}

// Students can cancel only until the kitchen starts the order. The server enforces this too.
export function canCancel(order) {
  return order?.status === 'Received';
}

export function swipeLabel(swipes) {
  return `${swipes} meal ${swipes === 1 ? 'swipe' : 'swipes'}`;
}

export function formatPlacedAt(createdAt, now = new Date()) {
  const placed = new Date(createdAt);
  if (Number.isNaN(placed.getTime())) return '';
  const time = placed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (placed.toDateString() === now.toDateString()) return `today at ${time}`;
  return `${placed.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

// Rejects anything that is not an order the API would send, so a bad response shows the
// error state instead of a half-drawn page.
export function isOrder(value) {
  return Boolean(value) && isOrderId(value.id) &&
    (ORDER_STATUSES.includes(value.status) || value.status === CANCELLED) &&
    Number.isInteger(value.swipes) && value.swipes > 0 && Array.isArray(value.items) &&
    value.items.every((item) => item && typeof item.name === 'string' && Number.isInteger(item.quantity));
}
