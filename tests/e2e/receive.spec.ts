import { test, expect } from '@playwright/test';
import { setup, unlock, boNav } from './helpers';

const SUMMARY = [
  '#ORBIZ-รับของ',
  'สัปดาห์: 2026-11-23 ถึง 2026-11-29',
  'บิล: แม็คโคร 24/11 ฿1,032',
  'น้ำดื่ม 600 มล. | 48 | 5.50',
  'BCAA 1 ซอง | 20 | 21',
  'Pocari 500 | 24 | 14',
  'รวม: 1,020',
].join('\n');

test('weekly bill summary from Claude adds stock and updates cost', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await unlock(page);
  await boNav(page, 'สต็อก');
  await page.getByRole('button', { name: 'รับของจากบิล' }).click();
  const sheet = page.getByRole('dialog');

  await sheet.getByRole('button', { name: 'คัดลอกคำสั่งให้ Claude' }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('#ORBIZ-รับของ');
  expect(prompt).toContain('- น้ำดื่ม 600 มล.');

  await sheet.getByLabel('ข้อความสรุปบิลจาก Claude').fill(SUMMARY);
  await expect(sheet.getByText('1 บรรทัดชื่อไม่ตรงกับสินค้าในแอป')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /รับเข้า/ })).toBeDisabled();
  await expect(sheet.getByText(/คงเหลือ 96 → 144/)).toBeVisible();
  await expect(sheet.getByText('(เดิม ฿6)')).toBeVisible();
  await sheet.getByLabel('เลือกสินค้าสำหรับ Pocari 500').selectOption({ label: 'เพิ่มเป็นสินค้าใหม่ (ปิดขายไว้ก่อน)' });
  // The stated total doesn't match 48×5.50 + 20×21 + 24×14 = 1,020? It does; no warning.
  await expect(sheet.getByText(/ไม่ตรงกับที่คำนวณได้/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'รับเข้า 3 รายการ' }).click();
  await expect(page.locator('.toast', { hasText: 'รับเข้า 3 รายการ' })).toBeVisible();

  await page.getByLabel('ค้นหาสินค้าในสต็อก').fill('น้ำดื่ม');
  await page.locator('tbody tr', { hasText: 'น้ำดื่ม' }).click();
  await expect(page.locator('.stat-big')).toHaveText('144');
  await expect(page.locator('.detail-pane')).toContainText('ทุน ฿5.50 / ชิ้น');

  // Pasting the same summary again is caught. (On portrait the detail panel covers the header.)
  await page.locator('.detail-pane').getByRole('button', { name: 'ปิด' }).click();
  await page.getByRole('button', { name: 'รับของจากบิล' }).click();
  await sheet.getByLabel('ข้อความสรุปบิลจาก Claude').fill(SUMMARY);
  await expect(sheet.getByText(/รับเข้าไปแล้วเมื่อ/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: /รับเข้า \d/ })).toBeDisabled();
});
