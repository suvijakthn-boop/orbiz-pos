import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type ImageKind } from './db';

const MAX_EDGE: Record<ImageKind, number> = { slip: 1800, product: 900, logo: 800 };

/**
 * Shrink a photo before storing it. Slips stay sharp enough to read reference numbers;
 * product photos are kept small so the grid stays fast.
 */
export async function compressImage(file: Blob, kind: ImageKind): Promise<Blob> {
  const max = MAX_EDGE[kind];
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น');
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('เปิดรูปนี้ไม่ได้');
  if (kind !== 'logo') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const type = kind === 'logo' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, kind === 'slip' ? 0.82 : 0.85));
  if (!blob) throw new Error('บันทึกรูปไม่สำเร็จ');
  return blob;
}

export async function storeImage(blob: Blob, kind: ImageKind): Promise<string> {
  const id = uid();
  await db.images.add({ id, kind, blob, createdAt: Date.now() });
  return id;
}

/** Object URL for a blob, revoked automatically. */
export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function useImageUrl(id: string | null | undefined): string | null {
  const rec = useLiveQuery(() => (id ? db.images.get(id) : undefined), [id]);
  return useBlobUrl(rec?.blob ?? null);
}
