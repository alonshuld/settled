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
