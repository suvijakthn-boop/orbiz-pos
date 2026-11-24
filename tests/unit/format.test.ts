import { describe, expect, it } from 'vitest';
import { addDays, baht, dayKey, parseBaht, saleNo, fileStamp } from '../../src/lib/format';

describe('money', () => {
  it('formats whole baht without decimals and satang with two', () => {
    expect(baht(125000)).toBe('฿1,250');
    expect(baht(1250)).toBe('฿12.50');
    expect(baht(0)).toBe('฿0');
    expect(baht(-500)).toBe('−฿5');
  });
  it('parses typed amounts to satang', () => {
    expect(parseBaht('1,250')).toBe(125000);
    expect(parseBaht('12.5')).toBe(1250);
    expect(parseBaht('12.05')).toBe(1205);
    expect(parseBaht(' ฿ 90 ')).toBe(9000);
    expect(parseBaht('')).toBeNull();
    expect(parseBaht('abc')).toBeNull();
    expect(parseBaht('1.234')).toBeNull();
    expect(parseBaht('-5')).toBeNull();
  });
  it('pads sale numbers', () => {
    expect(saleNo(42)).toBe('00042');
  });
});

describe('dates', () => {
  it('uses the local calendar day', () => {
    expect(dayKey(new Date(2026, 10, 24, 23, 59))).toBe('2026-11-24');
    expect(dayKey(new Date(2026, 10, 25, 0, 1))).toBe('2026-11-25');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('builds ASCII-only file stamps', () => {
    expect(fileStamp(new Date(2026, 10, 24, 9, 5))).toBe('2026-11-24-0905');
  });
});
