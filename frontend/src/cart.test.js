import { describe, expect, test } from 'vitest';
import { MENU_ITEMS } from './menu-data.js';
import { addToMeal, filterMenu, getCartSummary, MAX_SWIPES, restoreCart, setCustomizations, setQuantity, setSwipes, checkoutErrors, emptyCart, withCheckoutKey } from './cart.js';
const menu = MENU_ITEMS.map((item) => ({ ...item, available: true }));
const meal = () => ({ swipes: 1, items: { 'pub-burger': 1, 'straight-cut-fries': 1, 'sweet-tea': 1 }, reviewedTypes: {} });

test('one swipe holds exactly one entry, side, and drink', () => {
  let cart = emptyCart();
  for (const id of ['pub-burger', 'straight-cut-fries', 'sweet-tea']) cart = setQuantity(cart, id, 1, menu);
  expect(getCartSummary(cart, menu).counts).toEqual({ Entry: 1, Side: 1, Drink: 1 });
  expect(getCartSummary(cart, menu).count).toBe(3);
  expect(checkoutErrors(cart, menu)).toEqual([]);
});
test('database-only IDs work without changes to frontend constants', () => {
  const catalog = [{ id: 'new-special', name: 'Special', swipeType: 'Entry', available: true }];
  expect(setQuantity(emptyCart(), 'new-special', 1, catalog).items['new-special']).toBe(1);
});
test('entry capacity is enforced and milkshakes remain entries', () => {
  const cart = setQuantity(emptyCart(), 'chocolate-milkshake', 1, menu);
  expect(getCartSummary(cart, menu).counts.Entry).toBe(1);
  expect(setQuantity(cart, 'pub-burger', 1, menu)).toEqual(cart);
});
test('removing an item is immutable and can remove a deleted catalog ID', () => {
  const original = meal();
  expect(setQuantity(original, 'pub-burger', 0, []).items['pub-burger']).toBe(undefined);
  expect(original.items['pub-burger']).toBe(1);
});
test('more swipes unlock quantities and cannot be reduced below usage', () => {
  let cart = setSwipes(meal(), 2, menu);
  cart = setQuantity(cart, 'pub-burger', 2, menu);
  expect(setSwipes(cart, 1, menu).swipes).toBe(2);
});
test('invalid swipe counts are rejected rather than silently rounded or capped', () => {
  for (const value of [0, -1, 1.5, '2', true, NaN, MAX_SWIPES + 1]) {
    const cart = meal(); expect(setSwipes(cart, value, menu)).toBe(cart);
  }
});
test('invalid quantities and unknown or unavailable items are rejected', () => {
  const cart = emptyCart();
  for (const value of [-1, 1.5, NaN, '2', true, 11]) expect(setQuantity(cart, 'pub-burger', value, menu)).toBe(cart);
  expect(setQuantity(cart, 'unknown', 1, menu)).toBe(cart);
  expect(setQuantity(cart, 'pub-burger', 1, menu.map((i) => ({ ...i, available: false })))).toBe(cart);
});
test('cart restoration retains removed IDs and original reviewed types', () => {
  const cart = { swipes: 2, items: { removed: 1 }, reviewedTypes: { removed: 'Drink' } };
  expect(restoreCart(JSON.stringify(cart))).toEqual({ ...cart, customizations: {} });
  expect(getCartSummary(cart, []).items[0].available).toBe(false);
});
test('corrupt storage and invalid shapes return a fresh cart', () => {
  for (const value of [null, '', '{broken', 'null', '[]', 'true', '42', '"text"', '{"swipes":11,"items":{}}']) expect(restoreCart(value)).toEqual(emptyCart());
});
test('restoration rejects invalid quantities and dangerous property names', () => {
  expect(restoreCart('{"swipes":2,"items":{"ok":2,"bad":1.5,"negative":-1,"string":"2","__proto__":1}}').items).toEqual({ ok: 2 });
});
test('search combines categories with case-insensitive trimmed queries', () => {
  expect(filterMenu(' BEYOND ', 'Grill Main', menu).map((i) => i.id)).toEqual(['beyond-burger-patty']);
  expect(filterMenu('beyond', 'Beverages', menu).length).toBe(0);
  expect(filterMenu('', 'All', menu).length).toBe(22);
});
test('empty, incomplete, over-capacity, and invalid carts cannot pass review', () => {
  for (const cart of [emptyCart(), { ...meal(), swipes: 2 }, { ...meal(), swipes: 0 }, { ...meal(), items: { 'pub-burger': 1.5 } }, { ...meal(), items: { ...meal().items, 'pub-burger': 2 } }]) expect(checkoutErrors(cart, menu).length).toBeGreaterThan(0);
});
test('unavailable items fail review', () => {
    expect(checkoutErrors(meal(), menu.map((i) => ({ ...i, available: i.id !== 'pub-burger' })))[0]).toMatch(/sold out/);
});
test('quantity edits preserve original classification for server change detection', () => {
  let cart = setQuantity(emptyCart(), 'pub-burger', 1, menu);
  cart = setSwipes(cart, 2, menu);
  cart = setQuantity(cart, 'pub-burger', 2, menu.map((i) => ({ ...i, swipeType: i.id === 'pub-burger' ? 'Side' : i.swipeType })));
  expect(cart.reviewedTypes['pub-burger']).toBe('Entry');
});

