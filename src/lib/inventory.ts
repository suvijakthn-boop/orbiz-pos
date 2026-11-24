import { db, uid, type Product, type StockCount, type CountSnapshotLine, type Category } from './db';
import { logEvent } from './audit';
import { baht } from './format';
import { PosError } from './sales';

/* ---------------- products ---------------- */

export interface ProductDraft {
  name: string;
  categoryId: string | null;
  price: number;
  cost: number;
  trackStock: boolean;
  lowStock: number;
  active: boolean;
  imageId: string | null;
  /** Only used when creating. */
  initialStock?: number;
}

export function validateProduct(d: ProductDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = 'ใส่ชื่อสินค้า';
  else if (d.name.trim().length > 60) e.name = 'ชื่อยาวเกิน 60 ตัวอักษร';
  if (!Number.isInteger(d.price) || d.price < 0) e.price = 'ใส่ราคาขายเป็นตัวเลข';
  if (!Number.isInteger(d.cost) || d.cost < 0) e.cost = 'ใส่ต้นทุนเป็นตัวเลข';
  if (!Number.isInteger(d.lowStock) || d.lowStock < 0) e.lowStock = 'ใส่จำนวนเป็นตัวเลข 0 ขึ้นไป';
  if (d.initialStock !== undefined && (!Number.isInteger(d.initialStock) || d.initialStock < 0)) e.initialStock = 'ใส่จำนวนเป็นตัวเลข 0 ขึ้นไป';
  return e;
}

