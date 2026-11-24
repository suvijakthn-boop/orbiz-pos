import { test, expect } from '@playwright/test';
import { setup, pickStaff, stockOf, expectNoHorizontalOverflow, unlock, boNav, typePin } from './helpers';
import path from 'node:path';

const slipFile = path.resolve('public/icons/icon-512.png');

test('cash sale in three steps, then a fresh order', async ({ page }) => {
  await setup(page);
  const before = await stockOf(page, 'น้ำดื่ม 600 มล.');
  await page.locator('.tile', { hasText: 'น้ำดื่ม 600 มล.' }).click();
  await page.locator('.tile', { hasText: 'น้ำดื่ม 600 มล.' }).click();
  await page.locator('.tile', { hasText: 'เวย์โปรตีน เชค' }).click();
  await expect(page.locator('.total-amount')).toHaveText('฿150');
  // Without a name, the main button asks for one.
  await expect(page.getByRole('button', { name: /เลือกชื่อพนักงานก่อนบันทึก/ })).toBeVisible();
  await pickStaff(page, 'ฝน');
  await expect(page.getByTestId('complete-sale')).toBeDisabled();
  await page.getByRole('button', { name: 'เงินสด' }).click();
  // The checkout button stays on screen without scrolling.
  await expect(page.getByTestId('complete-sale')).toBeInViewport();
  await page.getByTestId('complete-sale').click();
  const success = page.getByRole('alertdialog');
  await expect(success).toContainText('บันทึกการขายแล้ว');
  await expect(success).toContainText('฿150');
  await success.getByRole('button', { name: /รายการใหม่/ }).click();
  await expect(page.locator('.cart-empty')).toBeVisible();
  expect(await stockOf(page, 'น้ำดื่ม 600 มล.')).toBe(before - 2);
  // The staff name is remembered for the next sale.
  await expect(page.locator('.staff-btn')).toContainText('ฝน');
  await expectNoHorizontalOverflow(page);
});

test('a double tap on Complete Sale saves one sale', async ({ page }) => {
  await setup(page);
  await page.locator('.rail-item', { hasText: 'ประวัติขาย' }).click();
  await expect(page.locator('.sale-row').first()).toBeVisible();
  const before = await page.locator('.sale-row').count();
  await page.locator('.rail-item', { hasText: 'ขายสินค้า' }).click();
  await page.locator('.tile', { hasText: 'กาแฟดำ Cold Brew' }).click();
  await pickStaff(page);
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByTestId('complete-sale').dblclick();
  await page.getByRole('alertdialog').getByRole('button', { name: /รายการใหม่/ }).click();
  await page.locator('.rail-item', { hasText: 'ประวัติขาย' }).click();
  await expect(page.locator('.sale-row')).toHaveCount(before + 1);
});

test('bank transfer opens the camera, keeps the slip, and the manager verifies it', async ({ page }) => {
  await setup(page);
  await page.locator('.tile', { hasText: 'สายรัดข้อมือ' }).click();
  await pickStaff(page, 'บอส');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'โอนเงิน' }).click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(false);
  await fc.setFiles(slipFile);
  await expect(page.getByText('ถ่ายรูปสลิปแล้ว')).toBeVisible();
  // Retake replaces it.
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ถ่ายรูปสลิปใหม่' }).click();
  await (await again).setFiles(slipFile);
  // Preview full screen, then close.
  await page.getByRole('button', { name: 'ดูรูปสลิปเต็มจอ' }).click();
  await expect(page.getByRole('dialog', { name: 'ดูรูปเต็มจอ' })).toBeVisible();
  await page.getByRole('button', { name: 'ปิดรูป' }).click();
  await page.getByTestId('complete-sale').click();
  await expect(page.getByRole('alertdialog')).toContainText('โอนเงิน');
  await page.getByRole('alertdialog').getByRole('button', { name: /รายการใหม่/ }).click();

  await unlock(page);
  await boNav(page, 'สลิปโอนเงิน');
  await page.getByRole('button', { name: /วันนี้/ }).first().click();
  const card = page.locator('.slip-card', { hasText: '฿390' }).first();
  await card.click();
  await page.getByRole('button', { name: /เงินเข้าแล้ว ถูกต้อง/ }).click();
  await expect(page.locator('.toast', { hasText: 'ยืนยันสลิปแล้ว' })).toBeVisible();
});

