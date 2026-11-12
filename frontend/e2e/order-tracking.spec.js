import { expect, test } from '@playwright/test';

// US4 + US6 end to end: browser → Vite → FastAPI → Supabase (local in CI), nothing mocked.
// The status change is written straight to the local database with the service key, the way
// a staff update (US5) stores it; the student's page must then show it.
const email = process.env.PUB_ORDER_TEST_EMAIL;
const password = process.env.PUB_ORDER_TEST_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceKey = process.env.PUB_ORDER_TEST_SERVICE_KEY;
const isLocal = ['127.0.0.1', 'localhost'].includes(URL.canParse(supabaseUrl) ? new URL(supabaseUrl).hostname : '');

test.skip(!email || !password || !serviceKey || !isLocal, 'Local Supabase test settings are not set');

const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

async function setStatus(request, orderId, status) {
  const response = await request.patch(`${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`, {
    headers: { ...adminHeaders, Prefer: 'return=minimal' }, data: { status },
  });
  expect(response.ok()).toBe(true);
}

test('a student places an order, reopens its confirmation, and sees when it is ready for pickup', async ({ page, request }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('button', { name: 'Add Philly Cheesesteak' }).click();
  await page.getByRole('button', { name: 'Add Straight Cut Fries' }).click();
  await page.getByRole('button', { name: 'Add Orange Juice' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();

  // US4: confirmation of the saved order.
  await expect(page.getByRole('heading', { name: 'Order received' })).toBeVisible();
  await expect(page).toHaveURL(/#order\/[0-9a-f-]{36}$/);
  const orderId = page.url().split('#order/')[1];
  try {
    const summary = page.getByRole('region', { name: 'Order summary' });
    await expect(summary.getByText('Philly Cheesesteak')).toBeVisible();
    await expect(summary.getByText('1 meal swipe')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for the kitchen' })).toBeVisible();

    // A refresh reads the order back from the database.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Your order' })).toBeVisible();
    await expect(summary.getByText('Orange Juice')).toBeVisible();

    // US6: the page shows each stored status.
    await setStatus(request, orderId, 'Preparing');
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByRole('heading', { name: 'Being prepared' })).toBeVisible();

    await setStatus(request, orderId, 'Ready');
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Ready for pickup' })).toBeVisible();

    // It is also listed under My orders with the same status.
    await page.getByRole('button', { name: 'View all my orders' }).click();
    const current = page.getByRole('region', { name: 'In progress' });
    await expect(current.getByRole('listitem').filter({ hasText: orderId.slice(0, 8).toUpperCase() }))
      .toContainText('Ready for pickup');
  } finally {
    await request.delete(`${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`, { headers: adminHeaders });
  }
});

test('a made-up order link shows not found instead of an order', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  await page.goto('/#order/00000000-0000-4000-8000-000000000000');

  await expect(page.getByRole('heading', { name: 'We couldn’t find that order' })).toBeVisible();
});
