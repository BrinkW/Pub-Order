import { expect, test } from '@playwright/test';
import { mockMenu } from './menu-fixture.js';

test('choosing a main moves to sides, and a sold-out main cannot be chosen', async ({ page }) => {
  await mockMenu(page);
  await page.goto('/#menu');

  await page.getByRole('button', { name: 'Add Pub Burger' }).click();

  await expect(page.getByRole('button', { name: 'Side' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Add Straight Cut Fries' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add Chicken Tenders' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Entrée' }).click();
  await page.getByRole('button', { name: 'Clear order' }).click();

  await expect(page.getByRole('heading', { name: 'Your meal (0)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Pub Burger' })).toBeEnabled();
});
