import { db, uid, type Product, type Receipt, type ReceiptLine, type StockMove } from './db';
import { baht, parseBaht } from './format';
import { logEvent } from './audit';
import { PosError } from './sales';

/**
 * Weekly stock-in from supplier bills.
 *
 * Outside the app, Claude reads photos of the week's bills and replies with text
 * in this format, which is pasted into สต็อก → รับของจากบิล:
 *
 *   #ORBIZ-รับของ
 *   สัปดาห์: 2026-11-23 ถึง 2026-11-29
 *   บิล: แม็คโคร 24/11 ฿1,250 ; โอสถสภา 26/11 ฿860
 *   น้ำเปล่า 550 ml | 48 | 4.50
 *   ใหม่: Electrolyte Beat | 12 | 18
 *   รวม: 432
 *
 * Each item line is: name | pieces received | cost per piece (after discount, incl. VAT).
 * Received pieces are added to stock and the product's cost becomes this bill's cost.
 */

export const RECEIPT_MARK = '#ORBIZ-รับของ';

export type LineAction = { kind: 'product'; productId: string } | { kind: 'create' } | { kind: 'skip' };

export interface ParsedLine {
  line: number;
  name: string;
  qty: number | null;
  cost: number | null;
  /** Written as "ใหม่: …" by Claude: not in the app's product list. */
  markedNew: boolean;
  match: Product | null;
  error?: string;
}

export interface ParsedReceipt {
  week: string;
  bills: string;
  statedTotal: number | null;
  lines: ParsedLine[];
  hash: string;
  hasMark: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.]+/g, '');

function hashText(text: string): string {
  // FNV-1a over the meaningful lines; good enough to spot the same summary pasted twice.
  const body = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + body.length.toString(16);
}

const HEADER_NAMES = ['ชื่อสินค้า', 'สินค้า', 'name', 'product'];

export function parseReceipt(text: string, products: Product[]): ParsedReceipt {
  const out: ParsedReceipt = { week: '', bills: '', statedTotal: null, lines: [], hash: hashText(text), hasMark: false };
  const byName = new Map(products.map((p) => [norm(p.name), p]));
  const rows = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  rows.forEach((raw, i) => {
    const l = raw.trim().replace(/^[-*•]\s+/, '');
    if (!l || l.startsWith('```')) return;
    if (l.startsWith('#')) {
      if (l.replace(/\s/g, '').startsWith(RECEIPT_MARK)) out.hasMark = true;
      return;
    }
    if (l.includes('|')) {
      const cells = l.split('|').map((c) => c.trim());
      if (cells[0] === '' && cells.length > 1) cells.shift(); // markdown table "| a | b |"
      if (cells[cells.length - 1] === '') cells.pop();
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // markdown separator row
      let name = cells[0] ?? '';
      if (HEADER_NAMES.includes(name.toLowerCase())) return;
      let markedNew = false;
      const m = name.match(/^(ใหม่|new)\s*[:：]\s*(.+)$/i);
      if (m) {
        markedNew = true;
        name = m[2].trim();
      }
      const p: ParsedLine = { line: i + 1, name, qty: null, cost: null, markedNew, match: markedNew ? null : byName.get(norm(name)) ?? null };
      const qtyText = (cells[1] ?? '').replace(/[,\s]|ชิ้น|ขวด|กระป๋อง|ซอง|อัน/g, '');
      const costText = (cells[2] ?? '').replace(/บาท|\/\s*ชิ้น/g, '').trim();
      if (!name) p.error = 'ไม่มีชื่อสินค้า';
      else if (!/^\d+$/.test(qtyText) || Number(qtyText) <= 0) p.error = qtyText.includes('?') || !qtyText ? 'ยังไม่มีจำนวน' : `จำนวน "${cells[1]}" ต้องเป็นจำนวนเต็มมากกว่า 0`;
      else p.qty = Number(qtyText);
      if (!p.error && costText) {
        const c = parseBaht(costText);
        if (c === null) p.error = costText.includes('?') ? 'ยังไม่มีทุนต่อชิ้น' : `ทุน "${cells[2]}" ไม่ใช่ตัวเลข`;
        else p.cost = c;
      }
      if (!p.error && p.match && !p.match.trackStock) p.error = 'สินค้านี้ไม่ได้นับสต็อก';
      if (!p.error && p.cost === null && (markedNew || !p.match)) p.error = 'สินค้าใหม่ต้องมีทุนต่อชิ้น';
      out.lines.push(p);
      return;
    }
    const kv = l.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      if (/สัปดาห์|week/i.test(key)) out.week = val;
      else if (/บิล|bill/i.test(key)) out.bills = val;
      else if (/รวม|total/i.test(key)) out.statedTotal = parseBaht(val.replace(/[^\d.,]/g, ''));
    }
  });
  // The same product twice: add them up so stock is right and cost is the weighted average.
  const merged: ParsedLine[] = [];
  for (const l of out.lines) {
    const prev = !l.error && l.match ? merged.find((x) => !x.error && x.match?.id === l.match!.id) : undefined;
    if (prev && prev.qty !== null && l.qty !== null) {
      const spend = (prev.cost ?? prev.match!.cost) * prev.qty + (l.cost ?? l.match!.cost) * l.qty;
      prev.qty += l.qty;
      prev.cost = Math.round(spend / prev.qty);
    } else merged.push(l);
  }
  out.lines = merged;
  return out;
}

