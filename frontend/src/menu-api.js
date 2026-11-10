import { getSupabase } from './supabase.js';
import { SWIPE_TYPES } from './cart.js';

export async function loadMenu(signal) {
  const response = await fetch('/api/menu', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Menu is temporarily unavailable. Please try again.');
  const items = await response.json();
  if (!Array.isArray(items) || items.some((item) => !item || typeof item.id !== 'string' || !item.id ||
    typeof item.name !== 'string' || typeof item.category !== 'string' || !SWIPE_TYPES.includes(item.swipeType) ||
    typeof item.available !== 'boolean') || new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('The menu could not be loaded. Please try again.');
  }
  return items;
}

async function accessToken() {
  const supabase = getSupabase();
  const { data, error } = supabase ? await supabase.auth.getSession() : { data: null };
  return error ? null : data?.session?.access_token || null;
}

function cartItems(cart, catalog) {
  return Object.entries(cart.items).map(([id, quantity]) => {
    const item = {
      id,
      quantity,
      expectedSwipeType: cart.reviewedTypes?.[id] || catalog.find((menuItem) => menuItem.id === id)?.swipeType,
    };
    const customizations = cart.customizations?.[id] || [];
    if (customizations.length > 0) item.customizations = customizations;
    return item;
  });
}

function postJson(url, token, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export async function reviewCart(cart, catalog) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await postJson('/api/checkout/review', token, { swipes: cart.swipes, items: cartItems(cart, catalog) });
  if (response.status === 401) return { signInRequired: true };
  if (!response.ok) throw new Error(response.status === 422 ? 'Something in this order needs a change. Check it and try again.' : 'Could not check the latest menu. Your order is still here; please try again.');
  return response.json();
}

// Returns { order }, { issues, message } when the meal needs review, or { signInRequired }.
// The cart's checkoutKey makes retries safe: the server returns the same order for it.
export async function placeOrder(cart, catalog) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await postJson('/api/orders', token, {
    swipes: cart.swipes, idempotencyKey: cart.checkoutKey, items: cartItems(cart, catalog),
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return { issues: body.detail?.issues ?? [], message: body.detail?.message || 'Your meal needs review before ordering.' };
  }
  if (!response.ok) throw new Error('Could not place your order. Your cart is still here; please try again.');
  return { order: await response.json() };
}

// Kitchen staff only. Returns { item }, { signInRequired }, { forbidden } or { notFound }.
export async function setItemAvailability(itemId, available) {
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await fetch(`/api/menu/${itemId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ available }),
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 403) return { forbidden: true };
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error('Could not update this item. Please try again.');
  const item = await response.json().catch(() => null);
  if (!item || item.id !== itemId || typeof item.available !== 'boolean') {
    throw new Error('Could not update this item. Please try again.');
  }
  return { item };
}
