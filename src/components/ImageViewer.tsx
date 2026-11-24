import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useImageUrl } from '../lib/images';

interface View {
  scale: number;
  x: number;
  y: number;
}
const MIN = 1;
const MAX = 5;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Full-screen photo with pinch, drag, double-tap and button zoom. */
export function ImageViewer({
  imageId,
  url: directUrl,
  onClose,
  title,
  children,
  onPrev,
  onNext,
}: {
  imageId?: string | null;
  url?: string | null;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const storedUrl = useImageUrl(directUrl ? null : imageId);
  const url = directUrl ?? storedUrl;
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [imageId, directUrl]);

  // Focus the close button once when the viewer opens, not on every render:
  // re-focusing each render pulled focus out of the note field while typing.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === 'Escape') onClose();
      if (typing) return;
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
      if (e.key === '+' || e.key === '=') zoomBy(1.5);
      if (e.key === '-') zoomBy(1 / 1.5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const zoomBy = (f: number) =>
    setView((v) => {
      const scale = clamp(v.scale * f, MIN, MAX);
      return scale === 1 ? { scale: 1, x: 0, y: 0 } : { scale, x: v.x * (scale / v.scale), y: v.y * (scale / v.scale) };
    });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = clamp((pinch.current.scale * dist) / pinch.current.dist, MIN, MAX);
      setView((v) => ({ ...v, scale }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      setView((v) => ({ ...v, x: v.x + (cur.x - prev.x), y: v.y + (cur.y - prev.y) }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setView((v) => (v.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : v));
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="ดูรูปเต็มจอ">
      <div
        className="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
      >
        <div className="viewer-bar">
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="ปิดรูป">
            <X size={22} />
          </button>
          {title && <div style={{ fontWeight: 600 }}>{title}</div>}
          <span className="spacer" />
          {onPrev && (
            <button className="icon-btn" onClick={onPrev} aria-label="รูปก่อนหน้า">
              <ChevronLeft size={22} />
            </button>
          )}
          {onNext && (
            <button className="icon-btn" onClick={onNext} aria-label="รูปถัดไป">
              <ChevronRight size={22} />
            </button>
          )}
        </div>
        {url ? (
          <img
            src={url}
            alt="รูปสลิปการโอนเงิน"
            draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: pointers.current.size ? 'none' : 'transform 160ms ease' }}
          />
        ) : (
          <p style={{ color: '#a1a3a9' }}>ไม่พบรูปนี้ในเครื่อง</p>
        )}
        <div className="viewer-zoom">
          <button className="icon-btn" onClick={() => zoomBy(1 / 1.5)} aria-label="ย่อ" disabled={view.scale <= MIN}>
            <Minus size={20} />
          </button>
          <span className="num">{Math.round(view.scale * 100)}%</span>
          <button className="icon-btn" onClick={() => zoomBy(1.5)} aria-label="ขยาย" disabled={view.scale >= MAX}>
            <Plus size={20} />
          </button>
        </div>
      </div>
      {children && <aside className="viewer-info">{children}</aside>}
    </div>
  );
}
