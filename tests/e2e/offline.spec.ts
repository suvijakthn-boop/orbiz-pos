import { test, expect } from '@playwright/test';
import { setup, pickStaff } from './helpers';

test('works with no internet after the first visit', async ({ page, context }) => {
  await setup(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Give the service worker a moment to finish caching.
  await page.waitForFunction(async () => (await caches.keys()).length > 0);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.tile', { hasText: 'น้ำดื่ม 600 มล.' })).toBeVisible();
  await page.locator('.tile', { hasText: 'น้ำดื่ม 600 มล.' }).click();
  await pickStaff(page);
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByTestId('complete-sale').click();
  await expect(page.getByRole('alertdialog')).toContainText('บันทึกการขายแล้ว');
  // Fonts come from the app, not the internet.
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "Noto Sans Thai"', 'ขาย') && document.fonts.check('16px Inter', '1');
  });
  expect(fontsOk).toBe(true);
});
