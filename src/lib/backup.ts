import { db, ALL_TABLES, type StoredImage } from './db';
import { fileStamp } from './format';
import { logEvent } from './audit';

/**
 * Backup file layout (one file, easy to keep in iPad Files):
 *   "ORBIZPOS-BACKUP 1\n"
 *   <header length, 12 ASCII digits>\n
 *   <header JSON: all tables; images point at byte ranges below>
 *   <image bytes, back to back>
 * Images stay binary (no base64), so a year of slip photos stays a reasonable size.
 */
const MAGIC = 'ORBIZPOS-BACKUP 1\n';
const LEN_DIGITS = 12;

interface ImageRef {
  id: string;
  kind: StoredImage['kind'];
  createdAt: number;
  demo?: boolean;
  type: string;
  offset: number;
  size: number;
}

interface Header {
  app: 'orbiz-pos';
  version: 1;
  createdAt: number;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
  images: ImageRef[];
}

export async function createBackup(now = Date.now()): Promise<{ blob: Blob; filename: string; header: Header }> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const name of ALL_TABLES) {
    if (name === 'images') continue;
    const rows = name === 'settings'
      ? (await db.settings.toArray()).map((r) => (r.key === 'lastBackupAt' ? { key: r.key, value: now } : r))
      : await db.table(name).toArray();
    tables[name] = rows;
    counts[name] = rows.length;
  }
  if (!(tables.settings as { key: string }[]).some((r) => r.key === 'lastBackupAt')) {
    (tables.settings as unknown[]).push({ key: 'lastBackupAt', value: now });
  }
  const imgs = await db.images.toArray();
  const refs: ImageRef[] = [];
  const parts: Blob[] = [];
  let offset = 0;
  for (const img of imgs) {
    refs.push({ id: img.id, kind: img.kind, createdAt: img.createdAt, demo: img.demo, type: img.blob.type, offset, size: img.blob.size });
    parts.push(img.blob);
    offset += img.blob.size;
  }
  counts.images = imgs.length;
  const header: Header = { app: 'orbiz-pos', version: 1, createdAt: now, counts, tables, images: refs };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = String(json.byteLength).padStart(LEN_DIGITS, '0') + '\n';
  const blob = new Blob([MAGIC, len, json, ...parts], { type: 'application/octet-stream' });
  return { blob, filename: `orbiz-pos-backup-${fileStamp(new Date(now))}.orbizpos`, header };
}

/** Call once the file has actually been saved or shared. */
export async function markBackupSaved(header: Header): Promise<void> {
  await db.settings.put({ key: 'lastBackupAt', value: header.createdAt });
  await logEvent('system', 'สำรองข้อมูล', `${header.counts.sales ?? 0} รายการขาย · ${header.counts.images ?? 0} รูป`);
}

export class BackupError extends Error {}

async function readText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

export interface BackupPreview {
  createdAt: number;
  counts: Record<string, number>;
}

async function readHeader(file: Blob): Promise<{ header: Header; dataStart: number }> {
  const magicLen = new TextEncoder().encode(MAGIC).byteLength;
  const head = await readText(file.slice(0, magicLen));
  if (head !== MAGIC) throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ ORBIZ POS');
  const lenText = await readText(file.slice(magicLen, magicLen + LEN_DIGITS + 1));
  const len = Number(lenText.trim());
  if (!Number.isInteger(len) || len <= 0) throw new BackupError('ไฟล์สำรองเสียหาย อ่านไม่ได้');
  const jsonStart = magicLen + LEN_DIGITS + 1;
  let header: Header;
  try {
    header = JSON.parse(await readText(file.slice(jsonStart, jsonStart + len)));
  } catch {
    throw new BackupError('ไฟล์สำรองเสียหาย อ่านไม่ได้');
  }
  if (header.app !== 'orbiz-pos' || header.version !== 1 || typeof header.tables !== 'object') {
    throw new BackupError('ไฟล์สำรองนี้มาจากเวอร์ชันที่ไม่รองรับ');
  }
  return { header, dataStart: jsonStart + len };
}

export async function previewBackup(file: Blob): Promise<BackupPreview> {
  const { header } = await readHeader(file);
  return { createdAt: header.createdAt, counts: header.counts };
}

/** Replace everything on this iPad with the backup's contents. */
export async function restoreBackup(file: Blob): Promise<BackupPreview> {
  const { header, dataStart } = await readHeader(file);
  const images: StoredImage[] = [];
  for (const ref of header.images) {
    if (ref.offset + ref.size + dataStart > file.size) throw new BackupError('ไฟล์สำรองไม่ครบ อาจคัดลอกมาไม่หมด');
    const buf = await file.slice(dataStart + ref.offset, dataStart + ref.offset + ref.size).arrayBuffer();
    images.push({ id: ref.id, kind: ref.kind, createdAt: ref.createdAt, demo: ref.demo, blob: new Blob([buf], { type: ref.type }) });
  }
  await db.transaction('rw', ALL_TABLES.map((t) => db.table(t)), async () => {
    for (const name of ALL_TABLES) await db.table(name).clear();
    for (const name of ALL_TABLES) {
      if (name === 'images') continue;
      const rows = header.tables[name];
      if (Array.isArray(rows) && rows.length) await db.table(name).bulkAdd(rows);
    }
    if (images.length) await db.images.bulkAdd(images);
  });
  await logEvent('system', 'กู้คืนข้อมูลจากไฟล์สำรอง', `ไฟล์วันที่ ${new Date(header.createdAt).toLocaleString('th-TH')}`);
  return { createdAt: header.createdAt, counts: header.counts };
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
