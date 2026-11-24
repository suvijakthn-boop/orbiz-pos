import { test, expect } from '@playwright/test';
import { setup, unlock, boNav, expectNoHorizontalOverflow } from './helpers';

test('monthly dashboard matches the reports page and prints a statement', async ({ page }) => {
  await setup(page);
  await unlock(page);
  await boNav(page, 'สรุปรายเดือน');
  const kpi = page.locator('.kpi', { hasText: 'ยอดขาย' }).first().locator('.v');
  await expect(kpi).toHaveText(/฿[1-9]/);
  const monthRevenue = (await kpi.textContent())!;
  // The same month on the Reports page shows the same revenue.
  await boNav(page, 'รายงาน');
  await page.getByRole('button', { name: 'เดือนนี้' }).click();
  await expect(page.locator('.kpi', { hasText: 'ยอดขาย' }).first().locator('.v')).toHaveText(monthRevenue);
  await boNav(page, 'สรุปรายเดือน');
  const statement = page.locator('.statement-wrap .statement');
  await expect(statement).toContainText('บิลสรุปประจำเดือน');
  await expect(statement).toContainText(monthRevenue);
  await expect(statement).toContainText('ยังไม่จบเดือน');
  await expectNoHorizontalOverflow(page);

  // Sample data only covers this month, so there is nowhere earlier or later to go.
  await expect(page.getByRole('button', { name: 'เดือนก่อน' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'เดือนถัดไป' })).toBeDisabled();

  // Print shows only the statement.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await page.getByRole('button', { name: /พิมพ์ \/ บันทึก PDF/ }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.locator('#print-root .statement')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^orbiz-pos-monthly-\d{4}-\d{2}\.csv$/);
});
