// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db';
import { importProducts, parseTable, previewImport, toImportRows } from '../../src/lib/importer';
import { makeProduct } from './helpers';

const ORBIZ_LIST = `ลำดับ\tรายการสินค้า
1\tน้ำเปล่า 550 ml
2\tน้ำเปล่า 1,500 ml
3\tโค้ก Original
4\tโค้ก Zero
5\tโค้ก Zero No Caffeine
6\tSponsor
7\tPocari Sweat
8\tMonster Energy 330 ml
9\tBiovitt Pre-Workout
10\tนมโปรตีน รสช็อกโกแลต
11\tนมโปรตีน รสสตรอว์เบอร์รี
12\tนมโปรตีน รสกาแฟ`;

describe('parseTable', () => {
  it('reads tab-separated cells copied from a spreadsheet', () => {
    expect(parseTable('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('reads CSV with quotes, commas inside quotes and a BOM', () => {
    expect(parseTable('﻿ชื่อ,ราคา\n"น้ำเปล่า 1,500 ml","25"\n"เสื้อ ""ORBIZ""",690')).toEqual([
      ['ชื่อ', 'ราคา'],
      ['น้ำเปล่า 1,500 ml', '25'],
      ['เสื้อ "ORBIZ"', '690'],
    ]);
  });
  it('drops blank lines', () => {
    expect(parseTable('\n\nโค้ก\n\n')).toEqual([['โค้ก']]);
  });
});

describe('toImportRows', () => {
  it('understands the ORBIZ list with a ลำดับ column', () => {
    const rows = toImportRows(parseTable(ORBIZ_LIST), []);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.status === 'new')).toBe(true);
    expect(rows[1].name).toBe('น้ำเปล่า 1,500 ml');
    expect(rows[11].name).toBe('นมโปรตีน รสกาแฟ');
    expect(rows.every((r) => r.price === null)).toBe(true);
  });
  it('treats a numbered list without a header the same way', () => {
    const rows = toImportRows(parseTable('1\tโค้ก Zero\n2\tSponsor'), []);
    expect(rows.map((r) => r.name)).toEqual(['โค้ก Zero', 'Sponsor']);
  });
  it('reads columns in the standard order without a header', () => {
    const [r] = toImportRows(parseTable('โค้ก Zero,เครื่องดื่ม,20,12.50,24'), []);
    expect(r).toMatchObject({ name: 'โค้ก Zero', category: 'เครื่องดื่ม', price: 2000, cost: 1250, stock: 24, status: 'new' });
  });
  it('follows header names in any order', () => {
    const [r] = toImportRows(parseTable('ราคาขาย,ชื่อสินค้า,สต็อก\n45,Pocari Sweat,30'), []);
    expect(r).toMatchObject({ name: 'Pocari Sweat', price: 4500, stock: 30 });
  });
  it('skips names already on the iPad and flags bad numbers and repeats', () => {
    const rows = toImportRows(parseTable('Sponsor,,15\nโค้ก,,abc\nน้ำ,,10,,2.5\nน้ำ,,10'), ['sponsor']);
    expect(rows.map((r) => r.status)).toEqual(['exists', 'error', 'error', 'new']);
    expect(rows[1].error).toContain('ราคาขาย');
    expect(rows[2].error).toContain('สต็อก');
  });
});

describe('importProducts', () => {
  it('adds the ORBIZ list switched off until each has a price', async () => {
    await makeProduct({ name: 'Sponsor' });
    const rows = await previewImport(ORBIZ_LIST);
    expect(rows.filter((r) => r.status === 'exists').map((r) => r.name)).toEqual(['Sponsor']);
    expect(await importProducts(rows)).toBe(11);
    const all = await db.products.toArray();
    expect(all).toHaveLength(12);
    const water = all.find((p) => p.name === 'น้ำเปล่า 550 ml')!;
    expect(water).toMatchObject({ price: 0, active: false, trackStock: true, stock: 0 });
    // running it again adds nothing
    expect(await importProducts(await previewImport(ORBIZ_LIST))).toBe(0);
  });
  it('creates categories, records starting stock and sells straight away when priced', async () => {
    const n = await importProducts(await previewImport('ชื่อสินค้า,หมวดหมู่,ราคาขาย,ต้นทุน,สต็อก\nโค้ก Zero,เครื่องดื่ม,20,12,24\nนมโปรตีน รสกาแฟ,โปรตีน,65,38,12'));
    expect(n).toBe(2);
    expect((await db.categories.toArray()).map((c) => c.name).sort()).toEqual(['เครื่องดื่ม', 'โปรตีน']);
    const coke = (await db.products.toArray()).find((p) => p.name === 'โค้ก Zero')!;
    expect(coke).toMatchObject({ price: 2000, cost: 1200, stock: 24, active: true });
    expect(await db.moves.where('productId').equals(coke.id).first()).toMatchObject({ reason: 'initial', delta: 24 });
    expect((await db.log.toArray()).some((l) => l.action === 'นำเข้าสินค้า 2 รายการ')).toBe(true);
  });
});
