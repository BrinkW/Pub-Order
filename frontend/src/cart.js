import { allowedOptionIds, customizationText } from './customizations.js';

export const CART_STORAGE_KEY = 'pub-order.sample-cart.v1';
export const MAX_SWIPES = 10;
export const SWIPE_TYPES = ['Entry', 'Side', 'Drink'];
export const emptyCart = () => ({ swipes: 1, items: {}, reviewedTypes: {}, customizations: {} });
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validQuantity = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_SWIPES;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A checkout key identifies one order attempt, so retrying a failed submission can't
// create a duplicate order. Any change to the cart makes it a new order with a new key.
export function withCheckoutKey(cart) {
  return cart.checkoutKey ? cart : { ...cart, checkoutKey: crypto.randomUUID() };
}

function changed(cart) {
  const next = { ...cart };
  delete next.checkoutKey;
  return next;
}

// Restore before the asynchronous catalog arrives. Keep removed IDs so users can
// see and remove them instead of silently losing part of their intended order.
export function restoreCart(serialized) {
  try {
    const value = JSON.parse(serialized);
    if (!record(value) || !validQuantity(value.swipes) || !record(value.items)) return emptyCart();
    const entries = Object.entries(value.items).filter(([id, quantity]) =>
      id.length > 0 && id.length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(id) && validQuantity(quantity));
    const itemIds = new Set(entries.map(([id]) => id));
    const savedOptions = record(value.customizations) ? value.customizations : {};
    const customizations = Object.fromEntries(Object.entries(savedOptions).flatMap(([id, selected]) => {
      if (!itemIds.has(id) || !Array.isArray(selected)) return [];
      const allowed = allowedOptionIds({ id });
      const options = [...new Set(selected.filter((optionId) => typeof optionId === 'string' && allowed.has(optionId)))].sort();
      return options.length ? [[id, options]] : [];
    }));
    return {
      swipes: value.swipes,
      items: Object.fromEntries(entries),
      reviewedTypes: Object.fromEntries(entries.filter(([id]) => SWIPE_TYPES.includes(value.reviewedTypes?.[id])).map(([id]) => [id, value.reviewedTypes[id]])),
      customizations,
      ...(value.noSide === true ? { noSide: true } : {}),
      ...(typeof value.checkoutKey === 'string' && UUID.test(value.checkoutKey) ? { checkoutKey: value.checkoutKey } : {}),
    };
  } catch { return emptyCart(); }
}

function countsByType(items, catalog) {
  const counts = { Entry: 0, Side: 0, Drink: 0 };
  for (const item of catalog) {
    const quantity = items[item.id];
    if (validQuantity(quantity)) counts[item.swipeType] += quantity;
  }
  return counts;
}

export function setSwipes(cart, swipes, catalog) {
  if (!validQuantity(swipes)) return cart;
  if (Object.values(countsByType(cart.items, catalog)).some((count) => count > swipes)) return cart;
  return { ...changed(cart), swipes };
}

export function setQuantity(cart, id, quantity, catalog) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_SWIPES) return cart;
  const items = { ...cart.items };
  const reviewedTypes = { ...cart.reviewedTypes };
  const customizations = { ...(cart.customizations || {}) };
  if (quantity === 0) {
    delete items[id]; delete reviewedTypes[id]; delete customizations[id];
    return { ...changed(cart), items, reviewedTypes, customizations };
  }
  const item = catalog.find((candidate) => candidate.id === id);
  if (!item || !item.available) return cart;
  const otherCount = countsByType(items, catalog)[item.swipeType] - (items[id] || 0);
  if (quantity + otherCount > cart.swipes) return cart;
  items[id] = quantity;
  // Keep the originally reviewed classification until an explicit acceptance.
  reviewedTypes[id] ??= item.swipeType;
  return { ...changed(cart), items, reviewedTypes, customizations };
}

export function setCustomizations(cart, item, optionIds) {
  if (!item || !validQuantity(cart.items?.[item.id])) return cart;
  const allowed = allowedOptionIds(item);
  const next = [...new Set((optionIds || []).filter((optionId) => allowed.has(optionId)))].sort();
  const current = [...(cart.customizations?.[item.id] || [])].sort();
  if (next.length === current.length && next.every((optionId, index) => optionId === current[index])) return cart;
  const customizations = { ...(cart.customizations || {}) };
  if (next.length === 0) delete customizations[item.id];
  else customizations[item.id] = next;
  return { ...changed(cart), customizations };
}

