import { test, expect } from '@playwright/test';

test('homepage has Kaiju heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Kaiju' })).toBeVisible();
});
