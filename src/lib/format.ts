import type { Satang } from './db';

const bahtFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const bahtFmt2 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('th-TH');

/** ฿1,250 or ฿12.50 — decimals only when there are satang. */
export function baht(v: Satang): string {
  const neg = v < 0;
  const abs = Math.abs(v);
  const s = abs % 100 === 0 ? bahtFmt.format(abs / 100) : bahtFmt2.format(abs / 100);
  return `${neg ? '−' : ''}฿${s}`;
}

export function num(v: number): string {
  return intFmt.format(v);
}

export function pct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** Parse a user-typed baht amount ("1,250", "12.5") to satang. Returns null if invalid. */
export function parseBaht(input: string): Satang | null {
  const cleaned = input.replace(/[,฿\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const value = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Satang to an editable string ("1250", "12.50"). */
export function bahtInput(v: Satang): string {
  return v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2);
}

export function saleNo(n: number): string {
  return String(n).padStart(5, '0');
}

/* ---------- dates (device local time; the iPad is set to Thailand) ---------- */

export function dayKey(d: Date | number = new Date()): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function startOfDay(key: string): number {
  return parseDayKey(key).getTime();
}

export function endOfDay(key: string): number {
  return parseDayKey(addDays(key, 1)).getTime() - 1;
}

const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 24 พ.ย. 2569 */
export function fmtDate(d: Date | number | string): string {
  const x = typeof d === 'string' ? parseDayKey(d) : new Date(d);
  return dateFmt.format(x);
}

export function fmtDateShort(d: Date | number | string): string {
  const x = typeof d === 'string' ? parseDayKey(d) : new Date(d);
  return dateShortFmt.format(x);
}

export function fmtWeekday(d: Date | number | string): string {
  const x = typeof d === 'string' ? parseDayKey(d) : new Date(d);
  return weekdayFmt.format(x);
}

export function fmtTime(t: number): string {
  return timeFmt.format(new Date(t));
}

export function fmtDateTime(t: number): string {
  return `${fmtDate(t)} ${fmtTime(t)}`;
}

/** "วันนี้", "เมื่อวาน", or a date. */
export function relativeDay(key: string, today = dayKey()): string {
  if (key === today) return 'วันนี้';
  if (key === addDays(today, -1)) return 'เมื่อวาน';
  return fmtDate(key);
}

/** "เมื่อสักครู่", "15 นาทีที่แล้ว", "3 ชั่วโมงที่แล้ว", "2 วันที่แล้ว" */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'เมื่อสักครู่';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const d = Math.round(h / 24);
  return `${d} วันที่แล้ว`;
}

/** ASCII-only timestamp for file names: 2026-11-24-1530 */
export function fileStamp(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dayKey(d)}-${hh}${mm}`;
}
