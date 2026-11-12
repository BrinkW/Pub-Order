import { expect, test } from '@playwright/test';
import { mockMenu } from './menu-fixture.js';

test.beforeEach(async ({ page }) => {
  await mockMenu(page);
  await page.goto('/#menu');
});

test('a guest reviews a full meal and is asked to sign in without losing it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Pub Burger' }).click();
  await page.getByRole('button', { name: 'Add Straight Cut Fries' }).click();
  await page.getByRole('button', { name: 'Add Sweet Tea' }).click();

  await expect(page.getByRole('heading', { name: 'Look over your order' })).toBeVisible();
  await expect(page.getByText('1 meal swipe', { exact: true })).toBeVisible();

  await expect(page.getByText('Sign in to continue. Your cart will stay here.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign in and keep cart' }).click();
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();

  await page.getByRole('button', { name: 'Browse menu' }).click();
  await expect(page.getByRole('heading', { name: 'Look over your order' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your meal 3' })).toBeVisible();
});

test('an incomplete meal cannot be sent and says what is missing', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Pub Burger' }).click();
  await page.getByRole('button', { name: 'No side' }).click();
  await page.getByRole('button', { name: 'Look over your order' }).click();

  await expect(page.getByText('Add a side before sending this order.')).toHaveCount(0);
  await expect(page.getByText('Add a drink before sending this order.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your meal (1)' })).toBeVisible();
});
