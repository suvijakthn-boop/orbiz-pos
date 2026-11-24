import { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { PIN_LENGTH, checkPin, isWeakPin, resetWithRecovery, setupPin, confirmPin } from '../../lib/auth';
import { Keypad, Sheet, useBusy } from '../../components/ui';
import { useSettings } from '../../state/app';

export function PinPad({ onComplete, disabled, error, resetKey }: { onComplete: (pin: string) => void; disabled?: boolean; error?: string; resetKey?: number }) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  useEffect(() => {
    setPin('');
    if (error) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [error, resetKey]);
  const push = (d: string) => {
    if (disabled || pin.length >= PIN_LENGTH) return;
    const n = pin + d;
    setPin(n);
    if (n.length === PIN_LENGTH) setTimeout(() => onComplete(n), 90);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key)) push(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <>
      <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-label={`ใส่แล้ว ${pin.length} จาก ${PIN_LENGTH} หลัก`} role="status">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <Keypad onDigit={push} onBack={() => setPin((p) => p.slice(0, -1))} disabled={disabled} />
    </>
  );
}

type Mode = 'enter' | 'setup' | 'setup-confirm' | 'show-recovery' | 'recover-code' | 'recover-pin' | 'recover-confirm';

export function LockScreen({ onUnlock, onExit }: { onUnlock: () => void; onExit: () => void }) {
  const settings = useSettings();
  const hasPin = settings.pin !== null;
  const [mode, setMode] = useState<Mode>(hasPin ? 'enter' : 'setup');
  const [first, setFirst] = useState('');
  const [error, setError] = useState('');
  const [errKey, setErrKey] = useState(0);
  const [recovery, setRecovery] = useState('');
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, run] = useBusy();

  useEffect(() => setMode((m) => (m === 'enter' || m === 'setup' ? (hasPin ? 'enter' : 'setup') : m)), [hasPin]);
  const locked = settings.pinLockedUntil > now;
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const fail = (msg: string) => {
    setError(msg);
    setErrKey((k) => k + 1);
  };

  const onPin = (pin: string) =>
    run(async () => {
      setError('');
      if (mode === 'enter') {
        const r = await checkPin(pin);
        if (r.ok) onUnlock();
        else if (r.locked) {
          setNow(Date.now());
          fail('ใส่ผิดหลายครั้ง รอสักครู่แล้วลองใหม่');
        } else fail(`PIN ไม่ถูกต้อง ลองได้อีก ${r.remaining} ครั้ง`);
      } else if (mode === 'setup' || mode === 'recover-pin') {
        if (isWeakPin(pin)) return fail('PIN นี้เดาง่าย ใช้ตัวเลขที่ไม่เรียงกันหรือซ้ำกัน');
        setFirst(pin);
        setMode(mode === 'setup' ? 'setup-confirm' : 'recover-confirm');
        setErrKey((k) => k + 1);
      } else if (mode === 'setup-confirm' || mode === 'recover-confirm') {
        if (pin !== first) {
          setMode(mode === 'setup-confirm' ? 'setup' : 'recover-pin');
          return fail('PIN สองครั้งไม่ตรงกัน ตั้งใหม่อีกครั้ง');
        }
        if (mode === 'setup-confirm') {
          setRecovery(await setupPin(pin));
          setMode('show-recovery');
        } else {
          const next = await resetWithRecovery(code, pin);
          if (!next) {
            setMode('recover-code');
            return fail('รหัสกู้คืนไม่ถูกต้อง');
          }
          setRecovery(next);
          setMode('show-recovery');
        }
      }
    });

  const secs = Math.max(0, Math.ceil((settings.pinLockedUntil - now) / 1000));
  const titles: Record<Mode, [string, string]> = {
    enter: ['ระบบจัดการ', 'ใส่ PIN ผู้จัดการ 6 หลัก'],
    setup: ['ตั้ง PIN ผู้จัดการ', 'ใช้เปิดระบบจัดการ ตั้งตัวเลข 6 หลักที่เดายาก'],
    'setup-confirm': ['ยืนยัน PIN', 'ใส่ PIN เดิมอีกครั้ง'],
    'show-recovery': ['เก็บรหัสกู้คืน', 'ถ้าลืม PIN ใช้รหัสนี้ตั้ง PIN ใหม่ จดเก็บไว้ในที่ปลอดภัย รหัสนี้จะแสดงครั้งเดียว'],
    'recover-code': ['ลืม PIN', 'ใส่รหัสกู้คืนที่ได้ตอนตั้ง PIN'],
    'recover-pin': ['ตั้ง PIN ใหม่', 'ตั้งตัวเลข 6 หลักที่เดายาก'],
    'recover-confirm': ['ยืนยัน PIN ใหม่', 'ใส่ PIN ใหม่อีกครั้ง'],
  };
  const [title, sub] = titles[mode];

  return (
    <div className="lock">
      <div className="lock-card">
        <div className="lock-icon">{mode === 'show-recovery' ? <ShieldCheck size={30} /> : mode.startsWith('recover') ? <KeyRound size={30} /> : <LockKeyhole size={30} />}</div>
        <h1>{title}</h1>
        <p>{locked && mode === 'enter' ? `ใส่ผิดหลายครั้ง ลองใหม่ได้ใน ${secs} วินาที` : sub}</p>

        {mode === 'show-recovery' ? (
          <>
            <div className="recovery-code num" data-testid="recovery-code">
              {recovery}
            </div>
            <button className="btn btn-accent btn-lg btn-block" onClick={onUnlock}>
              จดรหัสแล้ว เข้าระบบจัดการ
            </button>
          </>
        ) : mode === 'recover-code' ? (
          <>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              aria-label="รหัสกู้คืน"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="msg" role="alert">
              {error}
            </p>
            <button className="btn btn-accent btn-lg btn-block" disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 12} onClick={() => (setError(''), setMode('recover-pin'))}>
              ถัดไป
            </button>
            <button className="link" onClick={() => (setError(''), setMode('enter'))}>
              กลับไปใส่ PIN
            </button>
          </>
        ) : (
          <>
            <PinPad onComplete={onPin} disabled={busy || (locked && mode === 'enter')} error={error} resetKey={errKey} />
            <p className="msg" role="alert">
              {error}
            </p>
            {mode === 'enter' && settings.recovery && (
              <button className="link" onClick={() => (setError(''), setCode(''), setMode('recover-code'))}>
                ลืม PIN
              </button>
            )}
          </>
        )}
        {mode !== 'show-recovery' && (
          <button className="btn btn-ghost" style={{ color: '#c9cbd0' }} onClick={onExit}>
            <ArrowLeft size={18} /> กลับหน้าขายสินค้า
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Confirmation for sensitive actions: shows what will happen, optionally asks for a reason,
 * and always asks for the manager PIN again.
 */
export function PinConfirm({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  reasonLabel,
  reasonPlaceholder,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'reason' | 'pin'>(reasonLabel ? 'reason' : 'pin');
  const [error, setError] = useState('');
  const [errKey, setErrKey] = useState(0);
  const [busy, run] = useBusy();
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
      setStep(reasonLabel ? 'reason' : 'pin');
    }
  }, [open, reasonLabel]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="stack" style={{ gap: 16 }}>
        <div className={`notice ${danger ? 'danger' : 'warning'}`}>
          <div>{description}</div>
        </div>
        {step === 'reason' ? (
          <>
            <div className="field">
              <label className="label" htmlFor="pc-reason">
                {reasonLabel}
              </label>
              <textarea id="pc-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} maxLength={200} data-autofocus />
            </div>
            <button className="btn btn-primary btn-lg btn-block" disabled={!reason.trim()} onClick={() => setStep('pin')}>
              ถัดไป
            </button>
          </>
        ) : (
          <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
            <span className="label">ใส่ PIN ผู้จัดการเพื่อยืนยัน</span>
            <div style={{ width: '100%', maxWidth: 320 }} className="stack">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <PinDotsOnly
                  onComplete={(pin) =>
                    run(async () => {
                      if (!(await confirmPin(pin))) {
                        setError('PIN ไม่ถูกต้อง');
                        setErrKey((k) => k + 1);
                        return;
                      }
                      try {
                        await onConfirm(reason.trim());
                        onClose();
                      } catch (e) {
                        setError((e as Error).message);
                        setErrKey((k) => k + 1);
                      }
                    })
                  }
                  error={error}
                  resetKey={errKey}
                  disabled={busy}
                />
              </div>
            </div>
            <p className="error-text" role="alert" style={{ minHeight: 18 }}>
              {error}
            </p>
            <span className="t-sm muted">{confirmLabel}</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PinDotsOnly(props: { onComplete: (pin: string) => void; error: string; resetKey: number; disabled: boolean }) {
  return (
    <div className="stack pin-light" style={{ alignItems: 'center', width: '100%' }}>
      <PinPad {...props} />
    </div>
  );
}
