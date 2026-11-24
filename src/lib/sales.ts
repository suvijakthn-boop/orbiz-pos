import { db, uid, type PaymentMethod, type Sale, type SaleItem, type SlipStatus, type MistakeReport } from './db';
import { dayKey, saleNo, baht } from './format';
import { logEvent } from './audit';
import { DEFAULT_SETTINGS } from './settings';

export class PosError extends Error {}

export interface CartLine {
  productId: string;
  qty: number;
}

export interface CompleteSaleInput {
  /** Generated when the order starts; makes saving idempotent (double taps save once). */
  orderId: string;
  lines: CartLine[];
  staffId: string;
  payment: PaymentMethod;
  slip: Blob | null;
  now?: number;
}

export async function completeSale(input: CompleteSaleInput): Promise<Sale> {
  const { orderId, lines, staffId, payment, slip } = input;
  const now = input.now ?? Date.now();
  const filtered = lines.filter((l) => l.qty > 0);
  if (filtered.length === 0) throw new PosError('ยังไม่มีสินค้าในรายการ');
  if (payment === 'transfer' && !slip) throw new PosError('ถ่ายรูปสลิปก่อนบันทึกการขาย');

  return db.transaction('rw', [db.sales, db.products, db.moves, db.images, db.settings, db.staff, db.log], async () => {
    const existing = await db.sales.get(orderId);
    if (existing) return existing;

    const staff = await db.staff.get(staffId);
    if (!staff || !staff.active) throw new PosError('เลือกชื่อพนักงานก่อนบันทึก');

    const items: SaleItem[] = [];
    const merged = new Map<string, number>();
    for (const l of filtered) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.qty);

    for (const [productId, qty] of merged) {
      const p = await db.products.get(productId);
      if (!p || !p.active) throw new PosError('มีสินค้าที่ถูกปิดการขายแล้ว ลบออกจากรายการแล้วลองใหม่');
      if (!Number.isInteger(qty) || qty <= 0) throw new PosError('จำนวนสินค้าไม่ถูกต้อง');
      if (p.trackStock && p.stock < qty) {
        throw new PosError(`${p.name} เหลือ ${p.stock} ชิ้น ลดจำนวนแล้วลองใหม่`);
      }
      items.push({ productId, name: p.name, price: p.price, cost: p.cost, qty });
    }

    const counterRow = await db.settings.get('saleCounter');
    const number = ((counterRow?.value as number | undefined) ?? DEFAULT_SETTINGS.saleCounter) + 1;
    await db.settings.put({ key: 'saleCounter', value: number });

    let slipImageId: string | null = null;
    if (payment === 'transfer' && slip) {
      slipImageId = uid();
      await db.images.add({ id: slipImageId, kind: 'slip', blob: slip, createdAt: now });
    }

    const sale: Sale = {
      id: orderId,
      number,
      createdAt: now,
      day: dayKey(now),
      staffId: staff.id,
      staffName: staff.name,
      items,
      total: items.reduce((s, i) => s + i.price * i.qty, 0),
      costTotal: items.reduce((s, i) => s + i.cost * i.qty, 0),
      payment,
      slipImageId,
      slipStatus: payment === 'transfer' ? 'pending' : null,
      status: 'completed',
    };
    await db.sales.add(sale);

    for (const item of items) {
      const p = (await db.products.get(item.productId))!;
      if (!p.trackStock) continue;
      const balance = p.stock - item.qty;
      await db.products.update(p.id, { stock: balance });
      await db.moves.add({
        id: uid(),
        productId: p.id,
        productName: p.name,
        delta: -item.qty,
        balanceAfter: balance,
        reason: 'sale',
        refId: sale.id,
        at: now,
      });
    }
    await logEvent('sale', `ขาย เลขที่ ${saleNo(number)}`, `${baht(sale.total)} · ${payment === 'cash' ? 'เงินสด' : 'โอนเงิน'}`, staff.name);
    return sale;
  });
}

