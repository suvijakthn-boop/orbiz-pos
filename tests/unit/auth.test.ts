import { describe, expect, it } from 'vitest';
import { checkPin, isWeakPin, resetWithRecovery, setupPin } from '../../src/lib/auth';
import { getSetting } from '../../src/lib/settings';

describe('manager PIN', () => {
  it('stores only a hash', async () => {
    await setupPin('482916');
    const rec = await getSetting('pin');
    expect(JSON.stringify(rec)).not.toContain('482916');
    expect((await checkPin('482916')).ok).toBe(true);
    expect((await checkPin('111111')).ok).toBe(false);
  });

  it('locks for a while after 5 wrong tries', async () => {
    await setupPin('482916');
    const now = Date.now();
    for (let i = 0; i < 4; i++) expect((await checkPin('000001', now)).ok).toBe(false);
    const fifth = await checkPin('000001', now);
    expect(fifth).toMatchObject({ ok: false, locked: true });
    // Even the right PIN is refused while locked.
    expect((await checkPin('482916', now + 1000)).ok).toBe(false);
    expect((await checkPin('482916', now + 31_000)).ok).toBe(true);
  });

  it('rejects easy PINs', () => {
    expect(isWeakPin('000000')).toBe(true);
    expect(isWeakPin('123456')).toBe(true);
    expect(isWeakPin('654321')).toBe(true);
    expect(isWeakPin('482916')).toBe(false);
  });

  it('the recovery code sets a new PIN and is replaced after use', async () => {
    const code = await setupPin('482916');
    expect(await resetWithRecovery('WRONG-CODE-0000', '135792')).toBeNull();
    const next = await resetWithRecovery(code.toLowerCase().replace(/-/g, ' '), '135792');
    expect(next).toBeTruthy();
    expect(next).not.toBe(code);
    expect((await checkPin('135792')).ok).toBe(true);
    expect(await resetWithRecovery(code, '246801')).toBeNull();
  });
});