// Boundary-value tests for setQuantity (ICA 10, Worksheet 3).
// Rule: a quantity from 0 up to the swipes left for that item's type is accepted;
// anything outside that range is rejected and the cart is returned unchanged.
const cartWith = (swipes, items) => ({ swipes, items, reviewedTypes: {} });

describe('setQuantity boundaries', () => {
  test('zero removes the item, one keeps it, and negative is rejected', () => {
    const cart = cartWith(2, { 'pub-burger': 1 });
    expect(setQuantity(cart, 'pub-burger', 0, menu).items).toEqual({});
    expect(setQuantity(cart, 'pub-burger', 1, menu).items).toEqual({ 'pub-burger': 1 });
    expect(setQuantity(cart, 'pub-burger', -1, menu)).toBe(cart);
  });

  test('quantities just below and at the swipe count are accepted, just above is rejected', () => {
    const cart = cartWith(3, {});
    expect(setQuantity(cart, 'pub-burger', 2, menu).items['pub-burger']).toBe(2);
    expect(setQuantity(cart, 'pub-burger', 3, menu).items['pub-burger']).toBe(3);
    expect(setQuantity(cart, 'pub-burger', 4, menu)).toBe(cart);
  });

  test('other items of the same type shrink the allowance', () => {
    const cart = cartWith(3, { 'pub-burger': 2 });
    expect(setQuantity(cart, 'chicken-tenders', 1, menu).items['chicken-tenders']).toBe(1);
    expect(setQuantity(cart, 'chicken-tenders', 2, menu)).toBe(cart);

    const full = cartWith(3, { 'pub-burger': 3 });
    expect(setQuantity(full, 'chicken-tenders', 1, menu)).toBe(full);
  });

  test('an item does not count against its own allowance', () => {
    const cart = cartWith(2, { 'pub-burger': 2 });
    expect(setQuantity(cart, 'pub-burger', 2, menu).items['pub-burger']).toBe(2);
    expect(setQuantity(cart, 'pub-burger', 3, menu)).toBe(cart);
  });

  test('MAX_SWIPES is reachable but one more is rejected', () => {
    const cart = cartWith(MAX_SWIPES, {});
    expect(setQuantity(cart, 'pub-burger', MAX_SWIPES, menu).items['pub-burger']).toBe(MAX_SWIPES);
    expect(setQuantity(cart, 'pub-burger', MAX_SWIPES + 1, menu)).toBe(cart);
  });
});

describe('setSwipes boundaries', () => {
  test('MAX_SWIPES itself is accepted', () => {
    expect(setSwipes(emptyCart(), MAX_SWIPES, menu).swipes).toBe(MAX_SWIPES);
  });

  test('swipes can drop to exactly the busiest type but not below it', () => {
    const cart = cartWith(3, { 'pub-burger': 2, 'sweet-tea': 1 });
    expect(setSwipes(cart, 2, menu).swipes).toBe(2);
    expect(setSwipes(cart, 1, menu)).toBe(cart);
  });

  test('does not modify the original cart', () => {
    const original = cartWith(1, { 'pub-burger': 1 });
    setSwipes(original, 4, menu);
    expect(original).toEqual(cartWith(1, { 'pub-burger': 1 }));
  });
});

