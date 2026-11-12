// Order again (US-29): turn a past order back into a cart, using today's menu.
// Items that are sold out or gone from the menu are left out, and the student is told which.
import { MAX_SWIPES, SWIPE_TYPES, emptyCart } from './cart.js';
import { optionsFor } from './customizations.js';
import { shortOrderId } from './order-status.js';

const STEP_FOR_TYPE = { Entry: 'entry', Side: 'side', Drink: 'drink' };

// A saved order stores customizations as text ("No onion, Ketchup"). Map each phrase back to
// today's option for that item; a phrase the item no longer offers is dropped.
function optionIdsFrom(menuItem, text) {
  if (!text) return [];
  const phrases = new Set(text.split(',').map((phrase) => phrase.trim()).filter(Boolean));
  return optionsFor(menuItem).filter((option) => phrases.has(option.text)).map((option) => option.id).sort();
}

// Returns { cart, added, skipped } where skipped is [{ name, reason }]. The cart is new (no
// checkout key), so placing it is a new order, never a retry of the old one.
export function reorderCart(order, catalog) {
  const swipes = Math.min(Math.max(Number.isInteger(order?.swipes) ? order.swipes : 1, 1), MAX_SWIPES);
  const cart = { ...emptyCart(), swipes };
  const added = [];
  const skipped = [];
  for (const item of order?.items || []) {
    const menuItem = catalog.find((candidate) => candidate.id === item.id);
    if (!menuItem) { skipped.push({ name: item.name, swipeType: item.swipeType, reason: 'no longer on the menu' }); continue; }
    if (!menuItem.available) { skipped.push({ name: menuItem.name, swipeType: menuItem.swipeType, reason: 'sold out' }); continue; }
    const quantity = Math.min(item.quantity, MAX_SWIPES);
    cart.items[item.id] = (cart.items[item.id] || 0) + quantity;
    cart.reviewedTypes[item.id] = menuItem.swipeType;
    const options = optionIdsFrom(menuItem, item.customization);
    if (options.length) cart.customizations[item.id] = options;
    added.push(menuItem.name);
  }
  // The old order had no side on purpose (US-25), so keep it that way. If its side was left
  // out because it's sold out, the student needs to pick a new one instead.
  const hadSide = (order?.items || []).some((item) => item.swipeType === 'Side');
  if (!hadSide && added.length) cart.noSide = true;
  return { cart, added, skipped };
}

// Where the menu should open after a reorder: the first step that's now missing something,
// or straight to review when the whole order came back.
export function stepAfterReorder(result) {
  const missing = SWIPE_TYPES.find((type) => result.skipped.some((item) => item.swipeType === type));
  return missing ? STEP_FOR_TYPE[missing] : 'review';
}

export function reorderMessage(order, result, { replacedCart = false } = {}) {
  const number = shortOrderId(order.id);
  if (!result.added.length) {
    return `Nothing from order #${number} is available right now, so your order wasn’t changed.`;
  }
  const parts = [`Order #${number} is back in your order.`];
  if (result.skipped.length) {
    const list = result.skipped.map((item) => `${item.name} (${item.reason})`).join(', ');
    parts.push(`We left out ${list}. Pick a replacement before you send it.`);
  } else {
    parts.push('Check it and send it when you’re ready.');
  }
  if (replacedCart) parts.push('This replaced what you had in your order before.');
  return parts.join(' ');
}
