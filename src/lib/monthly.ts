import type { Receipt, Sale, StockMove, Product, StockCount } from './db';
import { dayKey, parseDayKey } from './format';
import { byDay, byProduct, byStaff, summarize, type GroupRow, type ProductRow, type Range, type Summary } from './reports';

/** A calendar month as "YYYY-MM". */
export type MonthKey = string;

export function monthOf(day: string = dayKey()): MonthKey {
  return day.slice(0, 7);
}

export function monthRange(m: MonthKey): Range {
  const [y, mo] = m.split('-').map(Number);
  const first = dayKey(new Date(y, mo - 1, 1));
  const last = dayKey(new Date(y, mo, 0));
  return { from: first, to: last };
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number);
  return dayKey(new Date(y, mo - 1 + n, 1)).slice(0, 7);
}

/** The last `count` months ending with `end`, oldest first. */
export function lastMonths(end: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - count + 1));
}

const monthFmt = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat('th-TH', { month: 'short' });

/** "พฤศจิกายน 2569" */
export function fmtMonth(m: MonthKey): string {
  return monthFmt.format(parseDayKey(`${m}-01`));
}

/** "พ.ย." */
export function fmtMonthShort(m: MonthKey): string {
  return monthShortFmt.format(parseDayKey(`${m}-01`));
}

export interface WeekPurchase {
  label: string;
  total: number;
  receipts: number;
}

export interface MonthlyReport {
  month: MonthKey;
  range: Range;
  /** The month isn't over yet: figures run up to today. */
  inProgress: boolean;
  daysElapsed: number;
  sales: Summary;
  /** Bills (completed) per day with at least one sale. */
  activeDays: number;
  avgPerDay: number;
  bestDay: GroupRow | null;
  days: GroupRow[];
  products: ProductRow[];
  staff: GroupRow[];
  voidedValue: number;
  purchases: number;
  purchaseWeeks: WeekPurchase[];
  receipts: Receipt[];
  /** Stock adjustments and approved count differences, in pieces and at today's cost. */
  stockLossUnits: number;
  stockLossValue: number;
  stockGainUnits: number;
  stockGainValue: number;
  slipsPending: number;
  slipsFlagged: number;
  inventoryValueNow: number;
}

/**
 * Everything for one month's summary. Inputs may hold more than the month; they are filtered here.
 * Stock adjustments are valued at the product's current cost (moves don't store cost).
 */
export function buildMonthlyReport(
  month: MonthKey,
  input: { sales: Sale[]; receipts: Receipt[]; moves: StockMove[]; products: Product[]; counts?: StockCount[] },
  today: string = dayKey(),
): MonthlyReport {
  const range = monthRange(month);
  const inProgress = today >= range.from && today <= range.to;
  const end = inProgress ? today : range.to;
  const inMonth = (d: string) => d >= range.from && d <= range.to;
  const sales = input.sales.filter((s) => inMonth(s.day));
  const done = sales.filter((s) => s.status === 'completed');
  const summary = summarize(sales);
  const days = byDay(sales, range);
  const elapsed = days.filter((d) => d.key <= end);
  const activeDays = elapsed.filter((d) => d.bills > 0).length;
  const best = days.reduce<GroupRow | null>((b, d) => (d.revenue > 0 && (!b || d.revenue > b.revenue) ? d : b), null);

  const receipts = input.receipts.filter((r) => inMonth(dayKey(r.at))).sort((a, b) => a.at - b.at);
  const weeks = new Map<string, WeekPurchase>();
  for (const r of receipts) {
    const label = r.week || `รับเข้าวันที่ ${dayKey(r.at)}`;
    const w = weeks.get(label) ?? { label, total: 0, receipts: 0 };
    w.total += r.total;
    w.receipts += 1;
    weeks.set(label, w);
  }

  const costOf = new Map(input.products.map((p) => [p.id, p.cost]));
  let lossU = 0;
  let lossV = 0;
  let gainU = 0;
  let gainV = 0;
  for (const m of input.moves) {
    if ((m.reason !== 'adjust' && m.reason !== 'count') || !inMonth(dayKey(m.at))) continue;
    const v = m.delta * (costOf.get(m.productId) ?? 0);
    if (m.delta < 0) {
      lossU += -m.delta;
      lossV += -v;
    } else {
      gainU += m.delta;
      gainV += v;
    }
  }

  return {
    month,
    range,
    inProgress,
    daysElapsed: elapsed.length,
    sales: summary,
    activeDays,
    avgPerDay: elapsed.length ? Math.round(summary.revenue / elapsed.length / 100) * 100 : 0,
    bestDay: best,
    days,
    products: byProduct(sales),
    staff: byStaff(sales),
    voidedValue: sales.filter((s) => s.status === 'voided').reduce((a, s) => a + s.total, 0),
    purchases: receipts.reduce((a, r) => a + r.total, 0),
    purchaseWeeks: [...weeks.values()],
    receipts,
    stockLossUnits: lossU,
    stockLossValue: lossV,
    stockGainUnits: gainU,
    stockGainValue: gainV,
    slipsPending: done.filter((s) => s.slipStatus === 'pending').length,
    slipsFlagged: done.filter((s) => s.slipStatus === 'flagged').length,
    inventoryValueNow: input.products.filter((p) => p.trackStock && p.active).reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0),
  };
}

export interface MonthTrend {
  month: MonthKey;
  revenue: number;
  profit: number;
  purchases: number;
  bills: number;
}

export function monthlyTrend(months: MonthKey[], sales: Sale[], receipts: Receipt[]): MonthTrend[] {
  const rows = new Map<MonthKey, MonthTrend>(months.map((m) => [m, { month: m, revenue: 0, profit: 0, purchases: 0, bills: 0 }]));
  for (const s of sales) {
    if (s.status !== 'completed') continue;
    const r = rows.get(monthOf(s.day));
    if (!r) continue;
    r.revenue += s.total;
    r.profit += s.total - s.costTotal;
    r.bills += 1;
  }
  for (const rc of receipts) {
    const r = rows.get(monthOf(dayKey(rc.at)));
    if (r) r.purchases += rc.total;
  }
  return months.map((m) => rows.get(m)!);
}

/** First day of the first month that has any sale, so the month picker can't wander into empty history. */
export function earliestMonth(sales: Sale[], fallback: MonthKey = monthOf()): MonthKey {
  let min: string | null = null;
  for (const s of sales) if (!min || s.day < min) min = s.day;
  return min ? monthOf(min) : fallback;
}

