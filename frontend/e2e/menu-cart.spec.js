import { expect, test } from '@playwright/test';
import { catalog, mockMenu } from './menu-fixture.js';

test.beforeEach(async ({ page }) => {
  await mockMenu(page);
});

test('a student builds a meal one step at a time and keeps it after a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Browse menu' }).click();

  await expect(page.getByRole('heading', { name: 'What sounds good?' })).toBeVisible();
  await expect(page).toHaveURL(/#menu$/);

  await page.getByRole('button', { name: 'Add Pub Burger' }).click();
  await page.getByRole('button', { name: 'Add Straight Cut Fries' }).click();
  await page.getByRole('button', { name: 'Add Sweet Tea' }).click();

  await expect(page.getByRole('heading', { name: 'Look over your order' })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Your meal (3)' })).toBeVisible();
  await expect(page.getByText('Pub Burger').first()).toBeVisible();
  await expect(page.getByText('Sweet Tea').first()).toBeVisible();
});

test('search on the entrée step ignores other steps and can be cleared', async ({ page }) => {
  await page.goto('/#menu');

  await page.getByRole('searchbox', { name: 'Search entrées…' }).fill('fries');
  await expect(page.getByText('No matches this time.')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();

  await expect(page.getByRole('article')).toHaveCount(catalog.filter((item) => item.swipeType === 'Entry').length);
});
