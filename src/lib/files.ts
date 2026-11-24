/**
 * Hand a file to the user. On iPad this opens the share sheet, where "Save to Files"
 * puts it in the Files app. Elsewhere it falls back to a normal download.
 */
export async function saveFile(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  if (isTouch && nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a BOM so Excel and Numbers read Thai text correctly. */
export function toCsv(rows: (string | number)[][]): Blob {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
}