describe('restoreCart boundaries', () => {
  test('1 and MAX_SWIPES are restored; 0 and one more give a fresh cart', () => {
    expect(restoreCart(JSON.stringify(cartWith(1, {}))).swipes).toBe(1);
    expect(restoreCart(JSON.stringify(cartWith(MAX_SWIPES, {}))).swipes).toBe(MAX_SWIPES);
    expect(restoreCart(JSON.stringify(cartWith(0, {})))).toEqual(emptyCart());
    expect(restoreCart(JSON.stringify(cartWith(MAX_SWIPES + 1, {})))).toEqual(emptyCart());
  });

  test('invalid saved swipe counts give a fresh cart', () => {
    for (const swipes of [-1, 1.5, '2', null]) {
      expect(restoreCart(JSON.stringify(cartWith(swipes, { 'pub-burger': 1 })))).toEqual(emptyCart());
    }
  });

  test('missing or array items give a fresh cart', () => {
    expect(restoreCart(JSON.stringify({ swipes: 3 }))).toEqual(emptyCart());
    expect(restoreCart(JSON.stringify({ swipes: 3, items: ['pub-burger'] }))).toEqual(emptyCart());
  });

  test('item ids up to 100 characters are kept; longer ids are dropped', () => {
    const ok = 'a'.repeat(100);
    const tooLong = 'b'.repeat(101);
    expect(restoreCart(JSON.stringify(cartWith(2, { [ok]: 1, [tooLong]: 1 }))).items).toEqual({ [ok]: 1 });
  });

  test('keeps reviewed types only for items in the cart and only valid types', () => {
    const saved = { swipes: 2, items: { 'pub-burger': 1, 'sweet-tea': 1 }, reviewedTypes: { 'pub-burger': 'Entry', 'sweet-tea': 'Dessert', gone: 'Side' } };
    expect(restoreCart(JSON.stringify(saved)).reviewedTypes).toEqual({ 'pub-burger': 'Entry' });
  });
});

describe('summary, search, and review details', () => {
  test('items no longer on the menu are listed but do not count toward a meal', () => {
    const summary = getCartSummary(cartWith(2, { removed: 2 }), menu);
    expect(summary.count).toBe(2);
    expect(summary.counts).toEqual({ Entry: 0, Side: 0, Drink: 0 });
    expect(summary.items[0]).toMatchObject({ id: 'removed', name: 'removed', available: false });
  });

  test('search matches dietary labels', () => {
    const vegan = filterMenu('vegan', 'All', menu);
    expect(vegan.length).toBe(menu.filter((item) => item.label === 'Vegan').length);
    expect(vegan.every((item) => item.label === 'Vegan')).toBe(true);
  });

  test('search matches allergen and preference markers', () => {
    const gluten = filterMenu('gluten', 'All', menu);
    expect(gluten.length).toBeGreaterThan(0);
    expect(gluten.every((item) => item.markers?.includes('Gluten'))).toBe(true);
    expect(filterMenu('local ingredient', 'All', menu).map((item) => item.id)).toEqual(['pub-burger']);
  });

  test('an empty search with a category returns exactly that category', () => {
    const sides = filterMenu('', 'Grill Side', menu);
    expect(sides.length).toBe(menu.filter((item) => item.category === 'Grill Side').length);
    expect(sides.every((item) => item.category === 'Grill Side')).toBe(true);
  });

  test('a complete two-swipe meal passes review', () => {
    const cart = cartWith(2, { 'pub-burger': 2, 'straight-cut-fries': 1, 'pretzel-sticks': 1, 'sweet-tea': 2 });
    expect(checkoutErrors(cart, menu)).toEqual([]);
  });

  test('adding fills a swipe without replacing the other choices', () => {
  const burger = menu.find((item) => item.id === 'pub-burger');
  const fries = menu.find((item) => item.id === 'straight-cut-fries');
  let cart = setSwipes(emptyCart(), 3, menu);
  cart = addToMeal(cart, burger, menu);
  cart = addToMeal(cart, burger, menu);
  expect(cart.swipes).toBe(3);
  expect(cart.items['pub-burger']).toBe(2);
  cart = addToMeal(cart, fries, menu);
  expect(cart.items).toEqual({ 'pub-burger': 2, 'straight-cut-fries': 1 });
});
test('a meal can leave the side out', () => {
  const cart = { swipes: 1, items: { 'pub-burger': 1, 'sweet-tea': 1 }, reviewedTypes: {} };
  expect(checkoutErrors(cart, menu)).toEqual([]);
});
test('too many sides is still rejected', () => {
  const cart = { swipes: 1, items: { 'pub-burger': 1, 'straight-cut-fries': 1, 'pretzel-sticks': 1, 'sweet-tea': 1 }, reviewedTypes: {} };
  expect(checkoutErrors(cart, menu)).toEqual(['This order can only include one side.']);
});
test('review explains which part of the meal is short', () => {
    const cart = cartWith(2, { 'pub-burger': 2, 'straight-cut-fries': 2, 'sweet-tea': 1 });
    expect(checkoutErrors(cart, menu)).toEqual(['This order needs 2 drinks. It has 1.']);
  });
});

