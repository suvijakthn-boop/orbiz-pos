import type { Product, Sale } from './db';
import { addDays, dayKey, parseDayKey } from './format';

export interface Range {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month';

export function presetRange(p: RangePreset, today = dayKey()): Range {
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today };
  }
}

export function rangeDays(r: Range): string[] {
  const out: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The range of the same length immediately before r. */
export function previousRange(r: Range): Range {
  const len = rangeDays(r).length;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function inRange(s: Sale, r: Range): boolean {
  return s.day >= r.from && s.day <= r.to;
}

export interface Summary {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  bills: number;
  units: number;
  avgBill: number;
  cash: number;
  transfer: number;
  voided: number;
}

export function summarize(sales: Sale[]): Summary {
  const done = sales.filter((s) => s.status === 'completed');
  const revenue = done.reduce((a, s) => a + s.total, 0);
  const cost = done.reduce((a, s) => a + s.costTotal, 0);
  const units = done.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0);
  return {
    revenue,
    cost,
    profit: revenue - cost,
    margin: revenue > 0 ? (revenue - cost) / revenue : NaN,
    bills: done.length,
    units,
    avgBill: done.length ? Math.round(revenue / done.length / 100) * 100 : 0,
    cash: done.filter((s) => s.payment === 'cash').reduce((a, s) => a + s.total, 0),
    transfer: done.filter((s) => s.payment === 'transfer').reduce((a, s) => a + s.total, 0),
    voided: sales.length - done.length,
  };
}

export interface ProductRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export function byProduct(sales: Sale[]): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const s of sales) {
    if (s.status !== 'completed') continue;
    for (const i of s.items) {
      const row = map.get(i.productId) ?? { productId: i.productId, name: i.name, qty: 0, revenue: 0, cost: 0, profit: 0 };
      row.qty += i.qty;
      row.revenue += i.price * i.qty;
      row.cost += i.cost * i.qty;
      row.profit = row.revenue - row.cost;
      map.set(i.productId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface GroupRow {
  key: string;
  label: string;
  bills: number;
  revenue: number;
  profit: number;
}

export function byStaff(sales: Sale[]): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const s of sales) {
    if (s.status !== 'completed') continue;
    const row = map.get(s.staffId) ?? { key: s.staffId, label: s.staffName, bills: 0, revenue: 0, profit: 0 };
    row.bills += 1;
    row.revenue += s.total;
    row.profit += s.total - s.costTotal;
    map.set(s.staffId, row);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export function byDay(sales: Sale[], r: Range): GroupRow[] {
  const days = rangeDays(r);
  const map = new Map<string, GroupRow>(days.map((d) => [d, { key: d, label: d, bills: 0, revenue: 0, profit: 0 }]));
  for (const s of sales) {
    if (s.status !== 'completed') continue;
    const row = map.get(s.day);
    if (!row) continue;
    row.bills += 1;
    row.revenue += s.total;
    row.profit += s.total - s.costTotal;
  }
  return days.map((d) => map.get(d)!);
}

export function byHour(sales: Sale[], openHour = 6, closeHour = 23): GroupRow[] {
  const rows: GroupRow[] = [];
  for (let h = openHour; h <= closeHour; h++) rows.push({ key: String(h), label: `${String(h).padStart(2, '0')}:00`, bills: 0, revenue: 0, profit: 0 });
  for (const s of sales) {
    if (s.status !== 'completed') continue;
    const h = new Date(s.createdAt).getHours();
    const row = rows.find((r) => Number(r.key) === h) ?? rows[h < openHour ? 0 : rows.length - 1];
    row.bills += 1;
    row.revenue += s.total;
    row.profit += s.total - s.costTotal;
  }
  return rows;
}

export function inventoryValue(products: Product[]): number {
  return products.filter((p) => p.trackStock && p.active).reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0);
}

export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export function monthStart(key: string): string {
  const d = parseDayKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
}
