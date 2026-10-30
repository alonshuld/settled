import { expect, test } from '@playwright/test';

test('guest -> create group -> add expense -> see balance', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('settled.lang', 'en'));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/groups/new');
  const name = `E2E ${Date.now()}`;
  await page.getByLabel('Group name').fill(name);
  await page.getByRole('button', { name: /^Create group/ }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByRole('link', { name: 'Add expense' }).first().click();
  await page.locator('#amt').fill('100');
  await page.locator('#desc').fill('Dinner');
  await page.getByRole('button', { name: 'Save expense' }).last().click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  await expect(page.getByText('Dinner')).toBeVisible();
  await expect(page.getByText('₪100').first()).toBeVisible();
});

test('code screen: back link, guest entry, sign out from avatar menu', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('settled.lang', 'en'));
  await page.goto('/j');
  await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/login');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL('/');

  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click(); // guest confirm
  await expect(page).toHaveURL(/\/login/);
});
