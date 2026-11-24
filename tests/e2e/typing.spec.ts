import { test, expect } from '@playwright/test';
import { setup, unlock, boNav } from './helpers';

// The iPad keyboard sends one key at a time. Text boxes must keep focus between keys.
test('typing letter by letter keeps focus in every kind of text box', async ({ page }) => {
  await setup(page);

  const search = page.getByLabel('ค้นหาสินค้า');
  await search.click();
  await page.keyboard.type('เวย์', { delay: 40 });
  await expect(search).toHaveValue('เวย์');
  await expect(search).toBeFocused();

  await unlock(page);
  await boNav(page, 'สินค้า');
  await page.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).first().click();
  const name = page.getByRole('dialog').getByLabel('ชื่อสินค้า');
  await name.click();
  await page.keyboard.type('ชาเขียว Matcha', { delay: 40 });
  await expect(name).toHaveValue('ชาเขียว Matcha');
  await expect(name).toBeFocused();
  const price = page.getByRole('dialog').getByLabel('ราคาขาย');
  await price.click();
  await page.keyboard.type('55', { delay: 40 });
  await expect(price).toHaveValue('55');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'นำเข้าหลายรายการ' }).first().click();
  const table = page.getByLabel('ตารางสินค้า');
  await table.click();
  await page.keyboard.type('โค้ก Zero,เครื่องดื่ม,20', { delay: 30 });
  await expect(table).toHaveValue('โค้ก Zero,เครื่องดื่ม,20');
  await expect(table).toBeFocused();
  await page.keyboard.press('Escape');

  await boNav(page, 'สต็อก');
  await page.getByRole('button', { name: 'รับของจากบิล' }).click();
  const bill = page.getByLabel('ข้อความสรุปบิลจาก Claude');
  await bill.click();
  await page.keyboard.type('BCAA 1 ซอง | 10 | 20', { delay: 30 });
  await expect(bill).toHaveValue('BCAA 1 ซอง | 10 | 20');
  await expect(bill).toBeFocused();
  await page.keyboard.press('Escape');

  await boNav(page, 'สลิปโอนเงิน');
  await page.locator('.slip-card').first().click();
  await page.getByRole('button', { name: 'มีปัญหา', exact: true }).click();
  const note = page.getByLabel('ปัญหาของสลิป');
  await page.keyboard.type('ยอด-ไม่ตรง+', { delay: 30 });
  await expect(note).toHaveValue('ยอด-ไม่ตรง+');
});