export async function voidSale(saleId: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new PosError('ระบุเหตุผลที่ยกเลิก');
  await db.transaction('rw', [db.sales, db.products, db.moves, db.log], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new PosError('ไม่พบรายการขายนี้');
    if (sale.status === 'voided') return;
    const now = Date.now();
    for (const item of sale.items) {
      const p = await db.products.get(item.productId);
      if (!p || !p.trackStock) continue;
      const balance = p.stock + item.qty;
      await db.products.update(p.id, { stock: balance });
      await db.moves.add({
        id: uid(),
        productId: p.id,
        productName: p.name,
        delta: item.qty,
        balanceAfter: balance,
        reason: 'void',
        refId: sale.id,
        at: now,
      });
    }
    await db.sales.update(saleId, { status: 'voided', voidReason: trimmed, voidedAt: now });
    await logEvent('sale', `ยกเลิกการขาย เลขที่ ${saleNo(sale.number)}`, `${baht(sale.total)} · ${trimmed} · คืนสต็อกแล้ว`);
  });
}

export async function changePayment(saleId: string, payment: PaymentMethod): Promise<void> {
  await db.transaction('rw', [db.sales, db.log], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale || sale.payment === payment) return;
    const slipStatus: SlipStatus | null = payment === 'transfer' && sale.slipImageId ? 'pending' : null;
    await db.sales.update(saleId, { payment, slipStatus });
    await logEvent(
      'sale',
      `แก้วิธีชำระ เลขที่ ${saleNo(sale.number)}`,
      `${sale.payment === 'cash' ? 'เงินสด' : 'โอนเงิน'} → ${payment === 'cash' ? 'เงินสด' : 'โอนเงิน'}`,
    );
  });
}

export async function setSlipStatus(saleId: string, status: SlipStatus, note = ''): Promise<void> {
  await db.transaction('rw', [db.sales, db.log], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) return;
    await db.sales.update(saleId, { slipStatus: status, slipNote: note.trim() || undefined, slipCheckedAt: Date.now() });
    const label = status === 'verified' ? 'ยืนยันสลิปถูกต้อง' : status === 'flagged' ? 'ทำเครื่องหมายสลิปมีปัญหา' : 'ตั้งสลิปเป็นรอตรวจ';
    await logEvent('sale', `${label} เลขที่ ${saleNo(sale.number)}`, note.trim() || undefined);
  });
}

export const MISTAKE_REASONS = ['ราคาไม่ถูกต้อง', 'จำนวนไม่ถูกต้อง', 'สินค้าผิดรายการ', 'วิธีชำระเงินผิด', 'บันทึกซ้ำ', 'อื่น ๆ'] as const;

export async function reportMistake(saleId: string, reason: string, note: string, staffName: string): Promise<MistakeReport> {
  if (!reason) throw new PosError('เลือกสิ่งที่ผิดก่อนส่ง');
  if (reason === 'อื่น ๆ' && !note.trim()) throw new PosError('เขียนรายละเอียดสั้น ๆ ว่าผิดอะไร');
  return db.transaction('rw', [db.sales, db.reports, db.log], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new PosError('ไม่พบรายการขายนี้');
    const report: MistakeReport = {
      id: uid(),
      saleId,
      saleNumber: sale.number,
      staffName,
      reason,
      note: note.trim(),
      createdAt: Date.now(),
      status: 'open',
    };
    await db.reports.add(report);
    await logEvent('sale', `แจ้งรายการผิด เลขที่ ${saleNo(sale.number)}`, [reason, note.trim()].filter(Boolean).join(' · '), staffName);
    return report;
  });
}

export async function resolveReport(reportId: string, resolution: string): Promise<void> {
  await db.transaction('rw', [db.reports, db.log], async () => {
    const r = await db.reports.get(reportId);
    if (!r || r.status === 'resolved') return;
    await db.reports.update(reportId, { status: 'resolved', resolution: resolution.trim() || undefined, resolvedAt: Date.now() });
    await logEvent('sale', `ปิดเรื่องแจ้งผิด เลขที่ ${saleNo(r.saleNumber)}`, resolution.trim() || undefined);
  });
}
