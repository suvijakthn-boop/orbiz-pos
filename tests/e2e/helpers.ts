import { expect, type Page } from '@playwright/test';

export const PIN = '258036';

export async function typePin(page: Page, pin = PIN) {
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
}

/** First run on a fresh iPad: set the manager PIN, load sample data, go back to selling. */
export async function setup(page: Page, { demo = true } = {}) {
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'ตั้ง PIN ผู้จัดการ' })).toBeVisible();
  await typePin(page);
  await expect(page.getByRole('heading', { name: 'ยืนยัน PIN' })).toBeVisible();
  await typePin(page);
  await expect(page.getByTestId('recovery-code')).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await page.getByRole('button', { name: /จดรหัสแล้ว/ }).click();
  if (demo) {
    await page.locator('.bo-nav button', { hasText: 'ตั้งค่า' }).click();
    await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();
    await expect(page.getByText('มีข้อมูลตัวอย่างอยู่ในเครื่อง')).toBeVisible({ timeout: 15_000 });
  }
  await page.getByTestId('return-to-pos').click();
  await expect(page.locator('.catalog')).toBeVisible();
}

export async function unlock(page: Page) {
  await page.locator('.rail-item', { hasText: 'ระบบจัดการ' }).click();
  await typePin(page);
  await expect(page.locator('.bo-side')).toBeVisible();
}

export async function boNav(page: Page, label: string) {
  await page.locator('.bo-nav button', { hasText: label }).first().click();
}

export async function pickStaff(page: Page, name = 'ฝน') {
  await page.locator('.staff-btn').click();
  await page.locator('.choice', { hasText: name }).click();
}

export async function tile(page: Page, name: string) {
  return page.locator('.tile', { hasText: name });
}

export async function stockOf(page: Page, name: string): Promise<number> {
  const t = page.locator('.tile', { hasText: name }).locator('.tile-stock');
  const txt = (await t.textContent()) ?? '';
  return Number(txt.replace(/\D/g, ''));
}

/** Nothing on the page should scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}
