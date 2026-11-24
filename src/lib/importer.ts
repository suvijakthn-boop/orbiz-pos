import { db, uid, type Category, type Product, type StockMove } from './db';
import { parseBaht } from './format';
import { logEvent } from './audit';

/**
 * Add many products at once, from a CSV file or from cells copied out of
 * Excel / Numbers / Google Sheets (which paste as tab-separated text).
 *
 * Columns, in this order unless a header row names them:
 *   ชื่อสินค้า, หมวดหมู่, ราคาขาย, ต้นทุน, สต็อก, แจ้งเมื่อเหลือ
 * Only the name is required. A product without a price comes in switched off
 * (ปิดขาย) so it can't be sold at ฿0 by mistake.
 */

export interface ImportRow {
  line: number;
  name: string;
  category: string;
  price: number | null;
  cost: number | null;
  stock: number | null;
  lowStock: number | null;
  status: 'new' | 'exists' | 'error';
  error?: string;
}

const FIELDS = ['name', 'category', 'price', 'cost', 'stock', 'lowStock'] as const;
type Field = (typeof FIELDS)[number];

const HEADER_WORDS: Record<Field, string[]> = {
  name: ['ชื่อสินค้า', 'รายการสินค้า', 'สินค้า', 'ชื่อ', 'name', 'product'],
  category: ['หมวดหมู่', 'หมวด', 'category'],
  price: ['ราคาขาย', 'ราคา', 'price'],
  cost: ['ต้นทุน', 'ทุน', 'cost'],
  stock: ['สต็อก', 'สต๊อก', 'คงเหลือ', 'จำนวน', 'stock', 'qty'],
  lowStock: ['แจ้งเมื่อเหลือ', 'แจ้งใกล้หมด', 'low', 'low_stock'],
};
const IGNORED_HEADERS = ['ลำดับ', 'ที่', 'no', 'no.', '#'];

/** Split text into rows and cells. Handles quotes, tabs, commas, semicolons and Windows line ends. */
export function parseTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n').find((l) => l.trim()) ?? '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

function headerField(cell: string): Field | 'skip' | null {
  const c = cell.trim().toLowerCase();
  if (IGNORED_HEADERS.includes(c)) return 'skip';
  for (const f of FIELDS) if (HEADER_WORDS[f].some((w) => c === w.toLowerCase())) return f;
  return null;
}

const isRowNumber = (s: string) => /^\d{1,4}\.?$/.test(s.trim());

function parseCount(s: string): number | null | 'bad' {
  const t = s.replace(/[,\s]/g, '');
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : 'bad';
}