export async function createProduct(d: ProductDraft): Promise<Product> {
  const errors = validateProduct(d);
  if (Object.keys(errors).length) throw new PosError(Object.values(errors)[0]);
  return db.transaction('rw', [db.products, db.moves, db.log], async () => {
    const now = Date.now();
    const last = await db.products.orderBy('sort').last();
    const stock = d.trackStock ? d.initialStock ?? 0 : 0;
    const p: Product = {
      id: uid(),
      name: d.name.trim(),
      categoryId: d.categoryId,
      price: d.price,
      cost: d.cost,
      stock,
      trackStock: d.trackStock,
      lowStock: d.lowStock,
      imageId: d.imageId,
      active: d.active,
      sort: (last?.sort ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.products.add(p);
    if (stock > 0) {
      await db.moves.add({ id: uid(), productId: p.id, productName: p.name, delta: stock, balanceAfter: stock, reason: 'initial', at: now });
    }
    await logEvent('product', `เพิ่มสินค้า ${p.name}`, `ราคา ${baht(p.price)} · ต้นทุน ${baht(p.cost)}${p.trackStock ? ` · สต็อกเริ่มต้น ${stock}` : ''}`);
    return p;
  });
}

export async function updateProduct(id: string, d: ProductDraft): Promise<void> {
  const errors = validateProduct({ ...d, initialStock: undefined });
  if (Object.keys(errors).length) throw new PosError(Object.values(errors)[0]);
  await db.transaction('rw', [db.products, db.categories, db.log], async () => {
    const before = await db.products.get(id);
    if (!before) throw new PosError('ไม่พบสินค้านี้');
    const changes: string[] = [];
    if (before.name !== d.name.trim()) changes.push(`ชื่อ "${before.name}" → "${d.name.trim()}"`);
    if (before.price !== d.price) changes.push(`ราคา ${baht(before.price)} → ${baht(d.price)}`);
    if (before.cost !== d.cost) changes.push(`ต้นทุน ${baht(before.cost)} → ${baht(d.cost)}`);
    if (before.categoryId !== d.categoryId) {
      const c = d.categoryId ? await db.categories.get(d.categoryId) : null;
      changes.push(`หมวด → ${c?.name ?? 'ไม่มีหมวด'}`);
    }
    if (before.trackStock !== d.trackStock) changes.push(d.trackStock ? 'เริ่มนับสต็อก' : 'เลิกนับสต็อก');
    if (before.lowStock !== d.lowStock) changes.push(`แจ้งใกล้หมดที่ ${before.lowStock} → ${d.lowStock}`);
    if (before.active !== d.active) changes.push(d.active ? 'เปิดขาย' : 'ปิดการขาย');
    if (before.imageId !== d.imageId) changes.push('เปลี่ยนรูป');
    await db.products.update(id, {
      name: d.name.trim(),
      categoryId: d.categoryId,
      price: d.price,
      cost: d.cost,
      trackStock: d.trackStock,
      lowStock: d.lowStock,
      active: d.active,
      imageId: d.imageId,
      updatedAt: Date.now(),
    });
    if (changes.length) await logEvent('product', `แก้สินค้า ${d.name.trim()}`, changes.join(' · '));
  });
}

export function isLowStock(p: Product): boolean {
  return p.active && p.trackStock && p.stock <= p.lowStock;
}

/* ---------------- categories ---------------- */

export async function addCategory(name: string): Promise<Category> {
  const n = name.trim();
  if (!n) throw new PosError('ใส่ชื่อหมวดหมู่');
  const all = await db.categories.toArray();
  if (all.some((c) => c.name === n)) throw new PosError('มีหมวดหมู่ชื่อนี้แล้ว');
  const c: Category = { id: uid(), name: n, sort: Math.max(0, ...all.map((x) => x.sort)) + 1 };
  await db.categories.add(c);
  await logEvent('product', `เพิ่มหมวดหมู่ ${n}`);
  return c;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new PosError('ใส่ชื่อหมวดหมู่');
  const before = await db.categories.get(id);
  if (!before || before.name === n) return;
  await db.categories.update(id, { name: n });
  await logEvent('product', `เปลี่ยนชื่อหมวดหมู่ ${before.name} → ${n}`);
}

export async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  const all = await db.categories.orderBy('sort').toArray();
  const i = all.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  await db.transaction('rw', db.categories, async () => {
    await db.categories.update(all[i].id, { sort: all[j].sort });
    await db.categories.update(all[j].id, { sort: all[i].sort });
  });
}

export async function deleteCategory(id: string): Promise<void> {
  const used = await db.products.where('categoryId').equals(id).count();
  if (used > 0) throw new PosError(`ย้ายสินค้า ${used} รายการออกจากหมวดนี้ก่อน`);
  const c = await db.categories.get(id);
  await db.categories.delete(id);
  if (c) await logEvent('product', `ลบหมวดหมู่ ${c.name}`);
}

/* ---------------- stock ---------------- */

export async function receiveStock(productId: string, qty: number, newCost: number | null, note: string): Promise<void> {
  if (!Number.isInteger(qty) || qty <= 0) throw new PosError('ใส่จำนวนที่รับเข้าเป็นตัวเลขมากกว่า 0');
  await db.transaction('rw', [db.products, db.moves, db.log], async () => {
    const p = await db.products.get(productId);
    if (!p) throw new PosError('ไม่พบสินค้านี้');
    if (!p.trackStock) throw new PosError('สินค้านี้ไม่ได้นับสต็อก');
    const balance = p.stock + qty;
    const patch: Partial<Product> = { stock: balance, updatedAt: Date.now() };
    if (newCost !== null && newCost !== p.cost) patch.cost = newCost;
    await db.products.update(p.id, patch);
    await db.moves.add({ id: uid(), productId: p.id, productName: p.name, delta: qty, balanceAfter: balance, reason: 'receive', note: note.trim() || undefined, at: Date.now() });
    const parts = [`+${qty} → คงเหลือ ${balance}`];
    if (patch.cost !== undefined) parts.push(`ต้นทุน ${baht(p.cost)} → ${baht(patch.cost)}`);
    if (note.trim()) parts.push(note.trim());
    await logEvent('stock', `รับสินค้าเข้า ${p.name}`, parts.join(' · '));
  });
}

export async function adjustStock(productId: string, newQty: number, reason: string): Promise<void> {
  if (!Number.isInteger(newQty) || newQty < 0) throw new PosError('ใส่ยอดคงเหลือเป็นตัวเลข 0 ขึ้นไป');
  if (!reason.trim()) throw new PosError('ระบุเหตุผลที่ปรับยอด');
  await db.transaction('rw', [db.products, db.moves, db.log], async () => {
    const p = await db.products.get(productId);
    if (!p) throw new PosError('ไม่พบสินค้านี้');
    const delta = newQty - p.stock;
    if (delta === 0) return;
    await db.products.update(p.id, { stock: newQty, updatedAt: Date.now() });
    await db.moves.add({ id: uid(), productId: p.id, productName: p.name, delta, balanceAfter: newQty, reason: 'adjust', note: reason.trim(), at: Date.now() });
    await logEvent('stock', `ปรับยอดสต็อก ${p.name}`, `${p.stock} → ${newQty} (${delta > 0 ? '+' : ''}${delta}) · ${reason.trim()}`);
  });
}

/* ---------------- stock counts ---------------- */

export async function getDraftCount(): Promise<StockCount | undefined> {
  return db.counts.where('status').equals('draft').first();
}

export async function startCount(staffName: string): Promise<StockCount> {
  const existing = await getDraftCount();
  if (existing) return existing;
  const c: StockCount = { id: uid(), status: 'draft', staffName, startedAt: Date.now(), updatedAt: Date.now(), counts: {} };
  await db.counts.add(c);
  await logEvent('stock', 'เริ่มตรวจนับสต็อก', undefined, staffName);
  return c;
}

export async function saveCountDraft(id: string, counts: Record<string, number>): Promise<void> {
  const c = await db.counts.get(id);
  if (!c || c.status !== 'draft') throw new PosError('รอบตรวจนับนี้ถูกส่งไปแล้ว');
  await db.counts.update(id, { counts, updatedAt: Date.now() });
}

export async function discardCount(id: string): Promise<void> {
  const c = await db.counts.get(id);
  if (!c || c.status !== 'draft') return;
  await db.counts.delete(id);
  await logEvent('stock', 'ยกเลิกรอบตรวจนับที่ยังไม่ส่ง', undefined, c.staffName);
}

export async function submitCount(id: string, counts: Record<string, number>, staffName: string): Promise<StockCount> {
  return db.transaction('rw', [db.counts, db.products, db.log], async () => {
    const c = await db.counts.get(id);
    if (!c || c.status !== 'draft') throw new PosError('รอบตรวจนับนี้ถูกส่งไปแล้ว');
    const entries = Object.entries(counts).filter(([, v]) => Number.isInteger(v) && v >= 0);
    if (entries.length === 0) throw new PosError('ยังไม่ได้นับสินค้า');
    const lines: CountSnapshotLine[] = [];
    for (const [productId, counted] of entries) {
      const p = await db.products.get(productId);
      if (!p || !p.trackStock) continue;
      lines.push({ productId, name: p.name, expected: p.stock, counted, cost: p.cost });
    }
    const patch = { status: 'submitted' as const, counts, lines, submittedAt: Date.now(), updatedAt: Date.now(), staffName };
    await db.counts.update(id, patch);
    const diffs = lines.filter((l) => l.counted !== l.expected).length;
    await logEvent('stock', 'ส่งผลตรวจนับสต็อก', `นับ ${lines.length} รายการ · ไม่ตรง ${diffs} รายการ`, staffName);
    return { ...c, ...patch };
  });
}

export function countVariance(lines: CountSnapshotLine[]) {
  const diffLines = lines.filter((l) => l.counted !== l.expected);
  const value = diffLines.reduce((s, l) => s + (l.counted - l.expected) * l.cost, 0);
  return { diffLines, value, units: diffLines.reduce((s, l) => s + (l.counted - l.expected), 0) };
}

/**
 * Approve a submitted count. The difference found at count time is applied to the current
 * balance, so sales made after the count was submitted are not lost.
 */
export async function approveCount(id: string, note: string): Promise<void> {
  await db.transaction('rw', [db.counts, db.products, db.moves, db.log], async () => {
    const c = await db.counts.get(id);
    if (!c || c.status !== 'submitted' || !c.lines) throw new PosError('รอบนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    const now = Date.now();
    for (const l of c.lines) {
      const delta = l.counted - l.expected;
      if (delta === 0) continue;
      const p = await db.products.get(l.productId);
      if (!p || !p.trackStock) continue;
      const balance = Math.max(0, p.stock + delta);
      await db.products.update(p.id, { stock: balance, updatedAt: now });
      await db.moves.add({ id: uid(), productId: p.id, productName: p.name, delta: balance - p.stock, balanceAfter: balance, reason: 'count', refId: c.id, note: note.trim() || undefined, at: now });
    }
    await db.counts.update(id, { status: 'approved', reviewedAt: now, reviewNote: note.trim() || undefined });
    const v = countVariance(c.lines);
    await logEvent('stock', 'อนุมัติผลตรวจนับและปรับสต็อก', `${v.diffLines.length} รายการ · มูลค่าต่าง ${baht(v.value)}${note.trim() ? ` · ${note.trim()}` : ''}`);
  });
}

export async function rejectCount(id: string, note: string): Promise<void> {
  if (!note.trim()) throw new PosError('ระบุเหตุผลที่ไม่อนุมัติ');
  await db.transaction('rw', [db.counts, db.log], async () => {
    const c = await db.counts.get(id);
    if (!c || c.status !== 'submitted') throw new PosError('รอบนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    await db.counts.update(id, { status: 'rejected', reviewedAt: Date.now(), reviewNote: note.trim() });
    await logEvent('stock', 'ไม่อนุมัติผลตรวจนับ', note.trim());
  });
}

/* ---------------- staff ---------------- */

export async function addStaff(name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new PosError('ใส่ชื่อพนักงาน');
  if (n.length > 30) throw new PosError('ชื่อยาวเกิน 30 ตัวอักษร');
  const all = await db.staff.toArray();
  if (all.some((s) => s.name === n && s.active)) throw new PosError('มีพนักงานชื่อนี้แล้ว');
  await db.staff.add({ id: uid(), name: n, active: true, createdAt: Date.now() });
  await logEvent('staff', `เพิ่มพนักงาน ${n}`);
}

export async function renameStaff(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new PosError('ใส่ชื่อพนักงาน');
  const s = await db.staff.get(id);
  if (!s || s.name === n) return;
  await db.staff.update(id, { name: n });
  await logEvent('staff', `เปลี่ยนชื่อพนักงาน ${s.name} → ${n}`);
}

export async function setStaffActive(id: string, active: boolean): Promise<void> {
  const s = await db.staff.get(id);
  if (!s) return;
  await db.staff.update(id, { active });
  await logEvent('staff', `${active ? 'เปิดใช้' : 'ปิดใช้'}ชื่อพนักงาน ${s.name}`);
}
