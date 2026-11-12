// Unit tests for US-29 Order again: rebuilding a past order from today's menu.
import { describe, expect, it } from 'vitest';
import { reorderCart, reorderMessage, stepAfterReorder } from './reorder.js';

const ORDER_ID = '0a1b2c3d-0000-4000-8000-000000000001';
const menu = [
  { id: 'pub-burger', name: 'Pub Burger', swipeType: 'Entry', available: true },
  { id: 'fries', name: 'Fries', swipeType: 'Side', available: true },
  { id: 'lemonade', name: 'Lemonade', swipeType: 'Drink', available: true },
  { id: 'cookie', name: 'Cookie', swipeType: 'Side', available: true },
];
const pastOrder = (items, swipes = 1) => ({ id: ORDER_ID, status: 'Collected', swipes, items });
const burger = { id: 'pub-burger', name: 'Pub Burger', swipeType: 'Entry', quantity: 1, customization: '' };
const fries = { id: 'fries', name: 'Fries', swipeType: 'Side', quantity: 1, customization: '' };
const lemonade = { id: 'lemonade', name: 'Lemonade', swipeType: 'Drink', quantity: 1, customization: '' };
const soldOut = (id) => menu.map((item) => (item.id === id ? { ...item, available: false } : item));

describe('reorderCart', () => {
  it('puts every item from the past order back, with its swipes and meal part', () => {
    const { cart, added, skipped } = reorderCart(pastOrder([burger, fries, lemonade]), menu);

    expect(cart).toEqual({
      swipes: 1,
      items: { 'pub-burger': 1, fries: 1, lemonade: 1 },
      reviewedTypes: { 'pub-burger': 'Entry', fries: 'Side', lemonade: 'Drink' },
      customizations: {},
    });
    expect(added).toEqual(['Pub Burger', 'Fries', 'Lemonade']);
    expect(skipped).toEqual([]);
  });

  it('starts a new order, never a retry of the old one', () => {
    const { cart } = reorderCart(pastOrder([burger, fries, lemonade]), menu);

    expect(cart.checkoutKey).toBeUndefined();
  });

  it('keeps quantities for a multi-swipe order', () => {
    const { cart } = reorderCart(pastOrder([{ ...burger, quantity: 2 }, { ...fries, quantity: 2 }, { ...lemonade, quantity: 2 }], 2), menu);

    expect(cart.swipes).toBe(2);
    expect(cart.items).toEqual({ 'pub-burger': 2, fries: 2, lemonade: 2 });
  });

  it('brings back toppings and sauces the item still offers, and drops ones it does not', () => {
    const { cart } = reorderCart(pastOrder([{ ...burger, customization: 'No onion, Ketchup, Truffle oil' }, fries, lemonade]), menu);

    expect(cart.customizations).toEqual({ 'pub-burger': ['ketchup', 'no-onion'] });
  });

  it('leaves out sold-out items and items no longer on the menu, and says why', () => {
    const gone = { id: 'onion-rings', name: 'Onion Rings', swipeType: 'Side', quantity: 1, customization: '' };
    const { cart, added, skipped } = reorderCart(pastOrder([burger, gone, { ...lemonade }]), soldOut('lemonade'));

    expect(cart.items).toEqual({ 'pub-burger': 1 });
    expect(added).toEqual(['Pub Burger']);
    expect(skipped).toEqual([
      { name: 'Onion Rings', swipeType: 'Side', reason: 'no longer on the menu' },
      { name: 'Lemonade', swipeType: 'Drink', reason: 'sold out' },
    ]);
  });

  it('keeps "no side" when the past order had no side on purpose', () => {
    expect(reorderCart(pastOrder([burger, lemonade]), menu).cart.noSide).toBe(true);
  });

  it('asks for a new side, instead of "no side", when the old side is sold out', () => {
    const { cart } = reorderCart(pastOrder([burger, fries, lemonade]), soldOut('fries'));

    expect(cart.noSide).toBeUndefined();
    expect(cart.items).toEqual({ 'pub-burger': 1, lemonade: 1 });
  });

  it('caps swipes and quantities at the menu limits', () => {
    const { cart } = reorderCart(pastOrder([{ ...burger, quantity: 50 }], 50), menu);

    expect(cart.swipes).toBe(10);
    expect(cart.items['pub-burger']).toBe(10);
  });

  it('returns an untouched empty cart when nothing is available', () => {
    const { cart, added } = reorderCart(pastOrder([burger]), soldOut('pub-burger'));

    expect(added).toEqual([]);
    expect(cart.items).toEqual({});
    expect(cart.noSide).toBeUndefined();
  });
});

describe('stepAfterReorder', () => {
  it('goes straight to review when the whole order came back', () => {
    expect(stepAfterReorder(reorderCart(pastOrder([burger, fries, lemonade]), menu))).toBe('review');
  });

  it('opens the first meal part that is missing something', () => {
    expect(stepAfterReorder(reorderCart(pastOrder([burger, fries, lemonade]), soldOut('fries')))).toBe('side');
    expect(stepAfterReorder(reorderCart(pastOrder([burger, fries, lemonade]), soldOut('pub-burger')))).toBe('entry');
  });
});

describe('reorderMessage', () => {
  it('confirms a full reorder', () => {
    const order = pastOrder([burger, fries, lemonade]);

    expect(reorderMessage(order, reorderCart(order, menu))).toBe('Order #0A1B2C3D is back in your order. Check it and send it when you’re ready.');
  });

  it('names each item left out and why, and mentions a replaced cart', () => {
    const order = pastOrder([burger, fries, lemonade]);

    expect(reorderMessage(order, reorderCart(order, soldOut('fries')), { replacedCart: true })).toBe(
      'Order #0A1B2C3D is back in your order. We left out Fries (sold out). Pick a replacement before you send it. '
      + 'This replaced what you had in your order before.',
    );
  });

  it('says nothing changed when nothing is available', () => {
    const order = pastOrder([burger]);

    expect(reorderMessage(order, reorderCart(order, soldOut('pub-burger')))).toBe(
      'Nothing from order #0A1B2C3D is available right now, so your order wasn’t changed.',
    );
  });
});
