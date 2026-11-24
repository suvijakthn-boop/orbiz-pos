// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { db, PosDB, useDatabase, uid } from '../../src/lib/db';
import { createBackup, previewBackup, restoreBackup, BackupError } from '../../src/lib/backup';
import { completeSale } from '../../src/lib/sales';
import { setupPin, checkPin } from '../../src/lib/auth';
import { makeProduct, makeStaff } from './helpers';

describe('backup and restore', () => {
  it('round-trips data, slip photos and the PIN to a fresh iPad', async () => {
    await setupPin('482916');
    const staffId = await makeStaff();
    const p = await makeProduct({ stock: 9 });
    const photo = new Blob([new Uint8Array([9, 8, 7, 6, 5])], { type: 'image/jpeg' });
    const sale = await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 2 }], staffId, payment: 'transfer', slip: photo });

    const { blob, filename } = await createBackup();
    expect(filename).toMatch(/^orbiz-pos-backup-\d{4}-\d{2}-\d{2}-\d{4}\.orbizpos$/);

    useDatabase(new PosDB(`restore-${Date.now()}`));
    expect(await db.sales.count()).toBe(0);
    const preview = await previewBackup(blob);
    expect(preview.counts.sales).toBe(1);
    await restoreBackup(blob);

    expect((await db.products.get(p.id))!.stock).toBe(7);
    const restored = (await db.sales.get(sale.id))!;
    expect(restored.total).toBe(sale.total);
    const img = await db.images.get(restored.slipImageId!);
    expect(new Uint8Array(await img!.blob.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6, 5]));
    expect((await checkPin('482916')).ok).toBe(true);
  });

  it('refuses files that are not backups', async () => {
    await expect(previewBackup(new Blob(['hello world, not a backup']))).rejects.toBeInstanceOf(BackupError);
  });

  it('refuses a truncated backup without touching current data', async () => {
    const p = await makeProduct({ stock: 9 });
    const staffId = await makeStaff();
    await completeSale({ orderId: uid(), lines: [{ productId: p.id, qty: 1 }], staffId, payment: 'transfer', slip: new Blob([new Uint8Array(64)], { type: 'image/jpeg' }) });
    const { blob } = await createBackup();
    const cut = blob.slice(0, blob.size - 10);
    await expect(restoreBackup(cut)).rejects.toThrow('ไม่ครบ');
    expect(await db.products.count()).toBe(1);
  });
});
