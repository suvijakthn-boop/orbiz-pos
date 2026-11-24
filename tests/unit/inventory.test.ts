import { describe, expect, it } from 'vitest';
import { db, uid } from '../../src/lib/db';
import { adjustStock, approveCount, createProduct, receiveStock, rejectCount, startCount, submitCount, updateProduct, validateProduct, deleteCategory, addCategory } from '../../src/lib/inventory';
import { completeSale } from '../../src/lib/sales';
import { makeProduct, makeStaff } from './helpers';

describe('products', () => {
  it('validates required fields', () => {
    const e = validateProduct({ name: ' ', categoryId: null, price: -1, cost: 0, trackStock: true, lowStock: 0, active: true, imageId: null });
    expect(Object.keys(e).sort()).toEqual(['name', 'price']);
  });

  it('records initial stock and logs price changes', async () => {
    const p = await createProduct({ name: 'ครีเอทีน', categoryId: null, price: 4000, cost: 1500, trackStock: true, lowStock: 5, active: true, imageId: null, initialStock: 20 });
    expect(p.stock).toBe(20);
    expect((await db.moves.toArray())[0]).toMatchObject({ reason: 'initial', delta: 20 });
    await updateProduct(p.id, { name: 'ครีเอทีน', categoryId: null, price: 4500, cost: 1500, trackStock: true, lowStock: 5, active: true, imageId: null });
    const log = await db.log.filter((l) => l.action.startsWith('แก้สินค้า')).toArray();
    expect(log[0].detail).toContain('฿40 → ฿45');
  });

  it('does not delete a category that still has products', async () => {
    const c = await addCategory('เครื่องดื่ม');
    await makeProduct({ categoryId: c.id });
    await expect(deleteCategory(c.id)).rejects.toThrow('ย้ายสินค้า');
  });
});

describe('stock', () => {
  it('receiving adds stock and can update cost', async () => {
    const p = await makeProduct({ stock: 3, cost: 5000 });
    await receiveStock(p.id, 12, 5500, 'ใบส่งของ 001');
    expect((await db.products.get(p.id))!).toMatchObject({ stock: 15, cost: 5500 });
  });

  it('adjusting needs a reason', async () => {
    const p = await makeProduct({ stock: 3 });
    await expect(adjustStock(p.id, 1, '')).rejects.toThrow('เหตุผล');
    await adjustStock(p.id, 1, 'ของเสีย');
    expect((await db.products.get(p.id))!.stock).toBe(1);
    expect((await db.moves.toArray())[0]).toMatchObject({ delta: -2, reason: 'adjust', note: 'ของเสีย' });
  });
});

describe('stock counts', () => {
  it('freezes system quantities at submit and applies only the difference on approval', async () => {
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 10 });
    const c = await startCount('ฝน');
    const submitted = await submitCount(c.id, { [p.id]: 8 }, 'ฝน');
    expect(submitted.lines![0]).toMatchObject({ expected: 10, counted: 8 });
    // A sale happens after the count was submitted.
    await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'cash', slip: null });
    await approveCount(c.id, '');
    // 10 - 1 sold - 2 missing = 7
    expect((await db.products.get(p.id))!.stock).toBe(7);
    expect((await db.counts.get(c.id))!.status).toBe('approved');
  });

  it('a rejected count leaves stock alone and needs a note', async () => {
    const p = await makeProduct({ stock: 10 });
    const c = await startCount('ฝน');
    await submitCount(c.id, { [p.id]: 4 }, 'ฝน');
    await expect(rejectCount(c.id, '')).rejects.toThrow();
    await rejectCount(c.id, 'นับชั้นหลังใหม่');
    expect((await db.products.get(p.id))!.stock).toBe(10);
  });

  it('only one draft count at a time', async () => {
    const a = await startCount('ฝน');
    const b = await startCount('บอส');
    expect(a.id).toBe(b.id);
  });
});
