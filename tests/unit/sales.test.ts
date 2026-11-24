// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { db, uid } from '../../src/lib/db';
import { completeSale, voidSale, changePayment, reportMistake, setSlipStatus } from '../../src/lib/sales';
import { makeProduct, makeStaff, slip } from './helpers';

describe('completeSale', () => {
  it('saves the sale, snapshots price and cost, and takes stock out', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 10 });
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 3 }], staffId, payment: 'cash', slip: null });
    expect(sale.total).toBe(36000);
    expect(sale.costTotal).toBe(15000);
    expect(sale.number).toBe(1);
    expect(sale.items[0]).toMatchObject({ name: p.name, price: 12000, cost: 5000, qty: 3 });
    expect((await db.products.get(p.id))!.stock).toBe(7);
    const moves = await db.moves.where('productId').equals(p.id).toArray();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ delta: -3, balanceAfter: 7, reason: 'sale' });
  });

  it('saves only once when the same order is submitted twice (double tap)', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 5 });
    const input = { orderId: uid(), lines: [{ productId: p.id, qty: 2 }], staffId, payment: 'cash' as const, slip: null };
    const [a, b] = await Promise.all([completeSale(input), completeSale(input)]);
    expect(a.id).toBe(b.id);
    expect(await db.sales.count()).toBe(1);
    expect((await db.products.get(p.id))!.stock).toBe(3);
  });

  it('numbers sales in order', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 5 });
    const one = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null });
    const two = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null });
    expect([one.number, two.number]).toEqual([1, 2]);
  });

  it('requires a slip photo for transfers and stores it', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct();
    await expect(completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'transfer', slip: null })).rejects.toThrow('สลิป');
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'transfer', slip: slip() });
    expect(sale.slipStatus).toBe('pending');
    expect(await db.images.get(sale.slipImageId!)).toBeTruthy();
  });

  it('refuses to sell more than is in stock, and saves nothing', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 2 });
    await expect(completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 3 }], staffId, payment: 'cash', slip: null })).rejects.toThrow('เหลือ 2');
    expect(await db.sales.count()).toBe(0);
    expect((await db.products.get(p.id))!.stock).toBe(2);
  });

  it('sells untracked items without touching stock', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 0, trackStock: false });
    await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 4 }], staffId, payment: 'cash', slip: null });
    expect((await db.products.get(p.id))!.stock).toBe(0);
    expect(await db.moves.count()).toBe(0);
  });

  it('needs an active staff member', async () => {
    const staffId = await makeStaff();
    await db.staff.update(staffId, { active: false });
    const p = await makeProduct();
    await expect(completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null })).rejects.toThrow('พนักงาน');
  });

  it('refuses products that were switched off', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ active: false });
    await expect(completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null })).rejects.toThrow();
  });
});

describe('manager corrections', () => {
  it('voiding returns stock once and keeps the record', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 10 });
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 4 }], staffId, payment: 'cash', slip: null });
    await expect(voidSale(sale.id, '  ')).rejects.toThrow('เหตุผล');
    await voidSale(sale.id, 'ลูกค้าคืนของ');
    await voidSale(sale.id, 'ลูกค้าคืนของ');
    expect((await db.products.get(p.id))!.stock).toBe(10);
    const saved = (await db.sales.get(sale.id))!;
    expect(saved.status).toBe('voided');
    expect(saved.voidReason).toBe('ลูกค้าคืนของ');
    expect(await db.log.filter((l) => l.action.startsWith('ยกเลิกการขาย')).count()).toBe(1);
  });

  it('changing the payment method is logged', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct();
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'transfer', slip: slip() });
    await changePayment(sale.id, 'cash');
    expect((await db.sales.get(sale.id))!).toMatchObject({ payment: 'cash', slipStatus: null });
    expect(await db.log.filter((l) => l.action.startsWith('แก้วิธีชำระ')).count()).toBe(1);
  });

  it('staff can report a mistake without changing the sale', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct();
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null });
    await expect(reportMistake(sale.id, 'อื่น ๆ', '', 'ฝน')).rejects.toThrow();
    const r = await reportMistake(sale.id, 'จำนวนไม่ถูกต้อง', '', 'ฝน');
    expect(r.status).toBe('open');
    expect((await db.sales.get(sale.id))!.total).toBe(sale.total);
  });

  it('slip verification is recorded', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct();
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'transfer', slip: slip() });
    await setSlipStatus(sale.id, 'flagged', 'ยอดไม่ตรง');
    expect((await db.sales.get(sale.id))!).toMatchObject({ slipStatus: 'flagged', slipNote: 'ยอดไม่ตรง' });
  });
});
