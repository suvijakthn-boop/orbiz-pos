import { test, expect } from '@playwright/test';
import { setup, unlock, boNav } from './helpers';

const LIST = ['ลำดับ\tรายการสินค้า', '1\tน้ำเปล่า 550 ml', '2\tน้ำเปล่า 1,500 ml', '3\tโค้ก Original', '4\tโค้ก Zero'].join('\n');

test('paste a product list, then price one and sell it', async ({ page }) => {
  await setup(page, { demo: false });
  await unlock(page);
  await boNav(page, 'สินค้า');
  await page.getByRole('button', { name: 'นำเข้าหลายรายการ' }).first().click();
  await page.getByLabel('ตารางสินค้า').fill(LIST);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('4 รายการยังไม่มีราคา')).toBeVisible();
  await sheet.getByRole('button', { name: 'เพิ่ม 4 รายการ' }).click();
  await expect(page.locator('.toast', { hasText: 'เพิ่ม 4 รายการแล้ว' })).toBeVisible();

  // Unpriced products wait under ปิดขาย.
  await page.getByRole('button', { name: 'ปิดขาย', exact: true }).click();
  const row = page.locator('tbody tr', { hasText: 'โค้ก Zero' });
  await expect(row).toContainText('ยังไม่มีราคา');
  await row.click();
  await page.getByLabel('ราคาขาย').fill('20');
  await page.getByLabel('ต้นทุน').fill('12');
  await page.getByRole('switch', { name: 'เปิดขาย' }).click();
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

  await page.getByTestId('return-to-pos').click();
  await expect(page.locator('.tile', { hasText: 'โค้ก Zero' })).toContainText('฿20');
  await expect(page.locator('.tile', { hasText: 'โค้ก Original' })).toHaveCount(0);
});
