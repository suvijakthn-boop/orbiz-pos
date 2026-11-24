// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { applyReceipt, claudePrompt, defaultAction, parseReceipt, receiptTotal, RECEIPT_MARK } from '../../src/lib/receiving';
import { makeProduct } from './helpers';

const SUMMARY = `\`\`\`
#ORBIZ-รับของ
สัปดาห์: 2026-11-23 ถึง 2026-11-29
บิล: แม็คโคร 24/11 ฿1,250 ; โอสถสภา 26/11 ฿860
น้ำเปล่า 550ml | 48 | 4.50
โค้ก Zero | 24 | 12.25
ใหม่: Electrolyte Beat | 12 | 18
รวม: 726
\`\`\``;

async function setup() {
  const water = await makeProduct({ name: 'น้ำเปล่า 550 ml', stock: 10, cost: 400 });
  const coke = await makeProduct({ name: 'โค้ก Zero', stock: 5, cost: 1200 });
  return { water, coke };
}

describe('parseReceipt', () => {
  it('reads the weekly summary and matches names loosely', async () => {
    const { water, coke } = await setup();
    const r = parseReceipt(SUMMARY, await db.products.toArray());
    expect(r.hasMark).toBe(true);
    expect(r.week).toBe('2026-11-23 ถึง 2026-11-29');
    expect(r.bills).toContain('แม็คโคร');
    expect(r.statedTotal).toBe(72600);
    expect(r.lines.map((l) => [l.name, l.qty, l.cost, l.match?.id ?? null, l.markedNew])).toEqual([
      ['น้ำเปล่า 550ml', 48, 450, water.id, false],
      ['โค้ก Zero', 24, 1225, coke.id, false],
      ['Electrolyte Beat', 12, 1800, null, true],
    ]);
    const actions = r.lines.map(defaultAction);
    expect(receiptTotal(r.lines, actions, await db.products.toArray())).toBe(72600);
  });

  it('flags unreadable numbers instead of guessing', async () => {
    await setup();
    const r = parseReceipt('โค้ก Zero | ? | 12\nน้ำเปล่า 550 ml | 24 | ?', await db.products.toArray());
    expect(r.lines.map((l) => l.error)).toEqual(['ยังไม่มีจำนวน', 'ยังไม่มีทุนต่อชิ้น']);
  });

  it('accepts a markdown table and merges repeated products by weighted cost', async () => {
    await setup();
    const r = parseReceipt('| ชื่อสินค้า | จำนวน | ทุน |\n|---|---|---|\n| โค้ก Zero | 24 | 12 |\n| โค้ก Zero | 12 | 15 |', await db.products.toArray());
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ qty: 36, cost: 1300 });
  });

  it('leaves unknown names for the manager to decide', async () => {
    await setup();
    const r = parseReceipt('Pocari 500 | 12 | 14', await db.products.toArray());
    expect(r.lines[0].match).toBeNull();
    expect(defaultAction(r.lines[0])).toBeNull();
  });
});

describe('applyReceipt', () => {
  it("adds stock, sets this week's cost, creates new items switched off, and logs it", async () => {
    const { water, coke } = await setup();
    const r = parseReceipt(SUMMARY, await db.products.toArray());
    const receipt = await applyReceipt(r, r.lines.map(defaultAction));
    expect(receipt.total).toBe(72600);
    expect((await db.products.get(water.id))!).toMatchObject({ stock: 58, cost: 450 });
    expect((await db.products.get(coke.id))!).toMatchObject({ stock: 29, cost: 1225 });
    const beat = (await db.products.toArray()).find((p) => p.name === 'Electrolyte Beat')!;
    expect(beat).toMatchObject({ stock: 12, cost: 1800, active: false, price: 0 });
    expect(await db.moves.filter((m) => m.reason === 'receive').count()).toBe(3);
    const log = (await db.log.toArray()).find((l) => l.action.startsWith('รับของจากบิล'))!;
    expect(log.detail).toContain('฿4 → ฿4.50');
  });

  it('refuses the same summary twice unless confirmed', async () => {
    const { water } = await setup();
    const products = await db.products.toArray();
    const r = parseReceipt(SUMMARY, products);
    await applyReceipt(r, r.lines.map(defaultAction));
    const again = parseReceipt(SUMMARY, await db.products.toArray());
    await expect(applyReceipt(again, again.lines.map(defaultAction))).rejects.toThrow('รับเข้าไปแล้ว');
    expect((await db.products.get(water.id))!.stock).toBe(58);
    await applyReceipt(again, again.lines.map(defaultAction), { allowDuplicate: true });
    expect((await db.products.get(water.id))!.stock).toBe(106);
  });

  it('needs a decision for every unknown name', async () => {
    const { coke } = await setup();
    const r = parseReceipt('Coke zero 325 | 24 | 12', await db.products.toArray());
    await expect(applyReceipt(r, [null])).rejects.toThrow('เลือกสินค้า');
    await applyReceipt(r, [{ kind: 'product', productId: coke.id }]);
    expect((await db.products.get(coke.id))!.stock).toBe(29);
  });

  it('a skipped-only summary changes nothing', async () => {
    await setup();
    const r = parseReceipt('โค้ก Zero | 24 | 12', await db.products.toArray());
    await expect(applyReceipt(r, [{ kind: 'skip' }])).rejects.toThrow('ไม่มีรายการ');
    expect(await db.receipts.count()).toBe(0);
  });
});

describe('claudePrompt', () => {
  it("lists the app's product names and the format", async () => {
    await setup();
    const p = claudePrompt(await db.products.toArray());
    expect(p).toContain(RECEIPT_MARK);
    expect(p).toContain('- น้ำเปล่า 550 ml');
    expect(p).toContain('- โค้ก Zero');
  });
});