describe('checkout key', () => {
  const KEY = '6f1d2c34-5b6a-4e7f-8a9b-0c1d2e3f4a5b';

  test('withCheckoutKey adds a UUID once and then keeps it', () => {
    const keyed = withCheckoutKey(meal());
    expect(keyed.checkoutKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(withCheckoutKey(keyed)).toBe(keyed);
  });

  test('a saved key survives a restore, but an invalid one is dropped', () => {
    expect(restoreCart(JSON.stringify({ ...meal(), checkoutKey: KEY })).checkoutKey).toBe(KEY);
    expect(restoreCart(JSON.stringify({ ...meal(), checkoutKey: 'not-a-key' }))).not.toHaveProperty('checkoutKey');
  });

  test('changing the cart drops the key, because it becomes a new order', () => {
    const keyed = { ...cartWith(2, { 'pub-burger': 1 }), checkoutKey: KEY };
    expect(setQuantity(keyed, 'pub-burger', 2, menu)).not.toHaveProperty('checkoutKey');
    expect(setQuantity(keyed, 'pub-burger', 0, menu)).not.toHaveProperty('checkoutKey');
    expect(setSwipes(keyed, 3, menu)).not.toHaveProperty('checkoutKey');
  });

  test('a rejected change keeps the key', () => {
    const keyed = { ...cartWith(1, { 'pub-burger': 1 }), checkoutKey: KEY };
    expect(setQuantity(keyed, 'chicken-tenders', 1, menu)).toBe(keyed);
    expect(setSwipes(keyed, 0, menu)).toBe(keyed);
  });
});

describe('customizations', () => {
  const burger = { id: 'pub-burger', name: 'Pub Burger', category: 'Grill Main', swipeType: 'Entry', available: true };

  test('options are stored on a cart item and shown in the summary', () => {
    const cart = setQuantity(emptyCart(), 'pub-burger', 1, menu);
    const customized = setCustomizations(cart, burger, ['no-cheese', 'no-onion', 'not-an-option']);
    expect(customized.customizations['pub-burger']).toEqual(['no-cheese', 'no-onion']);
    expect(getCartSummary(customized, menu).items[0].customization).toBe('No cheese, No onion');
    expect(customized).not.toHaveProperty('checkoutKey');
  });

  test('the same options do not change the cart', () => {
    const cart = setCustomizations(setQuantity(emptyCart(), 'pub-burger', 1, menu), burger, ['no-onion']);
    expect(setCustomizations(cart, burger, ['no-onion'])).toBe(cart);
  });

  test('removing an item drops its customization, and a saved one restores', () => {
    const cart = setCustomizations(setQuantity(emptyCart(), 'pub-burger', 1, menu), burger, ['no-onion']);
    expect(setQuantity(cart, 'pub-burger', 0, menu).customizations).toEqual({});
    expect(restoreCart(JSON.stringify(cart)).customizations).toEqual({ 'pub-burger': ['no-onion'] });
  });

  test('each grill item keeps only its own options', () => {
    const tenders = menu.find((item) => item.id === 'chicken-tenders');
    const cart = setQuantity(emptyCart(), 'chicken-tenders', 1, menu);
    const customized = setCustomizations(cart, tenders, ['ranch', 'no-onion', 'honey-mustard']);
    expect(customized.customizations['chicken-tenders']).toEqual(['honey-mustard', 'ranch']);
    expect(getCartSummary(customized, menu).items[0].customization).toBe('Honey mustard, Ranch');
    const saved = { ...customized, customizations: { 'chicken-tenders': ['no-onion', 'ranch'] } };
    expect(restoreCart(JSON.stringify(saved)).customizations).toEqual({ 'chicken-tenders': ['ranch'] });
  });
});
