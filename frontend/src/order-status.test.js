// Unit tests for the order status rules behind the confirmation page (US4) and pickup tracking (US6).
import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES, canCancel, formatPlacedAt, isOpenOrder, isOrder, isOrderId, shortOrderId, statusMessage, statusSteps,
  stepLabel, swipeLabel,
} from './order-status.js';

const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const order = (overrides = {}) => ({
  id: ID, status: 'Received', swipes: 1, createdAt: '2026-10-19T12:00:00+00:00',
  items: [{ id: 'burger', name: 'Burger', swipeType: 'Entry', quantity: 1 }], ...overrides,
});

describe('statusSteps', () => {
  it('marks earlier steps done, the current one current, and later ones upcoming', () => {
    expect(statusSteps('Preparing').map((step) => step.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('shows the whole journey done when the order was picked up', () => {
    expect(statusSteps('Collected').map((step) => step.state)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('labels Ready as ready for pickup', () => {
    expect(statusSteps('Ready')[2]).toEqual({ status: 'Ready', label: 'Ready for pickup', state: 'current' });
  });

  it('follows the order the backend allows', () => {
    expect(ORDER_STATUSES).toEqual(['Received', 'Preparing', 'Ready', 'Collected']);
  });
});

describe('status wording', () => {
  it('has a title and next step for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(statusMessage(status).title).not.toBe('');
      expect(statusMessage(status).detail).not.toBe('');
    }
    expect(statusMessage('Ready').title).toBe('Ready for pickup');
  });

  it('falls back to the raw value for an unknown status', () => {
    expect(statusMessage('Lost')).toEqual({ title: 'Lost', detail: '' });
    expect(stepLabel('Lost')).toBe('Lost');
  });

  it('pluralizes meal swipes', () => {
    expect(swipeLabel(1)).toBe('1 meal swipe');
    expect(swipeLabel(3)).toBe('3 meal swipes');
  });
});

describe('order ids', () => {
  it('accepts only UUIDs, so a mistyped link never reaches the API', () => {
    expect(isOrderId(ID)).toBe(true);
    expect(isOrderId('123')).toBe(false);
    expect(isOrderId('../me')).toBe(false);
    expect(isOrderId(undefined)).toBe(false);
  });

  it('shortens the id to an uppercase counter number', () => {
    expect(shortOrderId(ID)).toBe('0A1B2C3D');
  });
});

describe('isOpenOrder', () => {
  it('keeps checking every status until the order is collected', () => {
    expect(['Received', 'Preparing', 'Ready'].every((status) => isOpenOrder(order({ status })))).toBe(true);
    expect(isOpenOrder(order({ status: 'Collected' }))).toBe(false);
    expect(isOpenOrder(order({ status: 'Cancelled' }))).toBe(false);
    expect(isOpenOrder(null)).toBe(false);
  });
});

describe('canCancel', () => {
  it('allows cancelling only before the kitchen starts', () => {
    expect(canCancel(order({ status: 'Received' }))).toBe(true);
    expect(['Preparing', 'Ready', 'Collected', 'Cancelled'].some((status) => canCancel(order({ status })))).toBe(false);
    expect(canCancel(null)).toBe(false);
  });
});

describe('isOrder', () => {
  it('accepts an order shaped like the API response', () => {
    expect(isOrder(order())).toBe(true);
  });

  it.each([
    ['a missing body', null],
    ['a bad id', order({ id: 'nope' })],
    ['an unknown status', order({ status: 'Lost' })],
    ['zero swipes', order({ swipes: 0 })],
    ['items that are not a list', order({ items: 'Burger' })],
    ['an item without a quantity', order({ items: [{ name: 'Burger' }] })],
  ])('rejects %s', (_label, value) => {
    expect(isOrder(value)).toBe(false);
  });
});

describe('formatPlacedAt', () => {
  const now = new Date(2026, 9, 19, 18, 0);

  it('says today for an order placed today', () => {
    expect(formatPlacedAt(new Date(2026, 9, 19, 12, 5).toISOString(), now)).toMatch(/^today at 12:05/);
  });

  it('gives the date for an older order', () => {
    expect(formatPlacedAt(new Date(2026, 9, 16, 12, 5).toISOString(), now)).toMatch(/^Oct 16 at 12:05/);
  });

  it('returns nothing for an unreadable time', () => {
    expect(formatPlacedAt('not a date', now)).toBe('');
  });
});
