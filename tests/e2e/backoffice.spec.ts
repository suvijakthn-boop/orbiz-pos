import { test, expect } from '@playwright/test';
import { setup, unlock, boNav, typePin, pickStaff, expectNoHorizontalOverflow } from './helpers';

test('Back Office asks for the PIN and locks when leaving or switching apps', async ({ page }) => {
  await setup(page);
  await page.locator('.rail-item', { hasText: 'ระบบจัดการ' }).click();
  await expect(page.getByRole('heading', { name: 'ระบบจัดการ' })).toBeVisible();
  await typePin(page, '999999');
  await expect(page.locator('.lock .msg')).toContainText('PIN ไม่ถูกต้อง');
  await typePin(page);
  await expect(page.locator('.bo-side')).toBeVisible();

  // Switching to another app locks it.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await expect(page.locator('.lock')).toBeVisible();
  await typePin(page);
  await expect(page.locator('.bo-side')).toBeVisible();

  // Returning to POS locks it too; the URL alone cannot get back in.
  await page.getByTestId('return-to-pos').click();
  await page.goto('/#/admin/products');
  await expect(page.locator('.lock')).toBeVisible();
});

test('every Back Office page renders without sideways scrolling', async ({ page }) => {
  await setup(page);
  await unlock(page);
  for (const label of ['ภาพรวม', 'สินค้า', 'สต็อก', 'ตรวจนับ', 'รายการขาย', 'สลิปโอนเงิน', 'รายงาน', 'พนักงาน', 'ประวัติการแก้ไข', 'ตั้งค่า']) {
    await boNav(page, label);
    await expect(page.locator('.page-head h1').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('add a product, change its price, and the audit log records both', async ({ page }) => {
  await setup(page, { demo: false });
  await unlock(page);
  await boNav(page, 'พนักงาน');
  await page.getByLabel('ชื่อพนักงานใหม่').fill('ต้น');
  await page.getByRole('button', { name: 'เพิ่มพนักงาน' }).click();
  await boNav(page, 'สินค้า');
  await page.getByRole('button', { name: /เพิ่มสินค้าแรก/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  await expect(page.getByText('ใส่ชื่อสินค้า')).toBeVisible();
  await page.getByLabel('ชื่อสินค้า').fill('ชาเขียวมัทฉะ');
  await page.getByLabel('ราคาขาย').fill('55');
  await page.getByLabel('ต้นทุน').fill('20');
  await page.getByLabel('สต็อกเริ่มต้น').fill('24');
  await expect(page.getByText('กำไร ฿35 ต่อชิ้น')).toBeVisible();
  await sheet.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  await expect(page.locator('tbody tr', { hasText: 'ชาเขียวมัทฉะ' })).toBeVisible();

  await page.locator('tbody tr', { hasText: 'ชาเขียวมัทฉะ' }).click();
  await page.getByLabel('ราคาขาย').fill('60');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await boNav(page, 'ประวัติการแก้ไข');
  await expect(page.getByText('฿55 → ฿60')).toBeVisible();
  await expect(page.getByText('เพิ่มสินค้า ชาเขียวมัทฉะ')).toBeVisible();

  await page.getByTestId('return-to-pos').click();
  await expect(page.locator('.tile', { hasText: 'ชาเขียวมัทฉะ' })).toContainText('฿60');
});

test('staff count, manager approves with PIN, stock follows the count', async ({ page }) => {
  await setup(page);
  await page.locator('.rail-item', { hasText: 'ตรวจนับ' }).click();
  await pickStaffFromCount(page);
  await page.getByRole('button', { name: 'เริ่มตรวจนับ' }).click();
  // First product is selected: water. Count 90.
  await expect(page.locator('.count-pad')).toContainText('น้ำดื่ม 600 มล.');
  await page.locator('.count-pad').getByRole('button', { name: '9', exact: true }).click();
  await page.locator('.count-pad').getByRole('button', { name: '0', exact: true }).click();
  await expect(page.getByTestId('count-output')).toHaveText('90');
  await page.getByRole('button', { name: /รายการถัดไป/ }).click();
  await page.locator('.count-pad').getByRole('button', { name: 'เพิ่มหนึ่ง' }).click();
  await page.getByRole('button', { name: 'ส่งผลตรวจนับ' }).click();
  await page.getByRole('button', { name: 'ส่งเฉพาะที่นับแล้ว' }).click();
  await expect(page.getByText('ส่งผลตรวจนับแล้ว รอผู้จัดการตรวจ')).toBeVisible();

  await unlock(page);
  await boNav(page, 'ตรวจนับ');
  await expect(page.locator('.page', { hasText: 'ผลตรวจนับ' })).toContainText('ไม่ตรงระบบ');
  await page.getByRole('button', { name: 'อนุมัติและปรับสต็อก' }).click();
  await typePin(page);
  await expect(page.getByText('อนุมัติแล้ว').first()).toBeVisible();
  await boNav(page, 'สต็อก');
  await page.getByLabel('ค้นหาสินค้าในสต็อก').fill('น้ำดื่ม');
  await expect(page.locator('tbody tr', { hasText: 'น้ำดื่ม' })).toContainText('90');
});

async function pickStaffFromCount(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: 'เลือกชื่อผู้นับก่อนเริ่ม' });
  await expect(btn).toBeVisible();
  await btn.click();
  await page.locator('.choice', { hasText: 'แพร' }).click();
}

test('staff report a mistake and the manager closes it', async ({ page }) => {
  await setup(page);
  await pickStaff(page, 'แพร');
  await page.locator('.rail-item', { hasText: 'ประวัติขาย' }).click();
  await page.locator('.sale-row').first().click();
  await page.getByRole('button', { name: /แจ้งว่ารายการนี้ผิด/ }).click();
  await page.getByRole('button', { name: 'ราคาไม่ถูกต้อง' }).click();
  await page.getByRole('button', { name: 'ส่งให้ผู้จัดการ' }).click();
  await expect(page.getByText('แจ้งผิดแล้ว รอผู้จัดการตรวจ')).toBeVisible();

  await unlock(page);
  await page.getByRole('button', { name: /พนักงานแจ้งรายการผิด/ }).click();
  await page.locator('.sale-row').first().click();
  await page.getByLabel('วิธีที่แก้').first().fill('ตรวจแล้ว ราคาถูกต้อง');
  await page.getByRole('button', { name: 'ปิดเรื่องนี้' }).first().click();
  await expect(page.locator('.toast', { hasText: 'ปิดเรื่องแล้ว' })).toBeVisible();
});

test('receive stock and adjust with reason and PIN', async ({ page }) => {
  await setup(page);
  await unlock(page);
  await boNav(page, 'สต็อก');
  await page.getByLabel('ค้นหาสินค้าในสต็อก').fill('BCAA');
  await page.locator('tbody tr', { hasText: 'BCAA' }).click();
  await page.getByRole('button', { name: 'รับสินค้าเข้า' }).click();
  await page.getByLabel('จำนวนที่รับเข้า').fill('20');
  await page.getByRole('button', { name: 'บันทึกรับเข้า' }).click();
  await expect(page.locator('.stat-big')).toHaveText('23');
  await page.getByRole('button', { name: 'ปรับยอด' }).click();
  await page.getByLabel('ยอดคงเหลือที่ถูกต้อง').fill('21');
  await page.getByLabel('เหตุผล').fill('ซองขาด 2 ซอง');
  await page.locator('.detail-pane').getByRole('button', { name: 'ปรับยอด', exact: true }).click();
  await typePin(page);
  await expect(page.locator('.stat-big')).toHaveText('21');
  await expect(page.locator('.move-row').first()).toContainText('ซองขาด 2 ซอง');
});

test('backup to a file and restore it on a fresh iPad', async ({ page, browser }) => {
  await setup(page);
  await unlock(page);
  await boNav(page, 'ตั้งค่า');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'สำรองตอนนี้' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^orbiz-pos-backup-[0-9-]+\.orbizpos$/);
  const saved = await file.path();
  await expect(page.getByText(/สำรองล่าสุด/)).toBeVisible();

  const fresh = await browser.newContext({ viewport: page.viewportSize()!, locale: 'th-TH' });
  const p2 = await fresh.newPage();
  await setupFreshForRestore(p2);
  const chooser = p2.waitForEvent('filechooser');
  await p2.getByRole('button', { name: 'เลือกไฟล์' }).click();
  await (await chooser).setFiles(saved);
  await expect(p2.getByRole('dialog')).toContainText('ไฟล์สำรองเมื่อ');
  await p2.getByRole('button', { name: 'แทนที่ข้อมูลในเครื่อง' }).click();
  await typePin(p2, '470813');
  await p2.waitForURL(/#\/pos/);
  await expect(p2.locator('.tile', { hasText: 'เวย์โปรตีน เชค' })).toBeVisible();
  // The restored PIN is the original one.
  await p2.locator('.rail-item', { hasText: 'ระบบจัดการ' }).click();
  await typePin(p2);
  await expect(p2.locator('.bo-side')).toBeVisible();
  await fresh.close();
});

async function setupFreshForRestore(p: import('@playwright/test').Page) {
  await p.goto('/#/admin');
  await expect(p.getByRole('heading', { name: 'ตั้ง PIN ผู้จัดการ' })).toBeVisible();
  await typePin(p, '470813');
  await expect(p.getByRole('heading', { name: 'ยืนยัน PIN' })).toBeVisible();
  await typePin(p, '470813');
  await p.getByRole('button', { name: /จดรหัสแล้ว/ }).click();
  await boNav(p, 'ตั้งค่า');
}