/** Turn table cells into product rows, checking each one against what is already on this iPad. */
export function toImportRows(table: string[][], existingNames: string[]): ImportRow[] {
  if (table.length === 0) return [];
  let map: (Field | 'skip' | null)[];
  let body = table;
  const head = table[0].map(headerField);
  if (head.includes('name')) {
    map = head;
    body = table.slice(1);
  } else {
    // No header: a first column of 1, 2, 3 … is a row number, as in a printed list.
    const numbered = table.every((r) => r.length > 1 && isRowNumber(r[0]));
    map = numbered ? ['skip', ...FIELDS] : [...FIELDS];
  }
  const seen = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const inFile = new Set<string>();
  return body.map((cells, i) => {
    const get = (f: Field) => {
      const idx = map.indexOf(f);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const line = i + 1 + (body === table ? 0 : 1);
    const name = get('name').replace(/\s+/g, ' ');
    const row: ImportRow = { line, name, category: get('category'), price: null, cost: null, stock: null, lowStock: null, status: 'new' };
    const fail = (error: string): ImportRow => ({ ...row, status: 'error', error });
    if (!name) return fail('ไม่มีชื่อสินค้า');
    if (name.length > 60) return fail('ชื่อยาวเกิน 60 ตัวอักษร');
    const priceText = get('price');
    const costText = get('cost');
    if (priceText) {
      const v = parseBaht(priceText);
      if (v === null) return fail(`ราคาขาย "${priceText}" ไม่ใช่ตัวเลข`);
      row.price = v;
    }
    if (costText) {
      const v = parseBaht(costText);
      if (v === null) return fail(`ต้นทุน "${costText}" ไม่ใช่ตัวเลข`);
      row.cost = v;
    }
    const stock = parseCount(get('stock'));
    if (stock === 'bad') return fail(`สต็อก "${get('stock')}" ต้องเป็นจำนวนเต็ม`);
    row.stock = stock;
    const low = parseCount(get('lowStock'));
    if (low === 'bad') return fail(`แจ้งเมื่อเหลือ "${get('lowStock')}" ต้องเป็นจำนวนเต็ม`);
    row.lowStock = low;
    const key = name.toLowerCase();
    if (seen.has(key)) return { ...row, status: 'exists' };
    if (inFile.has(key)) return fail('ชื่อซ้ำกับแถวก่อนหน้า');
    inFile.add(key);
    return row;
  });
}

export async function previewImport(text: string): Promise<ImportRow[]> {
  const names = (await db.products.toArray()).map((p) => p.name);
  return toImportRows(parseTable(text), names);
}

/** Add the "new" rows. Missing categories are created. Returns how many products were added. */
export async function importProducts(rows: ImportRow[]): Promise<number> {
  const todo = rows.filter((r) => r.status === 'new');
  if (todo.length === 0) return 0;
  return db.transaction('rw', [db.products, db.categories, db.moves, db.log], async () => {
    const now = Date.now();
    const cats = await db.categories.toArray();
    const byName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
    let catSort = Math.max(0, ...cats.map((c) => c.sort));
    const newCats: Category[] = [];
    const existing = new Set((await db.products.toArray()).map((p) => p.name.trim().toLowerCase()));
    let sort = (await db.products.orderBy('sort').last())?.sort ?? 0;
    const products: Product[] = [];
    const moves: StockMove[] = [];
    for (const r of todo) {
      if (existing.has(r.name.toLowerCase())) continue;
      let categoryId: string | null = null;
      if (r.category) {
        let c = byName.get(r.category.toLowerCase());
        if (!c) {
          c = { id: uid(), name: r.category, sort: ++catSort };
          byName.set(r.category.toLowerCase(), c);
          newCats.push(c);
        }
        categoryId = c.id;
      }
      const stock = r.stock ?? 0;
      const p: Product = {
        id: uid(),
        name: r.name,
        categoryId,
        price: r.price ?? 0,
        cost: r.cost ?? 0,
        stock,
        trackStock: true,
        lowStock: r.lowStock ?? 5,
        imageId: null,
        active: r.price !== null,
        sort: ++sort,
        createdAt: now,
        updatedAt: now,
      };
      products.push(p);
      if (stock > 0) moves.push({ id: uid(), productId: p.id, productName: p.name, delta: stock, balanceAfter: stock, reason: 'initial', at: now });
    }
    if (newCats.length) await db.categories.bulkAdd(newCats);
    await db.products.bulkAdd(products);
    if (moves.length) await db.moves.bulkAdd(moves);
    const noPrice = products.filter((p) => !p.active).length;
    await logEvent(
      'product',
      `นำเข้าสินค้า ${products.length} รายการ`,
      [products.map((p) => p.name).join(', '), noPrice ? `${noPrice} รายการยังไม่มีราคา ปิดขายไว้` : '', newCats.length ? `หมวดใหม่: ${newCats.map((c) => c.name).join(', ')}` : '']
        .filter(Boolean)
        .join(' · '),
    );
    return products.length;
  });
}

export const IMPORT_TEMPLATE_HEADER = ['ชื่อสินค้า', 'หมวดหมู่', 'ราคาขาย', 'ต้นทุน', 'สต็อก', 'แจ้งเมื่อเหลือ'];