export function getCartSummary(cart, catalog) {
  const items = Object.entries(cart.items).map(([id, quantity]) => ({
    ...(catalog.find((item) => item.id === id) || { id, name: id, available: false, swipeType: 'Unavailable' }),
    quantity,
    customization: customizationText(cart.customizations?.[id]),
  }));
  return { items, count: items.reduce((sum, item) => sum + item.quantity, 0), counts: countsByType(cart.items, catalog), swipes: cart.swipes };
}

export function filterMenu(query, category, catalog) {
  const search = query.trim().toLowerCase();
  return catalog.filter((item) => (category === 'All' || item.category === category) &&
    `${item.name} ${item.description} ${item.label}`.toLowerCase().includes(search));
}

const PART_WORD = { Entry: ['entrée', 'entrées'], Side: ['side', 'sides'], Drink: ['drink', 'drinks'] };

export function compositionMessage(type, needed, have) {
  const [one, many] = PART_WORD[type];
  if (needed === 1 && have === 0) return `Add ${type === 'Entry' ? 'an' : 'a'} ${one} before sending this order.`;
  if (needed === 1) return `This order can only include one ${one}.`;
  return `This order needs ${needed} ${many}. It has ${have}.`;
}

// Swaps the one item of this kind when the order is a single meal swipe.
export function selectForMeal(cart, item, catalog) {
  if (!item?.available) return cart;
  const items = {};
  const reviewedTypes = {};
  const customizations = {};
  for (const id of Object.keys(cart.items || {})) {
    const known = catalog.find((candidate) => candidate.id === id);
    if (known?.swipeType === item.swipeType) continue;
    items[id] = 1;
    if (cart.reviewedTypes?.[id]) reviewedTypes[id] = cart.reviewedTypes[id];
    if (cart.customizations?.[id]) customizations[id] = cart.customizations[id];
  }
  items[item.id] = 1;
  reviewedTypes[item.id] = cart.reviewedTypes?.[item.id] || item.swipeType;
  if (cart.customizations?.[item.id]) customizations[item.id] = cart.customizations[item.id];
  const next = { ...changed(cart), swipes: 1, items, reviewedTypes, customizations };
  if (item.swipeType === 'Side') delete next.noSide;
  else if (cart.noSide) next.noSide = true;
  return next;
}

// Adds one of this item without dropping the other choices. A single swipe can still swap its one item.
export function addToMeal(cart, item, catalog) {
  if (!item?.available) return cart;
  const have = cart.items?.[item.id] || 0;
  const used = countsByType(cart.items || {}, catalog)[item.swipeType] || 0;
  if (used >= cart.swipes) {
    if (cart.swipes === 1 && have === 0) return selectForMeal(cart, item, catalog);
    return cart;
  }
  const next = setQuantity(cart, item.id, have + 1, catalog);
  if (next === cart || item.swipeType !== 'Side' || !next.noSide) return next;
  const chosen = { ...next };
  delete chosen.noSide;
  return chosen;
}

// A side is optional. This drops any chosen side and records that the student picked none.
export function chooseNoSide(cart, catalog) {
  const cleared = clearSwipeType(cart, 'Side', catalog);
  if (cleared.noSide) return cleared;
  return { ...(cleared === cart ? changed(cart) : cleared), noSide: true };
}

export function clearSwipeType(cart, swipeType, catalog) {
  const items = { ...(cart.items || {}) };
  const reviewedTypes = { ...(cart.reviewedTypes || {}) };
  const customizations = { ...(cart.customizations || {}) };
  let removed = false;
  for (const id of Object.keys(items)) {
    const known = catalog.find((candidate) => candidate.id === id);
    if (known?.swipeType !== swipeType && reviewedTypes[id] !== swipeType) continue;
    delete items[id];
    delete reviewedTypes[id];
    delete customizations[id];
    removed = true;
  }
  if (!removed) return cart;
  return { ...changed(cart), items, reviewedTypes, customizations };
}

export function checkoutErrors(cart, catalog) {
  if (!validQuantity(cart.swipes)) return ['Use between 1 and 10 meal swipes.'];
  if (!record(cart.items) || Object.keys(cart.items).length === 0) return ['Your order is empty.'];
  const errors = [];
  for (const [id, quantity] of Object.entries(cart.items)) {
    if (!validQuantity(quantity)) errors.push(`${id} needs a quantity from 1 to 10.`);
    const item = catalog.find((candidate) => candidate.id === id);
    if (!item?.available) errors.push(`${item?.name || id} is sold out. Pick something else.`);
  }
  const counts = countsByType(cart.items, catalog);
  for (const type of SWIPE_TYPES) {
    if (type === 'Side' && counts.Side === 0) continue;
    if (counts[type] !== cart.swipes) errors.push(compositionMessage(type, cart.swipes, counts[type]));
  }
  return errors;
}