export function defaultAction(l: ParsedLine): LineAction | null {
  if (l.error) return { kind: 'skip' };
  if (l.match) return { kind: 'product', productId: l.match.id };
  if (l.markedNew) return { kind: 'create' };
  return null; // the manager has to decide
}

export function receiptTotal(lines: ParsedLine[], actions: (LineAction | null)[], products: Product[]): number {
  return lines.reduce((sum, l, i) => {
    const a = actions[i];
    if (!a || a.kind === 'skip' || l.qty === null) return sum;
    const cost = l.cost ?? (a.kind === 'product' ? products.find((p) => p.id === a.productId)?.cost ?? 0 : 0);
    return sum + cost * l.qty;
  }, 0);
}

export async function findDuplicate(hash: string): Promise<Receipt | undefined> {
  return db.receipts.where('hash').equals(hash).first();
}

/** Add the stock and set this week's cost. Returns the saved receipt. */
export async function applyReceipt(parsed: ParsedReceipt, actions: (LineAction | null)[], opts: { allowDuplicate?: boolean } = {}): Promise<Receipt> {
  if (actions.length !== parsed.lines.length) throw new PosError('ข้อมูลไม่ครบ ลองวางข้อความใหม่');
  const undecided = parsed.lines.filter((l, i) => !l.error && actions[i] === null).length;
  if (undecided) throw new PosError(`เลือกสินค้าให้ ${undecided} บรรทัดที่ไม่ตรงกับในแอปก่อน`);
  return db.transaction('rw', [db.products, db.moves, db.receipts, db.log], async () => {
    if (!opts.allowDuplicate) {
      const dup = await db.receipts.where('hash').equals(parsed.hash).first();
      if (dup) throw new PosError('ข้อความนี้รับเข้าไปแล้ว ถ้าตั้งใจรับซ้ำ ให้กดยืนยันรับซ้ำ');
    }
    const now = Date.now();
    const id = uid();
    const lines: ReceiptLine[] = [];
    const moves: StockMove[] = [];
    let sort = (await db.products.orderBy('sort').last())?.sort ?? 0;
    for (let i = 0; i < parsed.lines.length; i++) {
      const l = parsed.lines[i];
      const a = actions[i];
      if (l.error || !a || a.kind === 'skip' || l.qty === null) continue;
      let p: Product | undefined;
      let created = false;
      if (a.kind === 'product') {
        p = await db.products.get(a.productId);
        if (!p) throw new PosError(`ไม่พบสินค้า ${l.name}`);
        if (!p.trackStock) throw new PosError(`${p.name} ไม่ได้นับสต็อก`);
      } else {
        const existing = (await db.products.toArray()).find((x) => norm(x.name) === norm(l.name));
        if (existing) p = existing;
        else {
          p = {
            id: uid(),
            name: l.name.slice(0, 60),
            categoryId: null,
            price: 0,
            cost: l.cost ?? 0,
            stock: 0,
            trackStock: true,
            lowStock: 5,
            imageId: null,
            active: false,
            sort: ++sort,
            createdAt: now,
            updatedAt: now,
          };
          await db.products.add(p);
          created = true;
        }
      }
      const fresh = (await db.products.get(p.id))!;
      const cost = l.cost ?? fresh.cost;
      const balance = fresh.stock + l.qty;
      await db.products.update(fresh.id, { stock: balance, cost, updatedAt: now });
      moves.push({ id: uid(), productId: fresh.id, productName: fresh.name, delta: l.qty, balanceAfter: balance, reason: 'receive', refId: id, note: parsed.week ? `บิลสัปดาห์ ${parsed.week}` : 'รับของจากบิล', at: now });
      lines.push({ productId: fresh.id, name: fresh.name, qty: l.qty, cost, previousCost: created ? cost : fresh.cost, created });
    }
    if (lines.length === 0) throw new PosError('ไม่มีรายการที่รับเข้าได้');
    await db.moves.bulkAdd(moves);
    const receipt: Receipt = {
      id,
      at: now,
      week: parsed.week,
      bills: parsed.bills,
      total: lines.reduce((s, l) => s + l.cost * l.qty, 0),
      lines,
      hash: parsed.hash,
    };
    await db.receipts.add(receipt);
    const costChanges = lines.filter((l) => !l.created && l.cost !== l.previousCost).map((l) => `${l.name} ${baht(l.previousCost)} → ${baht(l.cost)}`);
    const created = lines.filter((l) => l.created).map((l) => l.name);
    await logEvent(
      'stock',
      `รับของจากบิล ${lines.length} รายการ · ${baht(receipt.total)}`,
      [
        parsed.week && `สัปดาห์ ${parsed.week}`,
        parsed.bills && `บิล ${parsed.bills}`,
        costChanges.length && `ทุนเปลี่ยน: ${costChanges.join(', ')}`,
        created.length && `สินค้าใหม่ (ปิดขายไว้): ${created.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    return receipt;
  });
}

/** The instruction to send to Claude together with the bill photos. */
export function claudePrompt(products: Product[]): string {
  const names = products.filter((p) => p.trackStock).map((p) => `- ${p.name}`);
  return [
    'ช่วยสรุปบิลซื้อของเข้าร้าน ORBIZ สัปดาห์นี้จากรูปบิลที่แนบ แล้วตอบเป็นข้อความตามรูปแบบด้านล่างในกล่องโค้ดกล่องเดียว เพื่อให้ฉันก๊อปไปวางในแอป ORBIZ POS',
    '',
    'กติกา',
    '1. รวมทุกบิลของสัปดาห์ สินค้าเดียวกันจากหลายบิลให้รวมเป็นบรรทัดเดียว',
    '2. จำนวน = จำนวนชิ้นที่ขายได้จริง ถ้าบิลเป็นแพ็กหรือลัง ให้คูณเป็นชิ้น เช่น 2 แพ็ก × 12 ขวด = 24',
    '3. ทุนต่อชิ้น = เงินที่จ่ายจริงหลังส่วนลด รวม VAT หารด้วยจำนวนชิ้น ทศนิยมไม่เกิน 2 ตำแหน่ง ถ้าซื้อหลายบิลราคาไม่เท่ากัน ใช้ เงินรวม ÷ ชิ้นรวม',
    '4. ชื่อสินค้าต้องสะกดตรงกับรายชื่อในแอปด้านล่างทุกตัวอักษร ถ้าเป็นของที่ไม่มีในรายชื่อ ให้ขึ้นต้นด้วย "ใหม่: "',
    '5. ของที่ไม่ได้เอามาขาย เช่น ถุง น้ำแข็ง ค่าส่ง ไม่ต้องใส่ในกล่อง ให้บอกไว้ใต้กล่องแทน',
    '6. ตัวเลขที่อ่านไม่ชัด ห้ามเดา ให้ใส่ ? แล้วบอกฉันใต้กล่องว่าบรรทัดไหน',
    '7. รวม = ผลรวมของ จำนวน × ทุนต่อชิ้น ของทุกบรรทัดในกล่อง',
    '',
    'รูปแบบ (บรรทัดสินค้าคือ ชื่อสินค้า | จำนวนชิ้น | ทุนต่อชิ้น)',
    '```',
    RECEIPT_MARK,
    'สัปดาห์: YYYY-MM-DD ถึง YYYY-MM-DD',
    'บิล: ชื่อร้าน วันที่ ยอดบิล ; ชื่อร้าน วันที่ ยอดบิล',
    'น้ำเปล่า 550 ml | 48 | 4.50',
    'ใหม่: ชื่อสินค้าใหม่ | 12 | 18',
    'รวม: 432',
    '```',
    '',
    'รายชื่อสินค้าในแอป',
    ...(names.length ? names : ['(ยังไม่มีสินค้าในแอป ให้ขึ้นต้นทุกบรรทัดด้วย "ใหม่: ")']),
  ].join('\n');
}
