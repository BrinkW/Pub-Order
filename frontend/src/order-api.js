// Reading a student's saved orders (US4 confirmation, US6 pickup tracking).
// The backend returns 404 for an order that is missing or belongs to someone else, so the
// page cannot tell the two apart and never reveals another student's order.
import { getSupabase } from './supabase.js';
import { CANCELLED, isOrder, isOrderId } from './order-status.js';

const LOAD_FAILED = 'Could not load your order. Please try again.';
const LIST_FAILED = 'Could not load your orders. Please try again.';

async function accessToken() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data?.session?.access_token || null;
}

function getJson(url, token, signal) {
  return fetch(url, { signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
}

// Returns { order }, { notFound } or { signInRequired }. Throws when the request fails.
export async function loadOrder(orderId, signal) {
  if (!isOrderId(orderId)) return { notFound: true };
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await getJson(`/api/orders/${orderId}`, token, signal);
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(LOAD_FAILED);
  const order = await response.json().catch(() => null);
  if (!isOrder(order) || order.id !== orderId) throw new Error(LOAD_FAILED);
  return { order };
}

// Order history (US2) asks for this many orders at a time.
export const HISTORY_PAGE_SIZE = 20;

// Returns { orders } (newest first) or { signInRequired }. Throws when the request fails.
// With no options this is the newest page the server allows (the kitchen board uses that).
// `limit`, `before` and `beforeId` (the createdAt and id of the oldest order shown) page back
// through a student's history. The id breaks ties between orders placed at the same instant.
export async function loadOrders(signal, { limit, before, beforeId } = {}) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const query = new URLSearchParams();
  if (limit) query.set('limit', String(limit));
  if (before) query.set('before', before);
  if (before && beforeId) query.set('beforeId', beforeId);
  const url = query.size ? `/api/orders?${query}` : '/api/orders';
  const response = await getJson(url, token, signal);
  if (response.status === 401) return { signInRequired: true };
  if (!response.ok) throw new Error(LIST_FAILED);
  const orders = await response.json().catch(() => null);
  if (!Array.isArray(orders) || !orders.every(isOrder)) throw new Error(LIST_FAILED);
  return { orders };
}

const CANCEL_FAILED = 'Could not cancel this order. Please try again.';

// US23. Returns { order }, { signInRequired }, { notFound } or { tooLate } (the kitchen has
// already started it). Throws when the request fails.
export async function cancelOrder(orderId) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await fetch(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 404) return { notFound: true };
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    return { tooLate: true, message: typeof body?.detail === 'string' ? body.detail : undefined };
  }
  if (!response.ok) throw new Error(CANCEL_FAILED);
  const order = await response.json().catch(() => null);
  // If the server couldn't read the order back after cancelling, it confirms with just the id and status.
  const confirmed = order?.id === orderId && order?.status === CANCELLED;
  if (!(isOrder(order) || confirmed) || order.id !== orderId) throw new Error(CANCEL_FAILED);
  return { order };
}

const UPDATE_FAILED = 'Could not update this order. Please try again.';

// Kitchen staff only. Returns { order }, { signInRequired }, { forbidden } or { notFound }.
export async function updateOrderStatus(orderId, status) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await fetch(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 403) return { forbidden: true };
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(UPDATE_FAILED);
  const order = await response.json().catch(() => null);
  if (!isOrder(order) || order.id !== orderId) throw new Error(UPDATE_FAILED);
  return { order };
}

const NOTIFY_FAILED = 'Could not email this student. Please try again.';

// Kitchen staff only. Sends the current order status to the email captured at checkout.
export async function emailStudent(orderId) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await fetch(`/api/orders/${orderId}/notification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 403) return { forbidden: true };
  if (response.status === 404) return { notFound: true };
  if (response.status === 409) return { noEmail: true };
  if (!response.ok) throw new Error(NOTIFY_FAILED);
  const result = await response.json().catch(() => null);
  if (!result?.delivered) throw new Error(NOTIFY_FAILED);
  return { delivered: true };
}
