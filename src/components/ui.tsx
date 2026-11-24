import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Delete, Search, X, AlertCircle } from 'lucide-react';
import { useImageUrl } from '../lib/images';
import { addDays, dayKey, relativeDay } from '../lib/format';
import type { Toast } from '../state/app';

/* ---------- Sheet ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'center',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'center' | 'side';
  labelledBy?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
      el?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div ref={ref} className={`sheet ${variant}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} tabIndex={-1}>
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

/* ---------- Toggle ---------- */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />;
}

/* ---------- Segmented ---------- */

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Search ---------- */

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search">
      <Search size={20} />
      <input
        ref={ref}
        className="input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ref.current?.blur();
        }}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button className="icon-btn clear" aria-label="ล้างคำค้น" onClick={() => onChange('')}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/* ---------- Keypad ---------- */

export function Keypad({ onDigit, onBack, left, disabled }: { onDigit: (d: string) => void; onBack: () => void; left?: ReactNode; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button key={k} className="key num" type="button" onClick={() => onDigit(k)} disabled={disabled} aria-label={k}>
          {k}
        </button>
      ))}
      {left ?? <span />}
      <button className="key num" type="button" onClick={() => onDigit('0')} disabled={disabled} aria-label="0">
        0
      </button>
      <button className="key fn" type="button" onClick={onBack} disabled={disabled} aria-label="ลบตัวเลข">
        <Delete size={24} />
      </button>
    </div>
  );
}

/* ---------- Images ---------- */

export function initials(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const latin = t.match(/[A-Za-z0-9]/g);
  if (latin && /^[A-Za-z0-9]/.test(t)) return latin.slice(0, 2).join('').toUpperCase();
  // Thai: skip leading vowels that can't stand alone visually
  const chars = [...t].filter((c) => /[ก-ฮ]/.test(c));
  return chars[0] ?? t[0];
}

export function ProductImage({ imageId, name }: { imageId: string | null; name: string }) {
  const url = useImageUrl(imageId);
  if (url) return <img src={url} alt="" draggable={false} />;
  return (
    <div className="placeholder-img" aria-hidden>
      <span>{initials(name)}</span>
    </div>
  );
}

export function Thumb({ imageId, name, size }: { imageId: string | null; name: string; size?: number }) {
  return (
    <div className="thumb" style={size ? { width: size, height: size } : undefined}>
      <ProductImage imageId={imageId} name={name} />
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: number }) {
  return (
    <span className="avatar" aria-hidden style={size ? { width: size, height: size, fontSize: size * 0.4 } : undefined}>
      {initials(name)}
    </span>
  );
}

/* ---------- Empty ---------- */

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ---------- DateNav ---------- */

export function DateNav({ value, onChange, max = dayKey() }: { value: string; onChange: (d: string) => void; max?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="date-nav">
      <button className="icon-btn" aria-label="วันก่อนหน้า" onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft size={20} />
      </button>
      <button className="label-btn" onClick={() => inputRef.current?.showPicker?.() ?? inputRef.current?.focus()}>
        {relativeDay(value)}
      </button>
      <input
        ref={inputRef}
        type="date"
        className="sr-only"
        value={value}
        max={max}
        tabIndex={-1}
        aria-label="เลือกวันที่"
        onChange={(e) => e.target.value && onChange(e.target.value > max ? max : e.target.value)}
      />
      <button className="icon-btn" aria-label="วันถัดไป" onClick={() => onChange(addDays(value, 1))} disabled={value >= max}>
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

/* ---------- Toasts ---------- */

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.action ? '' : 'no-action'} ${t.tone === 'error' ? 'error' : ''}`}>
          {t.tone === 'error' ? <AlertCircle size={20} /> : t.tone === 'success' ? <CheckCircle2 size={20} color="#A9DDF5" /> : null}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- File picker (camera / photo library) ---------- */

export function useFilePicker(onFile: (f: File) => void, opts: { capture?: boolean; accept?: string } = {}) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={opts.accept ?? 'image/*'}
      {...(opts.capture ? { capture: 'environment' as const } : {})}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

/* ---------- Busy guard: one tap, one action ---------- */

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return [busy, run] as const;
}
