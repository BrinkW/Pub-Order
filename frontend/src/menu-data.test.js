import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SWIPE_TYPES } from './cart.js';
import { optionsFor } from './customizations.js';
import { CATEGORIES, MENU_ITEMS } from './menu-data.js';
import { hasListedNutrition, nutritionFor } from './nutrition.js';

const imageDir = path.resolve(import.meta.dirname, '../public/images/menu') + path.sep;
const ALLOWED_MARKERS = new Set([
  'Alcohol', 'Dairy', 'Egg', 'Fish', 'Gluten', 'Peanut', 'Pork', 'Sesame',
  'Shellfish', 'Soy', 'Tree Nut', 'Features Local Ingredient', 'Halal', 'Kosher',
  'Vegan', 'Vegetarian',
]);

describe('menu data', () => {
  test('every item has a unique id', () => {
    const ids = MENU_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every item has a name, category, portion, and known swipe type', () => {
    for (const item of MENU_ITEMS) {
      expect(item.name, item.id).toBeTruthy();
      expect(item.category, item.id).toBeTruthy();
      expect(item.portion, item.id).toBeTruthy();
      expect(SWIPE_TYPES, item.id).toContain(item.swipeType);
    }
  });

  test('every swipe type has at least one item, so a full meal swipe is possible', () => {
    for (const type of SWIPE_TYPES) {
      expect(MENU_ITEMS.some((item) => item.swipeType === type), type).toBe(true);
    }
  });

  test('every item uses unique markers from the Pub NetNutrition vocabulary', () => {
    for (const item of MENU_ITEMS) {
      expect(Array.isArray(item.markers), item.id).toBe(true);
      expect(new Set(item.markers).size, item.id).toBe(item.markers.length);
      expect(item.markers.every((marker) => ALLOWED_MARKERS.has(marker)), item.id).toBe(true);
    }
    expect(MENU_ITEMS.find((item) => item.id === 'seasoned-wings').markers).toEqual(['Gluten', 'Halal']);
    expect(MENU_ITEMS.find((item) => item.id === 'pub-burger').markers).toEqual([
      'Gluten', 'Sesame', 'Features Local Ingredient',
    ]);
  });

  test('categories start with All, have no duplicates, and each has items', () => {
    expect(CATEGORIES[0]).toBe('All');
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
    for (const category of CATEGORIES.slice(1)) {
      expect(MENU_ITEMS.some((item) => item.category === category), category).toBe(true);
    }
  });
});

describe('customization options', () => {
  test('only grill mains can be customized, and each list fits on an order', () => {
    for (const item of MENU_ITEMS) {
      const options = optionsFor(item);
      if (item.category === 'Grill Main') {
        expect(options.length, item.id).toBeGreaterThan(0);
        expect(options.length, item.id).toBeLessThanOrEqual(8);
        expect(new Set(options.map((option) => option.id)).size, item.id).toBe(options.length);
      } else {
        expect(options, item.id).toEqual([]);
      }
    }
  });
});

describe('nutrition facts', () => {
  test('every menu item has placeholder facts that can be edited later', () => {
    for (const item of MENU_ITEMS) {
      expect(hasListedNutrition(item.id), item.id).toBe(true);
      const facts = nutritionFor(item);
      expect(facts.serving, item.id).toBeTruthy();
      expect(facts.calories, item.id).toEqual(expect.any(Number));
      expect(facts.protein, item.id).toEqual(expect.any(Number));
    }
  });
});

describe('menu images', () => {
  test('every image file exists', () => {
    for (const item of MENU_ITEMS.filter((menuItem) => menuItem.image)) {
      expect(existsSync(imageDir + item.image), item.image).toBe(true);
    }
  });

  test('every image is credited in CREDITS.md', () => {
    const credits = readFileSync(imageDir + 'CREDITS.md', 'utf8');
    for (const item of MENU_ITEMS.filter((menuItem) => menuItem.image)) {
      expect(credits, item.image).toContain(`\`${item.image}\``);
    }
  });
});
