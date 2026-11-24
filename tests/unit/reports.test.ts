import { describe, expect, it } from 'vitest';
import type { Sale } from '../../src/lib/db';
import { byProduct, presetRange, previousRange, rangeDays, summarize, byDay } from '../../src/lib/reports';

const sale = (p: Partial<Sale>): Sale => ({
  id: Math.random().toString(),
  number: 1,
  createdAt: 0,
  day: '2026-11-24',
  staffId: 's',
  staffName: 'ฝน',
  items: [{ productId: 'a', name: 'A', price: 1000, cost: 400, qty: 2 }],
  total: 2000,
  costTotal: 800,
  payment: 'cash',
  slipImageId: null,
  slipStatus: null,
  status: 'completed',
  ...p,
});

describe('reports', () => {
  it('leaves voided sales out of totals', () => {
    const s = summarize([sale({}), sale({ status: 'voided' }), sale({ payment: 'transfer' })]);
    expect(s).toMatchObject({ revenue: 4000, cost: 1600, profit: 2400, bills: 2, units: 4, cash: 2000, transfer: 2000, voided: 1 });
    expect(s.margin).toBeCloseTo(0.6);
  });
  it('groups by product', () => {
    const rows = byProduct([sale({}), sale({ items: [{ productId: 'b', name: 'B', price: 5000, cost: 1000, qty: 1 }], total: 5000, costTotal: 1000 })]);
    expect(rows.map((r) => r.name)).toEqual(['B', 'A']);
    expect(rows[1]).toMatchObject({ qty: 2, revenue: 2000, profit: 1200 });
  });
  it('builds ranges', () => {
    expect(presetRange('7d', '2026-11-24')).toEqual({ from: '2026-11-18', to: '2026-11-24' });
    expect(presetRange('month', '2026-11-24')).toEqual({ from: '2026-11-01', to: '2026-11-24' });
    expect(previousRange({ from: '2026-11-18', to: '2026-11-24' })).toEqual({ from: '2026-11-11', to: '2026-11-17' });
    expect(rangeDays({ from: '2026-11-29', to: '2026-12-02' })).toHaveLength(4);
  });
  it('fills empty days with zero', () => {
    const rows = byDay([sale({ day: '2026-11-23' })], { from: '2026-11-22', to: '2026-11-24' });
    expect(rows.map((r) => r.revenue)).toEqual([0, 2000, 0]);
  });
});