test('transfer cannot be saved without a slip photo', async ({ page }) => {
  await setup(page);
  await page.locator('.tile', { hasText: 'น้ำดื่ม 600 มล.' }).click();
  await pickStaff(page);
  page.on('filechooser', () => {}); // staff closes the camera without a photo
  await page.getByRole('button', { name: 'โอนเงิน' }).click();
  await expect(page.getByTestId('complete-sale')).toHaveCount(0);
  await expect(page.locator('.cart-foot').getByRole('button', { name: 'ถ่ายรูปสลิป' }).last()).toBeVisible();
  await expect(page.getByText('ลูกค้าโอนแล้ว ถ่ายรูปสลิปเก็บไว้')).toBeVisible();
});

test('staff never see cost or profit', async ({ page }) => {
  await setup(page);
  for (const tab of ['ขายสินค้า', 'ประวัติขาย', 'ตรวจนับ']) {
    await page.locator('.rail-item', { hasText: tab }).click();
    if (tab === 'ประวัติขาย') await page.locator('.sale-row').first().click();
    const text = await page.locator('.stage').innerText();
    expect(text).not.toMatch(/ต้นทุน|กำไร/);
  }
});

test('out of stock items cannot be added beyond what is left', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.tile', { hasText: 'กล้วยหอม' })).toBeDisabled();
  const bcaa = page.locator('.tile', { hasText: 'BCAA' });
  for (let i = 0; i < 4; i++) await bcaa.click();
  await expect(page.locator('.toast', { hasText: 'เหลือ 3 ชิ้น' })).toBeVisible();
  await expect(bcaa.locator('.tile-qty')).toHaveText('3');
});

test('clearing the order can be undone', async ({ page }) => {
  await setup(page);
  await page.locator('.tile', { hasText: 'น้ำมะพร้าว' }).click();
  await page.getByRole('button', { name: 'ล้างรายการทั้งหมด' }).click();
  await expect(page.locator('.cart-empty')).toBeVisible();
  await page.locator('.toast', { hasText: 'ล้างรายการแล้ว' }).getByRole('button', { name: 'เลิกทำ' }).click();
  await expect(page.locator('.line')).toHaveCount(1);
});

test('the order survives switching tabs and reloading', async ({ page }) => {
  await setup(page);
  await page.locator('.tile', { hasText: 'น้ำมะพร้าว' }).click();
  await page.locator('.rail-item', { hasText: 'ประวัติขาย' }).click();
  await page.locator('.rail-item', { hasText: 'ขายสินค้า' }).click();
  await expect(page.locator('.line')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.line')).toHaveCount(1);
});

test('void with PIN returns the stock', async ({ page }) => {
  await setup(page);
  const before = await stockOf(page, 'ขวดเชค ORBIZ');
  await page.locator('.tile', { hasText: 'ขวดเชค ORBIZ' }).click();
  await pickStaff(page);
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await page.getByTestId('complete-sale').click();
  await page.getByRole('alertdialog').getByRole('button', { name: /รายการใหม่/ }).click();
  expect(await stockOf(page, 'ขวดเชค ORBIZ')).toBe(before - 1);

  await unlock(page);
  await boNav(page, 'รายการขาย');
  await page.locator('.sale-row', { hasText: 'ขวดเชค ORBIZ' }).first().click();
  await page.getByRole('button', { name: /ยกเลิกรายการขายนี้/ }).click();
  await page.getByLabel('เหตุผลที่ยกเลิก').fill('ลูกค้าคืนของ');
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await typePin(page, '111112');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('PIN ไม่ถูกต้อง');
  await typePin(page);
  await expect(page.locator('.detail-pane')).toContainText('ยกเลิกแล้ว');
  await page.getByTestId('return-to-pos').click();
  expect(await stockOf(page, 'ขวดเชค ORBIZ')).toBe(before);
});
