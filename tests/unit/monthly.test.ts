import { describe, expect, it } from 'vitest';
import type { Receipt, Sale, StockMove, Product } from '../../src/lib/db';
import { addMonths, buildMonthlyReport, fmtMonth, lastMonths, monthRange, monthlyTrend } from '../../src/lib/monthly';

const sale = (p: Partial<Sale>): Sale => ({
  id: Math.random().toString(),
  number: 1,
  createdAt: 0,
  day: '2026-11-10',
  staffId: 'a',
  staffName: 'ฝน',
  items: [{ productId: 'w', name: 'น้ำ', price: 1500, cost: 600, qty: 2 }],
  total: 3000,
  costTotal: 1200,
  payment: 'cash',
  slipImageId: null,
  slipStatus: null,
  status: 'completed',
  ...p,
});
const at = (day: string) => new Date(`${day}T10:00:00`).getTime();
const receipt = (day: string, total: number, week = ''): Receipt => ({ id: day + total, at: at(day), week, bills: '', total, lines: [], hash: day });
const product: Product = { id: 'w', name: 'น้ำ', categoryId: null, price: 1500, cost: 600, stock: 10, trackStock: true, lowStock: 2, imageId: null, active: true, sort: 1, createdAt: 0, updatedAt: 0 };
const move = (day: string, delta: number, reason: StockMove['reason']): StockMove => ({ id: day + delta, productId: 'w', productName: 'น้ำ', delta, balanceAfter: 0, reason, at: at(day) });

describe('months', () => {
  it('knows month lengths and steps across years', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(fmtMonth('2026-11')).toBe('พฤศจิกายน 2569');
  });
});

describe('buildMonthlyReport', () => {
  const sales = [
    sale({ day: '2026-10-31' }), // previous month
    sale({ day: '2026-11-01' }),
    sale({ day: '2026-11-01', payment: 'transfer', slipStatus: 'pending' }),
    sale({ day: '2026-11-15', status: 'voided' }),
    sale({ day: '2026-11-30', payment: 'transfer', slipStatus: 'flagged', total: 6000, costTotal: 2400, items: [{ productId: 'w', name: 'น้ำ', price: 1500, cost: 600, qty: 4 }] }),
    sale({ day: '2026-12-01' }), // next month
  ];
  const receipts = [receipt('2026-11-03', 20000, '2026-11-02 ถึง 2026-11-08'), receipt('2026-11-05', 5000, '2026-11-02 ถึง 2026-11-08'), receipt('2026-11-20', 8000), receipt('2026-12-02', 9999)];
  const moves = [move('2026-11-10', -3, 'adjust'), move('2026-11-28', 1, 'count'), move('2026-11-12', -5, 'sale'), move('2026-10-30', -9, 'adjust')];

  it('counts only the month, leaves voided bills out, and totals purchases by week', () => {
    const r = buildMonthlyReport('2026-11', { sales, receipts, moves, products: [product] }, '2026-12-05');
    expect(r.inProgress).toBe(false);
    expect(r.sales).toMatchObject({ revenue: 12000, cost: 4800, profit: 7200, bills: 3, voided: 1, cash: 3000, transfer: 9000 });
    expect(r.voidedValue).toBe(3000);
    expect(r.purchases).toBe(33000);
    expect(r.purchaseWeeks.map((w) => [w.label, w.total, w.receipts])).toEqual([
      ['2026-11-02 ถึง 2026-11-08', 25000, 2],
      ['รับเข้าวันที่ 2026-11-20', 8000, 1],
    ]);
    expect(r.stockLossUnits).toBe(3);
    expect(r.stockLossValue).toBe(1800);
    expect(r.stockGainUnits).toBe(1);
    expect(r.slipsPending).toBe(1);
    expect(r.slipsFlagged).toBe(1);
    expect(r.activeDays).toBe(2);
    expect(r.daysElapsed).toBe(30);
    expect(r.bestDay?.key).toBe('2026-11-01');
    expect(r.products[0]).toMatchObject({ name: 'น้ำ', qty: 8 });
  });

  it('marks a running month and averages over the days so far', () => {
    const r = buildMonthlyReport('2026-11', { sales, receipts, moves, products: [product] }, '2026-11-10');
    expect(r.inProgress).toBe(true);
    expect(r.daysElapsed).toBe(10);
    expect(r.avgPerDay).toBe(1200); // ฿120 over 10 days = ฿12/day
  });
});

describe('monthlyTrend', () => {
  it('puts revenue, profit and purchases in their months', () => {
    const t = monthlyTrend(['2026-10', '2026-11'], [sale({ day: '2026-10-31' }), sale({ day: '2026-11-02' }), sale({ day: '2026-11-03', status: 'voided' })], [receipt('2026-11-03', 500)]);
    expect(t).toEqual([
      { month: '2026-10', revenue: 3000, profit: 1800, purchases: 0, bills: 1 },
      { month: '2026-11', revenue: 3000, profit: 1800, purchases: 500, bills: 1 },
    ]);
  });
});
